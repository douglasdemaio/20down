import { deriveStream } from "../rng.js";

/**
 * Zwanzig ab ("20 Down")
 * ----------------------
 * German trick-taking game for 4 players (2-3 supported here with a shortened
 * deck deal; 5 cards each either way). Canonical rules per Pagat.com /
 * Wikipedia "Zwanzig ab":
 *
 *  - 32-card French deck: A 10 K Q J 9 8 7 in each suit. A is high, 10 is
 *    second-highest (above the King).
 *  - Everyone starts at 20 points. Deduct 1 point per trick won.
 *  - A player who plays but wins no trick adds 5 points.
 *  - Hearts as trump doubles everything (2 per trick, +10 for no trick).
 *  - Diamonds as trump means nobody may drop out.
 *  - The player left of the dealer (forehand) is the declarer: they choose trump
 *    after seeing only their first two cards, and they may never drop out.
 *  - Exchange: starting with forehand, each player may swap up to 3 cards with
 *    the talon.
 *  - Play: follow suit if able, otherwise play a trump if able, otherwise any
 *    card. No obligation to overtake. Highest trump wins, else highest card of
 *    the led suit. Trick winner leads next. Five tricks per deal.
 *  - After 8 deals, hearts is forced trump, nobody may drop out, and scores
 *    remain doubled.
 *  - First player to reach zero or below wins; the most negative score wins if
 *    several get there on the same deal. Equal scores mean another deal.
 */

export type Suit = "clubs" | "spades" | "hearts" | "diamonds";
export type Rank = 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const SUITS: readonly Suit[] = ["clubs", "spades", "hearts", "diamonds"];
export const RANKS: readonly Rank[] = [7, 8, 9, 10, 11, 12, 13, 14];
export const CARDS_PER_HAND = 5;
export const MAX_EXCHANGE = 3;
export const STARTING_SCORE = 20;
export const DEALS_BEFORE_FORCED_HEARTS = 8;

export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: "\u2663",
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
};

export function cardId(card: Card): string {
  const rank = card.rank === 11 ? "J" : card.rank === 12 ? "Q" : card.rank === 13 ? "K" : card.rank === 14 ? "A" : String(card.rank);
  return `${rank}${SUIT_SYMBOL[card.suit]}`;
}

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** A=8, 10=7, K=6, Q=5, J=4, 9=3, 8=2, 7=1. */
export function rankStrength(rank: Rank): number {
  switch (rank) {
    case 14:
      return 8;
    case 10:
      return 7;
    case 13:
      return 6;
    case 12:
      return 5;
    case 11:
      return 4;
    case 9:
      return 3;
    case 8:
      return 2;
    case 7:
      return 1;
  }
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank });
  }
  return deck;
}

export function parseCard(id: string): Card {
  const normalised = id.trim().toUpperCase();
  const suitChar = normalised.slice(-1);
  const rankPart = normalised.slice(0, -1);
  const suit = (Object.keys(SUIT_SYMBOL) as Suit[]).find((s) => SUIT_SYMBOL[s] === suitChar || s[0]?.toUpperCase() === suitChar);
  if (!suit) throw new GameRuleError(`Unrecognised suit in ${id}`);
  const rank = rankPart === "A" ? 14 : rankPart === "K" ? 13 : rankPart === "Q" ? 12 : rankPart === "J" ? 11 : Number(rankPart);
  if (!RANKS.includes(rank as Rank)) throw new GameRuleError(`Unrecognised rank in ${id}`);
  return { suit, rank: rank as Rank };
}

export type ZwanzigPhase = "trump" | "exchange" | "play" | "deal-scored" | "game-over";

export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}

export interface ZwanzigOptions {
  seed: string;
  playerCount: number;
  dealerSeat?: number;
  /** Start scores (useful when restoring a persisted game). */
  scores?: number[];
  dealNumber?: number;
}

export interface TrickCard {
  seat: number;
  card: Card;
}

export interface TrickState {
  leader: number;
  ledSuit: Suit | null;
  cards: TrickCard[];
}

export interface ZwanzigLogEntry {
  deal: number;
  trick: number;
  type: "trump" | "exchange" | "announce" | "play" | "scored";
  seat: number;
  detail: string;
}

export interface ZwanzigView {
  phase: ZwanzigPhase;
  playerCount: number;
  seat: number;
  scores: number[];
  hand: Card[];
  handCounts: number[];
  dealerSeat: number;
  declarer: number;
  dealNumber: number;
  trump: Suit | null;
  forcedHearts: boolean;
  trick: { leader: number; ledSuit: Suit | null; cards: TrickCard[] } | null;
  trickNumber: number;
  tricksWon: number[];
  inHand: boolean[];
  announces: Array<boolean | null>;
  exchangesUsed: number[];
  currentActor: number | null;
  legalCards: string[];
  canDropOut: boolean;
  winner: number | null;
  dealComplete: boolean;
  lastDealDeltas: number[] | null;
}

