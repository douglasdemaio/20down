import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playHorsesTurn,
  playShipCrewTurn,
  type HorsesTurn,
  type ShipCrewTurn,
} from "@20down/shared";
import {
  DiceSession,
  type DiceRoundOutcome,
  type DiceTurnRecord,
} from "../src/game/diceSession.js";

function makeSession(
  game: "ship-captain-crew" | "horses",
  seats: number[],
  options: { seed?: Uint8Array; timeoutMs?: number } = {},
) {
  const outcomes: DiceRoundOutcome[] = [];
  let timedOut = 0;
  let session!: DiceSession;
  session = new DiceSession({
    game,
    round: 1,
    seats,
    names: seats.map((seat) => `Seat ${seat}`),
    timeoutMs: options.timeoutMs ?? 60_000,
    seed: options.seed,
    events: {
      onUpdate: () => {},
      onRoundComplete: (outcome) => outcomes.push(outcome),
      onTimedOut: () => {
        timedOut += 1;
        session.autoFinishTurn();
      },
    },
  });
  return { session, outcomes, timedOut: () => timedOut };
}

function playOutWithBots(session: DiceSession): void {
  let guard = 0;
  while (!session.isFinished && guard < 200) {
    session.botAct();
    guard += 1;
  }
  expect(guard).toBeLessThan(200);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DiceSession", () => {
  it("completes a Ship, Captain & Crew round with bots", () => {
    const { session, outcomes } = makeSession("ship-captain-crew", [0, 1, 2]);
    playOutWithBots(session);
    expect(session.isFinished).toBe(true);
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0]!;
    expect(outcome.turns).toHaveLength(3);
    expect(outcome.summary.rows).toHaveLength(3);
    expect(outcome.winners.length).toBeGreaterThanOrEqual(1);
    expect(outcome.seedHex).toMatch(/^[0-9a-f]{64}$/);

    // Every score must be reproducible from the published seed and masks, which
    // is exactly what the on-chain program does.
    for (const turn of outcome.turns) {
      const replay = playShipCrewTurn(session.seed, 1, turn.seat, masksOf(turn));
      expect(replay.cargoScore).toBe(turn.score);
    }
  });

  it("completes a Horses round and replays identically", () => {
    const { session, outcomes } = makeSession("horses", [0, 1, 2]);
    playOutWithBots(session);
    const outcome = outcomes[0]!;
    expect(outcome.turns).toHaveLength(3);
    for (const turn of outcome.turns) {
      const replay = playHorsesTurn(session.seed, 1, turn.seat, masksOf(turn), 3);
      expect(replay.matches).toBe(turn.score);
    }
    expect(outcome.summary.rows.every((row) => row.ranking.length === 3)).toBe(true);
  });

  it("finds a tie deterministically and reports carry-over", () => {
    let found: DiceRoundOutcome | null = null;
    for (let value = 0; value < 400 && !found; value += 1) {
      const seed = new Uint8Array(32).fill(value % 256);
      const { session, outcomes } = makeSession("ship-captain-crew", [0, 1], { seed });
      playOutWithBots(session);
      const outcome = outcomes[0]!;
      if (outcome.tie) found = outcome;
    }
    expect(found).not.toBeNull();
    expect(found!.winners.length).toBeGreaterThan(1);
    expect(found!.summary.carryOver).toBe(true);
  });

  it("rejects illegal rerolls and out-of-turn actions", () => {
    const { session } = makeSession("ship-captain-crew", [0, 1]);
    expect(() => session.act(1, { type: "stand" })).toThrow(/not your turn/i);
    expect(() => session.act(0, { type: "reroll", mask: 32 })).toThrow(/between 0 and 31/i);
    expect(() => session.act(0, { type: "reroll", mask: -1 })).toThrow(/between 0 and 31/i);
    session.dispose();
  });

  it("auto-finishes a turn after the timeout", async () => {
    vi.useFakeTimers();
    const { session, timedOut } = makeSession("horses", [0, 1], { timeoutMs: 60_000 });
    expect(session.currentActor).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(timedOut()).toBe(1);
    expect(session.currentActor).toBe(1);
    session.dispose();
  });

  it("forfeits the current seat and resolves a two-player table", () => {
    const { session } = makeSession("ship-captain-crew", [0, 1]);
    const result = session.forfeitCurrentSeat();
    expect(result.finished).toBe(true);
    expect(result.survivor).toBe(1);
    expect(session.isFinished).toBe(true);
    session.dispose();
  });

  it("exposes only the current player's live dice", () => {
    const { session } = makeSession("horses", [0, 1]);
    const viewer = session.viewFor(0);
    expect(viewer.dice).not.toBeNull();
    expect(session.viewFor(1).dice).toBeNull();
    session.dispose();
  });
});

function masksOf(turn: DiceTurnRecord): number[] {
  const masks = turn.rerollMasks.slice(0, turn.rerollCount);
  return masks;
}
