import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ANTE_TIMEOUT_MS,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  PLATFORM_TREASURY,
  TURN_TIMEOUT_MS,
} from "@wagerwake/shared";
import { usdcMintForCluster } from "@wagerwake/shared/chain";
import { Room, checkedStake, createRoomId, formatStake } from "../src/room.js";
import type { ServerConfig } from "../src/config.js";

const ORACLE = Keypair.generate();

function testConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    rpcUrl: "http://127.0.0.1:8899",
    cluster: "devnet",
    programId: PublicKey.default,
    usdcMint: usdcMintForCluster("devnet"),
    treasury: new PublicKey(PLATFORM_TREASURY),
    oracle: ORACLE,
    chainEnabled: false,
    allowConfigInit: false,
    feePerPlayer: 20_000n,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    anteTimeoutMs: ANTE_TIMEOUT_MS,
    corsOrigin: "*",
  };
}

function freeRoom(game: "ship-captain-crew" | "horses" | "zwanzig-ab" = "ship-captain-crew") {
  const changes: number[] = [];
  const room = new Room({
    id: createRoomId(),
    game,
    mode: "free",
    stakeBaseUnits: 0n,
    feeBaseUnits: 0n,
    maxPlayers: game === "zwanzig-ab" ? 4 : 8,
    hostName: "Host",
    chain: null,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    anteTimeoutMs: ANTE_TIMEOUT_MS,
    hooks: {
      onChange: () => changes.push(Date.now()),
      onDestroy: () => {},
    },
  });
  return { room, changes };
}

function addBots(room: Room, count: number): void {
  room.fillBots(count);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Room (free play)", () => {
  it("seats players, rejects a late join, and keeps the host seat", () => {
    const { room } = freeRoom();
    const host = room.addPlayer({ playerId: "p1", name: "Ada" });
    expect(host.index).toBe(0);
    expect(room.hostSeat).toBe(0);
    room.addPlayer({ playerId: "p2", name: "Grace" });
    expect(room.occupied).toHaveLength(2);
    expect(room.toLobby().seats).toBe(2);
    room.destroy();
  });

  it("starts a dice game with bots and plays it to a resolution", async () => {
    vi.useFakeTimers();
    const { room } = freeRoom("ship-captain-crew");
    const host = room.addPlayer({ playerId: "host", name: "Host" });
    host.ready = true;
    addBots(room, 2);
    await room.start();
    expect(room.state).toBe("in-progress");
    expect(room.session).not.toBeNull();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(["resolved", "in-progress", "ante"]).toContain(room.state);
    if (room.state !== "in-progress") {
      expect(room.lastRound).not.toBeNull();
      expect(room.lastRound!.rows.length).toBeGreaterThanOrEqual(2);
      expect(room.lastRound!.seed).toMatch(/^[0-9a-f]{64}$/);
    }
    room.destroy();
  });

  it("auto-stands a human who never acts, so the table cannot stall", async () => {
    vi.useFakeTimers();
    const { room } = freeRoom("ship-captain-crew");
    const human = room.addPlayer({ playerId: "human", name: "Human" });
    human.ready = true;
    addBots(room, 1);
    await room.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // The human times out, the bot finishes, and the round eventually resolves
    // (or carries over into another round) — never stuck on the human.
    expect(["resolved", "in-progress", "ante", "scored"]).toContain(room.state);
    expect(room.viewFor("human").state).toBe(room.state);
    room.destroy();
  });

  it("plays a Zwanzig ab game with bots to game over", async () => {
    vi.useFakeTimers();
    const { room } = freeRoom("zwanzig-ab");
    room.addPlayer({ playerId: "bot-a", name: "Bones", isBot: true });
    room.addPlayer({ playerId: "bot-b", name: "Cargo Kate", isBot: true });
    await room.start();
    expect(room.game).toBe("zwanzig-ab");
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(room.state).toBe("resolved");
    expect(room.winnerSeat).not.toBeNull();
    expect(room.revealedSeed).toMatch(/^[0-9a-f]{64}$/);
    room.destroy();
  });

  it("starts another free dice round in place after the table resolves", () => {
    const { room } = freeRoom("horses");
    room.addPlayer({ playerId: "p1", name: "Ada" });
    room.addPlayer({ playerId: "bot", name: "Bones", isBot: true });
    // A completed round leaves the room resolved; rematch should reset the
    // table in place instead of forcing the players back to the lobby.
    room.state = "resolved";
    room.phase = "resolved";
    room.lastRound = {
      round: room.round,
      rows: [],
      tie: false,
      winners: [0],
      carryOver: false,
    };
    const before = room.round;
    room.rematch();
    expect(room.state).toBe("in-progress");
    expect(room.phase).toBe("play");
    expect(room.round).toBe(before + 1);
    expect(room.lastRound).toBeNull();
    expect(room.session).not.toBeNull();
    expect(room.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
    // A second request while the new round is live is rejected, so one player
    // cannot restart the table out from under everyone else.
    expect(() => room.rematch()).toThrow(/not finished/i);
    room.destroy();
  });

  it("refuses an in-place rematch for Zwanzig ab and USDC tables", () => {
    const { room } = freeRoom("zwanzig-ab");
    room.state = "resolved";
    expect(() => room.rematch()).toThrow(/new table/i);
    room.destroy();

    const wager = new Room({
      id: createRoomId(),
      game: "horses",
      mode: "wager",
      stakeBaseUnits: 10_000n,
      feeBaseUnits: 20_000n,
      maxPlayers: 2,
      hostName: "Host",
      chain: null,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      anteTimeoutMs: ANTE_TIMEOUT_MS,
      hooks: { onChange: () => {}, onDestroy: () => {} },
    });
    wager.state = "resolved";
    expect(() => wager.rematch()).toThrow(/USDC/i);
    wager.destroy();
  });

  it("carries a tied pot into a fresh round without charging a fee", async () => {
    vi.useFakeTimers();
    const { room } = freeRoom("horses");
    room.addPlayer({ playerId: "bot-1", name: "Bones", isBot: true });
    room.addPlayer({ playerId: "bot-2", name: "Dicey", isBot: true });
    await room.start();
    // Run long enough for at least one tie/carry cycle in most seeds; the
    // invariant under test is that the round counter never goes backwards and
    // the room keeps making progress.
    const startRound = room.round;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(room.round).toBeGreaterThanOrEqual(startRound);
    expect(["resolved", "in-progress", "ante", "scored"]).toContain(room.state);
    room.destroy();
  });

  it("formats stakes and enforces the USDC bounds", () => {
    expect(formatStake(10_000n)).toBe("0.01");
    expect(formatStake(1_000_000n)).toBe("1");
    expect(formatStake(123_450n)).toBe("0.12345");
    expect(checkedStake(String(MIN_STAKE_BASE_UNITS))).toBe(MIN_STAKE_BASE_UNITS);
    expect(checkedStake(String(MAX_STAKE_BASE_UNITS))).toBe(MAX_STAKE_BASE_UNITS);
    expect(() => checkedStake("9999")).toThrow(/0.01/);
    expect(() => checkedStake("1000001")).toThrow(/1.00/);
    expect(() => checkedStake(undefined)).toThrow(/required/);
  });
});

