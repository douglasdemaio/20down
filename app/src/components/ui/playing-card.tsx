"use client";

import type { Card, Suit } from "@20down/shared";
import { SUIT_SYMBOL } from "@20down/shared";

const SUIT_COLOR: Record<Suit, string> = {
  hearts: "text-red-700",
  diamonds: "text-red-700",
  clubs: "text-ink-950",
  spades: "text-ink-950",
};

const RANK_LABEL: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export function rankLabel(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

export function cardLabel(card: Card): string {
  return `${rankLabel(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

export function PlayingCard({
  card,
  selected,
  dimmed,
  trump,
  won,
  onClick,
  size = "md",
}: {
  card: Card;
  selected?: boolean;
  dimmed?: boolean;
  /** Marks a card that belongs to the current trump suit. */
  trump?: boolean;
  /** Marks the card that won a completed trick. */
  won?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const suit = SUIT_SYMBOL[card.suit];
  const tone = SUIT_COLOR[card.suit];
  const widths =
    size === "sm" ? "w-11 text-xs" : size === "lg" ? "w-24 text-2xl" : "w-16 text-base";

  const body = (
    <>
      <span className={`flex items-start justify-between leading-none ${tone}`}>
        <span className="font-semibold">{rankLabel(card.rank)}</span>
        <span>{suit}</span>
      </span>
      <span className={`text-center leading-none ${tone} ${size === "lg" ? "text-5xl" : "text-2xl"}`}>
        {suit}
      </span>
      <span className={`flex rotate-180 items-start justify-between leading-none ${tone}`}>
        <span className="font-semibold">{rankLabel(card.rank)}</span>
        <span>{suit}</span>
      </span>
      {trump ? (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-brass-500 px-1.5 py-[1px] font-mono text-[7px] font-bold uppercase tracking-wider text-ink-950 shadow-die">
          trump
        </span>
      ) : null}
    </>
  );

  const classes = `card-face ${widths} transition ${
    selected ? "-translate-y-1 border-brass-400 ring-2 ring-brass-400/60" : ""
  } ${won ? "border-emerald-400 ring-2 ring-emerald-400/70" : ""} ${
    trump && !dimmed && !won ? "border-brass-400/80 shadow-[0_0_18px_rgba(212,168,79,0.45)]" : ""
  } ${dimmed ? "opacity-40" : ""} ${onClick ? "cursor-pointer hover:-translate-y-1" : ""}`;

  if (!onClick) {
    const title = `${cardLabel(card)}${won ? " · winning card" : ""}${trump ? " · trump" : ""}`;
    return (
      <span className={classes} title={title}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      title={`${cardLabel(card)}${won ? " · winning card" : ""}${trump ? " · trump" : ""}`}
    >
      {body}
    </button>
  );
}

export function CardBack({ size = "sm" }: { size?: "sm" | "md" }) {
  const widths = size === "sm" ? "w-10" : "w-14";
  return (
    <span
      className={`relative flex aspect-[2/3] ${widths} items-center justify-center overflow-hidden rounded-md border border-brass-400/40 bg-gradient-to-br from-felt-600 to-felt-700 shadow-die`}
      aria-hidden
    >
      <span className="absolute inset-1 rounded border border-brass-400/25" />
      <span className="text-xs text-brass-300/70">✦</span>
    </span>
  );
}
