"use client";

const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * A single die face. Pips are laid out on a 3x3 grid so every face reads at a
 * glance, including the off-centre six.
 */
export function Die({
  value,
  size = "md",
  held,
  selectable,
  onClick,
  muted,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  held?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  muted?: boolean;
}) {
  const dims =
    size === "sm"
      ? "h-9 w-9 rounded-lg p-1"
      : size === "lg"
        ? "h-20 w-20 rounded-2xl p-2.5 sm:h-24 sm:w-24"
        : "h-14 w-14 rounded-xl p-1.5 sm:h-16 sm:w-16";

  const content = (
    <span className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[2px]">
      {Array.from({ length: 9 }, (_, index) => {
        const pip = PIP_LAYOUT[value]?.includes(index);
        return (
          <span
            key={index}
            className={`m-auto rounded-full ${
              size === "sm" ? "h-1 w-1" : size === "lg" ? "h-2.5 w-2.5" : "h-2 w-2"
            } ${pip ? (held ? "bg-coral-500" : "bg-ink-950") : "bg-transparent"}`}
          />
        );
      })}
    </span>
  );

  const classes = `die-face ${dims} transition ${
    held ? "border-coral-400 ring-2 ring-coral-400/50" : ""
  } ${muted ? "opacity-40 grayscale" : ""} ${
    selectable ? "cursor-pointer hover:-translate-y-0.5 hover:border-brass-400" : ""
  }`;

  if (!onClick) {
    return (
      <span className={classes} aria-label={`Die showing ${value}`}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      aria-label={`Die showing ${value}${held ? ", held for reroll" : ""}`}
      aria-pressed={held}
    >
      {content}
    </button>
  );
}
