import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils";
import { ZwanzigGame, type Suit, type ZwanzigView } from "@wagerwake/shared";
import { generateSeed, seedToHex } from "@wagerwake/shared";

export interface ZwanzigSessionEvents {
  onUpdate: () => void;
  onGameOver: (winnerSeat: number, logHash: string) => void;
}

export interface ZwanzigSessionOptions {
  playerCount: number;
  seed?: Uint8Array;
  timeoutMs: number;
  dealPauseMs: number;
  events: ZwanzigSessionEvents;
}

/**
 * Server-side wrapper around the shared Zwanzig ab engine. It owns the clock,
 * auto-actions for timeouts and the multi-deal game loop; the rules themselves
 * live in `@wagerwake/shared` and are unit-tested there.
 */
export class ZwanzigSession {
  readonly game: ZwanzigGame;
  readonly seed: Uint8Array;
  readonly timeoutMs: number;
  readonly dealPauseMs: number;
  private readonly events: ZwanzigSessionEvents;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  private over = false;
  private disposed = false;

  constructor(options: ZwanzigSessionOptions) {
    this.seed = options.seed ?? generateSeed();
    this.timeoutMs = options.timeoutMs;
    this.dealPauseMs = options.dealPauseMs;
    this.events = options.events;
    this.game = new ZwanzigGame({
      seed: this.seedHex,
      playerCount: options.playerCount,
    });
    this.game.startDeal();
    this.armTimer();
    this.events.onUpdate();
  }

  get seedHex(): string {
    return seedToHex(this.seed);
  }

  get currentActor(): number | null {
    return this.game.currentActor();
  }

  get deadlineAt(): number | null {
    return this.deadline;
  }

  get isOver(): boolean {
    return this.over;
  }

  get phase() {
    return this.game.phase;
  }

  viewFor(seat: number): ZwanzigView {
    return this.game.viewFor(seat);
  }

  spectatorView(): Omit<ZwanzigView, "hand" | "legalCards"> {
    return this.game.spectatorView();
  }

  /** sha256(seed || 0x00 || canonical log) — published with the on-chain result. */
  logHash(): string {
    const log = JSON.stringify(this.game.log);
    return bytesToHex(
      sha256(concatBytes(this.seed, new Uint8Array([0]), utf8ToBytes(log))),
    );
  }

  act(
    seat: number,
    message:
      | { type: "trump"; suit: Suit }
      | { type: "exchange"; cards: string[] }
      | { type: "announce"; play: boolean }
      | { type: "playCard"; card: string },
  ): void {
    if (this.over) throw new Error("The game is already over");
    if (this.game.currentActor() !== seat) throw new Error("It is not your turn");
    switch (message.type) {
      case "trump":
        this.game.chooseTrump(seat, message.suit);
        break;
      case "exchange":
        this.game.exchange(seat, message.cards);
        // Exchanging does not consume the turn; the player still announces, so
        // give them a fresh window for the announcement.
        this.afterAction(true);
        return;
      case "announce":
        this.game.announce(seat, message.play);
        break;
      case "playCard":
        this.game.playCard(seat, message.card);
        break;
    }
    this.afterAction(true);
  }

  /** Advances a scored deal to the next one. */
  nextDeal(): void {
    if (this.disposed || this.over) return;
    if (this.game.phase !== "deal-scored") return;
    this.clearPause();
    this.dealAdvance();
  }

  botAct(): void {
    const actor = this.game.currentActor();
    if (actor === null) return;
    this.game.applyAutoAction(actor);
    this.afterAction(true);
  }

  /** Plays the current actor's safe default after a timeout. */
  autoAct(): void {
    const actor = this.game.currentActor();
    if (actor === null) return;
    this.game.applyAutoAction(actor);
    this.afterAction(true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.clearPause();
  }

  private afterAction(armTimer: boolean): void {
    if (this.disposed) return;
    if (this.game.winner !== null) {
      this.over = true;
      this.clearTimer();
      this.clearPause();
      this.events.onUpdate();
      this.events.onGameOver(this.game.winner, this.logHash());
      return;
    }
    if (this.game.phase === "deal-scored") {
      this.clearTimer();
      this.events.onUpdate();
      this.scheduleDealAdvance();
      return;
    }
    if (armTimer) this.armTimer();
    this.events.onUpdate();
  }

  private scheduleDealAdvance(): void {
    this.clearPause();
    this.pauseTimer = setTimeout(() => {
      if (this.disposed || this.over) return;
      this.dealAdvance();
    }, this.dealPauseMs);
  }

  private dealAdvance(): void {
    if (this.game.phase !== "deal-scored" || this.over) return;
    this.game.nextDeal();
    this.armTimer();
    this.events.onUpdate();
  }

  private armTimer(): void {
    this.clearTimer();
    if (this.disposed || this.over || this.game.phase === "deal-scored") return;
    this.deadline = Date.now() + this.timeoutMs;
    this.timer = setTimeout(() => {
      if (this.disposed || this.over) return;
      this.events.onUpdate();
      this.autoAct();
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  private clearPause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }
}
