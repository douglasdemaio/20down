import { deriveStream } from "../rng.js";
import { MAX_REROLLS, bitCount, isValidMask } from "./dice.js";

/**
 * Horses
 * ------
 * Five dice, up to three rolls. Score the most dice showing the same face.
 *
 * House rules implemented here (confirmed with the product owner):
 *  - Ones are WILD and may represent any face.
 *  - A hand made entirely of ones counts as five ones (face 1), so five natural
 *    sixes remains the unique best hand.
 *  - Ranking is: matching dice (more is better) -> fewer rolls used -> higher
 *    face value. Face value only breaks ties after roll count.
 *  - The leader's roll count becomes the maximum roll count for every later
 *    player ("the call"). If nobody has a hand yet, the limit is 3.
 *
 * Exact ties at the top carry the pot over.
 */

export interface HorsesHand {
  dice: number[];
  rolls: number;
  /** Natural + wild dice representing `face`. */
  matches: number;
  /** Face the matching dice represent (1-6). */
  face: number;
}

export interface HorsesTurn extends HorsesHand {
  /** Full lexicographic ranking, higher is better: [matches, -rolls, face]. */
  ranking: [number, number, number];
}

/** Evaluates any five dice as a Horses hand. */
export function evaluateHorses(dice: readonly number[], rolls: number): HorsesHand {
  if (dice.length !== 5) throw new Error("Horses requires exactly five dice");
  if (!Number.isInteger(rolls) || rolls < 1 || rolls > 3) throw new Error("rolls must be 1..3");
  for (const die of dice) {
    if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error(`Invalid die: ${die}`);
  }

  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const die of dice) counts[die] = (counts[die] as number) + 1;

  let bestMatches = 0;
  let bestFace = 1;
  for (let face = 1; face <= 6; face += 1) {
    const natural = counts[face] as number;
    // Non-one faces need at least one natural die; otherwise all-wild hands
    // would become five sixes and outrank a natural five-six hand.
    if (face !== 1 && natural === 0) continue;
    if (face === 1 && natural === 0) continue;
    const matches = face === 1 ? natural : natural + (counts[1] as number);
    if (matches > bestMatches || (matches === bestMatches && face > bestFace)) {
      bestMatches = matches;
      bestFace = face;
    }
  }

  return { dice: [...dice], rolls, matches: bestMatches, face: bestFace };
}

export function horsesRanking(hand: HorsesHand): [number, number, number] {
  return [hand.matches, -hand.rolls, hand.face];
}

/** +1 when a is strictly better than b, -1 when worse, 0 on an exact tie. */
export function compareHorses(a: HorsesHand, b: HorsesHand): number {
  if (a.matches !== b.matches) return a.matches > b.matches ? 1 : -1;
  if (a.rolls !== b.rolls) return a.rolls < b.rolls ? 1 : -1;
  if (a.face !== b.face) return a.face > b.face ? 1 : -1;
  return 0;
}

/** Max rolls a player may use, given the current leader's hand. */
export function rollLimitFor(leader: HorsesHand | null): number {
  return leader ? leader.rolls : MAX_REROLLS + 1;
}

/**
 * Plays one turn from the round seed.
 *
 * Stream consumption mirrors Ship, Captain & Crew: 5 dice on roll 1, then
 * popcount(mask) for each reroll, assigned to rerolled positions ascending.
 * No dice are ever "locked" in Horses; the final face-up set is the hand.
 */
export function playHorsesTurn(
  seed: Uint8Array | string,
  round: number,
  seat: number,
  rerolls: readonly number[],
  rollLimit = 3,
): HorsesTurn {
  if (rerolls.length > MAX_REROLLS) throw new Error("A turn has at most 2 rerolls");
  const rollsUsed = rerolls.length + 1;
  if (rollsUsed > rollLimit) {
    throw new Error(`The leader's call limits this player to ${rollLimit} roll(s)`);
  }
  const stream = deriveStream(seed, "horses", round, seat);
  const dice = stream.dice(5);

  for (const mask of rerolls) {
    if (!isValidMask(mask)) throw new Error(`Invalid reroll mask: ${mask}`);
    const replacement = stream.dice(bitCount(mask));
    let cursor = 0;
    for (let i = 0; i < 5; i += 1) {
      if (mask & (1 << i)) {
        dice[i] = replacement[cursor] as number;
        cursor += 1;
      }
    }
  }

  const hand = evaluateHorses(dice, rollsUsed);
  return { ...hand, ranking: horsesRanking(hand) };
}

/** Human-readable hand label, e.g. "Four 4s (2 rolls)". */
export function describeHorsesHand(hand: HorsesHand): string {
  const names: Record<number, string> = {
    1: "ones",
    2: "twos",
    3: "threes",
    4: "fours",
    5: "fives",
    6: "sixes",
  };
  const countNames = ["", "One", "Two", "Three", "Four", "Five"];
  return `${countNames[hand.matches] ?? String(hand.matches)} ${names[hand.face] ?? "dice"} (${hand.rolls} roll${hand.rolls === 1 ? "" : "s"})`;
}
