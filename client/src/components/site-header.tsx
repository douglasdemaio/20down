import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Coins, Menu, ShieldAlert, Spade, X } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { config } from "@/lib/config";
import { useMode } from "./mode-provider";
import { useGameSocket } from "./game-socket-provider";

const NAV_ITEMS = [
  { to: "/", label: "Lobby", end: true },
  { to: "/rules", label: "Rules" },
  { to: "/verify", label: "Verify" },
  { to: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const { mode, setMode } = useMode();
  const { status } = useGameSocket();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="20 Down home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brass-400/40 bg-brass-500/10 text-brass-300">
            <Spade className="h-4 w-4" />
          </span>
          <span>
            <span className="block font-display text-lg leading-none text-parchment-100">20 Down</span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-brass-400/70">
              trick-taking club
            </span>
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-white/10 text-parchment-100"
                    : "text-parchment-200/60 hover:bg-white/5 hover:text-parchment-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={`chip hidden !px-2 !py-1 !text-[9px] sm:inline-flex ${
              status === "online" ? "chip-live" : ""
            }`}
            title={config.mock ? "Simulated Worker" : "Cloudflare Worker"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "online" ? "animate-pulse bg-emerald-300" : "bg-coral-400"
              }`}
            />
            {config.mock ? "demo" : status}
          </span>

          <div className="hidden rounded-xl border border-white/10 bg-white/5 p-0.5 lg:flex">
            {(["free", "wager"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  mode === value
                    ? value === "wager"
                      ? "bg-coral-500 text-white"
                      : "bg-brass-500 text-ink-950"
                    : "text-parchment-200/55 hover:text-parchment-100"
                }`}
              >
                {value === "free" ? "Free" : "USDC"}
              </button>
            ))}
          </div>

          <div className="wallet-trigger hidden sm:block">
            <WalletMultiButton />
          </div>

          <button
            type="button"
            className="btn-quiet !px-2 md:hidden"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/10 bg-ink-900/95 px-4 py-3 md:hidden">
          <div className="grid gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm ${
                    isActive ? "bg-white/10 text-parchment-100" : "text-parchment-200/70"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="mt-3 flex gap-2 sm:hidden">
            {(["free", "wager"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={mode === value ? "btn-primary flex-1 text-xs" : "btn-ghost flex-1 text-xs"}
              >
                {value === "free" ? "Free" : "USDC"}
              </button>
            ))}
          </div>
          <div className="wallet-trigger mt-3 sm:hidden">
            <WalletMultiButton />
          </div>
        </div>
      ) : null}

      {!config.wageringEnabled && mode === "wager" ? (
        <div className="flex items-center justify-center gap-2 border-t border-coral-400/20 bg-coral-500/10 px-4 py-1.5 text-center text-[11px] text-coral-400">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          Mainnet wagering launches after the independent audit and legal sign-off.
          <Coins className="hidden h-3 w-3 shrink-0 sm:block" />
        </div>
      ) : null}
    </header>
  );
}
