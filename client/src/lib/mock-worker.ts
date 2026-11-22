import {
  STARTING_SCORE,
  ZwanzigGame,
  commitSeed,
  formatUsdc,
  type Suit,
} from "@20down/shared";
import type {
  ClientMessage,
  LobbyTable,
  RoomPhase,
  RoomView,
  RoundSummary,
  SeatPublic,
  ServerMessage,
} from "@20down/shared/protocol";
import { config } from "./config";

interface ChatEntry {
  seat: number;
  name: string;
  text: string;
  at: number;
}

/**
 * A browser-side stand-in for the Cloudflare Worker. It speaks the same JSON
 * protocol, uses the real Zwanzig engine and plays bots locally. It exists so
 * the static shell can be exercised on GitHub Pages before the Worker is live.
 */
export class MockWorker {
  private playerId: string | null = null;
  private name = "Guest";
  private wallet: string | null = null;
  private tables = new Map<string, MockTable>();
  private rooms = new Map<string, MockTable>();
  private seatByPlayer = new Map<string, string>();

  constructor(private readonly emit: (message: ServerMessage) => void) {
    this.seedLobby();
  }

  send(message: ClientMessage): void {
    switch (message.type) {
      case "hello": {
        if (message.playerId) this.playerId = message.playerId;
        if (!this.playerId) this.playerId = randomId("P");
        if (message.name) this.name = cleanName(message.name);
        this.wallet = message.wallet ?? null;
        this.emit({ type: "welcome", playerId: this.playerId, name: this.name, serverTime: Date.now() });
        if (message.roomId) this.joinRoom(message.roomId, true);
        this.sendLobby();
        this.sendCurrentRoom();
        return;
      }
      case "lobby":
        this.sendLobby();
        return;
      case "create":
        this.createTable(message);
        return;
      case "quickMatch":
        this.quickMatch(message);
        return;
      case "join":
        this.joinRoom(message.tableId);
        return;
      case "leave": {
        const room = this.currentRoom();
        if (room) {
          this.seatByPlayer.delete(this.playerId ?? "");
          this.rooms.delete(this.playerId ?? "");
          this.tables.delete(room.view.id);
        }
        this.emit({ type: "left" });
        this.sendLobby();
        return;
      }
      case "ready": {
        const room = this.currentRoom();
        const seat = this.yourSeat(room);
        if (room && seat && room.view.state === "waiting") {
          seat.ready = message.ready;
          if (room.view.seats.every((s) => s.ready || s.isBot)) {
            this.startGame();
            return;
          }
          this.sync(room);
        }
        return;
      }
      case "start":
        this.startGame();
        return;
      case "trump":
        this.act((game, seat) => game.chooseTrump(seat, message.suit));
        return;
      case "exchange":
        this.act((game, seat) => game.exchange(seat, message.cards));
        return;
      case "announce":
        this.act((game, seat) => game.announce(seat, message.play));
        return;
      case "playCard":
        this.act((game, seat) => game.playCard(seat, message.card));
        return;
      case "nextDeal":
        this.nextDeal();
        return;
      case "deposited": {
        const room = this.currentRoom();
        const seat = this.yourSeat(room);
        if (room && seat) {
          seat.ready = true;
          seat.anted = true;
          room.view.chain = {
            ...(room.view.chain ?? emptyChain()),
            status: "Deposit simulated locally",
            lastSignature: message.signature,
          };
          this.sync(room);
        }
        return;
      }
      case "chat":
        this.sendChat(message.text);
        return;
      case "ping":
        this.emit({ type: "pong", serverTime: Date.now() });
        return;
    }
  }

  private seedLobby(): void {
    this.addDemoTable("T-OPEN-3", "free", 3, 1, "Mara");
    this.addDemoTable("T-OPEN-4", "free", 4, 2, "Jonas");
    this.addDemoTable("T-USDC-3", "wager", 3, 1, "Ilse", 250_000n);
  }

