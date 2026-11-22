/**
 * Dice & Cards — end-to-end wager round against a live cluster + hub.
 *
 * Boots the realtime hub exactly like production, then drives the complete
 * browser↔server↔program flow for two players:
 *
 *   1. start hub (createHubServer, CHAIN_ENABLED=true)
 *   2. player A creates a wager table via WS → on-chain table + escrow PDA
 *   3. both players POST /api/tx, sign with their own keypairs, POST /api/tx/submit
 *   4. the hub sees deposits and starts the on-chain game (start_game)
 *   5. a Ship, Captain & Crew round is played through reroll/stand messages
 *      (tied rounds auto re-ante the same stake, exactly like the UI)
 *   6. the seed is revealed on-chain and `resolve_dice_round` pays the winner
 *      from escrow, sweeping the fee pot to the treasury
 *   7. assertions:
 *        winner USDC delta = (2*stake − deposit) × rounds played
 *        loser  USDC delta = −deposit × rounds played
 *        escrow token account is empty
 *
 * Signing is never bypassed: every deposit needs a real player signature, the
 * same shape a Phantom or Solflare wallet produces in the browser.
 *
 * Usage (localnet with `solana-test-validator`, or devnet with funded wallets):
 *   npx tsx scripts/e2e-devnet.ts \
 *     --oracle ~/.config/solana/id.json \
 *     --player-a ~/.config/solana/playerA.json \
 *     --player-b ~/.config/solana/playerB.json
 */

