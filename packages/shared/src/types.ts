/**
 * Shared domain types and protocol constants.
 *
 * This package is intentionally dependency-light (only @noble/hashes) so it can
 * run unchanged in the browser (free-play simulation + verification) and in the
 * Node realtime server (authoritative game state).
 */

export type GameId = "zwanzig-ab";

export type PlayMode = "free" | "wager";

export interface GameMeta {
  id: GameId;
  name: string;
  shortName: string;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  /** The authoritative server advances play one card action at a time. */
  unit: "action";
  rulesPath: string;
}

export const GAMES: Record<GameId, GameMeta> = {
  "zwanzig-ab": {
    id: "zwanzig-ab",
    name: "20 Down",
    shortName: "20 Down",
    blurb: "German trick-taking: start at 20 points and trick your way down to zero.",
    minPlayers: 3,
    maxPlayers: 4,
    unit: "action",
    rulesPath: "/rules/20-down",
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && value in GAMES;
}

export function seatsFor(game: GameId): { min: number; max: number } {
  const meta = GAMES[game];
  return { min: meta.minPlayers, max: meta.maxPlayers };
}

/* ------------------------------------------------------------------ */
/* USDC + wager constants (base units, 6 decimals)                     */
/* ------------------------------------------------------------------ */

export const USDC_DECIMALS = 6;
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PLATFORM_TREASURY = "J59EPyPHf9wtoLjf8rG4f9cARnLnUPKCdNwZX241rakh";

/** 0.10 USDC — the smallest accepted stake. */
export const MIN_STAKE_BASE_UNITS = 100_000n;
/** 1.00 USDC — per-player ceiling, not a cap on the total pot. */
export const MAX_STAKE_BASE_UNITS = 1_000_000n;
/** The only accepted per-player stakes: 0.10, 0.25, 0.50 and 1.00 USDC. */
export const STAKE_PRESETS_BASE_UNITS = [
  100_000n,
  250_000n,
  500_000n,
  1_000_000n,
] as const;
export type StakePresetBaseUnits = (typeof STAKE_PRESETS_BASE_UNITS)[number];
/** 0.02 USDC, charged per player, once when a game finally resolves. */
export const PLATFORM_FEE_PER_PLAYER_BASE_UNITS = 20_000n;

export const TURN_TIMEOUT_MS = 60_000;
export const ANTE_TIMEOUT_MS = 60_000;

export function formatUsdc(baseUnits: bigint | string | number, maxFractionDigits = 2): string {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, maxFractionDigits);
  const trimmed = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

export function parseUsdcToBaseUnits(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error("Invalid USDC amount");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function validateStake(baseUnits: bigint): { ok: true } | { ok: false; reason: string } {
  if (STAKE_PRESETS_BASE_UNITS.some((preset) => preset === baseUnits)) {
    return { ok: true };
  }
  if (baseUnits < MIN_STAKE_BASE_UNITS) {
    return { ok: false, reason: "Stake must be at least 0.10 USDC" };
  }
  if (baseUnits > MAX_STAKE_BASE_UNITS) {
    return { ok: false, reason: "Stake cannot exceed 1.00 USDC" };
  }
  return { ok: false, reason: "Stake must be one of 0.10, 0.25, 0.50 or 1.00 USDC" };
}

/**
 * Fee charged per player, so the table fee scales with seat count. Charged once,
 * at final resolution (not on carry-over rounds).
 */
export function tableFeeBaseUnits(playerCount: number): bigint {
  return PLATFORM_FEE_PER_PLAYER_BASE_UNITS * BigInt(Math.max(0, playerCount));
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/** A single player's submitted result for one round. */
export interface PlayerResult {
  seat: number;
  /** Game-specific primary score, for display and as the default ranking. */
  score: number;
  /** Full lexicographic ranking, higher is better. Defaults to [score]. */
  ranking?: number[];
  /** Extra display metadata (hand summary, trick log...). Never trusted by the program. */
  detail?: string;
}

export interface RoundOutcome {
  /** Seats sharing the top score, in seat order. */
  winners: number[];
  /** True when 2+ seats are tied at the top, or nobody scored. */
  tie: boolean;
  /** Stakes are retained in escrow and a carry-over round is opened. */
  carryOver: boolean;
  /** Populated when the round resolved: base units the winner receives. */
  payoutBaseUnits: bigint;
}

export type VerifyLink = {
  label: string;
  href: string;
};
