import { describe, expect, it } from "vitest";
import {
  GAMES,
  GAME_IDS,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  PLATFORM_FEE_PER_PLAYER_BASE_UNITS,
  PLATFORM_TREASURY,
  STAKE_PRESETS_BASE_UNITS,
  formatUsdc,
  isGameId,
  parseUsdcToBaseUnits,
  seatsFor,
  tableFeeBaseUnits,
  validateStake,
} from "../src/types.js";

describe("game catalogue", () => {
  it("exposes only 20 Down", () => {
    expect(GAME_IDS).toEqual(["zwanzig-ab"]);
    expect(Object.keys(GAMES)).toEqual(["zwanzig-ab"]);
    expect(GAMES["zwanzig-ab"].name).toBe("20 Down");
  });

  it("allows only three- and four-player tables", () => {
    expect(seatsFor("zwanzig-ab")).toEqual({ min: 3, max: 4 });
  });

  it("validates game ids", () => {
    expect(isGameId("zwanzig-ab")).toBe(true);
    expect(isGameId("poker")).toBe(false);
    expect(isGameId(null)).toBe(false);
    expect(isGameId(3)).toBe(false);
  });
});

describe("USDC amounts", () => {
  it("parses human amounts into base units", () => {
    expect(parseUsdcToBaseUnits("0.10")).toBe(100_000n);
    expect(parseUsdcToBaseUnits("0.25")).toBe(250_000n);
    expect(parseUsdcToBaseUnits("1")).toBe(1_000_000n);
    expect(parseUsdcToBaseUnits("1.00")).toBe(1_000_000n);
    expect(parseUsdcToBaseUnits("0.123456")).toBe(123_456n);
    expect(parseUsdcToBaseUnits(" 0.5 ")).toBe(500_000n);
    expect(() => parseUsdcToBaseUnits("1.1234567")).toThrow(/Invalid/);
    expect(() => parseUsdcToBaseUnits("-1")).toThrow(/Invalid/);
    expect(() => parseUsdcToBaseUnits("abc")).toThrow(/Invalid/);
  });

  it("formats base units for display", () => {
    expect(formatUsdc(100_000n)).toBe("0.1");
    expect(formatUsdc(250_000n)).toBe("0.25");
    expect(formatUsdc(1_000_000n)).toBe("1");
    expect(formatUsdc(1_234_567n)).toBe("1.23");
    expect(formatUsdc(1_234_567n, 6)).toBe("1.234567");
    expect(formatUsdc(20_000n)).toBe("0.02");
  });

  it("accepts exactly the four stake presets", () => {
    expect(STAKE_PRESETS_BASE_UNITS).toEqual([100_000n, 250_000n, 500_000n, 1_000_000n]);
    expect(MIN_STAKE_BASE_UNITS).toBe(100_000n);
    expect(MAX_STAKE_BASE_UNITS).toBe(1_000_000n);
    for (const preset of STAKE_PRESETS_BASE_UNITS) {
      expect(validateStake(preset)).toEqual({ ok: true });
    }
  });

  it("rejects stakes outside the presets", () => {
    expect(validateStake(0n).ok).toBe(false);
    expect(validateStake(10_000n).ok).toBe(false);
    expect(validateStake(100_001n).ok).toBe(false);
    expect(validateStake(750_000n).ok).toBe(false);
    expect(validateStake(MAX_STAKE_BASE_UNITS + 1n).ok).toBe(false);
  });

  it("charges a flat fee per player, once", () => {
    expect(PLATFORM_FEE_PER_PLAYER_BASE_UNITS).toBe(20_000n);
    expect(tableFeeBaseUnits(0)).toBe(0n);
    expect(tableFeeBaseUnits(3)).toBe(60_000n);
    expect(tableFeeBaseUnits(4)).toBe(80_000n);
  });

  it("uses the configured treasury", () => {
    expect(PLATFORM_TREASURY).toBe("J59EPyPHf9wtoLjf8rG4f9cARnLnUPKCdNwZX241rakh");
  });
});
