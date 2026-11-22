import { DurableObject } from "cloudflare:workers";
import { isGameId, validateStake } from "@20down/shared";
import {
  isClientMessage,
  type ClientMessage,
  type LobbyTable,
  type RoomView,
  type ServerMessage,
} from "@20down/shared/protocol";
import { wageringEnabled } from "../config.js";
import { newPlayerId, newTableId } from "../lib/ids.js";
import type {
  Env,
  LobbyConnectionState,
  PublishMessageInput,
  PublishRoomInput,
  PublicTableRecord,
  TableResult,
} from "../types.js";

/** Single named Durable Object: registry, quick match and client socket hub. */
export class LobbyDurableObject extends DurableObject<Env> {
  private tables: PublicTableRecord[] = [];
  private publicTableIds = new Set<string>();
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;
    this.ctx.acceptWebSocket(server);

    const connection: LobbyConnectionState = {
      playerId: newPlayerId(),
      name: "Guest",
      wallet: null,
      roomId: null,
      country: url.searchParams.get("country"),
    };
    server.serializeAttachment(connection);
    this.sendWelcome(server, connection);
    await this.sendLobby(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== "string") return;
    if (message.length > 16 * 1024) {
      this.send(ws, { type: "error", message: "Message is too large." });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.send(ws, { type: "error", message: "Malformed message." });
      return;
    }
    if (!isClientMessage(parsed)) return;

    const connection = ws.deserializeAttachment() as LobbyConnectionState;
    const clientMessage = parsed as ClientMessage;

    try {
      switch (clientMessage.type) {
        case "hello": {
          const playerId = cleanPlayerId(clientMessage.playerId);
          if (playerId) connection.playerId = playerId;
          if (clientMessage.name) connection.name = cleanName(clientMessage.name);
          if (clientMessage.wallet !== undefined) connection.wallet = cleanWallet(clientMessage.wallet);
          this.save(ws, connection);
          this.sendWelcome(ws, connection);
          await this.sendLobby(ws);
          if (clientMessage.roomId) {
            const tableId = cleanTableId(clientMessage.roomId);
            connection.roomId = tableId;
            this.save(ws, connection);
            const view = await this.tableStub(tableId)
              .reconnect(connection.playerId, connection.name, connection.wallet)
              .catch(() => null);
            if (view) this.send(ws, { type: "room", room: view });
            else {
              connection.roomId = null;
              this.save(ws, connection);
              this.send(ws, { type: "error", message: "That table is no longer available." });
            }
          }
          return;
        }
        case "lobby":
          await this.sendLobby(ws);
          return;
        case "create":
          await this.handleCreate(ws, connection, clientMessage);
          return;
        case "quickMatch":
          await this.handleQuickMatch(ws, connection, clientMessage);
          return;
        case "join":
          await this.handleJoin(ws, connection, clientMessage.tableId, clientMessage);
          return;
        case "leave":
          await this.handleLeave(ws, connection);
          return;
        case "ping":
          this.send(ws, { type: "pong", serverTime: Date.now() });
          return;
        default:
          await this.forwardToTable(ws, connection, clientMessage);
      }
    } catch (cause) {
      this.send(ws, { type: "error", message: messageOf(cause) });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const connection = ws.deserializeAttachment() as LobbyConnectionState | null;
    if (connection?.roomId) {
      const stillConnected = this.ctx.getWebSockets().some((socket) => {
        const state = socket.deserializeAttachment() as LobbyConnectionState | null;
        return (
          socket !== ws &&
          state?.playerId === connection.playerId &&
          state?.roomId === connection.roomId
        );
      });
      if (!stillConnected) {
        await this.tableStub(connection.roomId).disconnect(connection.playerId).catch(() => undefined);
      }
    }
    if (isSendableCloseCode(code)) ws.close(code, reason);
    else ws.close();
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    void error;
    await this.webSocketClose(ws, 1000, "Socket error");
  }

  /* ------------------------------------------------------------------ */
  /* RPC used by the Worker and Table Durable Objects                    */
  /* ------------------------------------------------------------------ */

  async listTables(): Promise<PublicTableRecord[]> {
    await this.ensureLoaded();
    return sortTables(this.tables).map((table) => ({ ...table }));
  }

  async updateTable(table: PublicTableRecord): Promise<void> {
    await this.ensureLoaded();
    const index = this.tables.findIndex((entry) => entry.id === table.id);
    if (index >= 0) this.tables[index] = table;
    else this.tables.push(table);
    if (table.publicTable && table.state === "waiting") this.publicTableIds.add(table.id);
    else this.publicTableIds.delete(table.id);
    await this.persist();
    await this.publishLobby();
  }

  async removeTable(tableId: string): Promise<void> {
    await this.ensureLoaded();
    this.tables = this.tables.filter((table) => table.id !== tableId);
    this.publicTableIds.delete(tableId);
    await this.persist();
    await this.publishLobby();
  }

