import { DurableObject } from "cloudflare:workers";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import {
  GAMES,
  STARTING_SCORE,
  ZwanzigGame,
  commitSeed,
  formatUsdc,
  tableFeeBaseUnits,
  type GameId,
  type Suit,
} from "@20down/shared";
import {
  isClientMessage,
  type ChainStatus,
  type ClientMessage,
  type RoomPhase,
  type RoomState,
  type RoomView,
  type RoundSummary,
  type SeatPublic,
  type ServerMessage,
} from "@20down/shared/protocol";
import { newBotId, newPlayerId } from "../lib/ids.js";
import { restoreZwanzig, serializeZwanzig, type ZwanzigSnapshot } from "../lib/zwanzig-state.js";
import type {
  CanLeaveResult,
  Env,
  PublicTableRecord,
  TableConnectionState,
  TableCreateInput,
  TableResult,
} from "../types.js";

interface SeatState {
  index: number;
  playerId: string | null;
  name: string;
  wallet: string | null;
  connected: boolean;
  ready: boolean;
  isBot: boolean;
  active: boolean;
  deposited: boolean;
  anted: boolean;
  done: boolean;
}

interface RoundRecord extends RoundSummary {
  game: GameId;
  logHash?: string;
  vrfDigest?: string | null;
}

type DeadlineKind = "turn" | "bot" | "review" | "auto-start" | "ante" | null;

interface TableState {
  id: string;
  mode: "free" | "wager";
  game: GameId;
  stake: string;
  fee: string;
  minPlayers: number;
  maxPlayers: 3 | 4;
  publicTable: boolean;
  hostName: string;
  state: RoomState;
  phase: RoomPhase;
  round: number;
  seats: SeatState[];
  hostSeat: number;
  seed: string | null;
  seedCommitment: string | null;
  revealedSeed: string | null;
  vrfDigest: string | null;
  snapshot: ZwanzigSnapshot | null;
  lastRound: RoundSummary | null;
  history: RoundRecord[];
  winnerSeat: number | null;
  notice: string | null;
  anteDeadline: number | null;
  turnDeadline: number | null;
  deadlineKind: DeadlineKind;
  deadlineAt: number | null;
  potStakes: string;
  potFees: string;
  chainStatus: string;
  cluster: string;
  wageringEnabled: boolean;
  createdAt: number;
  touchedAt: number;
  turnTimeoutMs: number;
  anteTimeoutMs: number;
}

const BOT_NAMES = ["Mara", "Jonas", "Ilse", "Fritz", "Greta", "Otto"];
const DEAL_PAUSE_MS = 3_000;
const BOT_DELAY_MS = 350;
const AUTO_START_MS = 1_200;

/** One Durable Object per table: seats, cards, chat, timers and escrow guards. */
export class TableDurableObject extends DurableObject<Env> {
  private state: TableState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const tableId =
      url.searchParams.get("tableId") ??
      url.pathname.match(/^\/ws\/table\/([^/]+)$/)?.[1] ??
      this.ctx.id.toString();
    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;
    this.ctx.acceptWebSocket(server);

    const connection: TableConnectionState = {
      tableId,
      playerId: url.searchParams.get("playerId") || newPlayerId(),
      name: url.searchParams.get("name") || "Guest",
      wallet: url.searchParams.get("wallet") || null,
      roomId: tableId,
      country: null,
    };
    server.serializeAttachment(connection);

    const table = await this.load();
    if (table?.id === tableId) {
      const seat = this.seatOf(table, connection.playerId);
      if (seat) {
        seat.connected = true;
        seat.name = cleanName(connection.name);
        seat.wallet = connection.wallet ?? seat.wallet;
        await this.changed();
      }
      this.send(server, { type: "room", room: this.viewFor(table, connection.playerId) });
    } else {
      this.send(server, { type: "error", message: "That table is no longer available." });
    }
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
    const connection = ws.deserializeAttachment() as TableConnectionState;
    const clientMessage = parsed as ClientMessage;

