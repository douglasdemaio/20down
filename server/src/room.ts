import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { PublicKey } from "@solana/web3.js";
import {
  GAMES,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  generateSeed,
  type GameId,
  type PlayMode,
} from "@wagerwake/shared";
import { explorerAddressUrl, escrowPda } from "@wagerwake/shared/chain";
import type {
  ChainStatus,
  LobbyTable,
  RoomPhase,
  RoomState,
  RoomView,
  RoundSummary,
  SeatPublic,
} from "@wagerwake/shared/protocol";
import type { WagerChain } from "./chain.js";
import {
  DiceSession,
  type DiceRoundOutcome,
  type DiceTurnRecord,
  describeDiceTurn,
} from "./game/diceSession.js";
import { ZwanzigSession } from "./game/zwanzigSession.js";

export interface Seat {
  index: number;
  playerId: string | null;
  name: string;
  wallet: string | null;
  connected: boolean;
  ready: boolean;
  isBot: boolean;
  active: boolean;
  anted: boolean;
  deposited: boolean;
  done: boolean;
}

/** Published per-round verification record. */
export interface RoundRecord extends RoundSummary {
  game: GameId;
  turns?: DiceTurnRecord[];
  logHash?: string;
  vrfDigest?: string | null;
}

export interface RoomHooks {
  onChange: (room: Room) => void;
  onDestroy: (room: Room) => void;
}

export interface RoomOptions {
  id: string;
  game: GameId;
  mode: PlayMode;
  stakeBaseUnits: bigint;
  feeBaseUnits: bigint;
  maxPlayers: number;
  hostName: string;
  chain: WagerChain | null;
  hooks: RoomHooks;
  turnTimeoutMs: number;
  anteTimeoutMs: number;
}

const BOT_NAMES = [
  "Bones",
  "Cargo Kate",
  "Dicey",
  "Fiver",
  "Harbor",
  "Jinx",
  "Lucky Lu",
  "Moxie",
  "Nix",
  "Peg",
  "Quill",
  "Rook",
];

export class Room {
  readonly id: string;
  readonly game: GameId;
  readonly mode: PlayMode;
  readonly stake: bigint;
  readonly fee: bigint;
  readonly maxPlayers: number;
  readonly minPlayers: number;
  readonly createdAt = Date.now();
  touchedAt = Date.now();

  hostSeat = 0;
  state: RoomState = "waiting";
  phase: RoomPhase = "lobby";
  round = 1;
  seats: Array<Seat | null>;
  session: DiceSession | ZwanzigSession | null = null;
  lastRound: RoundSummary | null = null;
  readonly history: RoundRecord[] = [];
  seedCommitment: string | null = null;
  revealedSeed: string | null = null;
  vrfDigest: string | null = null;
  winnerSeat: number | null = null;
  notice: string | null = null;
  anteDeadline: number | null = null;
  potStakes = 0n;
  potFees = 0n;

