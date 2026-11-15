import { deriveStream, RandomStream } from "../rng.js";
import { ALL_DICE_MASK, MAX_REROLLS, bitCount, isValidMask } from "./dice.js";

/**
 * Ship, Captain & Crew
 * --------------------
 * Five dice, up to three rolls in a turn.
 *
 * The player locks a 6 (Ship), then a 5 (Captain), then a 4 (Crew) — strictly in
 * that order. Locking is automatic and greedy: after every roll the engine locks
 * the first available required die. Player agency lives in the reroll masks.
 *
 * Once 6-5-4 are locked the two remaining dice are the cargo; their sum (2-12)
 * is the score. A player may keep rerolling cargo dice while rolls remain.
 * No qualification means a score of 0.
 *
 * Because locking is deterministic, a turn is fully described by the reroll
 * masks, which makes the turn replayable on-chain from the round seed.
 */

export interface ShipCrewRoll {
  /** 1-based roll number. */
  index: number;
  /** Five dice after this roll (locked dice keep their previous face). */
  dice: number[];
  /** Which positions are locked after this roll. */
  locked: boolean[];
  /** 0 = no ship, 1 = ship, 2 = +captain, 3 = +crew (qualified). */
  stage: number;
  /** Positions rerolled to produce this roll (empty on roll 1). */
  rerolled: number[];
}

export interface ShipCrewTurn {
  rolls: ShipCrewRoll[];
  dice: number[];
  locked: boolean[];
  qualified: boolean;
  cargoDice: number[];
  cargoScore: number;
  rollsUsed: number;
}

const LOCK_ORDER = [6, 5, 4] as const;

function autoLock(dice: readonly number[], locked: boolean[], stage: number): number {
  let next = stage;
  while (next < LOCK_ORDER.length) {
    const wanted = LOCK_ORDER[next] as number;
    const index = dice.findIndex((die, i) => !locked[i] && die === wanted);
    if (index < 0) break;
    locked[index] = true;
    next += 1;
  }
  return next;
}

export function lockMask(locked: readonly boolean[]): number {
  return locked.reduce((mask, isLocked, i) => (isLocked ? mask | (1 << i) : mask), 0);
}

/**
 * Replays one turn from the round seed. Deterministic across JS and Rust.
 *
 * Stream consumption: 5 dice on roll 1, then popcount(mask) dice for each
 * subsequent roll. Dice are assigned to rerolled positions in ascending index
 * order.
 */
export function playShipCrewTurn(
  seed: Uint8Array | string,
  round: number,
  seat: number,
  rerolls: readonly number[],
): ShipCrewTurn {
  if (rerolls.length > MAX_REROLLS) {
    throw new Error(`A turn has at most ${MAX_REROLLS} rerolls`);
  }
  const stream = deriveStream(seed, "ship-captain-crew", round, seat);
  const dice: number[] = stream.dice(5);
  const locked = [false, false, false, false, false];
  let stage = autoLock(dice, locked, 0);

  const rolls: ShipCrewRoll[] = [
    {
      index: 1,
      dice: [...dice],
      locked: [...locked],
      stage,
      rerolled: [],
    },
  ];

  for (let r = 0; r < rerolls.length; r += 1) {
    const mask = rerolls[r] as number;
    if (!isValidMask(mask)) throw new Error(`Invalid reroll mask: ${mask}`);
    if ((mask & lockMask(locked)) !== 0) throw new Error("Cannot reroll a locked die");

    const rerolled: number[] = [];
    const replacement = stream.dice(bitCount(mask));
    let cursor = 0;
    for (let i = 0; i < 5; i += 1) {
      if (mask & (1 << i)) {
        dice[i] = replacement[cursor] as number;
        cursor += 1;
        rerolled.push(i);
      }
    }
    stage = autoLock(dice, locked, stage);
    rolls.push({
      index: r + 2,
      dice: [...dice],
      locked: [...locked],
      stage,
      rerolled,
    });
  }

  const qualified = stage === 3;
  const cargoDice = qualified ? dice.filter((_, i) => !locked[i]) : [];
  return {
    rolls,
    dice: [...dice],
    locked: [...locked],
    qualified,
    cargoDice,
    cargoScore: qualified ? cargoDice.reduce((sum, d) => sum + d, 0) : 0,
    rollsUsed: rolls.length,
  };
}

/**
 * Pure scoring helper, used by tests and by the UI to explain a result.
 * Returns 0 when the roll never qualified.
 */
export function scoreShipCrewDice(dice: readonly number[], locked: readonly boolean[]): number {
  const qualified = dice.some((d, i) => locked[i] && d === 6) &&
    dice.some((d, i) => locked[i] && d === 5) &&
    dice.some((d, i) => locked[i] && d === 4);
  if (!qualified || dice.length !== 5) return 0;
  return dice.reduce((sum, die, i) => (locked[i] ? sum : sum + die), 0);
}

/** True when a reroll mask only touches unlocked dice. */
export function isLegalShipCrewMask(mask: number, locked: readonly boolean[]): boolean {
  return isValidMask(mask) && (mask & lockMask(locked)) === 0;
}

export const SHIP_CREW_DICE_MASK = ALL_DICE_MASK;

/** Convenience for the client: derive the turn for display without a server round-trip. */
export function previewShipCrewTurn(seed: string, round: number, seat: number, rerolls: number[]): ShipCrewTurn {
  return playShipCrewTurn(seed, round, seat, rerolls);
}

export type { RandomStream };
