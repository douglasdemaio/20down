"use client";

import type { Card, Suit } from "@wagerwake/shared";
import { SUIT_SYMBOL } from "@wagerwake/shared";

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
  onClick,
  size = "md",
}: {
  card: Card;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const suit = SUIT_SYMBOL[card.suit];
  const tone = SUIT_COLOR[card.suit];
  const widths =
    size === "sm" ? "w-9 text-[10px]" : size === "lg" ? "w-20 text-xl" : "w-14 text-sm";

  const body = (
    <>
      <span className={`flex items-start justify-between leading-none ${tone}`}>
        <span className="font-semibold">{rankLabel(card.rank)}</span>
        <span>{suit}</span>
      </span>
      <span className={`text-center leading-none ${tone} ${size === "lg" ? "text-4xl" : "text-xl"}`}>
        {suit}
      </span>
      <span className={`flex rotate-180 items-start justify-between leading-none ${tone}`}>
        <span className="font-semibold">{rankLabel(card.rank)}</span>
        <span>{suit}</span>
      </span>
    </>
  );

  const classes = `card-face ${widths} transition ${
    selected ? "-translate-y-1 border-brass-400 ring-2 ring-brass-400/60" : ""
  } ${dimmed ? "opacity-40" : ""} ${onClick ? "cursor-pointer hover:-translate-y-1" : ""}`;

  if (!onClick) {
    return (
      <span className={classes} title={cardLabel(card)}>
        {body}
      </span>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} title={cardLabel(card)}>
      {body}
    </button>
  );
}

export function CardBack({ size = "sm" }: { size?: "sm" | "md" }) {
  const widths = size === "sm" ? "w-8" : "w-12";
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
