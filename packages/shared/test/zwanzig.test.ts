import { describe, expect, it } from "vitest";
import {
  CARDS_PER_HAND,
  DEALS_BEFORE_FORCED_HEARTS,
  GameRuleError,
  MAX_EXCHANGE,
  STARTING_SCORE,
  ZwanzigGame,
  cardId,
  cardKey,
  fullDeck,
  parseCard,
  rankStrength,
  type Suit,
} from "../src/games/zwanzig.js";

const seed = "b1a2c3d4e5f60718293a4b5c6d7e8f90b1a2c3d4e5f60718293a4b5c6d7e8f90";

function newGame(playerCount = 4, options: Record<string, unknown> = {}) {
  const game = new ZwanzigGame({ seed, playerCount, ...options });
  game.startDeal();
  return game;
}

/** Auto-plays until the deal is scored or the game ends. */
function finishDeal(game: ZwanzigGame): void {
  let guard = 0;
  while (game.phase !== "deal-scored" && game.phase !== "game-over") {
    const actor = game.currentActor();
    if (actor === null) throw new Error(`Stuck in phase ${game.phase}`);
    game.applyAutoAction(actor);
    guard += 1;
    if (guard > 500) throw new Error("Deal did not finish");
  }
}

describe("deck and cards", () => {
  it("builds a 32-card deck with unique cards", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map(cardKey)).size).toBe(32);
  });

  it("ranks A > 10 > K > Q > J > 9 > 8 > 7", () => {
    const order = [14, 10, 13, 12, 11, 9, 8, 7] as const;
    const strengths = order.map(rankStrength);
    expect(strengths).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    for (let index = 1; index < strengths.length; index += 1) {
      expect(strengths[index - 1]).toBeGreaterThan(strengths[index] as number);
    }
  });

  it("parses and renders card ids in several notations", () => {
    expect(parseCard("A♠")).toEqual({ suit: "spades", rank: 14 });
    expect(parseCard("as")).toEqual({ suit: "spades", rank: 14 });
    expect(parseCard("10♥")).toEqual({ suit: "hearts", rank: 10 });
    expect(parseCard("10H")).toEqual({ suit: "hearts", rank: 10 });
    expect(parseCard("7♦")).toEqual({ suit: "diamonds", rank: 7 });
    expect(parseCard("k♣")).toEqual({ suit: "clubs", rank: 13 });
    expect(cardId({ suit: "spades", rank: 14 })).toBe("A♠");
    expect(cardId({ suit: "hearts", rank: 10 })).toBe("10♥");
    expect(cardId({ suit: "diamonds", rank: 11 })).toBe("J♦");
    expect(() => parseCard("1♠")).toThrow(GameRuleError);
    expect(() => parseCard("A?")).toThrow(GameRuleError);
  });
});

describe("dealing", () => {
  it("deals five cards per player and leaves the rest in the talon", () => {
    for (const playerCount of [2, 3, 4]) {
      const game = new ZwanzigGame({ seed, playerCount });
      game.startDeal();
      // Two cards are dealt before the trump decision, three after.
      expect(game.hands.map((hand) => hand.length)).toEqual(new Array(playerCount).fill(2));
      game.chooseTrump(game.declarer, "clubs");
      expect(game.hands.map((hand) => hand.length)).toEqual(
        new Array(playerCount).fill(CARDS_PER_HAND),
      );
      expect(game.talon).toHaveLength(32 - playerCount * CARDS_PER_HAND);
      const all = [...game.hands.flat(), ...game.talon];
      expect(new Set(all.map(cardKey)).size).toBe(32);
    }
  });

  it("makes the player left of the dealer declarer", () => {
    const game = new ZwanzigGame({ seed, playerCount: 4, dealerSeat: 2 });
    game.startDeal();
    expect(game.declarer).toBe(3);
  });

  it("only lets the declarer choose trump", () => {
    const game = newGame(4);
    const nonDeclarer = (game.declarer + 1) % 4;
    expect(() => game.chooseTrump(nonDeclarer, "clubs")).toThrow(/declarer/);
    game.chooseTrump(game.declarer, "clubs");
    expect(game.trump).toBe("clubs");
    expect(game.phase).toBe("exchange");
  });
});