  chainTable: PublicKey | null = null;
  private chainCreateSignature: string | null = null;
  private chainLastSignature: string | null = null;
  private chainStatus = "off";
  private chainCommitmentDone: Promise<unknown> = Promise.resolve();
  private readonly chain: WagerChain | null;
  private readonly hooks: RoomHooks;
  private readonly turnTimeoutMs: number;
  private readonly anteTimeoutMs: number;
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private carryTimer: ReturnType<typeof setTimeout> | null = null;
  private anteTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private zwanzigSeed: Uint8Array | null = null;

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.game = options.game;
    this.mode = options.mode;
    this.stake = options.stakeBaseUnits;
    this.fee = options.feeBaseUnits;
    this.maxPlayers = options.maxPlayers;
    this.minPlayers = GAMES[options.game].minPlayers;
    this.seats = Array.from({ length: options.maxPlayers }, () => null);
    this.chain = options.chain;
    this.hooks = options.hooks;
    this.turnTimeoutMs = options.turnTimeoutMs;
    this.anteTimeoutMs = options.anteTimeoutMs;
    if (this.mode === "wager") {
      this.chainStatus = "creating";
      void this.createOnChain();
    }
    void options.hostName;
  }

  /* ------------------------------------------------------------------ */
  /* Seats                                                               */
  /* ------------------------------------------------------------------ */

  get occupied(): Seat[] {
    return this.seats.filter((seat): seat is Seat => seat !== null);
  }

  seatOf(playerId: string): Seat | null {
    return this.occupied.find((seat) => seat.playerId === playerId) ?? null;
  }

  get isFull(): boolean {
    return this.occupied.length >= this.maxPlayers;
  }

  addPlayer(input: {
    playerId: string;
    name: string;
    wallet?: string | null;
    isBot?: boolean;
  }): Seat {
    if (this.state !== "waiting") throw new Error("This table has already started");
    const existing = this.seatOf(input.playerId);
    if (existing) {
      existing.connected = true;
      if (input.wallet) existing.wallet = input.wallet;
      if (input.name) existing.name = input.name;
      this.changed();
      return existing;
    }
    if (this.isFull) throw new Error("Table is full");
    const index = this.seats.findIndex((seat) => seat === null);
    if (index < 0) throw new Error("Table is full");
    const seat: Seat = {
      index,
      playerId: input.playerId,
      name: input.name.slice(0, 24) || (input.isBot ? this.nextBotName() : "Player"),
      wallet: input.wallet ?? null,
      connected: true,
      ready: Boolean(input.isBot),
      isBot: Boolean(input.isBot),
      active: true,
      anted: this.mode === "free",
      deposited: this.mode === "free",
      done: false,
    };
    this.seats[index] = seat;
    if (this.occupied.length === 1) this.hostSeat = index;
    if (this.mode === "free") {
      this.potStakes += this.stake;
      this.potFees += this.fee;
    }
    this.changed();
    return seat;
  }

  removePlayer(playerId: string): boolean {
    const seat = this.seatOf(playerId);
    if (!seat) return false;
    if (this.state !== "waiting" && !seat.isBot) {
      seat.connected = false;
      this.changed();
      return false;
    }
    this.seats[seat.index] = null;
    if (this.occupied.length === 0) {
      this.destroy();
      return true;
    }
    if (this.hostSeat === seat.index) this.hostSeat = this.occupied[0]?.index ?? 0;
    this.changed();
    return true;
  }

  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    seat.connected = connected;
    this.changed();
  }

  fillBots(count: number): void {
    if (this.mode !== "free") return;
    for (let added = 0; added < count && !this.isFull; added += 1) {
      const playerId = `bot:${this.id}:${randomBytes(3).toString("hex")}`;
      this.addPlayer({
        playerId,
        name: this.nextBotName(),
        isBot: true,
      });
    }
  }

  setReady(seat: Seat, ready: boolean): void {
    if (this.state !== "waiting") throw new Error("The game has already started");
    if (seat.isBot) return;
    if (this.mode === "wager") {
      // Wager seats are marked ready by the program when they join; readiness is
      // implied by the on-chain deposit, so local toggles are meaningless.
      seat.ready = seat.deposited;
      this.changed();
      return;
    }
    seat.ready = ready;
    this.changed();
    this.maybeAutoStart();
  }

  /** Removes a waiting seat after its on-chain refund has been confirmed. */
  releaseSeatByWallet(wallet: string): boolean {
    if (this.state !== "waiting" || this.mode !== "wager") return false;
    const seat = this.occupied.find((entry) => entry.wallet === wallet);
    if (!seat) return false;
    return this.removePlayer(seat.playerId ?? "");
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    if (this.state !== "waiting") return;
    if (this.occupied.length < this.minPlayers) {
      throw new Error(`Need at least ${this.minPlayers} players`);
    }
    if (!this.occupied.every((seat) => seat.ready || seat.isBot)) {
      throw new Error("Every player must be ready");
    }
    if (this.mode === "wager") {
      if (!this.chain?.enabled) throw new Error("Wager mode is disabled on this server");
      if (!this.occupied.every((seat) => seat.deposited)) {
        throw new Error("Every player must deposit their stake on-chain first");
      }
      if (!this.chainTable) throw new Error("The on-chain table is not ready yet");
      this.state = "starting";
      this.phase = "countdown";
      this.changed();
      try {
        this.chainStatus = "starting on-chain game";
        await this.chain.startGame(this.chainTable);
      } catch (error) {
        this.state = "waiting";
        this.phase = "lobby";
        this.notice = `Could not start on-chain game: ${messageOf(error)}`;
        this.chainStatus = "start failed";
        this.changed();
        return;
      }
    }

    this.state = "in-progress";
    this.round = 1;
    this.winnerSeat = null;
    this.lastRound = null;
    this.revealedSeed = null;
    this.seedCommitment = null;
    this.notice = null;
    for (const seat of this.occupied) {
      seat.active = true;
      seat.anted = true;
      seat.done = false;
    }

    if (this.game === "zwanzig-ab") this.startZwanzig();
    else this.startDiceRound();
  }

  /**
   * Starts a fresh round in place for a finished free-play dice table. Wager
   * tables need a new deposit, and Zwanzig ab is a single game to zero, so both
   * still go back to the lobby.
   */
  rematch(): void {
    if (this.game === "zwanzig-ab") {
      throw new Error("Zwanzig ab ends when a player reaches zero — start a new table");
    }
    if (this.mode !== "free") {
      throw new Error("Start a new table to play another USDC round");
    }
    if (this.state !== "resolved") throw new Error("The round has not finished yet");
    if (this.destroyed) throw new Error("This table is closed");

    this.round += 1;
    this.state = "in-progress";
    this.phase = "play";
    this.winnerSeat = null;
    this.lastRound = null;
    this.notice = null;
    this.revealedSeed = null;
    this.seedCommitment = null;
    this.vrfDigest = null;
    this.anteDeadline = null;
    for (const seat of this.occupied) {
      seat.active = true;
      seat.anted = true;
      seat.done = false;
    }
    this.startDiceRound();
  }

  private startDiceRound(): void {
    if (this.session instanceof DiceSession) this.session.dispose();
    this.zwanzigSeed = null;
    const activeSeats = (this.occupied as Seat[])
      .filter((seat) => seat.active)
      .map((seat) => seat.index);
    for (const seat of this.occupied) seat.done = !seat.active;
    const session = new DiceSession({
      game: this.game === "horses" ? "horses" : "ship-captain-crew",
      round: this.round,
      seats: activeSeats,
      names: this.seats.map((seat) => seat?.name ?? ""),
      timeoutMs: this.turnTimeoutMs,
      events: {
        onUpdate: () => this.changed(),
        onRoundComplete: (outcome) => void this.onDiceRoundComplete(outcome),
        onTimedOut: (seat) => void this.onDiceTimeout(seat),
      },
    });
    this.session = session;
    this.phase = "play";
    this.seedCommitment = session.commitment;
    this.revealedSeed = null;
    if (this.mode === "wager" && this.chainTable) {
      this.chainStatus = "committing seed";
      this.chainCommitmentDone = this.chain!
        .commitSeed(this.chainTable, hexToBytes(session.commitment))
        .then((signature) => {
          this.chainLastSignature = signature;
          this.chainStatus = "seed committed";
          this.changed();
        })
        .catch((error) => {
          this.chainStatus = `commit failed: ${messageOf(error)}`;
          this.notice = "Could not publish the seed commitment on-chain.";
          this.changed();
        });
    }
    this.changed();
  }

  private startZwanzig(): void {
    this.zwanzigSeed = generateSeed();
    const seed = this.zwanzigSeed;
    this.seedCommitment = bytesToHex(sha256(seed));
    this.revealedSeed = null;
    const session = new ZwanzigSession({
      playerCount: this.occupied.length,
      seed,
      timeoutMs: this.turnTimeoutMs,
      dealPauseMs: 5000,
      events: {
        onUpdate: () => this.changed(),
        onGameOver: (winner, logHash) => void this.onZwanzigGameOver(winner, logHash),
      },
    });
    this.session = session;
    this.phase = session.game.phase === "trump" ? "trump" : "exchange";
    if (this.mode === "wager" && this.chainTable) {
      this.chainStatus = "committing seed";
      this.chainCommitmentDone = this.chain!
        .commitSeed(this.chainTable, hexToBytes(this.seedCommitment))
        .then((signature) => {
          this.chainLastSignature = signature;
          this.chainStatus = "seed committed";
          this.changed();
        })
        .catch((error) => {
          this.chainStatus = `commit failed: ${messageOf(error)}`;
          this.notice = "Could not publish the seed commitment on-chain.";
          this.changed();
        });
    }
    this.changed();
  }

  private maybeAutoStart(): void {
    if (this.autoStartTimer || this.state !== "waiting" || this.destroyed) return;
    const seats = this.occupied;
    if (seats.length < this.minPlayers) return;
    if (!seats.every((seat) => seat.ready || seat.isBot)) return;
    if (this.mode === "wager" && !seats.every((seat) => seat.deposited)) return;
    this.autoStartTimer = setTimeout(() => {
      this.autoStartTimer = null;
      void this.start().catch((error) => {
        this.notice = messageOf(error);
        this.changed();
      });
    }, 1200);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  handle(seat: Seat, message: Record<string, unknown> & { type: string }): void {
    switch (message.type) {
      case "ready":
        this.setReady(seat, Boolean(message.ready));
        return;
      case "start":
        void this.start().catch((error) => {
          this.notice = messageOf(error);
          this.changed();
        });
        return;
      case "rematch":
        this.rematch();
        return;
      case "reroll":
      case "stand": {
        const session = this.session;
        if (!(session instanceof DiceSession)) throw new Error("Dice are not in play");
        session.act(seat.index, message as { type: "reroll"; mask: number } | { type: "stand" });
        return;
      }
      case "trump":
      case "exchange":
      case "announce":
      case "playCard": {
        const session = this.session;
        if (!(session instanceof ZwanzigSession)) throw new Error("Cards are not in play");
        session.act(seat.index, message as never);
        return;
      }
      case "nextDeal": {
        const session = this.session;
        if (session instanceof ZwanzigSession) session.nextDeal();
        return;
      }
      case "deposited":
        void this.markDeposited(seat, String(message.signature ?? ""));
        return;
      default:
        throw new Error(`Unsupported action: ${message.type}`);
    }
  }

  private async markDeposited(seat: Seat, signature: string): Promise<void> {
    if (this.mode !== "wager") return;
    if (!this.chain || !this.chainTable) throw new Error("The on-chain table is not ready");
    const table = await this.chain.fetchTable(this.chainTable);
    if (!table) throw new Error("On-chain table not found");
    const wallet = seat.wallet ? new PublicKey(seat.wallet) : null;
    if (!wallet) throw new Error("Connect a wallet before depositing");
    const onChainSeat = table.seats.findIndex((key) => key.equals(wallet));
    if (onChainSeat < 0) throw new Error("Deposit not found on-chain yet");

    if (this.state === "ante") {
      if (seat.anted) return;
      if (table.antedRound[onChainSeat] !== this.round) {
        throw new Error("The ante is not visible on-chain yet");
      }
      seat.anted = true;
      this.potStakes += this.stake;
      this.notice = `${seat.name} re-anted ${formatStake(this.stake)} USDC`;
    } else {
      if (seat.deposited) return;
      seat.deposited = true;
      seat.anted = true;
      seat.ready = true;
      this.potStakes += this.stake;
      this.potFees += this.fee;
      this.notice = `${seat.name} deposited ${formatStake(this.stake + this.fee)} USDC`;
    }
    this.chainLastSignature = signature || this.chainLastSignature;
    this.chainStatus = "deposit confirmed";
    this.changed();
    this.maybeAutoStart();
  }

  /* ------------------------------------------------------------------ */
  /* Dice round outcomes                                                 */
  /* ------------------------------------------------------------------ */

  private async onDiceRoundComplete(outcome: DiceRoundOutcome): Promise<void> {
    const summary: RoundSummary = {
      ...outcome.summary,
      seedCommitment: this.seedCommitment,
      seed: outcome.seedHex,
      signature: null,
    };
    this.lastRound = summary;
    this.revealedSeed = outcome.seedHex;
    this.history.push({
      ...summary,
      game: this.game,
      turns: outcome.turns,
      vrfDigest: this.vrfDigest,
    });

    if (outcome.tie) {
      if (this.mode === "free") {
        this.phase = "scored";
        this.notice = "Tie — the pot carries over. New round starting…";
        this.changed();
        this.scheduleCarryRound();
      } else {
        await this.beginAnte(outcome);
      }
      return;
    }

    this.winnerSeat = outcome.winners[0] ?? null;
    this.state = "resolved";
    this.phase = "resolved";
    this.notice =
      this.mode === "wager"
        ? "Round resolved. Settling on-chain…"
        : `${this.seatName(this.winnerSeat)} wins the round`;
    this.changed();
    if (this.mode === "wager" && this.chainTable && this.winnerSeat !== null) {
      await this.settleDiceOnChain(outcome, this.winnerSeat, summary);
    }
  }

  private scheduleCarryRound(): void {
    this.clearCarryTimer();
    this.carryTimer = setTimeout(() => {
      this.carryTimer = null;
      if (this.destroyed) return;
      this.round += 1;
      for (const seat of this.occupied) {
        seat.active = true;
        seat.done = false;
        seat.anted = true;
      }
      this.state = "in-progress";
      this.startDiceRound();
    }, 5000);
  }

  private async settleDiceOnChain(
    outcome: DiceRoundOutcome,
    winnerSeat: number,
    summary: RoundSummary,
  ): Promise<void> {
    const chain = this.chain;
    const table = this.chainTable;
    if (!chain || !table) return;
    try {
      await this.revealSeedOnChain(outcome);
      this.chainStatus = "recording result";
      const signature = await chain.resolveDiceRound(table, outcome.turns, winnerSeat);
      summary.signature = signature;
      this.lastRound = { ...summary };
      const record = this.history[this.history.length - 1];
      if (record?.round === summary.round) {
        record.signature = signature;
        record.vrfDigest = this.vrfDigest;
      }
      this.chainLastSignature = signature;
      this.chainStatus = "settled on-chain";
      this.notice = "Paid out on-chain.";
    } catch (error) {
      this.chainStatus = "settlement failed";
      this.notice = `On-chain settlement failed: ${messageOf(error)}`;
    }
    this.changed();
  }

  /** Reveals the round seed and binds it to the on-chain commitment. */
  private async revealSeedOnChain(outcome: DiceRoundOutcome): Promise<string> {
    const chain = this.chain;
    const table = this.chainTable;
    if (!chain || !table) throw new Error("The on-chain table is not ready");
    await this.chainCommitmentDone;
    const digest = bytesToHex(sha256(concatBytes(hexToBytes(outcome.seedHex), new Uint8Array([0]))));
    this.vrfDigest = digest;
    this.chainStatus = "revealing seed";
    return chain.recordVrf(table, hexToBytes(outcome.seedHex), hexToBytes(digest));
  }

  private async beginAnte(outcome: DiceRoundOutcome): Promise<void> {
    const chain = this.chain;
    const table = this.chainTable;
    let chainError: string | null = null;
    if (chain && table) {
      try {
        await this.revealSeedOnChain(outcome);
        this.chainStatus = "recording tie";
        // Move the on-chain table into its ante state; the program advances the
        // round and clears the randomness for the carried-over round.
        const accountSeat = outcome.winners[0] ?? outcome.turns[0]?.seat ?? 0;
        await chain.resolveDiceRound(table, outcome.turns, accountSeat);
        this.chainStatus = "tie recorded, waiting for antes";
      } catch (error) {
        chainError = messageOf(error);
        this.chainStatus = "tie settlement failed";
      }
    }

    // The program has already advanced its round counter by one, so keep the
    // local round in lockstep for ante_round checks and the next commitment.
    this.round += 1;
    this.state = "ante";
    this.phase = "ante";
    this.anteDeadline = Date.now() + this.anteTimeoutMs;
    for (const seat of this.occupied) {
      seat.anted = false;
      seat.done = false;
    }
    this.notice = chainError
      ? `Tie — but the on-chain tie could not be recorded: ${chainError}`
      : "Tie — every remaining player must re-ante within 60 seconds.";
    this.changed();
    this.scheduleAnteFinalize();
  }

  private scheduleAnteFinalize(): void {
    this.clearAnteTimer();
    const wait = Math.max(0, (this.anteDeadline ?? Date.now()) - Date.now()) + 1500;
    this.anteTimer = setTimeout(() => {
      this.anteTimer = null;
      void this.finalizeAnte();
    }, wait);
  }

  private async finalizeAnte(): Promise<void> {
    if (this.destroyed || this.state !== "ante") return;
    const losers = this.occupied.filter((seat) => !seat.anted);
    for (const seat of losers) seat.active = false;
    const survivors = this.occupied.filter((seat) => seat.anted && seat.active);
    this.anteDeadline = null;

    if (this.mode === "wager" && this.chain && this.chainTable) {
      try {
        if (survivors.length === 0) {
          this.chainStatus = "voiding table";
          // finalize_ante voids the table when nobody re-anted.
          await this.chain.finalizeAnte(this.chainTable, 0);
          this.state = "voided";
          this.phase = "voided";
          this.notice = "Nobody re-anted. The table was voided and refunds are open.";
          this.changed();
          return;
        }
        this.chainStatus = "finalizing antes";
        await this.chain.finalizeAnte(this.chainTable, survivors[0]!.index);
        const table = await this.chain.fetchTable(this.chainTable);
        if (table?.state === 3 && table.winnerSeat !== 255) {
          this.winnerSeat = table.winnerSeat;
          this.state = "resolved";
          this.phase = "resolved";
          this.notice = `${this.seatName(table.winnerSeat)} takes the carried pot.`;
          this.changed();
          return;
        }
      } catch (error) {
        this.notice = `Could not finalize the ante on-chain: ${messageOf(error)}`;
        this.changed();
        return;
      }
    }

    if (survivors.length === 0) {
      this.state = "voided";
      this.phase = "voided";
      this.notice = "Nobody re-anted — the table is void.";
      this.changed();
      return;
    }
    if (survivors.length === 1) {
      this.winnerSeat = survivors[0]!.index;
      this.state = "resolved";
      this.phase = "resolved";
      this.notice = `${survivors[0]!.name} takes the carried pot — everyone else forfeited.`;
      this.changed();
      return;
    }

    for (const seat of this.occupied) {
      seat.active = survivors.some((survivor) => survivor.index === seat.index);
      seat.done = !seat.active;
    }
    this.state = "in-progress";
    this.notice = "Antes received. New round.";
    this.startDiceRound();
  }

  private async onDiceTimeout(seat: number): Promise<void> {
    const session = this.session;
    if (!(session instanceof DiceSession)) return;
    if (this.mode === "free") {
      this.notice = `${this.seatName(seat)} ran out of time — keeping their roll.`;
      this.changed();
      session.autoFinishTurn();
      return;
    }
    // Wager: a timed-out seat forfeits its stake.
    try {
      const outcome = session.forfeitCurrentSeat();
      if (this.chain && this.chainTable) {
        const winnerSeat = outcome.survivor ?? session.order[0] ?? seat;
        await this.chain.forfeitSeat(this.chainTable, seat, winnerSeat);
        this.chainLastSignature = "forfeit";
        this.chainStatus = "seat forfeited";
      }
      if (outcome.survivor !== null) {
        this.winnerSeat = outcome.survivor;
        this.state = "resolved";
        this.phase = "resolved";
        this.notice = `${this.seatName(outcome.survivor)} wins — the last opponent forfeited.`;
        this.changed();
        return;
      }
      this.notice = `${this.seatName(seat)} timed out and forfeited their stake.`;
      this.changed();
    } catch (error) {
      this.notice = `Forfeit failed: ${messageOf(error)}`;
      this.changed();
      session.autoFinishTurn();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Zwanzig                                                             */
  /* ------------------------------------------------------------------ */

  private async onZwanzigGameOver(winnerSeat: number, logHash: string): Promise<void> {
    const session = this.session;
    if (session instanceof ZwanzigSession) this.phase = "resolved";
    this.winnerSeat = winnerSeat;
    this.state = "resolved";
    this.revealedSeed = session instanceof ZwanzigSession ? session.seedHex : null;
    this.history.push({
      round: this.round,
      game: this.game,
      rows: [],
      tie: false,
      winners: [winnerSeat],
      carryOver: false,
      seedCommitment: this.seedCommitment,
      seed: this.revealedSeed,
      logHash,
      signature: null,
      vrfDigest: this.vrfDigest,
    });
    this.notice =
      this.mode === "wager"
        ? `${this.seatName(winnerSeat)} reached zero first. Settling on-chain…`
        : `${this.seatName(winnerSeat)} reached zero first and wins the game.`;
    this.changed();
    if (this.mode === "wager" && this.chain && this.chainTable) {
      try {
        await this.chainCommitmentDone;
        const seed = session instanceof ZwanzigSession ? session.seed : generateSeed();
        const digest = bytesToHex(sha256(concatBytes(seed, new Uint8Array([0]))));
        this.vrfDigest = digest;
        this.chainStatus = "revealing seed";
        await this.chain.recordVrf(this.chainTable, seed, hexToBytes(digest));
        this.chainStatus = "recording result";
        const signature = await this.chain.submitCardResult(
          this.chainTable,
          winnerSeat,
          hexToBytes(logHash),
        );
        this.chainLastSignature = signature;
        const record = this.history[this.history.length - 1];
        if (record) {
          record.signature = signature;
          record.vrfDigest = this.vrfDigest;
        }
        this.chainStatus = "settled on-chain";
        this.notice = "Paid out on-chain.";
      } catch (error) {
        this.chainStatus = "settlement failed";
        this.notice = `On-chain settlement failed: ${messageOf(error)}`;
      }
      this.changed();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */

  viewFor(playerId: string | null): RoomView {
    const viewer = playerId ? this.seatOf(playerId) : null;
    const session = this.session;
    const diceSession = session instanceof DiceSession ? session : null;
    const zwanzigSession = session instanceof ZwanzigSession ? session : null;
    const currentSeat = diceSession
      ? diceSession.currentActor
      : zwanzigSession
        ? zwanzigSession.game.currentActor()
        : null;
    return {
      id: this.id,
      game: this.game,
      gameName: GAMES[this.game].name,
      mode: this.mode,
      stake: this.mode === "wager" ? this.stake.toString() : null,
      fee: this.mode === "wager" ? this.fee.toString() : null,
      state: this.state,
      phase: this.effectivePhase(),
      round: this.round,
      minPlayers: this.minPlayers,
      maxPlayers: this.maxPlayers,
      seats: this.occupied.map((seat) => this.publicSeat(seat)),
      hostSeat: this.hostSeat,
      yourSeat: viewer ? viewer.index : null,
      currentSeat,
      turnDeadline: session ? session.deadlineAt : null,
      serverTime: Date.now(),
      potStakes: this.potStakes.toString(),
      potFees: this.potFees.toString(),
      seedCommitment: this.seedCommitment,
      revealedSeed: this.revealedSeed,
      vrfDigest: this.vrfDigest,
      dice: diceSession ? diceSession.currentDice : null,
      diceBySeat: diceSession ? diceSession.diceBySeat : [],
      zwanzig: zwanzigSession
        ? viewer
          ? zwanzigSession.viewFor(viewer.index)
          : (zwanzigSession.spectatorView() as RoomView["zwanzig"])
        : null,
      lastRound: this.lastRound,
      winnerSeat: this.winnerSeat,
      verifyUrl:
        this.mode === "wager"
          ? `/verify?room=${this.id}&round=${this.round}`
          : null,
      chain: this.chainView(),
      notice: this.notice,
      anteDeadline: this.anteDeadline,
      turnTimeoutMs: this.turnTimeoutMs,
    };
  }

  toLobby(): LobbyTable {
    return {
      id: this.id,
      game: this.game,
      gameName: GAMES[this.game].name,
      mode: this.mode,
      stake: this.mode === "wager" ? this.stake.toString() : null,
      seats: this.occupied.length,
      maxPlayers: this.maxPlayers,
      minPlayers: this.minPlayers,
      state: this.state,
      hostName: this.occupied.find((seat) => seat.index === this.hostSeat)?.name ?? "—",
    };
  }

  seatName(seat: number | null): string {
    if (seat === null) return "Nobody";
    return this.seats[seat]?.name ?? `Seat ${seat + 1}`;
  }

  /** Looks up a published round so the browser can re-derive every dice roll. */
  verifyRecord(round: number): RoundRecord | null {
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      const record = this.history[index]!;
      if (record.round === round) return record;
    }
    return null;
  }

  private publicSeat(seat: Seat): SeatPublic {
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

  private effectivePhase(): RoomPhase {
    if (this.state === "waiting") return "lobby";
    if (this.state === "starting") return "countdown";
    if (this.state === "ante") return "ante";
    if (this.state === "resolved") return "resolved";
    if (this.state === "voided") return "voided";
    if (this.session instanceof ZwanzigSession) {
      const phase = this.session.game.phase;
      if (phase === "deal-scored") return "scored";
      if (phase === "game-over") return "resolved";
      return phase;
    }
    return this.phase;
  }

  private chainView(): ChainStatus | null {
    if (this.mode !== "wager") return null;
    return {
      enabled: Boolean(this.chain?.enabled),
      cluster: this.chain?.cluster ?? null,
      tablePda: this.chainTable?.toBase58() ?? null,
      escrowPda:
        this.chainTable && this.chain
          ? escrowPda(this.chainTable, this.chain.mint).toBase58()
          : null,
      createSignature: this.chainCreateSignature,
      lastSignature: this.chainLastSignature,
      status: this.chainStatus,
      explorerUrl:
        this.chainTable && this.chain
          ? explorerAddressUrl(this.chain.cluster, this.chainTable.toBase58())
          : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Timers / bots / teardown                                            */
  /* ------------------------------------------------------------------ */

  private changed(): void {
    if (this.destroyed) return;
    this.touchedAt = Date.now();
    this.hooks.onChange(this);
    this.scheduleBot();
  }

  private scheduleBot(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.destroyed || this.state !== "in-progress") return;
    const actor = this.currentActor();
    if (actor === null) return;
    const seat = this.seats[actor];
    if (!seat?.isBot) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.destroyed || this.state !== "in-progress") return;
      try {
        if (this.session instanceof DiceSession) this.session.botAct();
        else if (this.session instanceof ZwanzigSession) this.session.botAct();
      } catch (error) {
        this.notice = `Bot error: ${messageOf(error)}`;
        this.changed();
      }
    }, 700 + Math.floor(Math.random() * 600));
  }

  private currentActor(): number | null {
    if (this.session instanceof DiceSession) return this.session.currentActor;
    if (this.session instanceof ZwanzigSession) return this.session.game.currentActor();
    return null;
  }

  private async createOnChain(): Promise<void> {
    if (!this.chain?.enabled) {
      this.chainStatus = "disabled";
      this.notice = "Wager mode is not configured on this server.";
      this.changed();
      return;
    }
    try {
      const created = await this.chain.createRoomTable(this.game, this.stake, this.maxPlayers);
      this.chainTable = created.tablePda;
      this.chainCreateSignature = created.signature;
      this.chainLastSignature = created.signature;
      this.chainStatus = "table created on-chain";
      this.changed();
    } catch (error) {
      this.chainStatus = "creation failed";
      this.notice = `Could not create the on-chain table: ${messageOf(error)}`;
      this.changed();
    }
  }

  private nextBotName(): string {
    const used = new Set(this.occupied.map((seat) => seat.name));
    return BOT_NAMES.find((name) => !used.has(name)) ?? `Bot ${this.occupied.length + 1}`;
  }

  private clearCarryTimer(): void {
    if (this.carryTimer) clearTimeout(this.carryTimer);
    this.carryTimer = null;
  }

  private clearAnteTimer(): void {
    if (this.anteTimer) clearTimeout(this.anteTimer);
    this.anteTimer = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.clearCarryTimer();
    this.clearAnteTimer();
    if (this.session) this.session.dispose();
    this.hooks.onDestroy(this);
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

export function createRoomId(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function newBotPlayerId(roomId: string): string {
  return `bot:${roomId}:${randomBytes(3).toString("hex")}`;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function formatStake(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** Validate a requested stake against the protocol bounds. */
export function checkedStake(input: string | undefined): bigint {
  if (!input) throw new Error("A stake is required for wager games");
  const stake = BigInt(input);
  if (stake < MIN_STAKE_BASE_UNITS) throw new Error("Stake must be at least 0.01 USDC");
  if (stake > MAX_STAKE_BASE_UNITS) throw new Error("Stake cannot exceed 1.00 USDC");
  return stake;
}

export { describeDiceTurn };
