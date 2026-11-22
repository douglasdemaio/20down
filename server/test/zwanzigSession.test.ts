import { afterEach, describe, expect, it, vi } from "vitest";
import { ZwanzigGame } from "@20down/shared";
import { ZwanzigSession } from "../src/game/zwanzigSession.js";
import type { ZwanzigView } from "@20down/shared";

afterEach(() => {
  vi.useRealTimers();
});

function playAuto(session: ZwanzigSession, maxSteps = 5000): void {
  for (let step = 0; step < maxSteps; step += 1) {
    if (session.isOver) return;
    if (session.phase === "deal-scored") {
      session.nextDeal();
      continue;
    }
    session.botAct();
  }
  throw new Error("Zwanzig game did not finish");
}

describe("ZwanzigSession", () => {
  it("plays a complete 4-player game to a single winner", () => {
    let winner: number | null = null;
    let logHash = "";
    const session = new ZwanzigSession({
      playerCount: 4,
      timeoutMs: 60_000,
      dealPauseMs: 5000,
      seed: new Uint8Array(32).fill(9),
      events: {
        onUpdate: () => {},
        onGameOver: (seat, hash) => {
          winner = seat;
          logHash = hash;
        },
      },
    });
    playAuto(session);
    expect(winner).not.toBeNull();
    expect(winner!).toBeGreaterThanOrEqual(0);
    expect(winner!).toBeLessThan(4);
    expect(logHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.isOver).toBe(true);
    expect(session.game.scores[winner!]).toBeLessThanOrEqual(0);
    session.dispose();
  });

  it("only lets the declarer choose trump", () => {
    const session = new ZwanzigSession({
      playerCount: 3,
      timeoutMs: 60_000,
      dealPauseMs: 5000,
      seed: new Uint8Array(32).fill(3),
      events: { onUpdate: () => {}, onGameOver: () => {} },
    });
    expect(session.phase).toBe("trump");
    const declarer = session.game.declarer;
    const other = (declarer + 1) % 3;
    expect(() => session.act(other, { type: "trump", suit: "hearts" })).toThrow(
      /not your turn|declarer/i,
    );
    session.act(declarer, { type: "trump", suit: "clubs" });
    expect(session.phase).toBe("exchange");
    session.dispose();
  });

  it("forces hearts from deal 9 and forbids drop-outs", () => {
    const game = new ZwanzigGame({
      seed: "11".repeat(32),
      playerCount: 2,
      scores: [20, 20],
      dealNumber: 8,
    });
    game.startDeal();
    expect(game.dealNumber).toBe(9);
    expect(game.forcedHearts).toBe(true);
    expect(game.trump).toBe("hearts");
    expect(game.canDropOut(game.declarer)).toBe(false);
    expect(game.canDropOut((game.declarer + 1) % 2)).toBe(false);
  });

  it("hashes the seed plus the public log", () => {
    const session = new ZwanzigSession({
      playerCount: 2,
      timeoutMs: 60_000,
      dealPauseMs: 5000,
      seed: new Uint8Array(32).fill(5),
      events: { onUpdate: () => {}, onGameOver: () => {} },
    });
    const hash = session.logHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.logHash()).toBe(hash);
    // Acting changes the log, so the published commitment changes.
    const declarer = session.game.declarer;
    session.act(declarer, { type: "trump", suit: "spades" });
    expect(session.logHash()).not.toBe(hash);
    session.dispose();
  });

  it("auto-acts instead of stalling on a timeout", async () => {
    vi.useFakeTimers();
    const session = new ZwanzigSession({
      playerCount: 2,
      timeoutMs: 1000,
      dealPauseMs: 100,
      seed: new Uint8Array(32).fill(2),
      events: { onUpdate: () => {}, onGameOver: () => {} },
    });
    const before = session.game.declarer;
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.phase).not.toBe("trump");
    expect(session.game.declarer).toBe(before);
    session.dispose();
  });

  it("gives the deal review a clock that matches the pause length", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const session = new ZwanzigSession({
      playerCount: 2,
      timeoutMs: 60_000,
      dealPauseMs: 9_000,
      seed: new Uint8Array(32).fill(3),
      events: { onUpdate: () => {}, onGameOver: () => {} },
    });
    for (let step = 0; step < 5000 && session.phase !== "deal-scored"; step += 1) {
      session.botAct();
    }
    expect(session.phase).toBe("deal-scored");
    // The review clock is exposed as the deadline so the UI can show it.
    expect(session.deadlineAt).toBe(Date.now() + 9_000);
    // A manual "deal now" clears the review clock and arms the turn clock.
    session.nextDeal();
    expect(session.phase).not.toBe("deal-scored");
    expect(session.deadlineAt).toBe(Date.now() + 60_000);
    session.dispose();
  });

  it("exposes a spectator view without hidden cards", () => {
    const session = new ZwanzigSession({
      playerCount: 3,
      timeoutMs: 60_000,
      dealPauseMs: 5000,
      seed: new Uint8Array(32).fill(8),
      events: { onUpdate: () => {}, onGameOver: () => {} },
    });
    const view = session.spectatorView() as ZwanzigView;
    expect("hand" in view).toBe(false);
    expect("legalCards" in view).toBe(false);
    expect(view.handCounts).toHaveLength(3);
    session.dispose();
  });
});
