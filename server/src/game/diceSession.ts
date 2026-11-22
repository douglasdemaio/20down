import {
  ALL_DICE_MASK,
  MAX_REROLLS,
  bitCount,
  commitSeed,
  describeHorsesHand,
  evaluateHorses,
  generateSeed,
  isLegalShipCrewMask,
  lockMask,
  playHorsesTurn,
  playShipCrewTurn,
  seedToHex,
  type HorsesHand,
  type HorsesTurn,
  type ShipCrewTurn,
} from "@20down/shared";
import type { DicePublicState, RoundResultRow, RoundSummary } from "@20down/shared/protocol";

export type DiceGameId = "ship-captain-crew" | "horses";

export interface DiceTurnRecord {
  seat: number;
  rerollCount: number;
  /** Two one-byte masks, zero-padded, matching the on-chain `DiceTurn`. */
  rerollMasks: [number, number];
  rolls: number;
  score: number;
  ranking: [number, number, number];
  detail: string;
}

export interface DiceRoundOutcome {
  summary: RoundSummary;
  tie: boolean;
  winners: number[];
  seedHex: string;
  turns: DiceTurnRecord[];
}

interface SessionEvents {
  onUpdate: () => void;
  onRoundComplete: (outcome: DiceRoundOutcome) => void;
  onTimedOut: (seat: number) => void;
}

export interface DiceSessionOptions {
  game: DiceGameId;
  round: number;
  /** Active seats, in turn order. */
  seats: number[];
  names: string[];
  timeoutMs: number;
  /** Deterministic seed for tests and replay verification. */
  seed?: Uint8Array;
  events: SessionEvents;
}

type CurrentTurn = ShipCrewTurn | HorsesTurn;

/**
 * One round of a five-dice game. The seed is generated once per round and the
 * full turn — including a player's dice — is recomputed from the seed and the
 * recorded reroll masks. The server never trusts or stores a score that the
 * program cannot independently replay.
 */
export class DiceSession {
  readonly game: DiceGameId;
  readonly round: number;
  readonly seed: Uint8Array;
  readonly commitment: string;
  readonly order: number[];
  readonly names: string[];
  private readonly timeoutMs: number;
  private readonly events: SessionEvents;
  private readonly turns = new Map<number, number[]>();
  private readonly results = new Map<number, DiceTurnRecord>();
  private readonly played: number[] = [];
  private leader: HorsesHand | null = null;
  private index = 0;
  private currentSeatValue: number | null = null;
  private current: CurrentTurn | null = null;
  private deadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  private summary: RoundSummary | null = null;

  constructor(options: DiceSessionOptions) {
    this.game = options.game;
    this.round = options.round;
    this.order = [...options.seats].sort((a, b) => a - b);
    this.names = options.names;
    this.timeoutMs = options.timeoutMs;
    this.events = options.events;
    this.seed = options.seed ?? generateSeed();
    this.commitment = commitSeed(this.seed);
    this.beginTurn();
  }