describe("exchange and dropping out", () => {
  it("never lets the declarer drop out", () => {
    const game = newGame(3);
    game.chooseTrump(game.declarer, "clubs");
    expect(game.canDropOut(game.declarer)).toBe(false);
    expect(() => game.announce(game.declarer, false)).toThrow(/may not drop out/);
    game.announce(game.declarer, true);
    expect(game.inHand[game.declarer]).toBe(true);
  });

  it("forbids drop-outs when diamonds are trump", () => {
    const game = newGame(3);
    game.chooseTrump(game.declarer, "diamonds");
    const next = (game.declarer + 1) % 3;
    game.announce(game.declarer, true);
    expect(game.canDropOut(next)).toBe(false);
    expect(() => game.announce(next, false)).toThrow(/Diamonds are trump/);
  });

  it("lets other players drop out with a normal trump", () => {
    const game = newGame(3);
    game.chooseTrump(game.declarer, "clubs");
    const next = (game.declarer + 1) % 3;
    game.announce(game.declarer, true);
    expect(game.inHand[next]).toBe(true);
    expect(game.canDropOut(next)).toBe(true);
    game.announce(next, false);
    expect(game.inHand[next]).toBe(false);
    expect(game.announces[next]).toBe(false);
  });

  it("caps total exchanges at three cards per deal", () => {
    const game = newGame(4);
    game.chooseTrump(game.declarer, "clubs");
    const hand = game.hands[game.declarer] ?? [];
    game.exchange(game.declarer, [cardId(hand[0] as (typeof hand)[number])]);
    const remaining = game.hands[game.declarer] ?? [];
    expect(() =>
      game.exchange(game.declarer, remaining.slice(0, MAX_EXCHANGE).map(cardId)),
    ).toThrow(/at most 3 cards/);
    expect(game.exchangesUsed[game.declarer]).toBe(1);
    // A third card is still allowed.
    game.exchange(game.declarer, [cardId(remaining[0] as (typeof remaining)[number])]);
    expect(game.exchangesUsed[game.declarer]).toBe(2);
  });

  it("rejects cards the player does not hold", () => {
    const game = newGame(2);
    game.chooseTrump(game.declarer, "clubs");
    const other = (game.declarer + 1) % 2;
    const card = game.hands[other]?.[0];
    expect(card).toBeDefined();
    expect(() => game.exchange(game.declarer, [cardId(card as NonNullable<typeof card>)])).toThrow(
      /do not hold/,
    );
  });

  it("awards all five tricks when everyone else drops out", () => {
    const game = newGame(3);
    game.chooseTrump(game.declarer, "clubs");
    game.announce(game.declarer, true);
    game.announce((game.declarer + 1) % 3, false);
    game.announce((game.declarer + 2) % 3, false);
    expect(game.tricksWon[game.declarer]).toBe(5);
    expect(game.phase).toBe("deal-scored");
    expect(game.scores[game.declarer]).toBe(STARTING_SCORE - 5);
  });
});

describe("trick play", () => {
  /** Builds a minimal play state with fixed hands. */
  function playState() {
    const game = new ZwanzigGame({ seed, playerCount: 2 });
    game.phase = "play";
    game.declarer = 0;
    game.trump = "clubs";
    game.inHand = [true, true];
    game.trickNumber = 1;
    game.trick = { leader: 0, ledSuit: "hearts", cards: [{ seat: 0, card: { suit: "hearts", rank: 7 } }] };
    game.hands[0] = [];
    game.hands[1] = [
      { suit: "hearts", rank: 14 },
      { suit: "spades", rank: 7 },
      { suit: "clubs", rank: 7 },
    ];
    return game;
  }

  it("enforces following suit", () => {
    const game = playState();
    expect(game.currentActor()).toBe(1);
    expect(game.legalCards(1).map(cardId)).toEqual(["A♥"]);
    expect(() => game.playCard(1, "7♠")).toThrow(/must follow hearts/);
    game.playCard(1, "A♥");
    // Ace of hearts beats the led 7 of hearts.
    expect(game.trick?.leader).toBe(1);
  });

  it("enforces playing trump when void in the led suit", () => {
    const game = playState();
    game.hands[1] = [
      { suit: "spades", rank: 7 },
      { suit: "clubs", rank: 7 },
    ];
    expect(game.legalCards(1).map(cardId)).toEqual(["7♣"]);
    expect(() => game.playCard(1, "7♠")).toThrow(/must play a trump/);
  });

  it("allows any card when void in both led suit and trump", () => {
    const game = playState();
    game.hands[1] = [{ suit: "spades", rank: 7 }];
    expect(game.legalCards(1).map(cardId)).toEqual(["7♠"]);
    game.playCard(1, "7♠");
    expect(game.trick?.leader).toBe(0);
  });

  it("lets a trump win over the led suit", () => {
    const game = playState();
    game.hands[1] = [{ suit: "clubs", rank: 7 }];
    game.playCard(1, "7♣");
    expect(game.trick?.leader).toBe(1);
  });
});

