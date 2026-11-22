import { describe, expect, it } from "vitest";
import {
  RandomStream,
  SEED_BYTES,
  commitSeed,
  deriveBytes,
  deriveStream,
  generateSeed,
  seedToHex,
  verifyCommitment,
} from "../src/rng.js";

const seed = new Uint8Array(SEED_BYTES).fill(1);
const otherSeed = new Uint8Array(SEED_BYTES).fill(2);

describe("seed commitment", () => {
  it("computes sha256(seed) as lowercase hex", () => {
    const commitment = commitSeed(seed);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(commitment).toBe(commitSeed(seedToHex(seed)));
    expect(commitment).not.toBe(commitSeed(otherSeed));
  });

  it("verifies the matching seed and rejects a different one", () => {
    expect(verifyCommitment(seed, commitSeed(seed))).toBe(true);
    expect(verifyCommitment(seed, `0x${commitSeed(seed)}`)).toBe(true);
    expect(verifyCommitment(otherSeed, commitSeed(seed))).toBe(false);
    expect(verifyCommitment(seed, "00")).toBe(false);
    expect(verifyCommitment(seed, "zz")).toBe(false);
  });

  it("generates 32 random bytes", () => {
    const a = generateSeed();
    const b = generateSeed();
    expect(a).toHaveLength(SEED_BYTES);
    expect(b).toHaveLength(SEED_BYTES);
    expect(seedToHex(a)).not.toBe(seedToHex(b));
  });
});

describe("RandomStream", () => {
  it("rejects seeds that are not 32 bytes", () => {
    expect(() => new RandomStream(new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it("is deterministic for a given seed", () => {
    const a = new RandomStream(seed);
    const b = new RandomStream(seed);
    for (let i = 0; i < 100; i += 1) expect(a.u32()).toBe(b.u32());
  });

  it("produces different streams for different seeds", () => {
    const a = new RandomStream(seed);
    const b = new RandomStream(otherSeed);
    expect(a.u32()).not.toBe(b.u32());
  });

  it("keeps int(n) inside [0, n) for many n", () => {
    const stream = new RandomStream(seed);
    for (let n = 1; n <= 64; n += 1) {
      for (let i = 0; i < 200; i += 1) {
        const value = stream.int(n);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(n);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("rejects invalid int bounds", () => {
    const stream = new RandomStream(seed);
    expect(() => stream.int(0)).toThrow();
    expect(() => stream.int(-1)).toThrow();
    expect(() => stream.int(1.5)).toThrow();
    expect(() => stream.int(0x1_0000_0001)).toThrow();
  });

  it("keeps small-range draws evenly distributed", () => {
    const stream = new RandomStream(seed);
    const counts = new Array(7).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i += 1) {
      counts[stream.int(6) + 1] += 1;
    }
    // Expected 10k each; allow generous statistical slack.
    for (let face = 1; face <= 6; face += 1) {
      expect(counts[face]).toBeGreaterThan(9_000);
      expect(counts[face]).toBeLessThan(11_000);
    }
  });

  it("shuffles without losing or duplicating items", () => {
    const stream = new RandomStream(seed);
    const items = Array.from({ length: 52 }, (_, index) => index);
    const shuffled = stream.shuffle([...items]);
    expect(shuffled).toHaveLength(52);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });
});

describe("domain separation", () => {
  it("different deals produce different streams", () => {
    const a = deriveStream(seed, "zwanzig-ab", "deal", 1);
    const b = deriveStream(seed, "zwanzig-ab", "deal", 2);
    const c = deriveStream(seed, "zwanzig-ab", "trump", 1);
    const d = deriveStream(seed, "other-game", "deal", 1);
    const values = [a.u32(), b.u32(), c.u32(), d.u32()];
    expect(new Set(values).size).toBe(4);
  });

  it("deriveBytes is stable and domain-separated", () => {
    expect(deriveBytes(seed, "a", 1)).toEqual(deriveBytes(seed, "a", 1));
    expect(deriveBytes(seed, "a", 1)).not.toEqual(deriveBytes(seed, "a", 2));
  });

  it("a later deal's stream does not depend on earlier consumption", () => {
    // Deriving deal 2 directly must equal deriving it after playing deal 1.
    const direct = deriveStream(seed, "zwanzig-ab", "deal", 2);
    const warmup = deriveStream(seed, "zwanzig-ab", "deal", 1);
    for (let i = 0; i < 50; i += 1) warmup.u32();
    const after = deriveStream(seed, "zwanzig-ab", "deal", 2);
    expect(Array.from({ length: 10 }, () => direct.u32())).toEqual(
      Array.from({ length: 10 }, () => after.u32()),
    );
  });
});