  private addDemoTable(
    id: string,
    mode: "free" | "wager",
    maxPlayers: number,
    seats: number,
    hostName: string,
    stake = 0n,
  ): void {
    const view = makeRoomView(id, mode, maxPlayers, stake, this.playerId ?? "demo");
    view.seats[0] = { ...(view.seats[0] as SeatPublic), name: hostName };
    view.yourSeat = null;
    for (let seat = 1; seat < seats; seat += 1) {
      view.seats.push(mode === "free" ? botSeat(seat) : humanSeat(seat));
    }

    const table: LobbyTable = {
      id,
      game: "zwanzig-ab",
      gameName: "20 Down",
      mode,
      stake: stake ? stake.toString() : null,
      seats: view.seats.length,
      maxPlayers,
      minPlayers: 3,
      state: "waiting",
      hostName,
    };
    this.tables.set(id, {
      view,
      lobby: table,
      game: null,
      seed: "",
      hostName,
    });
  }

  private sendLobby(): void {
    this.emit({ type: "lobby", tables: [...this.tables.values()].map((table) => ({ ...table.lobby })) });
  }

  private sendCurrentRoom(): void {
    const room = this.currentRoom();
    if (room) this.emit({ type: "room", room: structuredClone(room.view) });
  }

  private currentRoom(): MockTable | null {
    if (!this.playerId) return null;
    return this.rooms.get(this.playerId) ?? null;
  }

  private yourSeat(room: MockTable | null): SeatPublic | null {
    if (!room || !this.playerId) return null;
    return room.view.seats.find((seat) => seat.seat === room.view.yourSeat) ?? null;
  }

  private createTable(message: Extract<ClientMessage, { type: "create" }>): void {
    const mode = message.mode;
    if (mode === "wager" && !config.wageringEnabled) {
      this.fail("Wagering is paused until the independent audit and legal sign-off are complete.");
      return;
    }
    const maxPlayers = clampSeats(message.maxPlayers);
    const stake = parseStake(message.stakeBaseUnits);
    const id = randomId("T");
    const room = makeRoomView(id, mode, maxPlayers, stake, this.playerId ?? "local");
    const withBots = mode === "free" && message.vsBots !== false;
    if (withBots) {
      while (room.seats.length < maxPlayers) room.seats.push(botSeat(room.seats.length));
    }
    const table: MockTable = {
      view: room,
      lobby: lobbyFrom(room, this.name),
      game: null,
      seed: "",
      hostName: this.name,
    };
    this.register(table);
  }

  private quickMatch(message: Extract<ClientMessage, { type: "quickMatch" }>): void {
    if (message.mode === "wager" && !config.wageringEnabled) {
      this.fail("Wagering is paused until the independent audit and legal sign-off are complete.");
      return;
    }
    const stake = parseStake(message.stakeBaseUnits);
    const maxPlayers = clampSeats(message.maxPlayers);
    const match = [...this.tables.values()].find(
      (table) =>
        table.lobby.mode === message.mode &&
        table.lobby.state === "waiting" &&
        table.lobby.seats < table.lobby.maxPlayers &&
        (!stake || table.lobby.stake === stake.toString()),
    );
    if (match) {
      this.joinRoom(match.lobby.id);
      return;
    }
    this.createTable({
      type: "create",
      game: "zwanzig-ab",
      mode: message.mode,
      stakeBaseUnits: stake ? stake.toString() : undefined,
      maxPlayers,
      vsBots: message.mode === "free",
      name: this.name,
      wallet: this.wallet ?? undefined,
    });
  }

  private joinRoom(tableId: string, silent = false): void {
    const table = this.tables.get(tableId);
    if (!table) {
      // Deep links should still open something useful in the mock build.
      const room = makeRoomView(tableId, "free", 3, 0n, this.playerId ?? "local");
      while (room.seats.length < 3) room.seats.push(botSeat(room.seats.length));
      const created: MockTable = {
        view: room,
        lobby: lobbyFrom(room, "You"),
        game: null,
        seed: "",
        hostName: "You",
      };
      this.register(created, silent);
      return;
    }
    const room = table.view;
    if (room.state !== "waiting") {
      this.fail("That table is already in progress.");
      return;
    }
    if (room.seats.length >= room.maxPlayers) {
      this.fail("That table is full.");
      return;
    }
    const previous = this.currentRoom();
    if (previous && previous.view.id !== room.id) {
      this.seatByPlayer.delete(this.playerId ?? "");
      this.rooms.delete(this.playerId ?? "");
    }
    if (!room.seats.some((seat) => seat.seat === room.yourSeat)) {
      room.seats.push({
        seat: room.seats.length,
        name: this.name,
        connected: true,
        ready: false,
        isBot: false,
        wallet: this.wallet,
        active: true,
        anted: false,
        done: false,
      });
      room.yourSeat = room.seats.length - 1;
    }
    table.lobby.seats = room.seats.length;
    this.register(table, silent);
  }