export class ZwanzigGame {
  readonly seed: string;
  readonly playerCount: number;
  scores: number[];
  dealerSeat: number;
  dealNumber: number;
  phase: ZwanzigPhase;
  hands: Card[][];
  talon: Card[];
  trump: Suit | null;
  declarer: number;
  exchangesUsed: number[];
  exchangeDone: boolean[];
  announces: Array<boolean | null>;
  inHand: boolean[];
  trick: TrickState | null;
  trickNumber: number;
  tricksWon: number[];
  winner: number | null;
  lastDealDeltas: number[] | null;
  log: ZwanzigLogEntry[];

  constructor(options: ZwanzigOptions) {
    const { seed, playerCount } = options;
    if (playerCount < 2 || playerCount > 4) throw new GameRuleError("Zwanzig ab needs 2 to 4 players");
    this.seed = seed;
    this.playerCount = playerCount;
    this.scores = options.scores ? [...options.scores] : Array.from({ length: playerCount }, () => STARTING_SCORE);
    this.dealerSeat = options.dealerSeat ?? 0;
    this.dealNumber = options.dealNumber ?? 0;
    this.phase = "deal-scored";
    this.hands = Array.from({ length: playerCount }, () => []);
    this.talon = [];
    this.trump = null;
    this.declarer = this.leftOfDealer();
    this.exchangesUsed = Array.from({ length: playerCount }, () => 0);
    this.exchangeDone = Array.from({ length: playerCount }, () => false);
    this.announces = Array.from({ length: playerCount }, () => null);
    this.inHand = Array.from({ length: playerCount }, () => true);
    this.trick = null;
    this.trickNumber = 0;
    this.tricksWon = Array.from({ length: playerCount }, () => 0);
    this.winner = null;
    this.lastDealDeltas = null;
    this.log = [];
  }

  private leftOfDealer(): number {
    return (this.dealerSeat + 1) % this.playerCount;
  }

  get forcedHearts(): boolean {
    // "After eight deals have been played" means deal 9 onwards.
    return this.dealNumber > DEALS_BEFORE_FORCED_HEARTS;
  }

  get scoreMultiplier(): number {
    return this.trump === "hearts" ? 2 : 1;
  }

  /** Players still active in trick play this deal. */
  get activeSeats(): number[] {
    return this.inHand.map((inHand, seat) => (inHand ? seat : -1)).filter((seat) => seat >= 0);
  }

  /** Deals a new hand. Deals two cards, opens the trump decision, then deals three more on trump selection. */
  startDeal(): void {
    if (this.winner !== null) throw new GameRuleError("The game is already over");
    if (this.phase !== "deal-scored") throw new GameRuleError("A deal is already in progress");

    this.dealNumber += 1;
    this.declarer = this.leftOfDealer();
    const stream = deriveStream(this.seed, "zwanzig-ab", "deal", this.dealNumber);
    const deck = stream.shuffle(fullDeck());

    this.hands = Array.from({ length: this.playerCount }, () => []);
    for (let round = 0; round < 2; round += 1) {
      for (let offset = 0; offset < this.playerCount; offset += 1) {
        const seat = (this.declarer + offset) % this.playerCount;
        const card = deck.pop();
        if (!card) throw new GameRuleError("Deck exhausted while dealing");
        (this.hands[seat] as Card[]).push(card);
      }
    }
    this.talon = deck;
    this.trump = null;
    this.exchangesUsed = Array.from({ length: this.playerCount }, () => 0);
    this.exchangeDone = Array.from({ length: this.playerCount }, () => false);
    this.announces = Array.from({ length: this.playerCount }, () => null);
    this.inHand = Array.from({ length: this.playerCount }, () => true);
    this.trick = null;
    this.trickNumber = 0;
    this.tricksWon = Array.from({ length: this.playerCount }, () => 0);
    this.lastDealDeltas = null;

    if (this.forcedHearts) {
      this.applyTrump("hearts");
      this.log.push({ deal: this.dealNumber, trick: 0, type: "trump", seat: this.declarer, detail: "Forced hearts (deal 9+)" });
    } else {
      this.phase = "trump";
    }
  }

