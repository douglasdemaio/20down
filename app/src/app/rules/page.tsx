import Link from "next/link";
import { ArrowRight, BookOpen, Coins, Dices, Scale, Spade, Trophy } from "lucide-react";
import { GAMES, GAME_IDS } from "@20down/shared";
import { RULE_DOCS } from "@/lib/rules";

const GAME_ICONS = {
  "ship-captain-crew": Dices,
  horses: Trophy,
  "zwanzig-ab": Spade,
} as const;

export const metadata = {
  title: "House rules",
  description:
    "Complete rules for Ship, Captain & Crew, Horses and Zwanzig ab, plus how seeds, escrow and fees work.",
};

export default function RulesIndexPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 px-6 py-10 shadow-card sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(212,168,79,0.16),transparent_45%),radial-gradient(circle_at_10%_100%,rgba(29,107,82,0.25),transparent_55%)]" />
        <div className="relative max-w-2xl">
          <p className="label flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5" /> The house rules
          </p>
          <h1 className="mt-3 font-display text-4xl text-parchment-100 sm:text-5xl">
            Know the game before the dice hit the felt.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-parchment-200/65 sm:text-base">
            Short, complete rules for all three tables — plus the fairness and money mechanics
            behind USDC play. The server enforces these rules; the tables below are the same rules
            the code runs.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {GAME_IDS.map((gameId) => {
          const game = GAMES[gameId];
          const doc =
            RULE_DOCS.find((entry) => entry.slug === gameId) ??
            RULE_DOCS.find((entry) => entry.title.startsWith(game.shortName));
          const Icon = GAME_ICONS[gameId];
          return (
            <Link
              key={gameId}
              href={game.rulesPath}
              className="panel group flex flex-col p-5 transition hover:border-brass-400/40"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brass-400/30 bg-brass-500/10 text-brass-300">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 font-display text-2xl text-parchment-100">{game.name}</h2>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-parchment-200/55">
                {doc?.subtitle ?? game.blurb}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {doc?.chips.slice(0, 3).map((chip) => (
                  <span key={chip} className="chip">
                    {chip}
                  </span>
                ))}
              </div>
              <span className="mt-4 flex items-center gap-1 text-xs font-semibold text-brass-300">
                Read the rules
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Link
          href="/rules/fairness"
          className="panel group flex items-start gap-4 p-5 transition hover:border-brass-400/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl text-parchment-100">Seeds, VRF &amp; verification</h2>
            <p className="mt-1 text-xs leading-relaxed text-parchment-200/55">
              Commit–reveal randomness, replayable dice, and exactly what the chain does and does
              not verify today.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brass-300">
              How fairness works <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
        <Link
          href="/rules/wagering"
          className="panel group flex items-start gap-4 p-5 transition hover:border-brass-400/40"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-coral-400/30 bg-coral-500/10 text-coral-400">
            <Coins className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl text-parchment-100">Wagering, escrow &amp; fees</h2>
            <p className="mt-1 text-xs leading-relaxed text-parchment-200/55">
              Stakes, the flat per-player fee, tie carry-overs, timeouts, refunds and responsible
              play.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brass-300">
              Read the money rules <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      </div>

      <div className="mt-8 flex flex-col items-start justify-between gap-3 rounded-2xl border border-white/10 bg-ink-900/50 px-5 py-4 sm:flex-row sm:items-center">
        <p className="text-sm text-parchment-200/60">
          Ready to play? Free tables need no wallet and no deposit.
        </p>
        <Link href="/" className="btn-primary">
          Open the lobby <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
