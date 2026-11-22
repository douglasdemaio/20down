import {
  ZwanzigGame,
  type Card,
  type CompletedTrick,
  type Suit,
  type TrickState,
  type ZwanzigLogEntry,
  type ZwanzigPhase,
} from "@20down/shared";

/**
 * Plain-data snapshot of the shared engine. Durable Object storage can persist
 * this directly, and `restoreZwanzig` rebuilds the class instance after an
 * eviction or a hibernation wake-up.
 */
export interface ZwanzigSnapshot {
  seed: string;
  playerCount: number;
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
  trickHistory: CompletedTrick[];
  winner: number | null;
  lastDealDeltas: number[] | null;
  log: ZwanzigLogEntry[];
}

export function serializeZwanzig(game: ZwanzigGame): ZwanzigSnapshot {
  return structuredClone({
    seed: game.seed,
    playerCount: game.playerCount,
    scores: game.scores,
    dealerSeat: game.dealerSeat,
    dealNumber: game.dealNumber,
    phase: game.phase,
    hands: game.hands,
    talon: game.talon,
    trump: game.trump,
    declarer: game.declarer,
    exchangesUsed: game.exchangesUsed,
    exchangeDone: game.exchangeDone,
    announces: game.announces,
    inHand: game.inHand,
    trick: game.trick,
    trickNumber: game.trickNumber,
    tricksWon: game.tricksWon,
    trickHistory: game.trickHistory,
    winner: game.winner,
    lastDealDeltas: game.lastDealDeltas,
    log: game.log,
  });
}

export function restoreZwanzig(snapshot: ZwanzigSnapshot): ZwanzigGame {
  const game = new ZwanzigGame({
    seed: snapshot.seed,
    playerCount: snapshot.playerCount,
    scores: snapshot.scores,
    dealerSeat: snapshot.dealerSeat,
    dealNumber: snapshot.dealNumber,
  });
  Object.assign(game as unknown as Record<string, unknown>, structuredClone(snapshot));
  return game;
}