  currentActor(): number | null {
    if (this.phase === "trump") return this.declarer;
    if (this.phase === "exchange") {
      for (let offset = 0; offset < this.playerCount; offset += 1) {
        const seat = (this.declarer + offset) % this.playerCount;
        if (!this.exchangeDone[seat]) return seat;
      }
      return null;
    }
    if (this.phase === "play" && this.trick) {
      const next = this.trick.cards.length;
      return this.activeSeats[(this.activeSeats.indexOf(this.trick.leader) + next) % this.activeSeats.length] ?? null;
    }
    return null;
  }

  canDropOut(seat: number): boolean {
    if (this.phase !== "exchange") return false;
    if (seat === this.declarer) return false;
    if (this.trump === "diamonds") return false;
    if (this.forcedHearts) return false;
    return true;
  }

  chooseTrump(seat: number, suit: Suit): void {
    if (this.phase !== "trump") throw new GameRuleError("Trump is not being chosen right now");
    if (seat !== this.declarer) throw new GameRuleError("Only the declarer chooses trump");
    if (!SUITS.includes(suit)) throw new GameRuleError("Invalid trump suit");
    if (this.forcedHearts && suit !== "hearts") throw new GameRuleError("Hearts is forced in deal 9 and later");
    this.applyTrump(suit);
    this.log.push({ deal: this.dealNumber, trick: 0, type: "trump", seat, detail: `${suit}${suit === "hearts" ? " (doubled)" : ""}` });
  }

  private applyTrump(suit: Suit): void {
    this.trump = suit;
    // Deal the remaining three cards per player now that trump is known.
    for (let round = 0; round < 3; round += 1) {
      for (let offset = 0; offset < this.playerCount; offset += 1) {
        const seat = (this.declarer + offset) % this.playerCount;
        const card = this.talon.pop();
        if (!card) throw new GameRuleError("Talon exhausted while dealing");
        (this.hands[seat] as Card[]).push(card);
      }
    }
    this.phase = "exchange";
  }

