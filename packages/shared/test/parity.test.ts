import { describe, expect, it } from "vitest";
import { commitSeed, deriveStream } from "../src/rng.js";
import { cardId, fullDeck } from "../src/games/zwanzig.js";

/**
 * Cross-language parity vectors for 20 Down.
 *
 * The mainnet Anchor program must reproduce the same commitment, keystream and
 * card order from a revealed seed. Phase 5 mirrors these assertions in the new
 * program's Rust tests. If either implementation changes derivation, rejection
 * sampling or shuffling, one of the two suites breaks.
 */
const base = new Uint8Array(32).fill(7);

describe("20 Down parity vectors", () => {
  it("commits the documented seed", () => {
    expect(commitSeed(base)).toBe(
      "4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0",
    );
  });

  it("matches the deal keystream u32 words", () => {
    const stream = deriveStream(base, "zwanzig-ab", "deal", 1);
    expect(Array.from({ length: 6 }, () => stream.u32())).toEqual([
      4076186559, 4187523668, 1171156968, 2161526249, 1255425675, 2600830607,
    ]);
  });

  it("matches the canonical deal for deal 1", () => {
    const deck = deriveStream(base, "zwanzig-ab", "deal", 1).shuffle(fullDeck());
    expect(deck.map(cardId).slice(0, 8)).toEqual([
      "8♣", "Q♠", "K♦", "Q♥", "Q♣", "J♠", "10♦", "8♦",
    ]);
  });

  it("deals every card exactly once", () => {
    const deck = deriveStream(base, "zwanzig-ab", "deal", 2).shuffle(fullDeck());
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map(cardId)).size).toBe(32);
  });
});