    if (clientMessage.type === "hello") {
      const playerId = cleanPlayerId(clientMessage.playerId);
      if (playerId) connection.playerId = playerId;
      if (clientMessage.name) connection.name = cleanName(clientMessage.name);
      if (clientMessage.wallet !== undefined) connection.wallet = clientMessage.wallet;
      ws.serializeAttachment({ ...connection });
      return;
    }
    if (
      clientMessage.type === "lobby" ||
      clientMessage.type === "create" ||
      clientMessage.type === "quickMatch" ||
      clientMessage.type === "join" ||
      clientMessage.type === "leave"
    ) {
      this.send(ws, { type: "error", message: "Use /ws for lobby actions." });
      return;
    }
    try {
      await this.handleMessage(connection.playerId, clientMessage);
    } catch (cause) {
      this.send(ws, { type: "error", message: messageOf(cause) });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const connection = ws.deserializeAttachment() as TableConnectionState | null;
    if (connection?.playerId) {
      const stillConnected = this.ctx.getWebSockets().some((socket) => {
        const state = socket.deserializeAttachment() as TableConnectionState | null;
        return socket !== ws && state?.playerId === connection.playerId;
      });
      if (!stillConnected) await this.disconnect(connection.playerId).catch(() => undefined);
    }
    if (isSendableCloseCode(code)) ws.close(code, reason);
    else ws.close();
  }

  /* ------------------------------------------------------------------ */
  /* RPC used by the Worker and Lobby Durable Object                     */
  /* ------------------------------------------------------------------ */

  async create(input: TableCreateInput): Promise<TableResult> {
    const existing = await this.load();
    if (existing) throw new Error("That table already exists.");
    const stake = input.stakeBaseUnits;
    const fee = tableFeeBaseUnits(input.maxPlayers);
    const now = Date.now();
    const state: TableState = {
      id: input.id,
      mode: input.mode,
      game: "zwanzig-ab",
      stake: stake.toString(),
      fee: fee.toString(),
      minPlayers: GAMES["zwanzig-ab"].minPlayers,
      maxPlayers: input.maxPlayers,
      publicTable: input.publicTable,
      hostName: input.hostName,
      state: "waiting",
      phase: "lobby",
      round: 1,
      seats: Array.from({ length: input.maxPlayers }, (_, index): SeatState =>
        index === 0
          ? {
              index,
              playerId: input.hostPlayerId,
              name: input.hostName,
              wallet: input.hostWallet,
              connected: true,
              ready: false,
              isBot: false,
              active: true,
              deposited: input.mode === "free",
              anted: input.mode === "free",
              done: false,
            }
          : emptySeat(index),
      ),
      hostSeat: 0,
      seed: null,
      seedCommitment: null,
      revealedSeed: null,
      vrfDigest: null,
      snapshot: null,
      lastRound: null,
      history: [],
      winnerSeat: null,
      notice: null,
      anteDeadline: null,
      turnDeadline: null,
      deadlineKind: null,
      deadlineAt: null,
      potStakes: "0",
      potFees: "0",
      chainStatus: input.mode === "wager" ? "wagering paused" : "off",
      cluster: input.cluster,
      wageringEnabled: input.wageringEnabled,
      createdAt: now,
      touchedAt: now,
      turnTimeoutMs: input.turnTimeoutMs,
      anteTimeoutMs: input.anteTimeoutMs,
    };
    if (input.vsBots && input.mode === "free") this.fillBots(state);
    this.state = state;
    await this.persist();
    return { view: this.viewFor(state, input.hostPlayerId), lobby: this.toLobby(state) };
  }

