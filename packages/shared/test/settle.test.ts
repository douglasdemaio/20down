import { describe, expect, it } from "vitest";
import { rankResults, resolveRound } from "../src/settle.js";

describe("rankResults", () => {
  it("picks a single top seat", () => {
    expect(rankResults([
      { seat: 0, score: 8 },
      { seat: 1, score: 11 },
      { seat: 2, score: 3 },
    ])).toEqual({ winners: [1], tie: false });
  });

  it("reports every seat sharing the top ranking", () => {
    expect(rankResults([
      { seat: 0, score: 9 },
      { seat: 1, score: 9 },
      { seat: 2, score: 4 },
    ])).toEqual({ winners: [0, 1], tie: true });
  });

  it("treats everybody scoring zero as a tie", () => {
    expect(rankResults([
      { seat: 0, score: 0 },
      { seat: 1, score: 0 },
    ])).toEqual({ winners: [0, 1], tie: true });
  });

  it("uses the explicit ranking before the display score", () => {
    expect(rankResults([
      { seat: 0, score: 3, ranking: [3, -2, 4] },
      { seat: 1, score: 3, ranking: [3, -1, 4] },
    ])).toEqual({ winners: [1], tie: false });
    expect(rankResults([
      { seat: 0, score: 3, ranking: [3, -1, 4] },
      { seat: 1, score: 3, ranking: [3, -1, 4] },
    ])).toEqual({ winners: [0, 1], tie: true });
  });

  it("compares shorter rankings as if padded with -infinity", () => {
    expect(rankResults([
      { seat: 0, score: 5, ranking: [5] },
      { seat: 1, score: 5, ranking: [5, -1, 6] },
    ])).toEqual({ winners: [1], tie: false });
  });

  it("rejects empty result sets", () => {
    expect(() => rankResults([])).toThrow(/No results/);
  });

  it("is order independent", () => {
    const results = [
      { seat: 2, score: 7 },
      { seat: 0, score: 12 },
      { seat: 1, score: 7 },
    ];
    expect(rankResults(results)).toEqual({ winners: [0], tie: false });
    expect(rankResults([...results].reverse())).toEqual({ winners: [0], tie: false });
  });
});

describe("resolveRound", () => {
  it("pays the whole stake pot to a unique winner", () => {
    expect(resolveRound([
      { seat: 0, score: 9 },
      { seat: 1, score: 4 },
    ], 20_000n)).toEqual({
      winners: [0],
      tie: false,
      carryOver: false,
      payoutBaseUnits: 20_000n,
    });
  });

  it("carries the pot over and pays nothing on a tie", () => {
    expect(resolveRound([
      { seat: 0, score: 9 },
      { seat: 1, score: 9 },
    ], 20_000n)).toEqual({
      winners: [0, 1],
      tie: true,
      carryOver: true,
      payoutBaseUnits: 0n,
    });
  });
});
