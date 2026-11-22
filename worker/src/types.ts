import type { PlayMode } from "@20down/shared";
import type { LobbyTable, RoomView, ServerMessage } from "@20down/shared/protocol";
import type { LobbyDurableObject } from "./do/lobby.js";
import type { TableDurableObject } from "./do/table.js";

export interface Env {
  LOBBY_DO: DurableObjectNamespace<LobbyDurableObject>;
  TABLE_DO: DurableObjectNamespace<TableDurableObject>;
  ALLOWED_ORIGINS: string;
  GEO_BLOCKLIST: string;
  WAGERING_ENABLED: string;
  CLUSTER: string;
  USDC_MINT: string;
  PROGRAM_ID: string;
  RPC_URL: string;
  EXPLORER_CLUSTER_SUFFIX: string;
}

export interface LobbyConnectionState {
  playerId: string;
  name: string;
  wallet: string | null;
  roomId: string | null;
  country: string | null;
}

export interface TableConnectionState extends LobbyConnectionState {
  tableId: string;
}

export interface PublicTableRecord extends LobbyTable {
  /** Quick match only considers public tables. */
  publicTable: boolean;
  /** Internal sort key; not exposed over the wire. */
  createdAt: number;
}

export interface TableCreateInput {
  id: string;
  mode: PlayMode;
  stakeBaseUnits: bigint;
  maxPlayers: 3 | 4;
  hostPlayerId: string;
  hostName: string;
  hostWallet: string | null;
  vsBots: boolean;
  publicTable: boolean;
  turnTimeoutMs: number;
  anteTimeoutMs: number;
  cluster: string;
  wageringEnabled: boolean;
}

export interface TableResult {
  view: RoomView;
  lobby: PublicTableRecord;
}

export interface PublishRoomInput {
  roomId: string;
  /** Personalized views keyed by player id, so hole cards never cross seats. */
  views: Record<string, RoomView>;
  fallback: RoomView;
}

export interface PublishMessageInput {
  roomId: string;
  playerIds?: string[];
  message: ServerMessage;
}

export interface CanLeaveResult {
  ok: boolean;
  reason?: string;
}
