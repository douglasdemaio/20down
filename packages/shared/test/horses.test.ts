import { describe, expect, it } from "vitest";
import {
  compareHorses,
  describeHorsesHand,
  evaluateHorses,
  horsesRanking,
  playHorsesTurn,
  rollLimitFor,
} from "../src/games/horses.js";

const seed = new Uint8Array(32).fill(13);

describe("Horses hand evaluation", () => {
  it("counts natural matches", () => {
    const hand = evaluateHorses([4, 4, 4, 2, 3], 2);
    expect(hand.matches).toBe(3);
    expect(hand.face).toBe(4);
    expect(hand.rolls).toBe(2);
  });

  it("treats ones as wild", () => {
    expect(evaluateHorses([1, 1, 4, 4, 2], 1)).toMatchObject({ matches: 4, face: 4 });
    expect(evaluateHorses([1, 1, 1, 4, 2], 1)).toMatchObject({ matches: 4, face: 4 });
    expect(evaluateHorses([1, 5, 5, 2, 3], 1)).toMatchObject({ matches: 3, face: 5 });
  });

  it("counts an all-ones hand as five ones", () => {
    const allOnes = evaluateHorses([1, 1, 1, 1, 1], 1);
    expect(allOnes.matches).toBe(5);
    expect(allOnes.face).toBe(1);
    // Five natural sixes stays the unique best hand.
    expect(compareHorses(evaluateHorses([6, 6, 6, 6, 6], 1), allOnes)).toBe(1);
  });

  it("does not let all-wild hands become five sixes", () => {
    expect(evaluateHorses([1, 1, 1, 1, 1], 1).face).toBe(1);
  });

  it("rejects malformed hands", () => {
    expect(() => evaluateHorses([1, 2, 3, 4], 1)).toThrow(/five dice/);
    expect(() => evaluateHorses([0, 2, 3, 4, 5], 1)).toThrow(/Invalid die/);
    expect(() => evaluateHorses([1, 2, 3, 4, 7], 1)).toThrow(/Invalid die/);
    expect(() => evaluateHorses([1, 2, 3, 4, 5], 0)).toThrow(/rolls/);
    expect(() => evaluateHorses([1, 2, 3, 4, 5], 4)).toThrow(/rolls/);
  });
});

describe("Horses ranking", () => {
  it("orders by matches, then fewer rolls, then face", () => {
    const threeFoursTwoRolls = evaluateHorses([4, 4, 4, 2, 3], 2);
    const threeFoursOneRoll = evaluateHorses([4, 4, 4, 2, 3], 1);
    const fourTwos = evaluateHorses([2, 2, 2, 2, 6], 3);
    const fourThrees = evaluateHorses([3, 3, 3, 3, 6], 3);
    const threeFives = evaluateHorses([5, 5, 5, 2, 3], 3);

    expect(compareHorses(threeFoursOneRoll, threeFoursTwoRolls)).toBe(1);
    expect(compareHorses(threeFoursTwoRolls, threeFoursOneRoll)).toBe(-1);
    expect(compareHorses(fourTwos, threeFives)).toBe(1);
    expect(compareHorses(fourThrees, fourTwos)).toBe(1);
    expect(compareHorses(fourTwos, fourTwos)).toBe(0);
  });

  it("produces a lexicographic ranking", () => {
    expect(horsesRanking(evaluateHorses([6, 6, 6, 6, 6], 1))).toEqual([5, -1, 6]);
    expect(horsesRanking(evaluateHorses([4, 4, 4, 2, 3], 2))).toEqual([3, -2, 4]);
  });

  it("describes a hand", () => {
    expect(describeHorsesHand(evaluateHorses([4, 4, 4, 2, 3], 2))).toBe("Three fours (2 rolls)");
    expect(describeHorsesHand(evaluateHorses([2, 2, 2, 2, 3], 1))).toBe("Four twos (1 roll)");
  });
});

describe("the leader's call", () => {
  it("allows three rolls when nobody has a hand", () => {
    expect(rollLimitFor(null)).toBe(3);
  });

  it("caps later players at the leader's roll count", () => {
    const leader = evaluateHorses([4, 4, 4, 2, 3], 2);
    expect(rollLimitFor(leader)).toBe(2);
    expect(() => playHorsesTurn(seed, 1, 1, [0, 0], 2)).toThrow(/limits this player to 2/);
    expect(() => playHorsesTurn(seed, 1, 1, [0], 2)).not.toThrow();
  });

  it("rejects more than two rerolls", () => {
    expect(() => playHorsesTurn(seed, 1, 0, [0, 0, 0], 3)).toThrow(/at most 2/);
  });
});

describe("Horses turn replay", () => {
  it("is deterministic", () => {
    const a = playHorsesTurn(seed, 2, 3, [0b00110, 0b11000], 3);
    const b = playHorsesTurn(seed, 2, 3, [0b00110, 0b11000], 3);
    expect(a).toEqual(b);
    expect(a.rolls).toBe(3);
  });

  it("rerolls only the masked positions", () => {
    const noRerolls = playHorsesTurn(seed, 4, 1, [], 3);
    const rerollOne = playHorsesTurn(seed, 4, 1, [0b00001], 3);
    expect(rerollOne.dice.slice(1)).toEqual(noRerolls.dice.slice(1));
    expect(rerollOne.dice[0]).not.toBe(undefined);
  });

  it("ranks a full round consistently", () => {
    const hands = [0, 1, 2].map((seat) => playHorsesTurn(seed, 6, seat, [], 3));
    const sorted = [...hands].sort((a, b) => compareHorses(b, a));
    for (let index = 1; index < sorted.length; index += 1) {
      expect(compareHorses(sorted[index - 1] as (typeof sorted)[number], sorted[index] as (typeof sorted)[number])).toBeGreaterThanOrEqual(0);
    }
  });
});
