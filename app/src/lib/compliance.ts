"use client";

export interface ComplianceState {
  acceptedAt: number | null;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  jurisdiction: boolean;
  lossLimitUsdc: number;
}

export const DEFAULT_COMPLIANCE: ComplianceState = {
  acceptedAt: null,
  ageConfirmed: false,
  termsAccepted: false,
  jurisdiction: false,
  lossLimitUsdc: 5,
};

export const LOSS_LIMITS = [1, 5, 10, 25] as const;

const STATE_KEY = "ww.compliance.v1";
const SPEND_KEY = "ww.session.spend.v1";
const NAME_KEY = "ww.name.v1";

export function loadCompliance(): ComplianceState {
  if (typeof window === "undefined") return DEFAULT_COMPLIANCE;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return DEFAULT_COMPLIANCE;
    const parsed = JSON.parse(raw) as Partial<ComplianceState>;
    const limit = Number(parsed.lossLimitUsdc);
    return {
      acceptedAt: typeof parsed.acceptedAt === "number" ? parsed.acceptedAt : null,
      ageConfirmed: Boolean(parsed.ageConfirmed),
      termsAccepted: Boolean(parsed.termsAccepted),
      jurisdiction: Boolean(parsed.jurisdiction),
      lossLimitUsdc:
        LOSS_LIMITS.includes(limit as (typeof LOSS_LIMITS)[number]) ? limit : 5,
    };
  } catch {
    return DEFAULT_COMPLIANCE;
  }
}

export function saveCompliance(state: ComplianceState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function isCompliant(state: ComplianceState): boolean {
  return Boolean(
    state.acceptedAt && state.ageConfirmed && state.termsAccepted && state.jurisdiction,
  );
}

/* ------------------------------------------------------------------ */
/* Per-session loss limit (sessionStorage: resets with the tab)         */
/* ------------------------------------------------------------------ */

export function loadSessionSpend(): number {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(sessionStorage.getItem(SPEND_KEY) ?? "0");
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function recordSessionSpend(amountUsdc: number): number {
  if (typeof window === "undefined") return 0;
  const total = Math.round((loadSessionSpend() + Math.max(0, amountUsdc)) * 1_000_000) / 1_000_000;
  try {
    sessionStorage.setItem(SPEND_KEY, String(total));
  } catch {
    // Storage can be unavailable in private modes; the limit still applies for
    // the current render tree.
  }
  return total;
}

export function clearSessionSpend(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SPEND_KEY);
  } catch {
    // ignore
  }
}

export function loadName(): string {
  if (typeof window === "undefined") return "Guest";
  return localStorage.getItem(NAME_KEY) ?? "Guest";
}

export function saveName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NAME_KEY, name);
}