  private register(table: MockTable, silent = false): void {
    if (this.playerId) {
      this.seatByPlayer.set(this.playerId, table.view.id);
      this.rooms.set(this.playerId, table);
    }
    this.tables.set(table.view.id, table);
    if (!silent) this.emit({ type: "room", room: structuredClone(table.view) });
    this.sendLobby();
  }

  private startGame(): void {
    const room = this.currentRoom();
    if (!room) return this.fail("You are not seated at a table.");
    if (room.view.seats.length < room.view.minPlayers) {
      return this.fail(`20 Down needs at least ${room.view.minPlayers} players.`);
    }
    if (!room.view.seats.every((seat) => seat.ready || seat.isBot)) {
      return this.fail("Every player must be ready first.");
    }
    const seedBytes = crypto.getRandomValues(new Uint8Array(32));
    room.seed = toHex(seedBytes);
    room.game = new ZwanzigGame({
      seed: room.seed,
      playerCount: room.view.seats.length,
      dealerSeat: Math.floor(Math.random() * room.view.seats.length),
    });
    room.view.seedCommitment = commitSeed(seedBytes);
    room.view.state = "in-progress";
    room.game.startDeal();
    this.sync(room);
    this.advanceBots(room);
  }

  private act(action: (game: ZwanzigGame, seat: number) => void): void {
    const room = this.currentRoom();
    if (!room?.game || room.view.yourSeat === null) return;
    try {
      action(room.game, room.view.yourSeat);
      this.advanceBots(room);
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : "That move is not legal.");
    }
  }

  private nextDeal(): void {
    const room = this.currentRoom();
    if (!room?.game) return;
    try {
      if (room.game.phase === "deal-scored") room.game.nextDeal();
      this.advanceBots(room);
    } catch (cause) {
      this.fail(cause instanceof Error ? cause.message : "The next deal is not ready.");
    }
  }

  private advanceBots(room: MockTable): void {
    const game = room.game;
    if (!game) return;
    const human = room.view.yourSeat ?? -1;
    let guard = 0;
    while (guard < 200) {
      guard += 1;
      const actor = game.currentActor();
      if (actor === null || actor === human) break;
      game.applyAutoAction(actor);
    }
    this.sync(room);
  }

  private sync(room: MockTable): void {
    const game = room.game;
    const view = room.view;
    view.serverTime = Date.now();
    if (!game) {
      this.emit({ type: "room", room: structuredClone(view) });
      return;
    }
    view.zwanzig = game.viewFor(view.yourSeat ?? 0);
    view.round = game.dealNumber;
    view.state = game.phase === "game-over" ? "resolved" : "in-progress";
    view.phase = phaseFor(game);
    view.currentSeat = game.currentActor();
    view.turnDeadline = view.currentSeat === null ? null : Date.now() + view.turnTimeoutMs;
    view.winnerSeat = game.winner;
    if (game.phase === "game-over") {
      view.lastRound = summaryFor(room);
      view.verifyUrl = `/verify?room=${encodeURIComponent(view.id)}&round=${game.dealNumber}`;
    }
    this.emit({ type: "room", room: structuredClone(view) });
  }

  private sendChat(text: string): void {
    const room = this.currentRoom();
    if (!room) return;
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    const entry: ChatEntry = {
      seat: room.view.yourSeat ?? 0,
      name: this.name,
      text: clean,
      at: Date.now(),
    };
    // Chat is carried as a server message so the provider needs no mock branch.
    this.emit({ type: "chat", ...entry });
  }

  private fail(message: string): void {
    this.emit({ type: "error", message });
  }
}

interface MockTable {
  view: RoomView & { lobby?: never };
  lobby: LobbyTable;
  game: ZwanzigGame | null;
  seed: string;
  hostName: string;
}