  async publishRoom(input: PublishRoomInput): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const connection = ws.deserializeAttachment() as LobbyConnectionState | null;
      if (connection?.roomId !== input.roomId) continue;
      const room = input.views[connection.playerId] ?? input.fallback;
      this.send(ws, { type: "room", room });
    }
  }

  async publishMessage(input: PublishMessageInput): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const connection = ws.deserializeAttachment() as LobbyConnectionState | null;
      if (connection?.roomId !== input.roomId) continue;
      if (input.playerIds && !input.playerIds.includes(connection.playerId)) continue;
      this.send(ws, input.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Client flows                                                        */
  /* ------------------------------------------------------------------ */

  private async handleCreate(
    ws: WebSocket,
    connection: LobbyConnectionState,
    message: Extract<ClientMessage, { type: "create" }>,
  ): Promise<void> {
    assertGame(message.game);
    assertMode(message.mode);
    this.assertWageringAllowed(message.mode);
    const maxPlayers = clampSeats(message.maxPlayers);
    const stake = stakeFor(message.mode, message.stakeBaseUnits);
    const wallet = cleanWallet(message.wallet ?? connection.wallet);
    if (message.mode === "wager" && !wallet) throw new Error("Connect a wallet before opening a wager table.");
    connection.wallet = wallet;
    if (message.name) connection.name = cleanName(message.name);

    const id = newTableId();
    const result = await this.tableStub(id).create({
      id,
      mode: message.mode,
      stakeBaseUnits: stake,
      maxPlayers,
      hostPlayerId: connection.playerId,
      hostName: connection.name,
      hostWallet: wallet,
      vsBots: message.mode === "free" && message.vsBots !== false,
      publicTable: true,
      turnTimeoutMs: 60_000,
      anteTimeoutMs: 60_000,
      cluster: this.env.CLUSTER || "mainnet-beta",
      wageringEnabled: wageringEnabled(this.env),
    });
    await this.attach(ws, connection, id, result);
  }

  private async handleQuickMatch(
    ws: WebSocket,
    connection: LobbyConnectionState,
    message: Extract<ClientMessage, { type: "quickMatch" }>,
  ): Promise<void> {
    assertMode(message.mode);
    this.assertWageringAllowed(message.mode);
    const maxPlayers = clampSeats(message.maxPlayers);
    const stake = stakeFor(message.mode, message.stakeBaseUnits);
    const wallet = cleanWallet(message.wallet ?? connection.wallet);
    if (message.mode === "wager" && !wallet) throw new Error("Connect a wallet before quick matching.");
    connection.wallet = wallet;
    if (message.name) connection.name = cleanName(message.name);

    await this.ensureLoaded();
    const match = sortTables(this.tables).find(
      (table) =>
        table.publicTable &&
        table.state === "waiting" &&
        table.mode === message.mode &&
        table.stake === (stake ? stake.toString() : null) &&
        table.seats < table.maxPlayers,
    );
    if (match) {
      await this.handleJoin(ws, connection, match.id, message);
      return;
    }

    const id = newTableId();
    const result = await this.tableStub(id).create({
      id,
      mode: message.mode,
      stakeBaseUnits: stake,
      maxPlayers,
      hostPlayerId: connection.playerId,
      hostName: connection.name,
      hostWallet: wallet,
      vsBots: message.mode === "free",
      publicTable: true,
      turnTimeoutMs: 60_000,
      anteTimeoutMs: 60_000,
      cluster: this.env.CLUSTER || "mainnet-beta",
      wageringEnabled: wageringEnabled(this.env),
    });
    await this.attach(ws, connection, id, result);
  }

  private async handleJoin(
    ws: WebSocket,
    connection: LobbyConnectionState,
    tableIdValue: string,
    message?: Extract<ClientMessage, { type: "join" | "quickMatch" }>,
  ): Promise<void> {
    const tableId = cleanTableId(tableIdValue);
    if (connection.roomId && connection.roomId !== tableId) {
      const allowed = await this.canLeave(connection.roomId, connection.playerId);
      if (!allowed.ok) throw new Error(allowed.reason ?? "Leave your current table first.");
    }
    await this.ensureLoaded();
    if (!this.tables.some((table) => table.id === tableId)) {
      throw new Error("That table is no longer open.");
    }
    const table = this.tables.find((entry) => entry.id === tableId);
    const wallet = cleanWallet(message?.wallet ?? connection.wallet);
    if (table?.mode === "wager" && !wallet) throw new Error("Connect a wallet to join a wager table.");
    if (message && "name" in message && message.name) connection.name = cleanName(message.name);
    const result = await this.tableStub(tableId).join(connection.playerId, connection.name, wallet);
    await this.attach(ws, connection, tableId, result);
  }

  private async handleLeave(ws: WebSocket, connection: LobbyConnectionState): Promise<void> {
    if (!connection.roomId) return;
    const allowed = await this.canLeave(connection.roomId, connection.playerId);
    if (!allowed.ok) throw new Error(allowed.reason ?? "You cannot leave that table yet.");
    await this.tableStub(connection.roomId).leave(connection.playerId);
    connection.roomId = null;
    this.save(ws, connection);
    this.send(ws, { type: "left" });
  }

  private async forwardToTable(
    ws: WebSocket,
    connection: LobbyConnectionState,
    message: Exclude<
      ClientMessage,
      { type: "hello" | "lobby" | "create" | "quickMatch" | "join" | "leave" | "ping" }
    >,
  ): Promise<void> {
    if (!connection.roomId) throw new Error("Join a table first.");
    await this.tableStub(connection.roomId).handleMessage(connection.playerId, message);
    void ws;
  }

  private async attach(
    ws: WebSocket,
    connection: LobbyConnectionState,
    tableId: string,
    result: TableResult,
  ): Promise<void> {
    connection.roomId = tableId;
    this.save(ws, connection);
    await this.updateTable(result.lobby);
    this.send(ws, { type: "room", room: result.view });
  }

  private async canLeave(tableId: string, playerId: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      return await this.tableStub(tableId).canLeave(playerId);
    } catch {
      return { ok: true };
    }
  }

  private async sendLobby(ws: WebSocket): Promise<void> {
    await this.ensureLoaded();
    this.send(ws, { type: "lobby", tables: publicTables(this.tables) });
  }

  private async publishLobby(): Promise<void> {
    const tables = publicTables(this.tables);
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { type: "lobby", tables });
  }

  private sendWelcome(ws: WebSocket, connection: LobbyConnectionState): void {
    this.send(ws, {
      type: "welcome",
      playerId: connection.playerId,
      name: connection.name,
      serverTime: Date.now(),
    });
  }

  private assertWageringAllowed(mode: "free" | "wager"): void {
    if (mode === "wager" && !wageringEnabled(this.env)) {
      throw new Error("Wagering is paused until the independent audit and legal sign-off are complete.");
    }
  }

  private tableStub(tableId: string) {
    return this.env.TABLE_DO.getByName(tableId);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.tables = (await this.ctx.storage.get<PublicTableRecord[]>("tables")) ?? [];
    this.publicTableIds = new Set(
      (await this.ctx.storage.get<string[]>("publicTableIds")) ??
        this.tables.filter((table) => table.publicTable && table.state === "waiting").map((table) => table.id),
    );
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put({
      tables: this.tables,
      publicTableIds: [...this.publicTableIds],
    });
  }

  private save(ws: WebSocket, connection: LobbyConnectionState): void {
    ws.serializeAttachment({ ...connection });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // A socket can close between enumeration and send; ignore it.
    }
  }
}

