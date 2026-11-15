/**
 * Realtime protocol shared by the Node game server and the browser client.
 *
 * Every message is plain JSON. The server is authoritative for all game state;
 * the client only ever sends intents (which dice to reroll, which card to play)
 * and never computes an outcome that is paid out.
 */

import type { Suit, ZwanzigView } from "./games/zwanzig.js";
import type { GameId, PlayMode } from "./types.js";

export type RoomState = "waiting" | "starting" | "in-progress" | "ante" | "resolved" | "voided";

export type RoomPhase =
  | "lobby"
  | "countdown"
  | "trump"
  | "exchange"
  | "play"
  | "scored"
  | "ante"
  | "resolved"
  | "voided";

export interface SeatPublic {
  seat: number;
  name: string;
  connected: boolean;
  ready: boolean;
  isBot: boolean;
  wallet: string | null;
  active: boolean;
  anted: boolean;
  /** Set once the seat has finished its turn in the current round. */
  done: boolean;
}

export interface DicePublicState {
  /** 1-based roll within the current turn. */
  rollNumber: number;
  dice: number[];
  locked: boolean[];
  stage: number;
  qualified: boolean;
  cargoDice: number[];
  cargoScore: number;
  rollsUsed: number;
  rollLimit: number;
  canReroll: boolean;
  canStand: boolean;
}

export interface RoundResultRow {
  seat: number;
  name: string;
  score: number;
  ranking: number[];
  detail: string;
  winner: boolean;
}

export interface RoundSummary {
  round: number;
  rows: RoundResultRow[];
  tie: boolean;
  winners: number[];
  carryOver: boolean;
  seedCommitment?: string | null;
  /** Published only after the round is over. */
  seed?: string | null;
  /** Settlement transaction, when playing for USDC. */
  signature?: string | null;
}

export interface ChainStatus {
  enabled: boolean;
  cluster: string | null;
  tablePda: string | null;
  escrowPda: string | null;
  createSignature: string | null;
  lastSignature: string | null;
  /** Human-readable state of the on-chain leg. */
  status: string;
  explorerUrl: string | null;
}

export interface RoomView {
  id: string;
  game: GameId;
  gameName: string;
  mode: PlayMode;
  /** Stake per player per round, in USDC base units. */
  stake: string | null;
  /** Platform fee per player, in USDC base units. */
  fee: string | null;
  state: RoomState;
  phase: RoomPhase;
  round: number;
  minPlayers: number;
  maxPlayers: number;
  seats: SeatPublic[];
  hostSeat: number;
  yourSeat: number | null;
  currentSeat: number | null;
  turnDeadline: number | null;
  serverTime: number;
  potStakes: string;
  potFees: string;
  seedCommitment: string | null;
  revealedSeed: string | null;
  vrfDigest: string | null;
  dice: DicePublicState | null;
  diceBySeat: Array<DicePublicState | null>;
  zwanzig: ZwanzigView | null;
  lastRound: RoundSummary | null;
  winnerSeat: number | null;
  verifyUrl: string | null;
  chain: ChainStatus | null;
  notice: string | null;
  anteDeadline: number | null;
  turnTimeoutMs: number;
}

export interface LobbyTable {
  id: string;
  game: GameId;
  gameName: string;
  mode: PlayMode;
  stake: string | null;
  seats: number;
  maxPlayers: number;
  minPlayers: number;
  state: RoomState;
  hostName: string;
}

export interface TxRequest {
  kind: "join" | "ante" | "leave";
  tablePda: string;
  player: string;
}

export interface TxResponse {
  transaction: string;
  /** Human-readable hint for the client. */
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Client -> server                                                    */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  | { type: "hello"; playerId?: string; name?: string; wallet?: string }
  | { type: "lobby" }
  | {
      type: "create";
      game: GameId;
      mode: PlayMode;
      stakeBaseUnits?: string;
      name?: string;
      wallet?: string;
      vsBots?: boolean;
      maxPlayers?: number;
    }
  | { type: "join"; tableId: string; name?: string; wallet?: string }
  | { type: "leave" }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "reroll"; mask: number }
  | { type: "stand" }
  | { type: "trump"; suit: Suit }
  | { type: "exchange"; cards: string[] }
  | { type: "announce"; play: boolean }
  | { type: "playCard"; card: string }
  | { type: "nextDeal" }
  | { type: "deposited"; signature: string }
  | { type: "chat"; text: string }
  | { type: "ping" };

/* ------------------------------------------------------------------ */
/* Server -> client                                                    */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  | { type: "welcome"; playerId: string; name: string; serverTime: number }
  | { type: "lobby"; tables: LobbyTable[] }
  | { type: "room"; room: RoomView }
  | { type: "left" }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "chat"; seat: number; name: string; text: string; at: number }
  | { type: "pong"; serverTime: number };

/** Type guard for messages arriving over the wire. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && CLIENT_MESSAGE_TYPES.has(type as ClientMessage["type"]);
}

const CLIENT_MESSAGE_TYPES = new Set<ClientMessage["type"]>([
  "hello",
  "lobby",
  "create",
  "join",
  "leave",
  "ready",
  "start",
  "reroll",
  "stand",
  "trump",
  "exchange",
  "announce",
  "playCard",
  "nextDeal",
  "deposited",
  "chat",
  "ping",
]);

export const WS_PATH = "/ws";
export const LOBBY_PATH = "/api/lobby";
export const TX_PATH = "/api/tx";
export const TX_SUBMIT_PATH = "/api/tx/submit";
export const HEALTH_PATH = "/health";
