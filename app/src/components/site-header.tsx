"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Coins, Dices, ShieldAlert, Sparkles, Menu, X } from "lucide-react";
import { useMode } from "./mode-provider";
import { useGameSocket } from "./game-socket-provider";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const NAV_ITEMS = [
  { href: "/", label: "Lobby", exact: true },
  { href: "/rules", label: "Rules" },
  { href: "/verify", label: "Verify" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const { mode, setMode } = useMode();
  const { name, status } = useGameSocket();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname?.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/90 backdrop-blur-xl">
      <div className="relative mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brass-400/50 bg-gradient-to-br from-brass-400/30 to-felt-500/30 text-brass-300 shadow-card transition group-hover:border-brass-400">
            <Dices className="h-6 w-6" strokeWidth={1.7} />
          </span>
          <span className="leading-none">
            <span className="block font-display text-xl tracking-tight text-parchment-100 sm:text-2xl">
              Dice &amp; Cards
            </span>
            <span className="mt-1 hidden font-mono text-[10px] uppercase tracking-wider text-brass-400/70 sm:block">
              Free play · USDC tables
            </span>
          </span>
        </Link>

        {/* Centered mode toggle on large screens */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <div className="pointer-events-auto">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        </div>

        {/* Desktop nav + status + wallet */}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.slice(0, 3).map((item) => (
              <NavLink key={item.href} href={item.href} active={isActive(item.href, item.exact)} label={item.label} />
            ))}
          </nav>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider ${
              status === "online"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-coral-400/40 bg-coral-500/10 text-coral-400"
            }`}
            title={status === "online" ? "Realtime server connected" : "Reconnecting to the game server"}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === "online" ? "animate-pulse bg-emerald-300" : "bg-coral-400"
              }`}
            />
            {status === "online" ? "Live" : status}
          </span>
          <span className="max-w-[9rem] truncate text-xs text-parchment-200/60">{name}</span>
          <WalletMultiButton />
        </div>

        {/* Mobile: wallet + hamburger */}
        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <WalletMultiButton />
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-parchment-200 transition hover:border-brass-400/50 hover:bg-white/10"
            onClick={() => setMobileMenuOpen((value) => !value)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen ? (
        <div className="border-t border-white/10 bg-ink-950/95 px-4 py-4 backdrop-blur-xl lg:hidden">
          <div className="mx-auto max-w-7xl space-y-4">
            <ModeToggle mode={mode} onChange={setMode} full />
            <nav className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  active={isActive(item.href, item.exact)}
                  label={item.label}
                  mobile
                  onClick={() => setMobileMenuOpen(false)}
                />
              ))}
            </nav>
            <p className="flex items-center gap-2 pt-1 font-mono text-[10px] uppercase tracking-wider text-parchment-200/40">
              <span
                className={`h-2 w-2 rounded-full ${
                  status === "online" ? "bg-emerald-300" : "bg-coral-400"
                }`}
              />
              Server {status} · Playing as {name}
            </p>
          </div>
        </div>
      ) : null}

      {mode === "wager" ? (
        <div className="border-t border-coral-400/25 bg-gradient-to-r from-coral-500/15 via-coral-500/5 to-brass-500/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-xs sm:justify-between sm:px-6 sm:text-left">
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

function NavLink({
  href,
  label,
  active,
  mobile = false,
  onClick,
}: {
  href: string;
  label: string;
  active?: boolean;
  mobile?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        mobile
          ? `flex items-center justify-center rounded-xl px-4 py-3 text-base ${
              active
                ? "border border-brass-400/40 bg-brass-500/10 text-brass-300"
                : "border border-white/10 bg-white/5 text-parchment-200/80 hover:bg-white/10"
            }`
          : active
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
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
          mode === "free"
            ? "bg-brass-500 text-ink-950 shadow"
            : "text-parchment-200/65 hover:text-parchment-100"
        }`}
      >
        <Sparkles className="h-4 w-4" />
        Free Games
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "wager"}
        onClick={() => onChange("wager")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
          mode === "wager"
            ? "bg-coral-500 text-white shadow"
            : "text-parchment-200/65 hover:text-parchment-100"
        }`}
      >
        <Coins className="h-4 w-4" />
        Wager Games
      </button>
    </div>
  );
}