  get seedHex(): string {
    return seedToHex(this.seed);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get lastSummary(): RoundSummary | null {
    return this.summary;
  }

  get currentActor(): number | null {
    return this.currentSeatValue;
  }

  get deadlineAt(): number | null {
    return this.deadline;
  }

  get diceBySeat(): Array<DicePublicState | null> {
    const out: Array<DicePublicState | null> = this.names.map(() => null);
    for (const [seat, masks] of this.turns) {
      out[seat] = this.publicState(this.compute(seat, masks, 3), false);
    }
    return out;
  }

  get currentDice(): DicePublicState | null {
    if (!this.current || this.currentSeatValue === null) return null;
    return this.publicState(this.current, true);
  }

  viewFor(seat: number): { dice: DicePublicState | null; diceBySeat: Array<DicePublicState | null> } {
    if (this.currentSeatValue === seat) return { dice: this.currentDice, diceBySeat: this.diceBySeat };
    return { dice: null, diceBySeat: this.diceBySeat };
  }

  act(seat: number, message: { type: "reroll"; mask: number } | { type: "stand" }): void {
    if (this.finished) throw new Error("This round is already over");
    if (seat !== this.currentSeatValue) throw new Error("It is not your turn");
    if (message.type === "stand") {
      this.finishTurn();
      return;
    }

    const masks = this.turns.get(seat) ?? [];
    if (masks.length >= MAX_REROLLS) throw new Error("No rolls remaining");
    let mask = message.mask;
    if (!Number.isInteger(mask) || mask < 0 || mask > ALL_DICE_MASK) {
      throw new Error("Reroll mask must be between 0 and 31");
    }
    if (this.game === "ship-captain-crew" && this.current) {
      const locked = (this.current as ShipCrewTurn).locked;
      if (!isLegalShipCrewMask(mask, locked)) throw new Error("Cannot reroll a locked die");
    }
    if (mask === 0) {
      // Keeping everything is a legitimate "stand" shortcut.
      this.finishTurn();
      return;
    }
    if (this.game === "horses") {
      const limit = this.rollLimit();
      if (masks.length + 2 > limit) {
        throw new Error(`The leader's call limits this player to ${limit} roll(s)`);
      }
    }
    masks.push(mask);
    this.turns.set(seat, masks);
    this.current = this.compute(seat, masks);
    const rollsUsed = masks.length + 1;
    if (
      masks.length >= MAX_REROLLS ||
      (this.game === "horses" && rollsUsed >= this.rollLimit())
    ) {
      this.finishTurn();
      return;
    }
    this.armTimer();
    this.events.onUpdate();
  }

  /** Best-effort action for a bot. */
  botAct(): void {
    const seat = this.currentSeatValue;
    if (seat === null || !this.current) return;
    const masks = this.turns.get(seat) ?? [];
    const limit = this.game === "horses" ? this.rollLimit() : MAX_REROLLS + 1;
    if (masks.length + 1 >= limit) {
      this.finishTurn();
      return;
    }
    const mask = this.botMask(this.current);
    if (mask === 0) {
      this.finishTurn();
      return;
    }
    this.act(seat, { type: "reroll", mask });
  }

  /** Ends the current turn keeping whatever the player has. */
  autoFinishTurn(): void {
    if (this.finished || this.currentSeatValue === null) return;
    this.finishTurn();
  }

  /**
   * Removes the current seat from the round (wager timeout). Returns true when
   * only one seat is left, in which case that seat is the survivor.
   */
  forfeitCurrentSeat(): { survivor: number | null; finished: boolean } {
    if (this.finished) return { survivor: null, finished: true };
    const seat = this.currentSeatValue;
    if (seat !== null) {
      this.turns.delete(seat);
      this.results.delete(seat);
      const index = this.order.indexOf(seat);
      if (index >= 0) this.order.splice(index, 1);
      if (this.index > index) this.index -= 1;
    }
    this.clearTimer();
    this.currentSeatValue = null;
    this.current = null;
    this.deadline = null;
    if (this.order.length <= 1) {
      this.finished = true;
      const survivor = this.order[0] ?? null;
      this.events.onUpdate();
      return { survivor, finished: true };
    }
    if (this.index >= this.order.length) this.index = 0;
    this.beginTurn();
    return { survivor: null, finished: false };
  }

  dispose(): void {
    this.clearTimer();
  }

  private rollLimit(): number {
    return this.game === "horses" && this.leader ? this.leader.rolls : 3;
  }

  private beginTurn(): void {
    const seat = this.order[this.index];
    if (seat === undefined) {
      this.completeRound();
      return;
    }
    this.currentSeatValue = seat;
    this.turns.set(seat, this.turns.get(seat) ?? []);
    this.current = this.compute(seat, this.turns.get(seat) ?? []);
    this.armTimer();
    this.events.onUpdate();
  }

  private finishTurn(): void {
    const seat = this.currentSeatValue;
    if (seat === null || !this.current) {
      this.completeRound();
      return;
    }
    this.clearTimer();
    const masks = this.turns.get(seat) ?? [];
    const record = this.recordFor(seat, masks, this.current);
    this.results.set(seat, record);
    if (this.played.indexOf(seat) < 0) this.played.push(seat);
    if (this.game === "horses") {
      const turn = this.current as HorsesTurn;
      const hand = evaluateHorses(turn.dice, turn.rolls);
      if (!this.leader || compareHands(hand, this.leader) > 0) this.leader = hand;
    }
    this.currentSeatValue = null;
    this.current = null;
    this.deadline = null;
    this.index += 1;
    if (this.index >= this.order.length) {
      this.completeRound();
      return;
    }
    this.beginTurn();
  }

  private completeRound(): void {
    if (this.finished) return;
    this.clearTimer();
    this.finished = true;
    this.currentSeatValue = null;
    this.current = null;
    const records = this.order
      .map((seat) => this.results.get(seat))
      .filter((record): record is DiceTurnRecord => Boolean(record));

    let best: DiceTurnRecord | null = null;
    for (const record of records) {
      if (!best || compareRanking(record.ranking, best.ranking) > 0) best = record;
    }
    const winners = best
      ? records
          .filter((record) => compareRanking(record.ranking, best.ranking) === 0)
          .map((record) => record.seat)
      : [];
    const tie = winners.length > 1 || records.length === 0;
    const rows: RoundResultRow[] = records.map((record) => ({
      seat: record.seat,
      name: this.names[record.seat] ?? `Seat ${record.seat}`,
      score: record.score,
      ranking: record.ranking,
      detail: record.detail,
      winner: winners.includes(record.seat),
    }));
    this.summary = {
      round: this.round,
      rows,
      tie,
      winners,
      carryOver: tie,
    };
    this.events.onUpdate();
    this.events.onRoundComplete({
      summary: this.summary,
      tie,
      winners,
      seedHex: this.seedHex,
      turns: records,
    });
  }

  private compute(seat: number, masks: number[], rollLimit = this.rollLimit()): CurrentTurn {
    if (this.game === "ship-captain-crew") {
      return playShipCrewTurn(this.seed, this.round, seat, masks);
    }
    return playHorsesTurn(this.seed, this.round, seat, masks, rollLimit);
  }

  private recordFor(seat: number, masks: number[], turn: CurrentTurn): DiceTurnRecord {
    const rerollMasks: [number, number] = [masks[0] ?? 0, masks[1] ?? 0];
    if (this.game === "ship-captain-crew") {
      const ship = turn as ShipCrewTurn;
      return {
        seat,
        rerollCount: masks.length,
        rerollMasks,
        rolls: ship.rollsUsed,
        score: ship.cargoScore,
        ranking: [ship.cargoScore, 0, 0],
        detail: describeDiceTurn("ship-captain-crew", ship),
      };
    }
    const horses = turn as HorsesTurn;
    return {
      seat,
      rerollCount: masks.length,
      rerollMasks,
      rolls: horses.rolls,
      score: horses.matches,
      ranking: [horses.matches, -horses.rolls, horses.face],
      detail: describeDiceTurn("horses", horses),
    };
  }

  private publicState(turn: CurrentTurn, isCurrent: boolean): DicePublicState {
    if (this.game === "ship-captain-crew") {
      const ship = turn as ShipCrewTurn;
      const last = ship.rolls[ship.rolls.length - 1];
      return {
        rollNumber: ship.rollsUsed,
        dice: [...ship.dice],
        locked: [...ship.locked],
        stage: last?.stage ?? 0,
        qualified: ship.qualified,
        cargoDice: [...ship.cargoDice],
        cargoScore: ship.cargoScore,
        rollsUsed: ship.rollsUsed,
        rollLimit: 3,
        canReroll: isCurrent && ship.rollsUsed < 3,
        canStand: isCurrent,
      };
    }
    const horses = turn as HorsesTurn;
    return {
      rollNumber: horses.rolls,
      dice: [...horses.dice],
      locked: [false, false, false, false, false],
      stage: 0,
      qualified: true,
      cargoDice: [],
      cargoScore: horses.matches,
      rollsUsed: horses.rolls,
      rollLimit: this.rollLimit(),
      canReroll: isCurrent && horses.rolls < this.rollLimit(),
      canStand: isCurrent,
    };
  }

  private botMask(turn: CurrentTurn): number {
    if (this.game === "ship-captain-crew") {
      const ship = turn as ShipCrewTurn;
      const lockedMask = lockMask(ship.locked);
      return ALL_DICE_MASK & ~lockedMask;
    }
    const horses = turn as HorsesTurn;
    const target = horses.face;
    const counts = new Map<number, number>();
    for (const die of horses.dice) counts.set(die, (counts.get(die) ?? 0) + 1);
    let mask = 0;
    horses.dice.forEach((die, index) => {
      if (die !== target && die !== 1) mask |= 1 << index;
    });
    // Avoid rerolling into an obviously worse hand: if we already have four of
    // a kind, keep everything.
    if ((counts.get(target) ?? 0) >= 4) return 0;
    return mask;
  }

  private armTimer(): void {
    this.clearTimer();
    this.deadline = Date.now() + this.timeoutMs;
    this.timer = setTimeout(() => {
      if (this.finished) return;
      if (this.currentSeatValue !== null) this.events.onTimedOut(this.currentSeatValue);
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }
}

function compareHands(a: HorsesHand, b: HorsesHand): number {
  if (a.matches !== b.matches) return a.matches > b.matches ? 1 : -1;
  if (a.rolls !== b.rolls) return a.rolls < b.rolls ? 1 : -1;
  if (a.face !== b.face) return a.face > b.face ? 1 : -1;
  return 0;
}

function compareRanking(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? Number.NEGATIVE_INFINITY;
    const right = b[index] ?? Number.NEGATIVE_INFINITY;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

/** Human-readable detail computed from a finished turn. */
export function describeDiceTurn(
  game: DiceGameId,
  turn: ShipCrewTurn | HorsesTurn,
): string {
  if (game === "ship-captain-crew") {
    const ship = turn as ShipCrewTurn;
    if (!ship.qualified) return "No ship, captain & crew";
    return `Cargo ${ship.cargoDice.join("+")} = ${ship.cargoScore}`;
  }
  const horses = turn as HorsesTurn;
  return describeHorsesHand(evaluateHorses(horses.dice, horses.rolls));
}

export function diceTurnBitCount(mask: number): number {
  return bitCount(mask);
}
