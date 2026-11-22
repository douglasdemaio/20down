import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { PublicKey } from "@solana/web3.js";
import {
  GAMES,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  isGameId,
  type GameId,
  type PlayMode,
} from "@20down/shared";
import {
  HEALTH_PATH,
  LOBBY_PATH,
  TX_PATH,
  TX_SUBMIT_PATH,
  WS_PATH,
  isClientMessage,
  type ClientMessage,
  type LobbyTable,
  type ServerMessage,
  type TxRequest,
} from "@20down/shared/protocol";
import type { ServerConfig } from "./config.js";
import { WagerChain } from "./chain.js";
import {
  Room,
  checkedStake,
  createRoomId,
  messageOf,
  type RoomHooks,
} from "./room.js";

const MAX_NAME = 24;
const MAX_CHAT = 200;
const MAX_MESSAGE_BYTES = 16 * 1024;

interface Client {
  id: string;
  name: string;
  wallet: string | null;
  socket: WebSocket;
  roomId: string | null;
  alive: boolean;
}

interface Broadcastable {
  readyState: number;
  send(data: string): void;
}

export interface HubOptions {
  config: ServerConfig;
  chain?: WagerChain | null;
  /** Injectable clock/timer surface for tests. */
  now?: () => number;
}

/**
 * The realtime hub: owns rooms, sockets and the small HTTP control plane the
 * browser uses to build/sign wager transactions.
 */