import { readFileSync, existsSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import WebSocket from "ws";
import { createHubServer } from "../server/src/index";
import { loadConfig } from "../server/src/config";
import { formatUsdc } from "@20down/shared";

const STAKE = 10_000n; // 0.01 USDC stake per player
const FEE = 20_000n; // 0.02 USDC platform fee (charged once)
const DEPOSIT = STAKE + FEE;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function loadKeypair(path: string | undefined, label: string): Keypair {
  if (!path) {
    console.error(`[e2e] missing ${label} keypair — pass --${label.replace(/_/g, "-")}`);
    process.exit(1);
  }
  const full = path.startsWith("~") ? path.replace("~", process.env.HOME ?? "") : path;
  if (!existsSync(full)) {
    console.error(`[e2e] keypair file not found: ${full}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(full, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const short = (key: string): string => `${key.slice(0, 4)}…${key.slice(-4)}`;

interface SeatSnapshot {
  seat: number;
  name: string;
  ready: boolean;
  anted: boolean;
  active: boolean;
}

interface DiceSnapshot {
  rollNumber: number;
  dice: number[];
  locked: boolean[];
  qualified: boolean;
  cargoDice: number[];
  cargoScore: number;
  canReroll: boolean;
  canStand: boolean;
}

interface RoomSnapshot {
  id: string;
  game: string;
  state: "waiting" | "starting" | "in-progress" | "ante" | "resolved" | "voided";
  phase: string;
  round: number;
  yourSeat: number | null;
  currentSeat: number | null;
  seats: SeatSnapshot[];
  dice: DiceSnapshot | null;
  lastRound: { round: number; tie: boolean; signature?: string | null } | null;
  chain: {
    tablePda: string | null;
    escrowPda: string | null;
    status: string;
    lastSignature: string | null;
  } | null;
  notice: string | null;
}

interface ServerMessage {
  type: string;
  room?: RoomSnapshot;
  error?: string;
}

class WsClient {
  private readonly socket: WebSocket;
  private readonly queue: ServerMessage[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.queue.push(JSON.parse(String(event.data)) as ServerMessage);
    });
  }

  static open(url: string, timeoutMs = 10_000): Promise<WsClient> {
    return new Promise<WsClient>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("connect timed out")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new WsClient(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("websocket error while connecting"));
      });
    });
  }

  send(payload: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(payload));
  }

  close(): void {
    this.socket.close();
  }

  room(filter?: (room: RoomSnapshot) => boolean, timeoutMs = 120_000): Promise<RoomSnapshot> {
    return new Promise<RoomSnapshot>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for a matching room update")),
        timeoutMs,
      );
      const scan = (): void => {
        for (let index = 0; index < this.queue.length; index += 1) {
          const message = this.queue[index];
          const room = message?.room;
          if (room && (!filter || filter(room))) {
            this.queue.splice(0, index + 1);
            clearTimeout(timer);
            resolve(room);
            return;
          }
        }
        setTimeout(scan, 120);
      };
      scan();
    });
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T & { error?: string };
}

async function signAndSubmit(
  httpBase: string,
  kind: "join" | "ante" | "leave",
  tablePda: string,
  player: Keypair,
): Promise<string> {
  const built = await postJson<{ transaction: string }>(`${httpBase}/api/tx`, {
    kind,
    tablePda,
    player: player.publicKey.toBase58(),
  });
  if (!built.transaction) throw new Error(`building ${kind} tx failed: ${built.error}`);

  const transaction = Transaction.from(Buffer.from(built.transaction, "base64"));
  transaction.sign(player);
  const encoded = Buffer.from(transaction.serialize()).toString("base64");

  const result = await postJson<{ signature: string }>(`${httpBase}/api/tx/submit`, {
    transaction: encoded,
    tablePda,
    player: player.publicKey.toBase58(),
  });
  if (!result.signature) throw new Error(`submitting ${kind} tx failed: ${result.error}`);
  return result.signature;
}

async function tokenBalance(connection: Connection, account: PublicKey): Promise<bigint> {
  const parsed = await connection.getTokenAccountBalance(account);
  return BigInt(parsed.value.amount);
}

class Fatal extends Error {}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  process.env.CHAIN_ENABLED = process.env.CHAIN_ENABLED ?? "true";
  process.env.ALLOW_CONFIG_INIT = process.env.ALLOW_CONFIG_INIT ?? "true";
  if (!process.env.ORACLE_KEYPAIR && argValue(args, "--oracle")) {
    process.env.ORACLE_KEYPAIR = argValue(args, "--oracle");
  }
  if (process.env.SOLANA_CLUSTER === "mainnet-beta") {
    console.error("[e2e] this script targets devnet / localnet only.");
    process.exit(1);
  }

  const oracle = loadKeypair(argValue(args, "--oracle") ?? process.env.ORACLE_KEYPAIR, "oracle");
  const playerA = loadKeypair(argValue(args, "--player-a"), "player-a");
  const playerB = loadKeypair(argValue(args, "--player-b"), "player-b");
  console.log(`[e2e] players ${playerA.publicKey.toBase58()} / ${playerB.publicKey.toBase58()}`);

  const config = loadConfig(process.env);
  const running = createHubServer(config);
  await new Promise<void>((resolve) =>
    running.http.listen(0, "127.0.0.1", resolve),
  );
  const address = running.http.address();
  if (!address || typeof address === "string") throw new Fatal("hub did not bind a TCP port");
  const httpBase = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  console.log(
    `[e2e] hub on ${httpBase} — cluster ${config.cluster}, chain ${config.chainEnabled ? "on" : "off"}, mint ${config.usdcMint.toBase58()}`,
  );

  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = config.usdcMint;
  const ataOf = (player: Keypair) => getAssociatedTokenAddressSync(mint, player.publicKey);

  try {
    // Seed SOL for fee payments (devnet only; localnet validator airdrops).
    for (const player of [playerA, playerB]) {
      const lamports = await connection.getBalance(player.publicKey);
      if (lamports < 0.005 * LAMPORTS_PER_SOL) {
        try {
          const signature = await connection.requestAirdrop(player.publicKey, LAMPORTS_PER_SOL);
          await connection.getLatestBlockhash().then(async (hash) => {
            await connection.confirmTransaction({ signature, ...hash }, "confirmed");
          });
        } catch {
          console.warn(`[e2e] ${short(player.publicKey.toBase58())} needs SOL for fees — fund it manually.`);
        }
      }
    }

    // Each player's USDC token account must exist and be funded.
    for (const player of [playerA, playerB]) {
      const ata = ataOf(player);
      if (!(await connection.getAccountInfo(ata))) {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(oracle.publicKey, ata, player.publicKey, mint),
        );
        const signature = await connection.sendTransaction(tx, [oracle], { skipPreflight: false });
        await connection.getLatestBlockhash().then(async (hash) => {
          await connection.confirmTransaction({ signature, ...hash }, "confirmed");
        });
        console.log(`[e2e] created USDC account for ${short(player.publicKey.toBase58())}`);
      }
      const balance = await tokenBalance(connection, ata);
      if (balance < DEPOSIT) {
        throw new Fatal(
          `${player.publicKey.toBase58()} holds ${balance} USDC base units, needs ${DEPOSIT}. ` +
            "Fund both players first (scripts/init-devnet.ts --test-mint-authority … --fund-player …) and rerun.",
        );
      }
    }

    const beforeA = await tokenBalance(connection, ataOf(playerA));
    const beforeB = await tokenBalance(connection, ataOf(playerB));

    // Connect over the real socket protocol.
    const clientA = await WsClient.open(wsUrl);
    const clientB = await WsClient.open(wsUrl);
    clientA.send({ type: "hello", name: "Player A", wallet: playerA.publicKey.toBase58() });
    clientB.send({ type: "hello", name: "Player B", wallet: playerB.publicKey.toBase58() });
    // The first room snapshot arrives in response to the create/join below; the
    // welcome and lobby messages are already queued in each socket.

    // Player A creates a wager table; the hub races create_table on-chain.
    clientA.send({
      type: "create",
      game: "ship-captain-crew",
      mode: "wager",
      stakeBaseUnits: STAKE.toString(),
      name: "Player A",
      wallet: playerA.publicKey.toBase58(),
    });
    const created = await clientA.room(
      (room) => room.chain?.tablePda !== undefined || room.chain?.tablePda === null,
      30_000,
    );
    let tablePda = created.chain?.tablePda;
    if (!tablePda) {
      // allow the hub a beat to finish create_table, then read the next view
      const retry = await clientA.room((room) => Boolean(room.chain?.tablePda), 30_000);
      tablePda = retry.chain?.tablePda ?? null;
    }
    if (!tablePda) throw new Fatal("create_table never produced a table PDA");
    const escrow = new PublicKey(created.chain?.escrowPda ?? "");
    console.log(`[e2e] table ${tablePda} escrow ${escrow.toBase58()} (room ${created.id})`);

    // Player B joins.
    clientB.send({
      type: "join",
      tableId: created.id,
      name: "Player B",
      wallet: playerB.publicKey.toBase58(),
    });
    await clientB.room((room) => room.yourSeat !== null && room.seats.length >= 2, 30_000);

    // Deposits: build → sign → submit per player, like the browser flow.
    for (const [label, player, client] of [
      ["A", playerA, clientA],
      ["B", playerB, clientB],
    ] as const) {
      const depositSignature = await signAndSubmit(httpBase, "join", tablePda, player);
      console.log(`[e2e] ${label} deposit tx ${depositSignature}`);
      const updated = await client.room(
        (room) => room.seats.every((seat) => seat.ready) && room.seats.length >= 2,
        30_000,
      );
      if (updated.state === "waiting") throw new Fatal("hub did not register the deposits");
    }
    await clientA.room((room) => room.state !== "waiting", 60_000);
    console.log("[e2e] game started on-chain");

    // Drive both seats: act whenever it is our turn; re-ante on ties.
    const drive = async (client: WsClient, player: Keypair, label: string): Promise<RoomSnapshot> => {
      for (;;) {
        const room = await client.room(
          (candidate) =>
            candidate.state === "resolved" ||
            candidate.state === "voided" ||
            candidate.state === "ante" ||
            (candidate.currentSeat === candidate.yourSeat && candidate.dice !== null) ||
            (candidate.state === "waiting" && candidate.yourSeat !== null && !candidate.seats[candidate.yourSeat]?.ready),
          60_000,
        );

        if (room.state === "resolved" || room.state === "voided") return room;

        if (room.state === "waiting" && room.yourSeat !== null && !room.seats.find((seat) => seat.seat === room.yourSeat)?.ready) {
          // Seat was not marked; resend the deposit handshake.
          await signAndSubmit(httpBase, "join", tablePda, player);
          continue;
        }

        if (room.state === "ante") {
          const mySeat = room.seats.find((seat) => seat.seat === room.yourSeat);
          if (mySeat && !mySeat.anted) {
            const anteSignature = await signAndSubmit(httpBase, "ante", tablePda, player);
            console.log(`[e2e] ${label} re-ante tx ${anteSignature}`);
          }
          continue;
        }

        if (room.yourSeat !== null && room.currentSeat === room.yourSeat && room.dice) {
          const dice = room.dice;
          if (dice.canStand && dice.rollNumber < 3 && (!dice.qualified || dice.cargoScore < 9)) {
            let mask = 0;
            for (let index = 0; index < dice.locked.length; index += 1) {
              if (!dice.locked[index]) mask |= 1 << index;
            }
            if (mask !== 0) {
              client.send({ type: "reroll", mask });
              continue;
            }
          }
          client.send({ type: "stand" });
          continue;
        }
      }
    };

    const [, resolved] = await Promise.all([
      drive(clientA, playerA, "A"),
      drive(clientB, playerB, "B"),
    ]);

    if (resolved.state === "voided") throw new Fatal("the table was voided");
    const settleSignature = resolved.chain?.lastSignature ?? "";
    if (!settleSignature) throw new Fatal("no settlement signature published");
    console.log(`[e2e] settlement tx ${settleSignature} (round ${resolved.round})`);

    // On-chain verification: payout swept to the winner; escrow drained.
    const settle = await connection.confirmTransaction(settleSignature, "confirmed");
    if (settle.value.err) {
      throw new Fatal(`settlement failed on-chain: ${JSON.stringify(settle.value.err)}`);
    }

    const rounds = BigInt(resolved.round);
    const expectedWinner = (2n * STAKE - DEPOSIT) * rounds;
    const expectedLoser = -DEPOSIT * rounds;
    const afterA = await tokenBalance(connection, ataOf(playerA));
    const afterB = await tokenBalance(connection, ataOf(playerB));
    const deltaA = afterA - beforeA;
    const deltaB = afterB - beforeB;
    const winnerDelta = deltaA === expectedWinner ? deltaA : deltaB === expectedWinner ? deltaB : null;
    if (winnerDelta === null) {
      throw new Fatal(
        `unexpected payouts: A moved ${deltaA}, B moved ${deltaB}; expected ${expectedWinner} / ${expectedLoser}`,
      );
    }
    const residualEscrow = await tokenBalance(connection, escrow);
    if (residualEscrow !== 0n) {
      throw new Fatal(`escrow was not fully swept: ${residualEscrow} base units remain`);
    }

    console.log(
      `[e2e] payouts verified across ${resolved.round} round(s) — A ${deltaA >= 0 ? "+" : ""}${deltaA}, B ${deltaB >= 0 ? "+" : ""}${deltaB} base units (stake ${formatUsdc(STAKE)} USDC, fee ${formatUsdc(FEE)}). PASS.`,
    );
    clientA.close();
    clientB.close();
  } catch (error) {
    console.error("[e2e] FAIL:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await running.close();
  }
}

if (process.argv[1]?.endsWith("e2e-devnet.ts")) {
  void main().catch((error: unknown) => {
    console.error("[e2e] fatal:", error);
    process.exit(1);
  });
}
