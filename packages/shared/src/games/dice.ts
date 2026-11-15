/** Dice helpers shared by Ship, Captain & Crew and Horses. */

export const DICE_COUNT = 5;
export const ALL_DICE_MASK = 0b11111;
export const MAX_REROLLS = 2; // 3 rolls per turn total

export function bitCount(mask: number): number {
  let count = 0;
  let m = mask & ALL_DICE_MASK;
  while (m) {
    m &= m - 1;
    count += 1;
  }
  return count;
}

export function maskIndexes(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) {
    if (mask & (1 << i)) out.push(i);
  }
  return out;
}

export function isValidMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && (mask & ~ALL_DICE_MASK) === 0;
}

export function assertMasks(mask: number, locked: number): void {
  if (!isValidMask(mask)) throw new Error(`Invalid reroll mask: ${mask}`);
  if ((mask & locked) !== 0) throw new Error("Cannot reroll a locked die");
}

export function diceTotal(dice: readonly number[]): number {
  return dice.reduce((sum, d) => sum + d, 0);
}

export function formatDice(dice: readonly number[]): string {
  return dice.join(" ");
}