export class Hub {
  readonly config: ServerConfig;
  readonly chain: WagerChain | null;
  readonly rooms = new Map<string, Room>();
  private readonly clients = new Map<WebSocket, Client>();
  private readonly startedAt = Date.now();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: HubOptions) {
    this.config = options.config;
    this.chain = options.chain === undefined ? (options.config.chainEnabled ? new WagerChain(options.config) : null) : options.chain;
  }

  /* ------------------------------------------------------------------ */
  /* Sockets                                                             */
  /* ------------------------------------------------------------------ */

  attach(wss: WebSocketServer): void {
    wss.on("connection", (socket) => this.onConnection(socket));
    this.cleanupTimer = setInterval(() => this.cleanupRooms(), 60_000);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
    if (typeof this.cleanupTimer.unref === "function") this.cleanupTimer.unref();
    if (typeof this.heartbeatTimer.unref === "function") this.heartbeatTimer.unref();
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = {
      id: newPlayerId(),
      name: "Guest",
      wallet: null,
      socket,
      roomId: null,
      alive: true,
    };
    this.clients.set(socket, client);

    socket.on("message", (raw) => {
      void this.onMessage(client, raw).catch((error) => {
        this.send(client, { type: "error", message: messageOf(error) });
      });
    });
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("close", () => this.onClose(client));
    socket.on("error", () => this.onClose(client));

    this.send(client, {
      type: "welcome",
      playerId: client.id,
      name: client.name,
      serverTime: Date.now(),
    });
    this.sendLobby(client);
  }

  private onClose(client: Client): void {
    if (!this.clients.has(client.socket)) return;
    this.clients.delete(client.socket);
    if (client.roomId) {
      const room = this.rooms.get(client.roomId);
      room?.setConnected(client.id, false);
    }
  }

  private heartbeat(): void {
    for (const [socket, client] of this.clients) {
      if (!client.alive) {
        socket.terminate();
        this.clients.delete(socket);
        continue;
      }
      client.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
        this.clients.delete(socket);
      }
    }
  }

  private send(client: Client, message: ServerMessage): void {
    this.sendTo(client.socket, message);
  }

  private sendTo(socket: Broadcastable, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A dead socket is cleaned up by the close handler.
    }
  }

  /* ------------------------------------------------------------------ */
  /* Inbound messages                                                    */
  /* ------------------------------------------------------------------ */

  private async onMessage(client: Client, raw: RawData): Promise<void> {
    const text = raw.toString();
    if (text.length > MAX_MESSAGE_BYTES) throw new Error("Message too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Malformed JSON");
    }
    if (!isClientMessage(parsed)) throw new Error("Unknown message type");
    await this.handle(client, parsed);
  }

  private async handle(client: Client, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        return this.hello(client, message);
      case "lobby":
        return this.sendLobby(client);
      case "ping":
        this.send(client, { type: "pong", serverTime: Date.now() });
        return;
      case "create":
        return this.create(client, message);
      case "join":
        return this.join(client, message);
      case "leave":
        return this.leave(client);
      case "chat": {
        const room = this.currentRoom(client);
        if (!room) throw new Error("Join a table to chat");
        const seat = room.seatOf(client.id);
        if (!seat) throw new Error("You are not seated at this table");
        const text = cleanText(message.text, MAX_CHAT);
        if (!text) return;
        this.broadcastRoomChat(room, {
          type: "chat",
          seat: seat.index,
          name: seat.name,
          text,
          at: Date.now(),
        });
        return;
      }
      default: {
        const room = this.currentRoom(client);
        if (!room) throw new Error("Join a table first");
        const seat = room.seatOf(client.id);
        if (!seat) throw new Error("You are not seated at this table");
        room.handle(seat, message as unknown as Record<string, unknown> & { type: string });
      }
    }
  }

  private hello(
    client: Client,
    message: Extract<ClientMessage, { type: "hello" }>,
  ): void {
    if (message.name !== undefined) client.name = cleanName(message.name) || client.name;
    if (message.wallet !== undefined) {
      client.wallet = validateWallet(message.wallet);
    }
    if (message.playerId) {
      // Reconnect: adopt the stored identity. The browser tells us which table
      // it is viewing; without that hint we must not guess, or a stale seat in
      // an abandoned room would drag the player back into it.
      const existingId = message.playerId.trim();
      if (existingId && existingId.length <= 64 && !existingId.startsWith("bot:")) {
        client.id = existingId;
      }
    }
    const requestedRoomId = String(message.roomId ?? "").trim();
    if (requestedRoomId) {
      const room = this.rooms.get(requestedRoomId);
      if (room && !room.isDestroyed && room.seatOf(client.id)) {
        client.roomId = room.id;
        room.setConnected(client.id, true);
        this.send(client, { type: "room", room: room.viewFor(client.id) });
      }
    }
    this.send(client, {
      type: "welcome",
      playerId: client.id,
      name: client.name,
      serverTime: Date.now(),
    });
    this.sendLobby(client);
  }

  private create(
    client: Client,
    message: Extract<ClientMessage, { type: "create" }>,
  ): void {
    if (!isGameId(message.game)) throw new Error("Unknown game");
    const mode: PlayMode = message.mode === "wager" ? "wager" : "free";
    if (mode === "wager" && !this.chain?.enabled) {
      throw new Error("USDC wagering is not enabled on this server");
    }
    const meta = GAMES[message.game];
    const maxPlayers = clamp(
      Math.floor(Number(message.maxPlayers ?? meta.maxPlayers)),
      meta.minPlayers,
      meta.maxPlayers,
    );
    const stake = mode === "wager" ? checkedStake(message.stakeBaseUnits) : 0n;
    const fee = mode === "wager" ? this.config.feePerPlayer : 0n;
    const wallet = mode === "wager" ? validateWallet(message.wallet ?? client.wallet) : null;
    if (message.wallet) client.wallet = validateWallet(message.wallet);
    if (message.name) client.name = cleanName(message.name) || client.name;
    if (mode === "wager" && !wallet) throw new Error("Connect a wallet before creating a wager table");
    if (client.roomId) this.detach(client);

    const id = createRoomId();
    const hooks: RoomHooks = {
      onChange: (room) => this.broadcastRoom(room),
      onDestroy: (room) => {
        this.rooms.delete(room.id);
        this.broadcastLobby();
      },
    };
    const room = new Room({
      id,
      game: message.game,
      mode,
      stakeBaseUnits: stake,
      feeBaseUnits: fee,
      maxPlayers,
      hostName: client.name,
      chain: this.chain,
      hooks,
      turnTimeoutMs: this.config.turnTimeoutMs,
      anteTimeoutMs: this.config.anteTimeoutMs,
    });
    this.rooms.set(id, room);
    room.addPlayer({
      playerId: client.id,
      name: client.name,
      wallet,
    });

    if (mode === "free" && message.vsBots !== false) {
      const desired = Math.min(maxPlayers, Math.max(meta.minPlayers, 3));
      room.fillBots(Math.max(0, desired - 1));
    }
    // Only subscribe the socket after the table is fully populated, so the
    // client sees one coherent lobby snapshot rather than partial rooms.
    client.roomId = id;

    this.send(client, { type: "room", room: room.viewFor(client.id) });
    this.broadcastLobby();
  }

  private join(
    client: Client,
    message: Extract<ClientMessage, { type: "join" }>,
  ): void {
    const room = this.rooms.get(String(message.tableId ?? "").trim());
    if (!room || room.isDestroyed) throw new Error("Table not found");
    const existingSeat = room.seatOf(client.id);
    if (existingSeat) {
      // Reconnecting to (or returning to) a seat we still hold, even after the
      // game has started. Switching from a different live table still has to
      // respect the escrow guard.
      if (client.roomId && client.roomId !== room.id) this.detach(client);
      client.roomId = room.id;
      room.setConnected(client.id, true);
      this.send(client, { type: "room", room: room.viewFor(client.id) });
      this.broadcastLobby();
      return;
    }
    if (room.state !== "waiting") throw new Error("That game has already started");
    if (room.isFull) throw new Error("Table is full");
    if (message.name) client.name = cleanName(message.name) || client.name;
    const wallet = message.wallet ? validateWallet(message.wallet) : client.wallet;
    if (message.wallet) client.wallet = wallet;
    if (room.mode === "wager" && !wallet) {
      throw new Error("Connect a wallet before joining a wager table");
    }
    if (client.roomId) this.detach(client);
    const seat = room.addPlayer({
      playerId: client.id,
      name: client.name,
      wallet: room.mode === "wager" ? wallet : null,
    });
    client.roomId = room.id;
    room.setConnected(client.id, true);
    this.send(client, { type: "room", room: room.viewFor(client.id) });
    this.broadcastLobby();
    void seat;
  }

  private leave(client: Client): void {
    // The deposit-aware guard lives on switching; pressing Leave always releases
    // the socket, even if escrow still has to be refunded separately.
    this.detach(client, { allowDepositedWager: true });
    this.send(client, { type: "left" });
    this.broadcastLobby();
  }

  /**
   * Releases this socket from its current table, mirroring the Leave button.
   * A waiting seat is removed; an in-progress seat is only marked disconnected
   * so the game can finish. Switching away from a deposited wager seat is
   * refused because its escrow is still live.
   */
  private detach(client: Client, options?: { allowDepositedWager?: boolean }): void {
    const room = this.currentRoom(client);
    if (!room) {
      client.roomId = null;
      return;
    }
    const seat = room.seatOf(client.id);
    const liveEscrow =
      room.mode === "wager" &&
      Boolean(seat?.deposited) &&
      room.state !== "resolved" &&
      room.state !== "voided";
    if (liveEscrow && !options?.allowDepositedWager) {
      throw new Error("Finish or refund your USDC seat before switching tables");
    }
    client.roomId = null;
    const removable =
      room.state === "waiting" && (!seat || room.mode === "free" || !seat.deposited);
    if (removable) room.removePlayer(client.id);
    else room.setConnected(client.id, false);
  }

  /* ------------------------------------------------------------------ */
  /* HTTP control plane                                                  */
  /* ------------------------------------------------------------------ */

  lobby(): LobbyTable[] {
    return [...this.rooms.values()]
      .filter((room) => !room.isDestroyed)
      .sort((a, b) => {
        const rank = (room: Room) => (room.state === "waiting" ? 0 : 1);
        return rank(a) - rank(b) || b.createdAt - a.createdAt;
      })
      .map((room) => room.toLobby());
  }

  async buildTransaction(request: TxRequest): Promise<{ transaction: string; message?: string }> {
    if (!this.chain?.enabled) throw new Error("USDC wagering is not enabled on this server");
    if (!request || !["join", "ante", "leave"].includes(request.kind)) {
      throw new Error("Unknown transaction kind");
    }
    const player = validateWallet(request.player);
    if (!player) throw new Error("A player wallet is required");
    const tableKey = new PublicKey(request.tablePda);
    const room = this.roomForTable(tableKey);
    if (!room) throw new Error("Table not found");
    if (room.mode !== "wager") throw new Error("That table is not a wager table");
    const seat = room.occupied.find((entry) => entry.wallet === player);
    if (!seat) throw new Error("That wallet is not seated at this table");

    if (request.kind === "join") {
      if (room.state !== "waiting") throw new Error("This table has already started");
      if (seat.deposited) throw new Error("Already deposited");
      const transaction = await this.chain.buildJoinTransaction(tableKey, new PublicKey(player));
      return {
        transaction,
        message: `Deposit ${formatBase(room.stake + room.fee)} USDC (${formatBase(room.stake)} stake + ${formatBase(room.fee)} fee)`,
      };
    }
    if (request.kind === "ante") {
      if (room.state !== "ante") throw new Error("The table is not waiting for antes");
      if (!seat.active) throw new Error("Your seat is no longer active");
      if (seat.anted) throw new Error("Already re-anted");
      const transaction = await this.chain.buildAnteTransaction(tableKey, new PublicKey(player));
      return {
        transaction,
        message: `Re-ante ${formatBase(room.stake)} USDC to stay in the carried pot`,
      };
    }
    if (room.state !== "waiting") throw new Error("You can only leave a waiting table");
    const transaction = await this.chain.buildLeaveTransaction(tableKey, new PublicKey(player));
    return { transaction, message: "Leave the table and reclaim your stake" };
  }

  async submitTransaction(
    base64: string,
    context?: { tablePda?: string; player?: string },
  ): Promise<string> {
    if (!this.chain?.enabled) throw new Error("USDC wagering is not enabled on this server");
    if (typeof base64 !== "string" || base64.length < 16) throw new Error("Missing transaction");
    const signature = await this.chain.submitSignedTransaction(base64);
    if (context?.tablePda && context.player) {
      try {
        const tableKey = new PublicKey(context.tablePda);
        const room = this.roomForTable(tableKey);
        if (room) {
          const table = await this.chain.fetchTable(tableKey);
          const stillSeated = table?.seats.some((key) => key.toBase58() === context.player);
          if (!stillSeated) room.releaseSeatByWallet(String(context.player));
        }
      } catch {
        // The transaction is already submitted; reconciliation is best-effort.
      }
    }
    return signature;
  }

  private roomForTable(table: PublicKey): Room | null {
    for (const room of this.rooms.values()) {
      if (room.chainTable?.equals(table)) return room;
    }
    return null;
  }

  private currentRoom(client: Client): Room | null {
    if (!client.roomId) return null;
    return this.rooms.get(client.roomId) ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Broadcasts                                                          */
  /* ------------------------------------------------------------------ */

  private broadcastRoom(room: Room): void {
    for (const client of this.clients.values()) {
      if (client.roomId !== room.id) continue;
      this.send(client, { type: "room", room: room.viewFor(client.id) });
    }
    this.broadcastLobby();
  }

  private broadcastRoomChat(
    room: Room,
    message: Extract<ServerMessage, { type: "chat" }>,
  ): void {
    for (const client of this.clients.values()) {
      if (client.roomId !== room.id) continue;
      this.send(client, message);
    }
  }

  private sendLobby(client: Client): void {
    this.send(client, { type: "lobby", tables: this.lobby() });
  }

  broadcastLobby(): void {
    const tables = this.lobby();
    for (const client of this.clients.values()) {
      this.send(client, { type: "lobby", tables });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Housekeeping                                                        */
  /* ------------------------------------------------------------------ */

  private cleanupRooms(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.touchedAt;
      if (room.mode === "wager") {
        // Never destroy a wager room that could still hold escrow. Only clean up
        // fully resolved tables, and even then leave a long grace period.
        if ((room.state === "resolved" || room.state === "voided") && idle > 6 * 60 * 60_000) {
          room.destroy();
        }
        continue;
      }
      if (idle > 45 * 60_000) room.destroy();
    }
  }

  stats() {
    return {
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      rooms: this.rooms.size,
      clients: this.clients.size,
      chainEnabled: Boolean(this.chain?.enabled),
      cluster: this.config.cluster,
      programId: this.config.programId.toBase58(),
      now: Date.now(),
    };
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
    for (const socket of this.clients.keys()) socket.terminate();
    this.clients.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

export interface RunningServer {
  hub: Hub;
  http: ReturnType<typeof createHttpServer>;
  wss: WebSocketServer;
  port: number;
  close(): Promise<void>;
}

export function createHubServer(config: ServerConfig, chain?: WagerChain | null): RunningServer {
  const hub = new Hub({ config, chain });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const http = createHttpServer(async (req, res) => {
    try {
      await handleHttp(hub, req, res);
    } catch (error) {
      sendJson(res, 500, { error: messageOf(error) });
    }
  });

  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
  hub.attach(wss);

  return {
    hub,
    http,
    wss,
    port: config.port,
    close: async () => {
      hub.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

async function handleHttp(hub: Hub, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  setCors(res, hub.config.corsOrigin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === HEALTH_PATH) {
    sendJson(res, 200, hub.stats());
    return;
  }

  if (req.method === "GET" && url.pathname === LOBBY_PATH) {
    sendJson(res, 200, { tables: hub.lobby() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/verify") {
    const room = hub.rooms.get((url.searchParams.get("room") ?? "").trim());
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return;
    }
    const round = Number(url.searchParams.get("round") ?? room.round);
    const record = room.verifyRecord(Number.isFinite(round) ? round : room.round);
    if (!record) {
      sendJson(res, 404, { error: "No published round with that number yet" });
      return;
    }
    sendJson(res, 200, {
      room: room.id,
      cluster: hub.config.cluster,
      programId: hub.config.programId.toBase58(),
      record,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      cluster: hub.config.cluster,
      programId: hub.config.programId.toBase58(),
      usdcMint: hub.config.usdcMint.toBase58(),
      treasury: hub.config.treasury.toBase58(),
      feePerPlayer: hub.config.feePerPlayer.toString(),
      minStake: MIN_STAKE_BASE_UNITS.toString(),
      maxStake: MAX_STAKE_BASE_UNITS.toString(),
      turnTimeoutMs: hub.config.turnTimeoutMs,
      anteTimeoutMs: hub.config.anteTimeoutMs,
      chainEnabled: Boolean(hub.chain?.enabled),
      wsPath: WS_PATH,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === TX_PATH) {
    const body = (await readJson(req)) as Partial<TxRequest>;
    if (!body || typeof body !== "object") throw new Error("Invalid request");
    const result = await hub.buildTransaction({
      kind: body.kind as TxRequest["kind"],
      tablePda: String(body.tablePda ?? ""),
      player: String(body.player ?? ""),
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === TX_SUBMIT_PATH) {
    const body = (await readJson(req)) as {
      transaction?: string;
      tablePda?: string;
      player?: string;
    };
    const signature = await hub.submitTransaction(String(body?.transaction ?? ""), {
      tablePda: body?.tablePda ? String(body.tablePda) : undefined,
      player: body?.player ? String(body.player) : undefined,
    });
    sendJson(res, 200, { signature });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Malformed JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newPlayerId(): string {
  return `p_${randomBytes(8).toString("hex")}`;
}

function cleanText(input: unknown, limit: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function cleanName(input: unknown): string {
  return cleanText(input, MAX_NAME);
}

function validateWallet(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return new PublicKey(input).toBase58();
  } catch {
    throw new Error("Invalid wallet address");
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function formatBase(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/* ------------------------------------------------------------------ */
/* Entrypoint                                                          */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const { loadConfig } = await import("./config.js");
  const config = loadConfig();
  const server = createHubServer(config);
  server.http.listen(config.port, config.host, () => {
    console.log(
      `[20down] listening on http://${config.host}:${config.port} (ws ${WS_PATH})`,
    );
    console.log(
      `[20down] cluster=${config.cluster} program=${config.programId.toBase58()} chain=${config.chainEnabled ? "on" : "off"}`,
    );
  });

  const shutdown = () => {
    console.log("[20down] shutting down");
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/index.ts") || process.argv[1].endsWith("/index.js"));
if (isMain) {
  void main().catch((error) => {
    console.error("[20down] fatal:", error);
    process.exit(1);
  });
}

export { isGameId };
