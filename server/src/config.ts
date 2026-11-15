import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WAGERWAKE_PROGRAM_ID, usdcMintForCluster } from "@wagerwake/shared/chain";
import { PLATFORM_TREASURY } from "@wagerwake/shared";

export interface ServerConfig {
  host: string;
  port: number;
  rpcUrl: string;
  cluster: string;
  programId: PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
  oracle: Keypair;
  chainEnabled: boolean;
  allowConfigInit: boolean;
  feePerPlayer: bigint;
  turnTimeoutMs: number;
  anteTimeoutMs: number;
  corsOrigin: string;
}

function readKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function envBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const cluster = env.SOLANA_CLUSTER ?? "devnet";
  const rpcUrl =
    env.SOLANA_RPC_URL ??
    (cluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : cluster === "localnet"
        ? "http://127.0.0.1:8899"
        : "https://api.devnet.solana.com");
  const oraclePath = env.ORACLE_KEYPAIR ?? env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
  const chainEnabled = envBool(env.CHAIN_ENABLED, false);

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8787),
    rpcUrl,
    cluster,
    programId: env.PROGRAM_ID ? new PublicKey(env.PROGRAM_ID) : WAGERWAKE_PROGRAM_ID,
    usdcMint: env.USDC_MINT ? new PublicKey(env.USDC_MINT) : usdcMintForCluster(cluster),
    treasury: env.TREASURY ? new PublicKey(env.TREASURY) : new PublicKey(PLATFORM_TREASURY),
    oracle: readKeypair(oraclePath),
    chainEnabled,
    allowConfigInit: envBool(env.ALLOW_CONFIG_INIT, false),
    feePerPlayer: BigInt(env.FEE_PER_PLAYER ?? "20000"),
    turnTimeoutMs: Number(env.TURN_TIMEOUT_MS ?? "60000"),
    anteTimeoutMs: Number(env.ANTE_TIMEOUT_MS ?? "60000"),
    corsOrigin: env.CORS_ORIGIN ?? "*",
  };
}
