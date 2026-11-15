"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Coins, Dices, ShieldAlert, Sparkles } from "lucide-react";
import { useMode } from "./mode-provider";
import { useGameSocket } from "./game-socket-provider";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export function SiteHeader() {
  const { mode, setMode } = useMode();
  const { name, status } = useGameSocket();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur-xl">
      <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brass-400/50 bg-gradient-to-br from-brass-400/30 to-felt-500/30 text-brass-300 shadow-card">
            <Dices className="h-5 w-5" strokeWidth={1.7} />
          </span>
          <span className="leading-none">
            <span className="block font-display text-xl tracking-tight text-parchment-100">
              Dice &amp; Cards
            </span>
            <span className="mt-1 hidden font-mono text-[9px] uppercase tracking-[0.28em] text-brass-400/70 sm:block">
              Free play · USDC tables
            </span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          <NavLink href="/" active={pathname === "/"} label="Lobby" />
          <NavLink href="/rules" active={pathname?.startsWith("/rules")} label="Rules" />
          <NavLink href="/verify" active={pathname === "/verify"} label="Verify" />
        </nav>

        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider sm:flex ${
              status === "online"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-coral-400/40 bg-coral-500/10 text-coral-400"
            }`}
            title={status === "online" ? "Realtime server connected" : "Reconnecting to the game server"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "online" ? "animate-pulse bg-emerald-300" : "bg-coral-400"
              }`}
            />
            {status === "online" ? "Live" : status}
          </span>
          <span className="hidden max-w-[9rem] truncate text-xs text-parchment-200/60 md:block">
            {name}
          </span>
          <WalletMultiButton />
        </div>

        <div className="order-last w-full lg:hidden">
          <ModeToggle mode={mode} onChange={setMode} full />
        </div>
      </div>

      {mode === "wager" ? (
        <div className="border-t border-coral-400/25 bg-gradient-to-r from-coral-500/15 via-coral-500/5 to-brass-500/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs sm:justify-between sm:px-6 sm:text-left">
            <p className="flex items-center gap-2 font-semibold text-coral-400">
              <ShieldAlert className="h-4 w-4" />
              Real USDC wagering active
              <span className="hidden font-normal text-parchment-200/55 sm:inline">
                — Solana devnet, 18+ only
              </span>
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-parchment-200/50">
              Stake 0.01–1.00 USDC · 0.02 USDC fee per player
            </p>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm transition ${
        active
          ? "bg-white/10 text-parchment-100"
          : "text-parchment-200/60 hover:bg-white/5 hover:text-parchment-100"
      }`}
    >
      {label}
    </Link>
  );
}

function ModeToggle({
  mode,
  onChange,
  full,
}: {
  mode: "free" | "wager";
  onChange: (mode: "free" | "wager") => void;
  full?: boolean;
}) {
  return (
    <div
      className={`flex rounded-full border border-white/15 bg-ink-900/90 p-1 shadow-card ${
        full ? "w-full" : ""
      }`}
      role="tablist"
      aria-label="Play mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "free"}
        onClick={() => onChange("free")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
          mode === "free"
            ? "bg-brass-500 text-ink-950 shadow"
            : "text-parchment-200/65 hover:text-parchment-100"
        }`}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Free Games
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "wager"}
        onClick={() => onChange("wager")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
          mode === "wager"
            ? "bg-coral-500 text-white shadow"
            : "text-parchment-200/65 hover:text-parchment-100"
        }`}
      >
        <Coins className="h-3.5 w-3.5" />
        Wager Games
      </button>
    </div>
  );
}
