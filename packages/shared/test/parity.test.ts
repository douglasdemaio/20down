import { describe, expect, it } from "vitest";
import { commitSeed, deriveStream } from "../src/rng.js";
import { playShipCrewTurn } from "../src/games/shipCaptainCrew.js";
import { evaluateHorses, playHorsesTurn } from "../src/games/horses.js";

/**
 * Cross-language parity vectors.
 *
 * The identical assertions live in `programs/wagerwake/src/games.rs`
 * (`js_parity_vectors`). If either implementation changes the keystream,
 * derivation domain, rejection sampling, dice assignment or scoring, one of the
 * two suites breaks. This is what lets the program replay a seed on-chain and
 * arrive at the same result the server showed the players.
 */

const base = new Uint8Array(32).fill(7);

describe("JS <-> Rust parity vectors", () => {
  it("commits the documented seed", () => {
    expect(commitSeed(base)).toBe(
      "4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0",
    );
  });

  it("matches raw keystream u32 words", () => {
    const stream = deriveStream(base, "horses", 1, 0);
    expect(Array.from({ length: 6 }, () => stream.u32())).toEqual([
      1124701820, 16179969, 3542505683, 520292941, 3510176334, 3167450993,
    ]);
  });

  it("matches raw die stream", () => {
    const stream = deriveStream(base, "horses", 1, 0);
    expect(stream.dice(12)).toEqual([3, 4, 6, 2, 1, 6, 2, 2, 4, 2, 6, 2]);
  });

  it("matches Ship, Captain & Crew turn vectors", () => {
    const cases: Array<{
      round: number;
      seat: number;
      masks: number[];
      stage: number;
      dice: number[];
      lockedMask: number;
      score: number;
    }> = [
      { round: 1, seat: 0, masks: [21, 21], stage: 2, dice: [6, 5, 3, 6, 5], lockedMask: 0b01010, score: 0 },
      { round: 2, seat: 3, masks: [28, 24], stage: 3, dice: [6, 5, 4, 2, 1], lockedMask: 0b00111, score: 3 },
      { round: 5, seat: 7, masks: [26, 26], stage: 3, dice: [6, 4, 5, 5, 2], lockedMask: 0b00111, score: 7 },
      { round: 9, seat: 1, masks: [30, 30], stage: 1, dice: [6, 1, 6, 4, 1], lockedMask: 0b00001, score: 0 },
    ];

    for (const testCase of cases) {
      const turn = playShipCrewTurn(base, testCase.round, testCase.seat, testCase.masks);
      expect(turn.dice).toEqual(testCase.dice);
      expect(
        turn.locked.reduce((mask, locked, index) => (locked ? mask | (1 << index) : mask), 0),
      ).toBe(testCase.lockedMask);
      expect(turn.rolls[turn.rolls.length - 1]?.stage).toBe(testCase.stage);
      expect(turn.cargoScore).toBe(testCase.score);
      expect(turn.rollsUsed).toBe(testCase.masks.length + 1);
    }
  });

  it("matches Horses turn vectors", () => {
    const cases: Array<{
      round: number;
      seat: number;
      masks: number[];
      dice: number[];
      matches: number;
      face: number;
    }> = [
      { round: 1, seat: 0, masks: [], dice: [3, 4, 6, 2, 1], matches: 2, face: 6 },
      { round: 2, seat: 1, masks: [6], dice: [2, 5, 5, 4, 1], matches: 3, face: 5 },
      { round: 3, seat: 2, masks: [31, 3], dice: [3, 4, 3, 1, 1], matches: 4, face: 3 },
    ];

    for (const testCase of cases) {
      const turn = playHorsesTurn(base, testCase.round, testCase.seat, testCase.masks, 3);
      expect(turn.dice).toEqual(testCase.dice);
      expect(turn.matches).toBe(testCase.matches);
      expect(turn.face).toBe(testCase.face);
    }
  });

  it("matches the canonical hand rankings", () => {
    expect(evaluateHorses([6, 6, 6, 6, 6], 1).matches).toBe(5);
    expect(evaluateHorses([6, 6, 6, 6, 6], 1).face).toBe(6);
    expect(evaluateHorses([1, 1, 1, 1, 1], 1).matches).toBe(5);
    expect(evaluateHorses([1, 1, 1, 1, 1], 1).face).toBe(1);
    expect(evaluateHorses([6, 6, 6, 6, 6], 1).rolls).toBe(1);
  });
});
