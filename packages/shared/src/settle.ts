import type { PlayerResult, RoundOutcome } from "./types.js";

function compareRanking(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? Number.NEGATIVE_INFINITY;
    const right = b[i] ?? Number.NEGATIVE_INFINITY;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

/**
 * Ranks player results lexicographically (higher is better) and returns the top
 * seats. A tie is any round with two or more seats sharing the exact top
 * ranking, including "everybody scored zero".
 */
export function rankResults(results: readonly PlayerResult[]): { winners: number[]; tie: boolean } {
  if (results.length === 0) throw new Error("No results to rank");
  const ranked = results.map((result) => ({
    seat: result.seat,
    ranking: result.ranking ?? [result.score],
  }));
  let best = ranked[0] as { seat: number; ranking: number[] };
  for (const entry of ranked.slice(1)) {
    if (compareRanking(entry.ranking, best.ranking) > 0) best = entry;
  }
  const winners = ranked
    .filter((entry) => compareRanking(entry.ranking, best.ranking) === 0)
    .map((entry) => entry.seat)
    .sort((a, b) => a - b);
  return { winners, tie: winners.length > 1 };
}

/**
 * Round settlement. In this platform the platform fee is deposited per player on
 * top of the stake, so the stake pot is paid to the winner in full and the fee
 * pot goes to the treasury separately. A tie moves the whole pot to the next
 * round and charges no fee.
 */
export function resolveRound(
  results: readonly PlayerResult[],
  potStakesBaseUnits: bigint,
): RoundOutcome {
  const { winners, tie } = rankResults(results);
  if (tie) {
    return {
      winners,
      tie: true,
      carryOver: true,
      payoutBaseUnits: 0n,
    };
  }
  return {
    winners,
    tie: false,
    carryOver: false,
    payoutBaseUnits: potStakesBaseUnits,
  };
}
