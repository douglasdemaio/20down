import { describe, expect, it } from "vitest";
import {
  GAMES,
  GAME_IDS,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  PLATFORM_FEE_PER_PLAYER_BASE_UNITS,
  PLATFORM_TREASURY,
  formatUsdc,
  isGameId,
  parseUsdcToBaseUnits,
  seatsFor,
  tableFeeBaseUnits,
  validateStake,
} from "../src/types.js";

describe("game catalogue", () => {
  it("exposes exactly the three supported games", () => {
    expect(GAME_IDS).toEqual(["ship-captain-crew", "horses", "zwanzig-ab"]);
    expect(Object.keys(GAMES).sort()).toEqual([...GAME_IDS].sort());
  });

  it("uses the confirmed table sizes", () => {
    expect(seatsFor("ship-captain-crew")).toEqual({ min: 2, max: 8 });
    expect(seatsFor("horses")).toEqual({ min: 2, max: 8 });
    expect(seatsFor("zwanzig-ab")).toEqual({ min: 2, max: 4 });
  });

  it("validates game ids", () => {
    expect(isGameId("horses")).toBe(true);
    expect(isGameId("poker")).toBe(false);
    expect(isGameId(null)).toBe(false);
    expect(isGameId(3)).toBe(false);
  });
});

describe("USDC amounts", () => {
  it("parses human amounts into base units", () => {
    expect(parseUsdcToBaseUnits("0.01")).toBe(10_000n);
    expect(parseUsdcToBaseUnits("1")).toBe(1_000_000n);
    expect(parseUsdcToBaseUnits("1.00")).toBe(1_000_000n);
    expect(parseUsdcToBaseUnits("0.123456")).toBe(123_456n);
    expect(parseUsdcToBaseUnits(" 0.5 ")).toBe(500_000n);
    expect(() => parseUsdcToBaseUnits("1.1234567")).toThrow(/Invalid/);
    expect(() => parseUsdcToBaseUnits("-1")).toThrow(/Invalid/);
    expect(() => parseUsdcToBaseUnits("abc")).toThrow(/Invalid/);
  });

  it("formats base units for display", () => {
    expect(formatUsdc(10_000n)).toBe("0.01");
    expect(formatUsdc(1_000_000n)).toBe("1");
    expect(formatUsdc(1_234_567n)).toBe("1.23");
    expect(formatUsdc(1_234_567n, 6)).toBe("1.234567");
    expect(formatUsdc(20_000n)).toBe("0.02");
  });

  it("round-trips the supported range", () => {
    for (const value of ["0.01", "0.02", "0.10", "0.50", "1.00"]) {
      expect(formatUsdc(parseUsdcToBaseUnits(value), 6)).toBe(
        value === "1.00" ? "1" : value.replace(/0$/, "").replace(/\.$/, ""),
      );
    }
  });

  it("enforces the 0.01..1.00 USDC stake range", () => {
    expect(validateStake(MIN_STAKE_BASE_UNITS)).toEqual({ ok: true });
    expect(validateStake(MAX_STAKE_BASE_UNITS)).toEqual({ ok: true });
    expect(validateStake(500_000n)).toEqual({ ok: true });
    expect(validateStake(0n).ok).toBe(false);
    expect(validateStake(9_999n)).toEqual({ ok: false, reason: expect.stringMatching(/at least/) });
    expect(validateStake(MAX_STAKE_BASE_UNITS + 1n)).toEqual({
      ok: false,
      reason: expect.stringMatching(/exceed/),
    });
  });

  it("charges a flat fee per player, once", () => {
    expect(PLATFORM_FEE_PER_PLAYER_BASE_UNITS).toBe(20_000n);
    expect(tableFeeBaseUnits(0)).toBe(0n);
    expect(tableFeeBaseUnits(2)).toBe(40_000n);
    expect(tableFeeBaseUnits(8)).toBe(160_000n);
  });

  it("uses the configured treasury", () => {
    expect(PLATFORM_TREASURY).toBe("J59EPyPHf9wtoLjf8rG4f9cARnLnUPKCdNwZX241rakh");
  });
});