  async join(playerId: string, name?: string, wallet?: string | null): Promise<TableResult> {
    const state = await this.load();
    if (!state) throw new Error("That table is no longer available.");
    if (state.state !== "waiting") throw new Error("That table has already started.");
    const existing = this.seatOf(state, playerId);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = cleanName(name);
      if (wallet) existing.wallet = wallet;
      await this.changed();
      return { view: this.viewFor(state, playerId), lobby: this.toLobby(state) };
    }
    const open = state.seats.find((seat) => seat.playerId === null);
    if (!open) throw new Error("That table is full.");
    if (state.mode === "wager" && !wallet) throw new Error("Connect a wallet to join a wager table.");
    Object.assign(open, {
      index: open.index,
      playerId,
      name: cleanName(name || "Player"),
      wallet: wallet ?? null,
      connected: true,
      ready: false,
      isBot: false,
      active: true,
      deposited: state.mode === "free",
      anted: state.mode === "free",
      done: false,
    } satisfies SeatState);
    await this.changed();
    return { view: this.viewFor(state, playerId), lobby: this.toLobby(state) };
  }

  async reconnect(playerId: string, name?: string, wallet?: string | null): Promise<RoomView> {
    const state = await this.load();
    if (!state) throw new Error("That table is no longer available.");
    const seat = this.seatOf(state, playerId);
    if (!seat) throw new Error("You are not seated at this table.");
    seat.connected = true;
    if (name) seat.name = cleanName(name);
    if (wallet) seat.wallet = wallet;
    await this.changed();
    return this.viewFor(state, playerId);
  }

  async canLeave(playerId: string): Promise<CanLeaveResult> {
    const state = await this.load();
    if (!state) return { ok: true };
    const seat = this.seatOf(state, playerId);
    if (!seat) return { ok: true };
    if (
      state.mode === "wager" &&
      seat.deposited &&
      state.state !== "resolved" &&
      state.state !== "voided"
    ) {
      return {
        ok: false,
        reason: "Your USDC is in escrow at this table. Request a refund here before joining another table.",
      };
    }
    return { ok: true };
  }

  async leave(playerId: string): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const guard = await this.canLeave(playerId);
    if (!guard.ok) throw new Error(guard.reason);
    const seat = this.seatOf(state, playerId);
    if (!seat) return;
    if (seat.isBot) return;
    if (state.state !== "waiting") {
      seat.connected = false;
      await this.changed();
      return;
    }
    state.seats[seat.index] = emptySeat(seat.index);
    state.potStakes = (BigInt(state.potStakes) - BigInt(state.stake)).toString();
    state.potFees = (BigInt(state.potFees) - BigInt(state.fee)).toString();
    if (state.hostSeat === seat.index) {
      const host = this.occupied(state)[0];
      if (host) {
        state.hostSeat = host.index;
        state.hostName = host.name;
      }
    }
    if (this.occupied(state).length === 0) {
      await this.lobbyStub().removeTable(state.id).catch(() => undefined);
      await this.ctx.storage.delete("state");
      await this.clearAlarm();
      this.state = null;
      return;
    }
    await this.changed();
  }

  async disconnect(playerId: string): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const seat = this.seatOf(state, playerId);
    if (!seat || !seat.connected) return;
    seat.connected = false;
    await this.changed();
  }

  async handleMessage(playerId: string, message: ClientMessage): Promise<void> {
    const state = await this.load();
    if (!state) throw new Error("That table is no longer available.");
    const seat = this.seatOf(state, playerId);
    if (!seat) throw new Error("You are not seated at this table.");

    switch (message.type) {
      case "ready":
        await this.setReady(state, seat, message.ready);
        await this.changed();
        return;
      case "start":
        await this.startGame(state);
        return;
      case "trump":
      case "exchange":
      case "announce":
      case "playCard":
        await this.act(state, seat, message);
        return;
      case "nextDeal": {
        const game = this.game(state);
        if (game.phase !== "deal-scored") throw new Error("The next deal is not ready.");
        game.nextDeal();
        state.snapshot = serializeZwanzig(game);
        await this.afterAction(state);
        return;
      }
      case "deposited":
        this.markDeposited(state, seat, message.signature);
        await this.changed();
        return;
      case "chat":
        await this.publishChat(state, seat, message.text);
        return;
      case "rematch":
        throw new Error("20 Down ends when a player reaches zero — start a new table.");
      default:
        throw new Error(`Unsupported action: ${message.type}`);
    }
  }

  async verifyRecord(round: number): Promise<RoundRecord | null> {
    const state = await this.load();
    if (!state) return null;
    return state.history.find((record) => record.round === round) ?? null;
  }

  async allRecords(): Promise<{ round: number; records: RoundRecord[] } | null> {
    const state = await this.load();
    if (!state) return null;
    return { round: state.round, records: [...state.history] };
  }

  async getLobby(): Promise<PublicTableRecord> {
    const state = await this.load();
    if (!state) throw new Error("That table is no longer available.");
    return this.toLobby(state);
  }

  /** Deterministic entry point for tests; the runtime calls `alarm()` itself. */
  async runDueWork(): Promise<void> {
    await this.alarm();
  }

  override async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;
    await this.clearAlarm();
    if (!state.deadlineKind || !state.deadlineAt) {
      await this.changed();
      return;
    }
    if (state.deadlineKind === "auto-start") {
      if (this.everyoneReady(state)) await this.startGame(state);
      else await this.changed();
      return;
    }
    if (state.deadlineKind === "ante") {
      this.finalizeAnte(state);
      await this.changed();
      return;
    }

    const game = this.game(state);
    if (state.deadlineKind === "review") {
      if (game.phase === "deal-scored") {
        game.nextDeal();
        state.snapshot = serializeZwanzig(game);
        await this.afterAction(state);
      } else {
        await this.scheduleNext(state);
        await this.changed();
      }
      return;
    }

    const actor = game.currentActor();
    if (actor !== null) {
      game.applyAutoAction(actor);
      state.snapshot = serializeZwanzig(game);
      await this.afterAction(state);
      return;
    }
    await this.scheduleNext(state);
    await this.changed();
  }

  /* ------------------------------------------------------------------ */
  /* Game flow                                                           */
  /* ------------------------------------------------------------------ */

  private async startGame(state: TableState): Promise<void> {
    if (state.state !== "waiting") throw new Error("This game has already started.");
    const seats = this.occupied(state);
    if (seats.length < state.minPlayers) throw new Error(`20 Down needs at least ${state.minPlayers} players.`);
    if (!this.everyoneReady(state)) throw new Error("Every player must be ready first.");
    if (state.mode === "wager") {
      if (!state.wageringEnabled) throw new Error("Wagering is paused until audit and legal sign-off.");
      if (!seats.every((seat) => seat.deposited)) throw new Error("Every player must deposit first.");
    }

    const seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    const seed = bytesToHex(seedBytes);
    const dealerBytes = new Uint8Array(1);
    crypto.getRandomValues(dealerBytes);
    const dealerSeat = (dealerBytes[0] ?? 0) % seats.length;
    const game = new ZwanzigGame({ seed, playerCount: seats.length, dealerSeat });
    game.startDeal();

    state.seed = seed;
    state.seedCommitment = commitSeed(seedBytes);
    state.revealedSeed = null;
    state.snapshot = serializeZwanzig(game);
    state.state = "in-progress";
    state.phase = "lobby";
    state.round = game.dealNumber;
    state.winnerSeat = null;
    state.lastRound = null;
    state.notice = null;
    state.deadlineKind = null;
    state.deadlineAt = null;
    state.potStakes = (BigInt(state.stake) * BigInt(seats.length)).toString();
    state.potFees = (BigInt(state.fee) * BigInt(seats.length)).toString();
    for (const seat of seats) {
      seat.active = true;
      seat.anted = true;
      seat.done = false;
    }
    await this.scheduleNext(state);
    await this.changed();
  }

  private async setReady(state: TableState, seat: SeatState, ready: boolean): Promise<void> {
    if (state.state !== "waiting") throw new Error("The game has already started.");
    if (seat.isBot) return;
    seat.ready = state.mode === "wager" ? seat.deposited : ready;
    if (this.everyoneReady(state) && this.occupied(state).length >= state.minPlayers) {
      state.deadlineKind = "auto-start";
      state.deadlineAt = Date.now() + AUTO_START_MS;
      await this.ctx.storage.setAlarm(state.deadlineAt);
    } else {
      state.deadlineKind = null;
      state.deadlineAt = null;
      await this.clearAlarm();
    }
  }

  private async act(
    state: TableState,
    seat: SeatState,
    message: Extract<ClientMessage, { type: "trump" | "exchange" | "announce" | "playCard" }>,
  ): Promise<void> {
    const game = this.game(state);
    if (game.currentActor() !== seat.index) throw new Error("It is not your turn.");
    switch (message.type) {
      case "trump":
        game.chooseTrump(seat.index, message.suit as Suit);
        break;
      case "exchange":
        game.exchange(seat.index, message.cards);
        break;
      case "announce":
        game.announce(seat.index, message.play);
        break;
      case "playCard":
        game.playCard(seat.index, message.card);
        break;
    }
    state.snapshot = serializeZwanzig(game);
    state.round = game.dealNumber;
    await this.afterAction(state);
  }

  private async afterAction(state: TableState): Promise<void> {
    const game = this.game(state);
    state.round = game.dealNumber;
    if (game.winner !== null) {
      this.finalizeGame(state, game);
      await this.clearAlarm();
      await this.changed();
      return;
    }
    if (game.phase === "deal-scored") {
      state.deadlineKind = "review";
      state.deadlineAt = Date.now() + DEAL_PAUSE_MS;
      state.turnDeadline = null;
      await this.ctx.storage.setAlarm(state.deadlineAt);
      await this.changed();
      return;
    }
    await this.scheduleNext(state);
    await this.changed();
  }

  private async scheduleNext(state: TableState): Promise<void> {
    const game = this.game(state);
    const actor = game.currentActor();
    state.anteDeadline = null;
    if (actor === null) {
      state.deadlineKind = null;
      state.deadlineAt = null;
      state.turnDeadline = null;
      await this.clearAlarm();
      return;
    }
    const actorSeat = state.seats[actor];
    if (actorSeat?.isBot) {
      state.deadlineKind = "bot";
      state.deadlineAt = Date.now() + BOT_DELAY_MS;
      state.turnDeadline = null;
    } else {
      state.deadlineKind = "turn";
      state.deadlineAt = Date.now() + state.turnTimeoutMs;
      state.turnDeadline = state.deadlineAt;
    }
    await this.ctx.storage.setAlarm(state.deadlineAt);
  }

  private finalizeGame(state: TableState, game: ZwanzigGame): void {
    const winner = game.winner ?? 0;
    state.state = "resolved";
    state.phase = "resolved";
    state.round = game.dealNumber;
    state.winnerSeat = winner;
    state.revealedSeed = state.seed;
    state.turnDeadline = null;
    state.anteDeadline = null;
    state.deadlineKind = null;
    state.deadlineAt = null;

    const rows = game.scores.map((score, seat) => ({
      seat,
      name: state.seats[seat]?.name ?? `Seat ${seat + 1}`,
      score,
      ranking: [score],
      detail: `${game.tricksWon[seat] ?? 0} tricks won · started at ${STARTING_SCORE}`,
      winner: seat === winner,
    }));
    const summary: RoundSummary = {
      round: game.dealNumber,
      rows,
      tie: false,
      winners: [winner],
      carryOver: false,
      seedCommitment: state.seedCommitment,
      seed: state.seed,
      signature: null,
    };
    state.lastRound = summary;
    state.notice =
      state.mode === "wager"
        ? `${rows[winner]?.name ?? "A player"} reached zero first. Settlement is pending.`
        : `${rows[winner]?.name ?? "A player"} reached zero first and wins the game.`;
    if (state.mode === "wager") state.chainStatus = "settlement pending";

    const logHash = state.seed
      ? bytesToHex(
          sha256(
            concatBytes(
              hexToBytes(state.seed),
              new Uint8Array([0]),
              utf8ToBytes(JSON.stringify(game.log)),
            ),
          ),
        )
      : undefined;
    state.history.push({
      ...summary,
      game: "zwanzig-ab",
      logHash,
      vrfDigest: state.vrfDigest,
    });
  }

  private finalizeAnte(state: TableState): void {
    for (const seat of this.occupied(state)) {
      if (!seat.anted) seat.active = false;
      seat.anted = false;
      seat.done = false;
    }
    const survivors = this.occupied(state).filter((seat) => seat.active);
    state.anteDeadline = null;
    state.deadlineKind = null;
    state.deadlineAt = null;
    if (survivors.length < 2) {
      state.state = "voided";
      state.phase = "voided";
      state.notice = "Not enough players re-anted. The table was voided.";
      return;
    }
    state.round += 1;
    state.state = "in-progress";
    state.phase = "lobby";
    state.notice = "The pot carries over. A fresh deal is starting.";
  }

  private markDeposited(state: TableState, seat: SeatState, signature: string): void {
    if (state.mode !== "wager") return;
    if (seat.deposited) return;
    if (!signature.trim()) throw new Error("A deposit signature is required.");
    seat.deposited = true;
    seat.anted = true;
    seat.ready = true;
    state.potStakes = (BigInt(state.potStakes) + BigInt(state.stake)).toString();
    state.potFees = (BigInt(state.potFees) + BigInt(state.fee)).toString();
    state.chainStatus = "deposit recorded locally; chain verification pending";
    state.notice = `${seat.name} deposited ${formatUsdc(BigInt(state.stake) + BigInt(state.fee))} USDC.`;
  }

  private everyoneReady(state: TableState): boolean {
    return this.occupied(state).every((seat) => seat.ready || seat.isBot);
  }

  private fillBots(state: TableState): void {
    const used = new Set(this.occupied(state).map((seat) => seat.name));
    for (const seat of state.seats) {
      if (seat.playerId !== null) continue;
      const name = BOT_NAMES.find((candidate) => !used.has(candidate)) ?? `Bot ${seat.index + 1}`;
      used.add(name);
      Object.assign(seat, {
        index: seat.index,
        playerId: newBotId(state.id),
        name,
        wallet: null,
        connected: true,
        ready: true,
        isBot: true,
        active: true,
        deposited: true,
        anted: true,
        done: false,
      } satisfies SeatState);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Views and persistence                                               */
  /* ------------------------------------------------------------------ */

  private viewFor(state: TableState, playerId: string | null): RoomView {
    const viewer = playerId ? this.seatOf(state, playerId) : null;
    const game = state.snapshot ? this.game(state) : null;
    const spectator = game?.spectatorView();
    const zwanzig = game
      ? viewer
        ? game.viewFor(viewer.index)
        : ({ ...spectator, hand: [], legalCards: [] } as RoomView["zwanzig"])
      : null;

    return {
      id: state.id,
      game: "zwanzig-ab",
      gameName: GAMES["zwanzig-ab"].name,
      mode: state.mode,
      stake: state.mode === "wager" ? state.stake : null,
      fee: state.mode === "wager" ? state.fee : null,
      state: state.state,
      phase: this.effectivePhase(state),
      round: state.snapshot?.dealNumber ?? state.round,
      minPlayers: state.minPlayers,
      maxPlayers: state.maxPlayers,
      seats: this.occupied(state).map((seat) => this.publicSeat(seat)),
      hostSeat: state.hostSeat,
      yourSeat: viewer?.index ?? null,
      currentSeat: game?.currentActor() ?? null,
      turnDeadline: state.turnDeadline,
      serverTime: Date.now(),
      potStakes: state.potStakes,
      potFees: state.potFees,
      seedCommitment: state.seedCommitment,
      revealedSeed: state.revealedSeed,
      vrfDigest: state.vrfDigest,
      zwanzig,
      lastRound: state.lastRound,
      winnerSeat: state.winnerSeat,
      verifyUrl: state.seedCommitment ? `/api/verify?room=${state.id}&round=${state.round}` : null,
      chain: this.chainView(state),
      notice: state.notice,
      anteDeadline: state.anteDeadline,
      turnTimeoutMs: state.turnTimeoutMs,
    };
  }

  private toLobby(state: TableState): PublicTableRecord {
    return {
      id: state.id,
      game: "zwanzig-ab",
      gameName: GAMES["zwanzig-ab"].name,
      mode: state.mode,
      stake: state.mode === "wager" ? state.stake : null,
      seats: this.occupied(state).length,
      maxPlayers: state.maxPlayers,
      minPlayers: state.minPlayers,
      state: state.state,
      hostName: state.hostName,
      publicTable: state.publicTable,
      createdAt: state.createdAt,
    };
  }

  private chainView(state: TableState): ChainStatus | null {
    if (state.mode !== "wager") return null;
    return {
      enabled: state.wageringEnabled,
      cluster: state.cluster,
      tablePda: null,
      escrowPda: null,
      createSignature: null,
      lastSignature: null,
      status: state.chainStatus,
      explorerUrl: null,
    };
  }

  private effectivePhase(state: TableState): RoomPhase {
    if (state.state === "waiting") return "lobby";
    if (state.state === "starting") return "countdown";
    if (state.state === "ante") return "ante";
    if (state.state === "resolved") return "resolved";
    if (state.state === "voided") return "voided";
    if (!state.snapshot) return state.phase;
    const phase = this.game(state).phase;
    if (phase === "deal-scored") return "scored";
    if (phase === "game-over") return "resolved";
    return phase;
  }

  private publicSeat(seat: SeatState): SeatPublic {
    return {
      seat: seat.index,
      name: seat.name,
      connected: seat.connected,
      ready: seat.ready,
      isBot: seat.isBot,
      wallet: seat.wallet,
      active: seat.active,
      anted: seat.anted,
      done: seat.done,
    };
  }

  private occupied(state: TableState): SeatState[] {
    return state.seats.filter((seat): seat is SeatState => seat.playerId !== null);
  }

  private seatOf(state: TableState, playerId: string): SeatState | null {
    return state.seats.find((seat) => seat.playerId === playerId) ?? null;
  }

  private game(state: TableState): ZwanzigGame {
    if (!state.snapshot) throw new Error("No deal is in progress.");
    return restoreZwanzig(state.snapshot);
  }

  private async changed(): Promise<void> {
    const state = this.state;
    if (!state) return;
    state.touchedAt = Date.now();
    await this.persist();

    const playerIds = this.occupied(state)
      .filter((seat) => !seat.isBot && seat.playerId)
      .map((seat) => seat.playerId as string);
    const views: Record<string, RoomView> = {};
    for (const playerId of playerIds) views[playerId] = this.viewFor(state, playerId);
    const fallback = this.viewFor(state, null);

    await this.lobbyStub().publishRoom({ roomId: state.id, views, fallback }).catch(() => undefined);
    await this.lobbyStub().updateTable(this.toLobby(state)).catch(() => undefined);

    for (const ws of this.ctx.getWebSockets()) {
      const connection = ws.deserializeAttachment() as TableConnectionState | null;
      if (!connection) continue;
      this.send(ws, { type: "room", room: views[connection.playerId] ?? fallback });
    }
  }

  private async publishChat(state: TableState, seat: SeatState, text: string): Promise<void> {
    const clean = cleanChat(text);
    if (!clean) return;
    const message: ServerMessage = {
      type: "chat",
      seat: seat.index,
      name: seat.name,
      text: clean,
      at: Date.now(),
    };
    await this.lobbyStub()
      .publishMessage({ roomId: state.id, message })
      .catch(() => undefined);
    for (const ws of this.ctx.getWebSockets()) this.send(ws, message);
  }

  private async load(): Promise<TableState | null> {
    if (this.state) return this.state;
    this.state = (await this.ctx.storage.get<TableState>("state")) ?? null;
    return this.state;
  }

  private persist(): Promise<void> {
    if (!this.state) return Promise.resolve();
    return this.ctx.storage.put("state", this.state);
  }

  private clearAlarm(): Promise<void> {
    return this.ctx.storage.deleteAlarm();
  }

  private lobbyStub() {
    return this.env.LOBBY_DO.getByName("global");
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore closed sockets.
    }
  }
}

function emptySeat(index: number): SeatState {
  return {
    index,
    playerId: null,
    name: "",
    wallet: null,
    connected: false,
    ready: false,
    isBot: false,
    active: false,
    deposited: false,
    anted: false,
    done: false,
  };
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 24) || "Player";
}

function cleanChat(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
}

function cleanPlayerId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || trimmed.startsWith("bot:")) return null;
  return trimmed;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "That action could not be completed.";
}

function isSendableCloseCode(code: number): boolean {
  return code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code);
}
