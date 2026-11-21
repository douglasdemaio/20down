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
  highlighted,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  held?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  muted?: boolean;
  highlighted?: boolean;
}) {
  const dims =
    size === "sm"
      ? "h-11 w-11 rounded-xl p-1.5"
      : size === "lg"
        ? "h-24 w-24 rounded-3xl p-3 sm:h-28 sm:w-28"
        : "h-16 w-16 rounded-2xl p-2 sm:h-20 sm:w-20";

  const content = (
    <span className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[3px]">
      {Array.from({ length: 9 }, (_, index) => {
        const pip = PIP_LAYOUT[value]?.includes(index);
        return (
          <span
            key={index}
            className={`m-auto rounded-full ${
              size === "sm"
                ? "h-1.5 w-1.5"
                : size === "lg"
                  ? "h-3 w-3"
                  : "h-2 w-2"
            } ${
              pip
                ? highlighted
                  ? "bg-brass-400 drop-shadow-[0_0_3px_rgba(212,168,79,0.6)]"
                  : held
                    ? "bg-coral-500"
                    : "bg-ink-950"
                : "bg-transparent"
            }`}
          />
        );
      })}
    </span>
  );

  const classes = `die-face ${dims} transition ${
    highlighted
      ? "border-brass-400 shadow-[0_0_20px_rgba(212,168,79,0.4)] ring-2 ring-brass-400/60"
      : held
        ? "border-coral-400 ring-2 ring-coral-400/50"
        : ""
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