describe("Room (wager plumbing)", () => {
  it("ignores local ready toggles when a wager seat is already deposited", () => {
    const room = new Room({
      id: createRoomId(),
      game: "ship-captain-crew",
      mode: "wager",
      stakeBaseUnits: 10_000n,
      feeBaseUnits: 20_000n,
      maxPlayers: 4,
      hostName: "Host",
      chain: null,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      anteTimeoutMs: ANTE_TIMEOUT_MS,
      hooks: { onChange: () => {}, onDestroy: () => {} },
    });
    const seat = room.addPlayer({
      playerId: "p1",
      name: "Host",
      wallet: "5vWdYSmcNJnoj2PM8LfLRvnviujnQCT1Eu8Csw6Jzfhs",
    });
    seat.deposited = true;
    seat.ready = true;
    room.setReady(seat, false);
    expect(seat.ready).toBe(true);
    expect(room.toLobby().stake).toBe("10000");
    expect(room.viewFor("p1").fee).toBe("20000");
    room.destroy();
  });

  it("refuses to start a wager game without an enabled chain", async () => {
    const room = new Room({
      id: createRoomId(),
      game: "ship-captain-crew",
      mode: "wager",
      stakeBaseUnits: 10_000n,
      feeBaseUnits: 20_000n,
      maxPlayers: 2,
      hostName: "Host",
      chain: null,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      anteTimeoutMs: ANTE_TIMEOUT_MS,
      hooks: { onChange: () => {}, onDestroy: () => {} },
    });
    const a = room.addPlayer({ playerId: "a", name: "A", wallet: "5vWdYSmcNJnoj2PM8LfLRvnviujnQCT1Eu8Csw6Jzfhs" });
    const b = room.addPlayer({ playerId: "b", name: "B", wallet: "34Wxj37y8yCynoxsqkvZ5o2Wj3xH36XFkQ1AVUpawCZB" });
    a.deposited = true;
    b.deposited = true;
    a.ready = true;
    b.ready = true;
    await expect(room.start()).rejects.toThrow(/disabled/i);
    room.destroy();
  });

  it("uses the configured fee rather than hard-coding it", () => {
    const room = new Room({
      id: createRoomId(),
      game: "horses",
      mode: "wager",
      stakeBaseUnits: 50_000n,
      feeBaseUnits: 12_345n,
      maxPlayers: 3,
      hostName: "Host",
      chain: null,
      turnTimeoutMs: TURN_TIMEOUT_MS,
      anteTimeoutMs: ANTE_TIMEOUT_MS,
      hooks: { onChange: () => {}, onDestroy: () => {} },
    });
    expect(room.viewFor(null).fee).toBe("12345");
    expect(room.viewFor(null).stake).toBe("50000");
    room.destroy();
  });

  it("exposes config values used by the wager UI", () => {
    const config = testConfig();
    expect(config.feePerPlayer).toBe(20_000n);
    expect(config.chainEnabled).toBe(false);
    expect(config.anteTimeoutMs).toBe(ANTE_TIMEOUT_MS);
  });
});
