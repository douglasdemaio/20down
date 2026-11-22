"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatUsdc } from "@20down/shared";
import {
  DEFAULT_COMPLIANCE,
  LOSS_LIMITS,
  isCompliant,
  loadCompliance,
  loadSessionSpend,
  recordSessionSpend,
  saveCompliance,
  type ComplianceState,
} from "@/lib/compliance";
import { useMode } from "./mode-provider";

interface GeoState {
  country: string | null;
  blocked: boolean;
  configured: boolean;
}

interface ComplianceContextValue {
  ready: boolean;
  state: ComplianceState;
  accepted: boolean;
  geo: GeoState;
  spentUsdc: number;
  remainingUsdc: number;
  limitReached: boolean;
  accept: (input: Pick<ComplianceState, "lossLimitUsdc">) => void;
  addSpend: (amountUsdc: number) => void;
  resetSession: () => void;
  updateLimit: (limitUsdc: number) => void;
}

const ComplianceContext = createContext<ComplianceContextValue | null>(null);

export function ComplianceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<ComplianceState>(DEFAULT_COMPLIANCE);
  const [spentUsdc, setSpentUsdc] = useState(0);
  const [geo, setGeo] = useState<GeoState>({ country: null, blocked: false, configured: false });

  useEffect(() => {
    setState(loadCompliance());
    setSpentUsdc(loadSessionSpend());
    setReady(true);
    fetch("/api/geo")
      .then((response) => response.json())
      .then((data: GeoState & { blockedCountries?: string[] }) =>
        setGeo({
          country: data.country,
          blocked: Boolean(data.blocked),
          configured: Boolean(data.configured),
        }),
      )
      .catch(() => setGeo({ country: null, blocked: false, configured: false }));
  }, []);

  const accept = useCallback(
    (input: Pick<ComplianceState, "lossLimitUsdc">) => {
      const next: ComplianceState = {
        acceptedAt: Date.now(),
        ageConfirmed: true,
        termsAccepted: true,
        jurisdiction: true,
        lossLimitUsdc: input.lossLimitUsdc,
      };
      saveCompliance(next);
      setState(next);
    },
    [],
  );

  const addSpend = useCallback((amountUsdc: number) => {
    setSpentUsdc(recordSessionSpend(amountUsdc));
  }, []);

  const resetSession = useCallback(() => {
    recordSessionSpend(0);
    setSpentUsdc(0);
  }, []);

  const updateLimit = useCallback(
    (limitUsdc: number) => {
      const next = { ...state, lossLimitUsdc: limitUsdc };
      saveCompliance(next);
      setState(next);
    },
    [state],
  );

  const accepted = isCompliant(state);
  const remainingUsdc = Math.max(0, state.lossLimitUsdc - spentUsdc);

  const value = useMemo(
    () => ({
      ready,
      state,
      accepted,
      geo,
      spentUsdc,
      remainingUsdc,
      limitReached: accepted && remainingUsdc <= 0,
      accept,
      addSpend,
      resetSession,
      updateLimit,
    }),
    [ready, state, accepted, geo, spentUsdc, remainingUsdc, accept, addSpend, resetSession, updateLimit],
  );

  return (
    <ComplianceContext.Provider value={value}>
      {children}
      {ready && !accepted ? <ComplianceGate /> : null}
      {ready && geo.blocked ? <GeoBlocked country={geo.country} /> : null}
    </ComplianceContext.Provider>
  );
}

export function useCompliance(): ComplianceContextValue {
  const context = useContext(ComplianceContext);
  if (!context) throw new Error("useCompliance must be used inside ComplianceProvider");
  return context;
}

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

function ComplianceGate() {
  const { accept } = useCompliance();
  const { mode } = useMode();
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [jurisdiction, setJurisdiction] = useState(false);
  const [limit, setLimit] = useState<number>(5);

  const canEnter = age && terms && jurisdiction;
  const wager = mode === "wager";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:items-center">
      <div className="panel w-full max-w-xl overflow-hidden">
        <div className="border-b border-white/10 bg-gradient-to-r from-brass-500/15 via-transparent to-felt-500/15 px-6 py-5">
          <p className="label">House check</p>
          <h2 className="mt-1 font-display text-3xl text-parchment-100">Before you sit down</h2>
          <p className="mt-2 text-sm leading-relaxed text-parchment-200/70">
            Dice &amp; Cards has free tables for everyone and optional USDC wager tables on
            Solana devnet. Wager play is 18+ only and is not available in every jurisdiction.
          </p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <Check
            checked={age}
            onChange={setAge}
            title="I am at least 18 years old"
            detail="Wager tables can be paused or removed where required by law."
          />
          <Check
            checked={terms}
            onChange={setTerms}
            title="I accept the house rules and terms"
            detail="Games are final once settled on-chain. A 0.02 USDC platform fee is charged per player, per game."
          />
          <Check
            checked={jurisdiction}
            onChange={setJurisdiction}
            title="Online wagering is legal where I am"
            detail="I am responsible for confirming my local law. Geo-blocking is enforced when configured."
          />

          <div>
            <p className="label mb-2">Per-session loss limit</p>
            <div className="flex flex-wrap gap-2">
              {LOSS_LIMITS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLimit(value)}
                  className={`btn px-3 py-2 text-xs ${
                    limit === value
                      ? "border-brass-400 bg-brass-500 text-ink-950"
                      : "border-white/15 bg-white/5 text-parchment-200"
                  }`}
                >
                  ${value} USDC
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-parchment-200/55">
              This session&apos;s wager deposits are capped at ${limit} USDC. It resets when you
              close the tab. {wager ? "" : "You can raise it later in Settings."}
            </p>
          </div>

          <a
            href="https://www.begambleaware.org/"
            target="_blank"
            rel="noreferrer noopener"
            className="block rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3 text-xs text-parchment-200/70 transition hover:border-brass-400/40 hover:text-parchment-100"
          >
            <span className="font-semibold text-brass-300">Need a break?</span> Help and support
            are available at BeGambleAware.org →
          </a>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 bg-ink-950/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-parchment-200/40">
            {wager ? "Wager mode selected" : "Free tables only"}
          </p>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={!canEnter}
            onClick={() => accept({ lossLimitUsdc: limit })}
          >
            Enter Dice &amp; Cards
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-ink-950/30 p-3.5 transition hover:border-brass-400/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brass-500"
      />
      <span>
        <span className="block text-sm font-semibold text-parchment-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-parchment-200/55">{detail}</span>
      </span>
    </label>
  );
}

function GeoBlocked({ country }: { country: string | null }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/95 p-6">
      <div className="panel max-w-lg p-8 text-center">
        <p className="label">Jurisdiction notice</p>
        <h2 className="mt-2 font-display text-3xl">Not available in your region</h2>
        <p className="mt-3 text-sm leading-relaxed text-parchment-200/70">
          Dice &amp; Cards cannot offer wager play to visitors from {country ?? "this region"}.
          Free tables are also paused here while the jurisdiction policy is in effect.
        </p>
        <a
          href="https://www.begambleaware.org/"
          target="_blank"
          rel="noreferrer noopener"
          className="btn-ghost mt-6"
        >
          Responsible gambling resources
        </a>
      </div>
    </div>
  );
}

export function formatLimit(value: number): string {
  return `${formatUsdc(BigInt(Math.round(value * 1_000_000)))} USDC`;
}
