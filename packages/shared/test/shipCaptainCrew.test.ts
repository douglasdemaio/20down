import { describe, expect, it } from "vitest";
import {
  playShipCrewTurn,
  scoreShipCrewDice,
  isLegalShipCrewMask,
  lockMask,
} from "../src/games/shipCaptainCrew.js";
import { ALL_DICE_MASK, MAX_REROLLS, bitCount, isValidMask, maskIndexes } from "../src/games/dice.js";

const seed = new Uint8Array(32).fill(11);

/** Find a seed whose first roll satisfies a predicate. */
function seedFor(predicate: (dice: number[]) => boolean): Uint8Array {
  for (let value = 0; value < 256; value += 1) {
    const candidate = new Uint8Array(32).fill(value);
    const turn = playShipCrewTurn(candidate, 1, 0, []);
    if (predicate(turn.dice)) return candidate;
  }
  throw new Error("No matching seed found");
}

/** Plays a turn rerolling every unlocked die, at most twice. */
function aggressive(candidate: Uint8Array, round: number, seat: number) {
  const first = playShipCrewTurn(candidate, round, seat, []);
  const mask1 = ALL_DICE_MASK & ~lockMask(first.locked);
  const second = playShipCrewTurn(candidate, round, seat, [mask1]);
  const mask2 = ALL_DICE_MASK & ~lockMask(second.locked);
  return playShipCrewTurn(candidate, round, seat, [mask1, mask2]);
}

describe("dice helpers", () => {
  it("validates masks against the five-die range", () => {
    expect(isValidMask(0)).toBe(true);
    expect(isValidMask(ALL_DICE_MASK)).toBe(true);
    expect(isValidMask(0b100000)).toBe(false);
    expect(isValidMask(-1)).toBe(false);
    expect(isValidMask(1.5)).toBe(false);
  });

  it("counts and lists mask bits", () => {
    expect(bitCount(0)).toBe(0);
    expect(bitCount(0b10101)).toBe(3);
    expect(maskIndexes(0b10101)).toEqual([0, 2, 4]);
    expect(maskIndexes(31)).toEqual([0, 1, 2, 3, 4]);
  });

  it("builds a lock mask", () => {
    expect(lockMask([false, true, false, true, false])).toBe(0b01010);
  });
});

describe("Ship, Captain & Crew", () => {
  it("locks dice greedily in 6, 5, 4 order", () => {
    const turn = playShipCrewTurn(seedFor((dice) => dice[0] === 6 && dice[1] === 5 && dice[2] === 4), 1, 0, []);
    expect(turn.dice.slice(0, 3)).toEqual([6, 5, 4]);
    expect(turn.locked.slice(0, 3)).toEqual([true, true, true]);
    expect(turn.qualified).toBe(true);
    expect(turn.cargoDice).toHaveLength(2);
    expect(turn.cargoScore).toBe((turn.cargoDice[0] as number) + (turn.cargoDice[1] as number));
  });

  it("does not lock a 5 before a 6", () => {
    const turn = playShipCrewTurn(seedFor((dice) => dice[0] === 5 && !dice.includes(6)), 1, 0, []);
    expect(turn.rolls[0]?.stage).toBe(0);
    expect(turn.locked.every((locked) => !locked)).toBe(true);
    expect(turn.qualified).toBe(false);
    expect(turn.cargoScore).toBe(0);
  });

  it("does not lock a 4 before both 6 and 5", () => {
    const turn = playShipCrewTurn(
      seedFor((dice) => dice[0] === 4 && !dice.includes(6) && !dice.includes(5)),
      1,
      0,
      [],
    );
    expect(turn.rolls[0]?.stage).toBe(0);
    expect(turn.qualified).toBe(false);
  });

  it("awards 0 when the turn never qualifies", () => {
    let chosen: Uint8Array | null = null;
    for (let value = 0; value < 256 && !chosen; value += 1) {
      const candidate = new Uint8Array(32).fill(value);
      if (!aggressive(candidate, 1, 0).qualified) chosen = candidate;
    }
    expect(chosen).not.toBeNull();
    expect(aggressive(chosen as Uint8Array, 1, 0).cargoScore).toBe(0);
  });

  it("allows rerolling only unlocked dice", () => {
    const sixFirst = seedFor((dice) => dice[0] === 6);
    const first = playShipCrewTurn(sixFirst, 1, 0, []);
    expect(first.locked[0]).toBe(true);
    expect(() => playShipCrewTurn(sixFirst, 1, 0, [0b00001])).toThrow(/locked/);
    expect(isLegalShipCrewMask(0b00001, first.locked)).toBe(false);
    const legal = ALL_DICE_MASK & ~lockMask(first.locked);
    expect(isLegalShipCrewMask(legal, first.locked)).toBe(true);
  });

  it("supports at most two rerolls", () => {
    expect(() => playShipCrewTurn(seed, 1, 0, [0, 0, 0])).toThrow(/at most/);
    expect(MAX_REROLLS).toBe(2);
  });

  it("assigns replacement dice to rerolled positions in ascending order", () => {
    const first = playShipCrewTurn(seed, 3, 2, []);
    const mask = ALL_DICE_MASK & ~lockMask(first.locked);
    const turn = playShipCrewTurn(seed, 3, 2, [mask]);
    expect(turn.rolls[1]?.rerolled).toEqual(maskIndexes(mask));
    // Locked dice never change across rolls.
    const firstDice = turn.rolls[0]?.dice ?? [];
    for (let index = 0; index < 5; index += 1) {
      if (turn.rolls[0]?.locked[index]) expect(turn.dice[index]).toBe(firstDice[index]);
    }
  });

  it("is deterministic and records every roll", () => {
    const a = playShipCrewTurn(seed, 2, 4, [0, 0]);
    const b = playShipCrewTurn(seed, 2, 4, [0, 0]);
    expect(a).toEqual(b);
    expect(a.rolls).toHaveLength(3);
    expect(a.rolls.map((roll) => roll.index)).toEqual([1, 2, 3]);
  });

  it("scores cargo with the pure helper", () => {
    expect(scoreShipCrewDice([6, 5, 4, 3, 2], [true, true, true, false, false])).toBe(5);
    expect(scoreShipCrewDice([6, 5, 4, 6, 6], [true, true, true, false, false])).toBe(12);
    expect(scoreShipCrewDice([6, 5, 2, 3, 2], [true, true, false, false, false])).toBe(0);
    expect(scoreShipCrewDice([1, 2, 3, 4, 5], [false, false, false, false, false])).toBe(0);
  });

  it("cargo always lies in 2..12 when qualified", () => {
    for (let round = 1; round <= 40; round += 1) {
      const turn = aggressive(seed, round, round % 8);
      if (turn.qualified) {
        expect(turn.cargoScore).toBeGreaterThanOrEqual(2);
        expect(turn.cargoScore).toBeLessThanOrEqual(12);
      }
    }
  });
});