function makeRoomView(
  id: string,
  mode: "free" | "wager",
  maxPlayers: number,
  stake: bigint,
  playerId: string,
): RoomView {
  const seats: SeatPublic[] = [
    {
      seat: 0,
      name: "You",
      connected: true,
      ready: false,
      isBot: false,
      wallet: null,
      active: true,
      anted: false,
      done: false,
    },
  ];
  return {
    id,
    game: "zwanzig-ab",
    gameName: "20 Down",
    mode,
    stake: stake ? stake.toString() : null,
    fee: stake ? "20000" : null,
    state: "waiting",
    phase: "lobby",
    round: 0,
    minPlayers: 3,
    maxPlayers,
    seats,
    hostSeat: 0,
    yourSeat: 0,
    currentSeat: null,
    turnDeadline: null,
    serverTime: Date.now(),
    potStakes: "0",
    potFees: "0",
    seedCommitment: null,
    revealedSeed: null,
    vrfDigest: null,
    zwanzig: null,
    lastRound: null,
    winnerSeat: null,
    verifyUrl: null,
    chain: stake ? emptyChain() : null,
    notice: mockNotice(playerId),
    anteDeadline: null,
    turnTimeoutMs: 60_000,
  };
}

function mockNotice(_playerId: string): string {
  return config.mock
    ? "Demo mode — this table is simulated in your browser."
    : "Table connected.";
}

function emptyChain() {
  return {
    enabled: config.wageringEnabled,
    cluster: config.cluster,
    tablePda: null,
    escrowPda: null,
    createSignature: null,
    lastSignature: null,
    status: config.wageringEnabled ? "creating table" : "wagering paused",
    explorerUrl: null,
  };
}

function lobbyFrom(room: RoomView, hostName: string): LobbyTable {
  return {
    id: room.id,
    game: room.game,
    gameName: room.gameName,
    mode: room.mode,
    stake: room.stake,
    seats: room.seats.length,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    state: room.state,
    hostName,
  };
}

function botSeat(seat: number): SeatPublic {
  const names = ["Mara", "Jonas", "Ilse", "Fritz"];
  return {
    seat,
    name: names[seat % names.length] ?? `Bot ${seat + 1}`,
    connected: true,
    ready: true,
    isBot: true,
    wallet: null,
    active: true,
    anted: false,
    done: false,
  };
}

function humanSeat(seat: number): SeatPublic {
  const names = ["Renate", "Otto", "Greta", "Hans"];
  return {
    seat,
    name: names[seat % names.length] ?? `Player ${seat + 1}`,
    connected: false,
    ready: false,
    isBot: false,
    wallet: null,
    active: true,
    anted: false,
    done: false,
  };
}

function phaseFor(game: ZwanzigGame): RoomPhase {
  switch (game.phase) {
    case "trump":
      return "trump";
    case "exchange":
      return "exchange";
    case "play":
      return "play";
    case "deal-scored":
      return "scored";
    case "game-over":
      return "resolved";
  }
}

function summaryFor(room: MockTable): RoundSummary {
  const game = room.game as ZwanzigGame;
  const winner = game.winner ?? 0;
  return {
    round: game.dealNumber,
    rows: game.scores.map((score, seat) => ({
      seat,
      name: room.view.seats[seat]?.name ?? `Seat ${seat + 1}`,
      score,
      ranking: [score],
      detail: `${game.tricksWon[seat] ?? 0} tricks won · started at ${STARTING_SCORE}`,
      winner: seat === winner,
    })),
    tie: false,
    winners: [winner],
    carryOver: false,
    seedCommitment: room.view.seedCommitment,
    seed: room.seed,
    signature: null,
  };
}

function clampSeats(value: number | undefined): number {
  return value === 4 ? 4 : 3;
}

function parseStake(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

function cleanName(value: string): string {
  return value.trim().slice(0, 24) || "Guest";
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${prefix}-${toHex(bytes).toUpperCase()}`;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Minimal WebSocket-compatible transport backed by the local simulator. */
export class MockSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  private readonly worker: MockWorker;

  constructor() {
    super();
    this.worker = new MockWorker((message) => {
      if (this.readyState !== WebSocket.OPEN) return;
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
      });
    });
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) return;
    try {
      this.worker.send(JSON.parse(String(data)) as ClientMessage);
    } catch {
      // Ignore malformed messages, just like a real socket would.
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

export const mockStakeLabel = (stake: string | null): string =>
  stake ? `${formatUsdc(BigInt(stake))} USDC` : "Free";

export const knownSuits: Suit[] = ["clubs", "spades", "hearts", "diamonds"];