describe("scoring", () => {
  function scored(tricksWon: number[], scores: number[], trump: Suit, inHand?: boolean[]) {
    const game = new ZwanzigGame({ seed, playerCount: scores.length });
    game.trump = trump;
    game.tricksWon = [...tricksWon];
    game.scores = [...scores];
    game.inHand = inHand ?? new Array(scores.length).fill(true);
    game.phase = "play";
    game.scoreDeal();
    return game;
  }

  it("deducts one point per trick", () => {
    const game = scored([3, 2], [20, 20], "clubs");
    expect(game.scores).toEqual([17, 18]);
    expect(game.lastDealDeltas).toEqual([-3, -2]);
  });

  it("adds five points for playing but taking no trick", () => {
    const game = scored([5, 0], [20, 20], "clubs");
    expect(game.lastDealDeltas).toEqual([-5, 5]);
    expect(game.scores).toEqual([15, 25]);
  });

  it("doubles everything when hearts are trump", () => {
    const game = scored([5, 0], [20, 20], "hearts");
    expect(game.lastDealDeltas).toEqual([-10, 10]);
    expect(game.scores).toEqual([10, 30]);
  });

  it("ignores players who dropped out", () => {
    const game = scored([5, 0], [20, 20], "clubs", [true, false]);
    expect(game.lastDealDeltas).toEqual([-5, 0]);
    expect(game.scores).toEqual([15, 20]);
  });

  it("ends the game when a player reaches zero or below", () => {
    const game = scored([5, 0], [4, 20], "clubs");
    expect(game.winner).toBe(0);
    expect(game.phase).toBe("game-over");
  });

  it("picks the most negative score when several reach zero together", () => {
    const game = scored([2, 3], [2, 2], "clubs");
    expect(game.scores).toEqual([0, -1]);
    expect(game.winner).toBe(1);
    expect(game.phase).toBe("game-over");
  });

  it("plays another deal on an exact tie at the bottom", () => {
    const game = scored([2, 3], [2, 4], "hearts");
    expect(game.scores).toEqual([-2, -2]);
    expect(game.winner).toBeNull();
    expect(game.phase).toBe("deal-scored");
  });
});

describe("forced hearts", () => {
  it("forces hearts from deal nine onwards and forbids drop-outs", () => {
    expect(DEALS_BEFORE_FORCED_HEARTS).toBe(8);
    const game = new ZwanzigGame({ seed, playerCount: 3, dealNumber: 8 });
    game.startDeal();
    expect(game.dealNumber).toBe(9);
    expect(game.forcedHearts).toBe(true);
    expect(game.trump).toBe("hearts");
    expect(game.phase).toBe("exchange");
    const next = (game.declarer + 1) % 3;
    game.announce(game.declarer, true);
    expect(game.canDropOut(next)).toBe(false);
    expect(() => game.announce(next, false)).toThrow(/may not drop out/);
  });

  it("does not force hearts before deal nine", () => {
    const game = new ZwanzigGame({ seed, playerCount: 3, dealNumber: 7 });
    game.startDeal();
    expect(game.dealNumber).toBe(8);
    expect(game.forcedHearts).toBe(false);
    expect(game.phase).toBe("trump");
  });
});

describe("full game simulation", () => {
  for (const playerCount of [2, 3, 4]) {
    it(`plays a ${playerCount}-player game to completion without illegal states`, () => {
      const game = new ZwanzigGame({
        seed,
        playerCount,
        scores: new Array(playerCount).fill(1),
      });
      game.startDeal();
      let guard = 0;
      while (game.winner === null && guard < 20_000) {
        if (game.phase === "deal-scored") {
          game.nextDeal();
          continue;
        }
        const actor = game.currentActor();
        expect(actor).not.toBeNull();
        game.applyAutoAction(actor as number);
        for (const score of game.scores) expect(Number.isInteger(score)).toBe(true);
        for (const hand of game.hands) {
          expect(hand.length).toBeLessThanOrEqual(CARDS_PER_HAND);
        }
        guard += 1;
      }
      expect(guard).toBeLessThan(20_000);
      expect(game.winner).not.toBeNull();
      expect(game.phase).toBe("game-over");
      expect((game.scores[game.winner as number] as number)).toBeLessThanOrEqual(0);
    });
  }

  it("keeps hidden information out of the spectator view", () => {
    const game = newGame(4);
    game.chooseTrump(game.declarer, "clubs");
    const spectator = game.spectatorView();
    expect("hand" in spectator).toBe(false);
    expect("legalCards" in spectator).toBe(false);
    const own = game.viewFor(game.declarer);
    expect(own.hand).toHaveLength(CARDS_PER_HAND);
  });

  it("rejects a second deal while one is in progress", () => {
    const game = newGame(3);
    expect(() => game.startDeal()).toThrow(/already in progress/);
  });

  it("only advances deals between deals", () => {
    const game = newGame(3);
    expect(() => game.nextDeal()).toThrow(/not finished/);
  });

  it("never deals more than five cards and keeps the talon consistent", () => {
    const game = new ZwanzigGame({ seed, playerCount: 4 });
    game.startDeal();
    game.chooseTrump(game.declarer, "clubs");
    for (const hand of game.hands) expect(hand).toHaveLength(CARDS_PER_HAND);
    expect(game.talon).toHaveLength(32 - 4 * CARDS_PER_HAND);
    finishDeal(game);
    for (const hand of game.hands) expect(hand).toHaveLength(0);
    expect(game.talon).toHaveLength(32 - 4 * CARDS_PER_HAND);
  });
});
