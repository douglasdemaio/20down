/**
 * Chain constants and helpers shared by the server, the Next.js app and the
 * devnet end-to-end script.
 *
 * Deliberately dependency-light: only `@solana/web3.js` and
 * `@solana/spl-token`, no Anchor client. Instructions are built by the server
 * (which owns the oracle keypair); the browser only signs.
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { GameId } from "./types.js";
import { USDC_MINT_DEVNET, USDC_MINT_MAINNET } from "./types.js";

export const WAGERWAKE_PROGRAM_ID = new PublicKey(
  "CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt",
);

export const CONFIG_SEED = "config";
export const TABLE_SEED = "table";

export const GAME_CODE: Record<GameId, number> = {
  "ship-captain-crew": 0,
  horses: 1,
  "zwanzig-ab": 2,
};

export const GAME_BY_CODE: Record<number, GameId> = {
  0: "ship-captain-crew",
  1: "horses",
  2: "zwanzig-ab",
};

export const STATE_WAITING = 0;
export const STATE_IN_PROGRESS = 1;
export const STATE_ANTE = 2;
export const STATE_RESOLVED = 3;
export const STATE_VOIDED = 4;

export const NO_WINNER = 255;
export const MAX_SEATS = 8;
export const ANTE_TIMEOUT_SECS = 60;
export const HARD_MIN_STAKE = 10_000n;
export const HARD_MAX_STAKE = 1_000_000n;

export function configPda(programId: PublicKey = WAGERWAKE_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId);
}

export function tablePda(
  creator: PublicKey,
  tableId: bigint,
  programId: PublicKey = WAGERWAKE_PROGRAM_ID,
): [PublicKey, number] {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(tableId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TABLE_SEED), creator.toBuffer(), id],
    programId,
  );
}

export function escrowPda(
  table: PublicKey,
  mint: PublicKey,
  tokenProgramId?: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, table, true, tokenProgramId);
}

export function playerAta(mint: PublicKey, player: PublicKey, tokenProgramId?: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, player, false, tokenProgramId);
}

export function usdcMintForCluster(cluster: string): PublicKey {
  return new PublicKey(cluster === "mainnet-beta" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET);
}

export function explorerTxUrl(cluster: string, signature: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(cluster: string, address: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export interface OnChainTable {
  id: bigint;
  creator: PublicKey;
  game: number;
  stake: bigint;
  fee: bigint;
  maxPlayers: number;
  playerCount: number;
  seats: PublicKey[];
  ready: boolean[];
  active: boolean[];
  antedRound: number[];
  state: number;
  round: number;
  potStakes: bigint;
  potFees: bigint;
  seedCommitment: Uint8Array;
  seed: Uint8Array;
  vrfDigest: Uint8Array;
  vrfFulfilled: boolean;
  resolved: boolean;
  winnerSeat: number;
  roundStartedAt: bigint;
  anteDeadline: bigint;
  refunded: boolean[];
  bump: number;
}

class Reader {
  private offset = 0;
  constructor(private readonly data: Buffer) {}

  u8(): number {
    const value = this.data.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    const value = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u64(): bigint {
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  i64(): bigint {
    const value = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Uint8Array {
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new Uint8Array(value);
  }

  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
}

/**
 * Decodes the Anchor `Table` account (8-byte discriminator + fixed fields).
 * Mirrors `programs/wagerwake/src/state.rs`.
 */
export function decodeTable(data: Uint8Array): OnChainTable {
  const reader = new Reader(Buffer.from(data));
  reader.bytes(8); // discriminator
  const table: OnChainTable = {
    id: reader.u64(),
    creator: reader.pubkey(),
    game: reader.u8(),
    stake: reader.u64(),
    fee: reader.u64(),
    maxPlayers: reader.u8(),
    playerCount: reader.u8(),
    seats: Array.from({ length: MAX_SEATS }, () => reader.pubkey()),
    ready: Array.from({ length: MAX_SEATS }, () => reader.bool()),
    active: Array.from({ length: MAX_SEATS }, () => reader.bool()),
    antedRound: Array.from({ length: MAX_SEATS }, () => reader.u16()),
    state: reader.u8(),
    round: reader.u16(),
    potStakes: reader.u64(),
    potFees: reader.u64(),
    seedCommitment: reader.bytes(32),
    seed: reader.bytes(32),
    vrfDigest: reader.bytes(32),
    vrfFulfilled: reader.bool(),
    resolved: reader.bool(),
    winnerSeat: reader.u8(),
    roundStartedAt: reader.i64(),
    anteDeadline: reader.i64(),
    refunded: Array.from({ length: MAX_SEATS }, () => reader.bool()),
    bump: reader.u8(),
  };
  return table;
}

export const TABLE_DISCRIMINATOR = new Uint8Array([34, 100, 138, 97, 236, 129, 230, 112]);
export const CONFIG_DISCRIMINATOR = new Uint8Array([155, 12, 170, 224, 30, 250, 204, 130]);
