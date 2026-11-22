"use client";

import Link from "next/link";
import { Settings as SettingsIcon, Trash2, User } from "lucide-react";
import { GAMES } from "@20down/shared";
import { useState } from "react";
import { useGameSocket } from "@/components/game-socket-provider";
import { useMode } from "@/components/mode-provider";
import { useCompliance } from "@/components/compliance-provider";
import { LOSS_LIMITS } from "@/lib/compliance";

export default function SettingsPage() {
  const { name, setName, status } = useGameSocket();
  const { mode, setMode } = useMode();
  const { state, updateLimit, spentUsdc, resetSession } = useCompliance();
  const [draft, setDraft] = useState(name);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-10 sm:px-6">
      <p className="label flex items-center gap-2">
        <SettingsIcon className="h-4 w-4" /> Settings
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100 sm:text-5xl">
        Your table presence
      </h1>

      <div className="panel mt-6 p-5 sm:p-6">
        <p className="label mb-3 flex items-center gap-1.5">
          <User className="h-4 w-4" /> Table name
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            value={draft}
            maxLength={24}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => setName(draft.trim() || "Guest")}>
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-parchment-200/45">
          Realtime server: {status} · saved locally and sent with every hello
        </p>
      </div>

      <div className="panel mt-4 p-5 sm:p-6">
        <p className="label mb-3">Play mode</p>
        <div className="flex flex-wrap gap-2">
          {(["free", "wager"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={mode === value ? "btn-primary" : "btn-ghost"}
            >
              {value === "free" ? "Free Games" : "Wager Games"}
            </button>
          ))}
        </div>
      </div>

      <div className="panel mt-4 p-5 sm:p-6">
        <p className="label mb-1">Session loss limit</p>
        <p className="mb-3 text-sm leading-relaxed text-parchment-200/60">
          Caps this session&apos;s wager deposits (stake + fee). Session spend so far: $
          {spentUsdc.toFixed(2)} USDC. It resets when the tab closes.
        </p>
        <div className="flex flex-wrap gap-2">
          {LOSS_LIMITS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => updateLimit(value)}
              className={
                state.lossLimitUsdc === value
                  ? "btn-primary px-4 py-2.5 text-sm"
                  : "btn-ghost px-4 py-2.5 text-sm"
              }
            >
              ${value} USDC
            </button>
          ))}
        </div>
        <button type="button" className="btn-quiet mt-3 px-2 py-1.5 text-xs" onClick={resetSession}>
          <Trash2 className="h-3 w-3" /> Reset session spend counter
        </button>
      </div>

      <div className="panel mt-4 p-5 sm:p-6">
        <p className="label mb-3">Quick links</p>
        <ul className="space-y-2 text-sm text-parchment-200/65">
          {Object.values(GAMES).map((game) => (
            <li key={game.id}>
              <Link href={game.rulesPath} className="hover:text-parchment-100">
                {game.name} rules →
              </Link>
            </li>
          ))}
          <li>
            <Link href="/rules/fairness" className="hover:text-parchment-100">
              Verification guide →
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}