  /** Swap up to three cards with the talon. Pass an empty list to keep the hand. */
  exchange(seat: number, cardIds: readonly string[]): void {
    if (this.phase !== "exchange") throw new GameRuleError("Not in the exchange phase");
    if (this.currentActor() !== seat) throw new GameRuleError("It is not your turn to exchange");
    if ((this.exchangesUsed[seat] ?? 0) + cardIds.length > MAX_EXCHANGE) {
      throw new GameRuleError(`You may exchange at most ${MAX_EXCHANGE} cards per deal`);
    }
    const hand = this.hands[seat] as Card[];
    const chosen: Card[] = [];
    for (const id of cardIds) {
      const card = parseCard(id);
      const index = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
      if (index < 0) throw new GameRuleError(`You do not hold ${id}`);
      if (chosen.some((c) => c.suit === card.suit && c.rank === card.rank)) throw new GameRuleError(`Duplicate card ${id}`);
      chosen.push(hand[index] as Card);
    }
    for (const card of chosen) {
      hand.splice(hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank), 1);
      this.talon.unshift(card);
      const replacement = this.talon.pop();
      if (!replacement) throw new GameRuleError("Talon exhausted");
      hand.push(replacement);
    }
    this.exchangesUsed[seat] = (this.exchangesUsed[seat] ?? 0) + chosen.length;
    if (chosen.length > 0) {
      this.log.push({ deal: this.dealNumber, trick: 0, type: "exchange", seat, detail: chosen.map(cardId).join(" ") });
    }
  }

  announce(seat: number, play: boolean): void {
    if (this.phase !== "exchange") throw new GameRuleError("Not in the announcement phase");
    if (this.currentActor() !== seat) throw new GameRuleError("It is not your turn to announce");
    if (!play && !this.canDropOut(seat)) {
      throw new GameRuleError(
        this.trump === "diamonds" ? "Diamonds are trump: everyone must play" : "You may not drop out of this deal",
      );
    }
    this.announces[seat] = play;
    this.inHand[seat] = play;
    this.exchangeDone[seat] = true;
    this.log.push({ deal: this.dealNumber, trick: 0, type: "announce", seat, detail: play ? "play" : "pass" });

    if (this.exchangeDone.every(Boolean)) {
      this.beginPlay();
    }
  }

  private beginPlay(): void {
    const active = this.activeSeats;
    if (active.length === 0) throw new GameRuleError("Nobody is playing this deal");
    if (active.length === 1 && active[0] === this.declarer) {
      // All opponents dropped out: declarer takes all five tricks.
      this.tricksWon[this.declarer] = CARDS_PER_HAND;
      this.scoreDeal();
      return;
    }
    this.phase = "play";
    this.trickNumber = 1;
    this.trick = { leader: this.declarer, ledSuit: null, cards: [] };
  }

  legalCards(seat: number): Card[] {
    const hand = this.hands[seat] as Card[];
    if (this.phase !== "play" || !this.trick) return [];
    if (this.currentActor() !== seat) return [];
    const led = this.trick.ledSuit;
    if (!led) return [...hand];
    const trump = this.trump;
    const hasLed = hand.some((c) => c.suit === led);
    if (hasLed) return hand.filter((c) => c.suit === led);
    if (trump && hand.some((c) => c.suit === trump)) return hand.filter((c) => c.suit === trump);
    return [...hand];
  }

  playCard(seat: number, id: string): void {
    if (this.phase !== "play" || !this.trick) throw new GameRuleError("Not in the play phase");
    if (this.currentActor() !== seat) throw new GameRuleError("It is not your turn");
    const card = parseCard(id);
    const legal = this.legalCards(seat);
    if (!legal.some((c) => c.suit === card.suit && c.rank === card.rank)) {
      throw new GameRuleError(this.explainIllegalCard(seat, card));
    }
    const hand = this.hands[seat] as Card[];
    hand.splice(hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank), 1);
    if (this.trick.cards.length === 0) this.trick.ledSuit = card.suit;
    this.trick.cards.push({ seat, card });
    this.log.push({ deal: this.dealNumber, trick: this.trickNumber, type: "play", seat, detail: cardId(card) });

    if (this.trick.cards.length === this.activeSeats.length) {
      this.completeTrick();
    } else {
      void this.currentActor();
    }
  }

  private explainIllegalCard(seat: number, card: Card): string {
    const led = this.trick?.ledSuit;
    if (!led) return "You cannot play that card";
    const hand = this.hands[seat] as Card[];
    if (hand.some((c) => c.suit === led) && card.suit !== led) {
      return `You must follow ${led}`;
    }
    if (this.trump && hand.some((c) => c.suit === this.trump) && card.suit !== this.trump) {
      return `You are out of ${led}: you must play a trump`;
    }
    return "Illegal card";
  }

  private trickWinner(): number {
    const cards = this.trick?.cards ?? [];
    const trump = this.trump;
    const led = this.trick?.ledSuit;
    const trumps = cards.filter((c) => trump && c.card.suit === trump);
    const pool = trumps.length > 0 ? trumps : cards.filter((c) => c.card.suit === led);
    let best = pool[0] as TrickCard;
    for (const entry of pool) {
      if (rankStrength(entry.card.rank) > rankStrength(best.card.rank)) best = entry;
    }
    return best.seat;
  }

  private completeTrick(): void {
    if (!this.trick) return;
    const winner = this.trickWinner();
    this.tricksWon[winner] = (this.tricksWon[winner] as number) + 1;
    const tricksPlayed = this.trickNumber;
    if (tricksPlayed >= CARDS_PER_HAND) {
      this.scoreDeal();
      return;
    }
    this.trickNumber += 1;
    this.trick = { leader: winner, ledSuit: null, cards: [] };
  }

  scoreDeal(): void {
    const mult = this.scoreMultiplier;
    const deltas = Array.from({ length: this.playerCount }, () => 0);
    for (let seat = 0; seat < this.playerCount; seat += 1) {
      if (!this.inHand[seat]) continue;
      const tricks = this.tricksWon[seat] as number;
      let delta = -tricks * mult;
      if (tricks === 0) delta += 5 * mult;
      deltas[seat] = delta;
      this.scores[seat] = (this.scores[seat] as number) + delta;
    }
    this.lastDealDeltas = deltas;
    this.log.push({
      deal: this.dealNumber,
      trick: this.trickNumber,
      type: "scored",
      seat: -1,
      detail: deltas.map((d, seat) => `${seat}:${d >= 0 ? "+" : ""}${d}`).join(" "),
    });

    const finished = this.scores
      .map((score, seat) => ({ score, seat }))
      .filter((entry) => entry.score <= 0);
    if (finished.length > 0) {
      const lowest = Math.min(...finished.map((entry) => entry.score));
      const lowestSeats = finished.filter((entry) => entry.score === lowest);
      if (lowestSeats.length === 1) {
        this.winner = (lowestSeats[0] as { seat: number }).seat;
        this.phase = "game-over";
        return;
      }
      // Tie at the bottom: play another deal (nobody may be eliminated here).
    }
    this.phase = "deal-scored";
  }

  /**
   * Advances the dealer and starts the next deal. Only valid between deals.
   */
  nextDeal(): void {
    if (this.phase !== "deal-scored") throw new GameRuleError("The current deal is not finished");
    this.dealerSeat = (this.dealerSeat + 1) % this.playerCount;
    this.startDeal();
  }

  /** Best-effort action for a disconnected or timed-out player. */
  autoAction(seat: number): { type: "trump"; suit: Suit } | { type: "exchange"; cardIds: string[] } | { type: "announce"; play: boolean } | { type: "play"; cardId: string } | { type: "none" } {
    if (this.currentActor() !== seat) return { type: "none" };
    if (this.phase === "trump") {
      const counts: Record<Suit, number> = { clubs: 0, spades: 0, hearts: 0, diamonds: 0 };
      for (const card of this.hands[seat] as Card[]) counts[card.suit] += 1;
      const suit = (Object.keys(counts) as Suit[]).sort((a, b) => counts[b] - counts[a])[0] as Suit;
      return { type: "trump", suit };
    }
    if (this.phase === "exchange") {
      // Keep the strongest cards (never trumps if there is a choice) and swap
      // the rest. Passing on the exchange is always legal, so an empty list is
      // also a safe timeout action.
      const hand = this.hands[seat] as Card[];
      if ((this.exchangesUsed[seat] ?? 0) >= MAX_EXCHANGE) {
        return { type: "announce", play: true };
      }
      const budget = MAX_EXCHANGE - (this.exchangesUsed[seat] as number);
      const sorted = [...hand].sort((a, b) => {
        const aTrump = this.trump !== null && a.suit === this.trump ? 1 : 0;
        const bTrump = this.trump !== null && b.suit === this.trump ? 1 : 0;
        if (aTrump !== bTrump) return aTrump - bTrump;
        return rankStrength(a.rank) - rankStrength(b.rank);
      });
      return { type: "exchange", cardIds: sorted.slice(0, budget).map(cardId) };
    }
    if (this.phase === "play") {
      const legal = this.legalCards(seat);
      const led = this.trick?.ledSuit;
      const lowest = [...legal].sort((a, b) => rankStrength(a.rank) - rankStrength(b.rank))[0];
      if (!lowest) return { type: "none" };
      // Prefer to keep trumps when discarding is possible.
      const offSuit = led && this.trump ? legal.filter((c) => c.suit !== this.trump) : legal;
      const pool = offSuit.length > 0 ? offSuit : legal;
      const card = [...pool].sort((a, b) => rankStrength(a.rank) - rankStrength(b.rank))[0] as Card;
      return { type: "play", cardId: cardId(card) };
    }
    return { type: "none" };
  }

  /** Applies autoAction for a timed-out seat. */
  applyAutoAction(seat: number): void {
    const action = this.autoAction(seat);
    switch (action.type) {
      case "trump":
        this.chooseTrump(seat, action.suit);
        break;
      case "exchange":
        this.exchange(seat, action.cardIds);
        this.announce(seat, true);
        break;
      case "announce":
        this.announce(seat, action.play);
        break;
      case "play":
        this.playCard(seat, action.cardId);
        break;
      case "none":
        break;
    }
  }

  viewFor(seat: number): ZwanzigView {
    const actor = this.currentActor();
    const legal = this.legalCards(seat).map(cardId);
    const canDrop = this.canDropOut(seat) && actor === seat;
    return {
      phase: this.phase,
      playerCount: this.playerCount,
      seat,
      scores: [...this.scores],
      hand: [...(this.hands[seat] as Card[])],
      handCounts: this.hands.map((hand) => hand.length),
      dealerSeat: this.dealerSeat,
      declarer: this.declarer,
      dealNumber: this.dealNumber,
      trump: this.trump,
      forcedHearts: this.forcedHearts,
      trick: this.trick
        ? { leader: this.trick.leader, ledSuit: this.trick.ledSuit, cards: this.trick.cards.map((entry) => ({ ...entry })) }
        : null,
      trickNumber: this.trickNumber,
      tricksWon: [...this.tricksWon],
      inHand: [...this.inHand],
      announces: [...this.announces],
      exchangesUsed: [...this.exchangesUsed],
      currentActor: actor,
      legalCards: legal,
      canDropOut: canDrop,
      winner: this.winner,
      dealComplete: this.phase === "deal-scored" || this.phase === "game-over",
      lastDealDeltas: this.lastDealDeltas ? [...this.lastDealDeltas] : null,
    };
  }

  /** Public spectator view: no hands. */
  spectatorView(): Omit<ZwanzigView, "hand" | "legalCards"> {
    const { hand: _hand, legalCards: _legal, ...rest } = this.viewFor(0);
    return rest;
  }
}
