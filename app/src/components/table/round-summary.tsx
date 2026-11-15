"use client";

import Link from "next/link";
import { Crown, Eye, Scale, Trophy } from "lucide-react";
import { formatUsdc } from "@wagerwake/shared";
import type { RoomView } from "@wagerwake/shared/protocol";
import { explorerTxUrl } from "@/lib/config";

export function RoundSummary({ room }: { room: RoomView }) {
  const summary = room.lastRound;
  if (!summary) return null;

  const rows = [...summary.rows].sort((a, b) => compareRanking(b.ranking, a.ranking));
  const verifyHref = room.verifyUrl ?? `/verify?room=${room.id}&round=${summary.round}`;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brass-300" />
          <p className="font-display text-lg text-parchment-100">
            Round {summary.round} {summary.tie ? "— tie" : "result"}
          </p>
        </div>
        <span className="chip">
          {summary.tie ? "pot carries over" : "settled"}
        </span>
      </div>

      {summary.tie ? (
        <p className="border-b border-white/5 bg-coral-500/[0.06] px-4 py-2.5 text-xs text-coral-400">
          Top score was shared. {room.mode === "wager" ? "Every player must re-ante the same stake to stay in; non-anters forfeit their share." : "The pot carries into the next round."}
        </p>
      ) : null}

      <ul className="divide-y divide-white/5">
        {rows.map((row, index) => (
          <li key={row.seat} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-5 text-center font-mono text-xs text-parchment-200/35">
              {index + 1}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] text-parchment-200/60">
              {row.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm text-parchment-100">
                {row.name}
                {row.winner ? <Crown className="h-3.5 w-3.5 text-brass-400" /> : null}
              </p>
              <p className="truncate font-mono text-[10px] text-parchment-200/40">{row.detail}</p>
            </div>
            <span
              className={`font-mono text-sm ${
                row.winner ? "text-brass-300" : "text-parchment-200/55"
              }`}
            >
              {row.score}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-ink-950/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-parchment-200/35">
          {room.mode === "wager" && room.potStakes ? (
            <span className="chip">pot {formatUsdc(room.potStakes)} USDC</span>
          ) : null}
          {summary.seed ? (
            <span className="font-mono">seed {summary.seed.slice(0, 10)}…</span>
          ) : null}
          {summary.signature ? (
            <a
              href={explorerTxUrl(summary.signature)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brass-300 hover:text-brass-400"
            >
              payout tx ↗
            </a>
          ) : null}
        </div>
        <Link href={verifyHref} className="btn-quiet px-2 py-1 text-[10px]">
          <Scale className="h-3 w-3" /> Verify replay
        </Link>
      </div>
    </div>
  );
}

export function FairnessCard({ room }: { room: RoomView }) {
  return (
    <div className="panel p-4">
      <p className="label mb-2 flex items-center gap-1.5">
        <Eye className="h-3 w-3" /> Fairness
      </p>
      <dl className="space-y-2 font-mono text-[10px]">
        <div>
          <dt className="text-parchment-200/35">Seed commitment</dt>
          <dd className="mt-0.5 break-all text-parchment-200/70">
            {room.seedCommitment ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-parchment-200/35">Revealed seed</dt>
          <dd className="mt-0.5 break-all text-parchment-200/70">
            {room.revealedSeed ?? "published when the round ends"}
          </dd>
        </div>
        {room.vrfDigest ? (
          <div>
            <dt className="text-parchment-200/35">VRF digest</dt>
            <dd className="mt-0.5 break-all text-parchment-200/70">{room.vrfDigest}</dd>
          </div>
        ) : null}
      </dl>
      <Link
        href={room.verifyUrl ?? `/verify?room=${room.id}&round=${room.round}`}
        className="btn-ghost mt-3 w-full py-1.5 text-[10px]"
      >
        Re-derive this round
      </Link>
    </div>
  );
}

function compareRanking(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}
