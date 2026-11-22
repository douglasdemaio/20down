/**
 * 20 Down — legacy devnet bootstrap.
 *
 * Historical helper for the retained devnet Anchor program only. The new
 * mainnet product does not use this script.
 *
 * Prepares a funded wallet + token state for wager play:
 *   1. Loads (or generates) the oracle keypair.
 *   2. Airdrops SOL if the RPC faucet permits.
 *   3. Creates the treasury's USDC token account (needed to receive fees).
 *   4. Optionally mints test USDC to player wallets when a mint authority
 *      keypair is supplied (devnet / localnet only — mainnet funds are real USDC).
 *
 * The server itself initializes the program config when ALLOW_CONFIG_INIT=true,
 * so this script does not fight an already-deployed config.
 *
 * Usage:
 *   npx tsx scripts/init-devnet.ts \
 *     [--oracle ~/.config/solana/id.json] \
 *     [--mint <USDC_MINT>] \
 *     [--fund-player keypair.json ...] \
 *     [--test-mint-authority authority.json [--test-mint mint.json]] \
 *     [--mint-amount 100000000]
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { PLATFORM_TREASURY, USDC_MINT_DEVNET, USDC_MINT_MAINNET } from "@20down/shared";

const CLUSTER = process.env.SOLANA_CLUSTER ?? "devnet";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`);

const ORACLE_WARMUPS = 0.002 * LAMPORTS_PER_SOL;

function parseArgs(argv: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i] as string;
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const values: string[] = [];
    while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) {
      values.push(argv[++i] as string);
    }
    out[key] = values;
  }
  return out;
}

function resolvePath(path: string): string {
  return path.startsWith("~") ? path.replace("~", process.env.HOME ?? "") : path;
}

function loadKeypair(path: string): Keypair | null {
  if (!path) return null;
  try {
    if (!existsSync(resolvePath(path))) return null;
    const raw = JSON.parse(readFileSync(resolvePath(path), "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    return null;
  }
}

function saveKeypair(path: string, keypair: Keypair): void {
  writeFileSync(resolvePath(path), JSON.stringify(Array.from(keypair.secretKey)));
}

function short(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function confirm(connection: Connection, signature: string): Promise<string> {
  return connection
    .getLatestBlockhash("confirmed")
    .then((hash) => connection.confirmTransaction({ signature, ...hash }, "confirmed"))
    .then(() => signature);
}

async function airdrop(connection: Connection, publicKey: PublicKey): Promise<boolean> {
  try {
    const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
    await confirm(connection, signature);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const connection = new Connection(RPC_URL, "confirmed");
  console.log(`[init] cluster ${CLUSTER} rpc ${RPC_URL}`);

  // 1. Oracle ---------------------------------------------------------------
  const oraclePath =
    args.oracle?.[0] ??
    process.env.ORACLE_KEYPAIR ??
    process.env.ANCHOR_WALLET ??
    "~/.config/solana/id.json";
  let oracle = loadKeypair(oraclePath);
  if (!oracle) {
    if (CLUSTER === "mainnet-beta") {
      console.error(`[init] refusing to generate a keypair for mainnet. Fund ${oraclePath} first.`);
      process.exit(1);
    }
    oracle = Keypair.generate();
    saveKeypair(oraclePath, oracle);
    console.log(`[init] generated oracle keypair at ${oraclePath}`);
  }
  console.log(`[init] oracle ${oracle.publicKey.toBase58()}`);

  // 2. SOL ------------------------------------------------------------------
  let balance = await connection.getBalance(oracle.publicKey);
  if (balance < ORACLE_WARMUPS && CLUSTER !== "mainnet-beta") {
    console.log("[init] requesting SOL airdrop…");
    if (await airdrop(connection, oracle.publicKey)) {
      balance = await connection.getBalance(oracle.publicKey);
    } else {
      console.warn(
        `[init] airdrop failed — fund ${oracle.publicKey.toBase58()} manually before starting wager tables.`,
      );
    }
  }
  console.log(`[init] oracle balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // 3. USDC mint & treasury --------------------------------------------------
  const mintArg = args.mint?.[0] ?? process.env.USDC_MINT ?? USDC_MINT_DEVNET;
  const usdcMint = new PublicKey(
    CLUSTER === "mainnet-beta" && !args.mint?.[0] && !process.env.USDC_MINT
      ? USDC_MINT_MAINNET
      : mintArg,
  );
  const treasury = new PublicKey(process.env.TREASURY ?? PLATFORM_TREASURY);
  const treasuryAta = getAssociatedTokenAddressSync(usdcMint, treasury);

  const ataInfo = await connection.getAccountInfo(treasuryAta);
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        oracle.publicKey,
        treasuryAta,
        treasury,
        usdcMint,
      ),
    );
    const signature = await confirm(
      connection,
      await connection.sendTransaction(tx, [oracle], { skipPreflight: false }),
    );
    console.log(`[init] created treasury USDC account: ${signature}`);
  } else {
    console.log(`[init] treasury USDC account ready ${short(treasuryAta.toBase58())}`);
  }

  // 4. Optional: mint free test USDC to players ------------------------------
  const mintAuthority = loadKeypair(args["test-mint-authority"]?.[0] ?? "");
  if (mintAuthority) {
    if (CLUSTER === "mainnet-beta") {
      console.error("[init] refusing to mint test tokens on mainnet.");
      process.exit(1);
    }
    let mintKeypair = loadKeypair(args["test-mint"]?.[0] ?? "");
    let mintAddress: PublicKey;
    if (mintKeypair) {
      mintAddress = mintKeypair.publicKey;
      console.log(`[init] reusing test mint ${mintAddress.toBase58()}`);
    } else {
      mintAddress = await createMint(
        connection,
        oracle,
        mintAuthority.publicKey,
        mintAuthority.publicKey,
        6,
        Keypair.generate(),
        undefined,
      );
      console.log(`[init] created test mint ${mintAddress.toBase58()}`);
      if (args["test-mint"]?.[0]) {
        // Best-effort persistence so a re-run can reuse the mint.
        try {
          saveKeypair(args["test-mint"][0], Keypair.fromSecretKey(mintAddress.toBytes()));
        } catch {
          // Mint derived from createMint's keypair — addressed via authority.
        }
      }
    }
    console.log(
      `[init] set USDC_MINT=${mintAddress.toBase58()} and NEXT_PUBLIC_USDC_MINT=${mintAddress.toBase58()}`,
    );

    const fundAmount = Number(BigInt(args["mint-amount"]?.[0] ?? "100000000"));
    for (const playerPath of args["fund-player"] ?? []) {
      const player = loadKeypair(playerPath);
      if (!player) {
        console.warn(`[init] skipping unreadable keypair ${playerPath}`);
        continue;
      }
      const playerAta = getAssociatedTokenAddressSync(mintAddress, player.publicKey);
      if (!(await connection.getAccountInfo(playerAta))) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(oracle.publicKey, playerAta, player.publicKey, mintAddress),
        );
        const signature = await confirm(connection, await connection.sendTransaction(tx, [oracle]));
        console.log(`[init] token account created for ${short(player.publicKey.toBase58())} (${signature})`);
      }
      const mintSignature = await mintTo(
        connection,
        oracle,
        mintAddress,
        playerAta,
        mintAuthority,
        fundAmount,
      );
      console.log(
        `[init] minted ${(fundAmount / 1_000_000).toFixed(2)} test USDC to ${short(player.publicKey.toBase58())} (${mintSignature})`,
      );
    }
  } else {
    console.log(`[init] USDC mint ${usdcMint.toBase58()}`);
  }

  // 5. Wrap up --------------------------------------------------------------
  console.log(`[init] treasury receives 0.02 USDC per player per game: ${treasury.toBase58()}`);
  console.log("[init] start the server with CHAIN_ENABLED=true (and ALLOW_CONFIG_INIT=true on a fresh deployment);");
  console.log("[init] wager table creation then initializes the program config on first use.");
}

void main().catch((error: unknown) => {
  console.error("[init] fatal:", error);
  process.exit(1);
});