function stakeFor(mode: "free" | "wager", value: string | undefined): bigint {
  if (mode !== "wager") return 0n;
  let stake: bigint;
  try {
    stake = BigInt(value ?? "0");
  } catch {
    throw new Error("Choose a valid USDC stake.");
  }
  const result = validateStake(stake);
  if (!result.ok) throw new Error(result.reason);
  return stake;
}

function clampSeats(value: number | undefined): 3 | 4 {
  return value === 4 ? 4 : 3;
}

function assertGame(value: unknown): void {
  if (!isGameId(value)) throw new Error("Only 20 Down is available.");
}

function assertMode(value: unknown): asserts value is "free" | "wager" {
  if (value !== "free" && value !== "wager") throw new Error("Unknown table mode.");
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 24) || "Guest";
}

function cleanPlayerId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || trimmed.startsWith("bot:")) return null;
  return trimmed;
}

function cleanWallet(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    throw new Error("That wallet address is not valid.");
  }
  return trimmed;
}

function cleanTableId(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) throw new Error("That table link is not valid.");
  return trimmed;
}

function sortTables(tables: PublicTableRecord[]): PublicTableRecord[] {
  return [...tables].sort((a, b) => {
    const waiting = (table: PublicTableRecord) => (table.state === "waiting" ? 0 : 1);
    return waiting(a) - waiting(b) || b.createdAt - a.createdAt;
  });
}

function publicTables(tables: PublicTableRecord[]): LobbyTable[] {
  return sortTables(tables).map((table) => ({
    id: table.id,
    game: table.game,
    gameName: table.gameName,
    mode: table.mode,
    stake: table.stake,
    seats: table.seats,
    maxPlayers: table.maxPlayers,
    minPlayers: table.minPlayers,
    state: table.state,
    hostName: table.hostName,
  }));
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "That action could not be completed.";
}

function isSendableCloseCode(code: number): boolean {
  return code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code);
}

export type { RoomView };
