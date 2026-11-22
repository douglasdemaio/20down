"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  playShipCrewTurn,
  playHorsesTurn,
  commitSeed,
  type ShipCrewTurn,
  type HorsesTurn,
} from "@20down/shared";
import { SERVER_URL, explorerTxUrl } from "@/lib/config";

interface TurnRecord {
  seat: number;
  rerollCount: number;
  rerollMasks: [number, number];
  rolls: number;
  score: number;
  ranking: [number, number, number];
  detail: string;
}

interface RecordPayload {
  round: number;
  game: string;
  rows?: Array<{ seat: number; name: string; score: number; detail: string; winner: boolean }>;
  tie?: boolean;
  winners?: number[];
  seed?: string | null;
  seedCommitment?: string | null;
  vrfDigest?: string | null;
  logHash?: string | null;
  signature?: string | null;
  turns?: TurnRecord[];
}

interface VerifyResponse {
  room: string;
  cluster: string;
  programId: string;
  record: RecordPayload;
}

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export function VerifyClient({
  initialRoom,
  initialRound,
}: {
  initialRoom: string;
  initialRound: string;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [round, setRound] = useState(initialRound);
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (roomValue: string, roundValue: string) => {
    if (!roomValue.trim()) {
      setError("Enter a table code");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ room: roomValue.trim() });
      if (roundValue.trim() && /^\d+$/.test(roundValue.trim())) {
        params.set("round", roundValue.trim());
      }
      const response = await fetch(`${SERVER_URL}/api/verify?${params.toString()}`);
      const payload = (await response.json()) as VerifyResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load that round");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  // Pre-fill from a share link: run the lookup once when the page mounts.
  useEffect(() => {
    if (initialRoom) void lookup(initialRoom, initialRound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 px-6 py-8 shadow-card sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_15%,rgba(29,107,82,0.3),transparent_45%),radial-gradient(circle_at_8%_110%,rgba(212,168,79,0.14),transparent_50%)]" />
        <div className="relative max-w-2xl">
          <p className="label flex items-center gap-2">
            <Scale className="h-3.5 w-3.5" /> Independent verification
          </p>
          <h1 className="mt-3 font-display text-4xl text-parchment-100 sm:text-5xl">
            Check any roll yourself.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-parchment-200/65 sm:text-base">
            Enter a table code (and optionally a round) to pull the published record. The verifier
            regenerates every die from the revealed seed and the recorded reroll masks, and checks
            the revealed seed against the commitment that was published before play.
          </p>
        </div>
      </div>

      <form
        className="panel mt-6 flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(room, round);
        }}
      >
        <label className="min-w-[12rem] flex-1">
          <span className="label">Table code</span>
          <input
            className="input mt-1.5 font-mono text-sm"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="e.g. T-3F9K2A"
          />
        </label>
        <label className="w-28">
          <span className="label">Round</span>
          <input
            className="input mt-1.5 font-mono text-sm"
            value={round}
            onChange={(event) => setRound(event.target.value.replace(/[^\d]/g, ""))}
            placeholder="latest"
            inputMode="numeric"
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Verify
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-xl border border-coral-400/30 bg-coral-500/10 px-4 py-3 text-sm text-coral-400">
          {error}
        </p>
      ) : null}

      {data ? <RecordView data={data} /> : null}
    </div>
  );
}

function RecordView({ data }: { data: VerifyResponse }) {
  const record = data.record;
  const checks = buildChecks(record);

  return (
    <div className="mt-6 space-y-4">
      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label">
              Round {record.round} · {record.game}
            </p>
            <p className="mt-1 font-mono text-xs text-parchment-200/50">room {data.room}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">{data.cluster}</span>
            <span className="chip">program {short(data.programId)}</span>
            {record.signature ? (
              <a
                href={explorerTxUrl(record.signature)}
                target="_blank"
                rel="noreferrer noopener"
                className="chip text-brass-300 hover:text-brass-400"
              >
                settlement tx <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {checks.length > 0 ? (
        <div className="panel divide-y divide-white/5 overflow-hidden">
          <p className="label px-4 py-2.5">Verification checks</p>
          {checks.map((check) => (
            <div key={check.label} className="flex items-start gap-3 px-4 py-2.5">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-coral-400" />
              )}
              <div className="min-w-0">
                <p className="text-sm text-parchment-100">{check.label}</p>
                <p className="truncate font-mono text-[10px] text-parchment-200/45">
                  {check.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {record.rows && record.rows.length > 0 ? (
        <div className="panel overflow-hidden">
          <p className="label px-4 py-2.5">Published scores</p>
          <ul className="divide-y divide-white/5 border-t border-white/5">
            {record.rows.map((row) => (
              <li key={`${row.seat}-${row.name}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0 truncate text-xs text-parchment-200/60">
                  {row.name}
                </span>
                <span className="flex-1 truncate font-mono text-[10px] text-parchment-200/40">
                  {row.detail}
                </span>
                <span
                  className={`font-mono text-sm ${row.winner ? "text-brass-300" : "text-parchment-200/55"}`}
                >
                  {row.score}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="panel overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 text-xs text-parchment-200/50">
          Raw published record
        </summary>
        <pre className="max-h-[26rem] overflow-auto border-t border-white/5 p-4 font-mono text-[11px] leading-relaxed text-parchment-200/70">
          {JSON.stringify(record, null, 2)}
        </pre>
      </details>

      <Link href="/rules/fairness" className="btn-quiet px-3 py-1.5 text-xs">
        How verification works →
      </Link>
    </div>
  );
}

function buildChecks(record: RecordPayload): Check[] {
  const checks: Check[] = [];
  const seed = record.seed ?? null;

  if (!seed) {
    checks.push({
      label: "Revealed seed",
      ok: false,
      detail: "The seed is published when the round resolves.",
    });
  } else {
    checks.push({
      label: "Seed revealed",
      ok: true,
      detail: `${seed.slice(0, 16)}… (${seed.length / 2} bytes)`,
    });

    if (record.seedCommitment) {
      const derived = commitSeed(seed);
      checks.push({
        label: "Matches the published commitment",
        ok: derived === record.seedCommitment.toLowerCase().replace(/^0x/, ""),
        detail: `sha256(seed) = ${derived.slice(0, 16)}…`,
      });
    }
  }

  if (seed && record.turns && record.game !== "zwanzig-ab") {
    for (const turn of record.turns) {
      try {
        const masks = turn.rerollMasks.slice(0, turn.rerollCount);
        let score: number;
        let ranking: number[];
        if (record.game === "horses") {
          const hand: HorsesTurn = playHorsesTurn(seed, record.round, turn.seat, masks);
          score = hand.matches;
          ranking = [...hand.ranking];
        } else {
          const ship: ShipCrewTurn = playShipCrewTurn(seed, record.round, turn.seat, masks);
          score = ship.cargoScore;
          ranking = [ship.cargoScore, 0, 0];
        }
        const scoreOk = score === turn.score;
        const rankOk = ranking.length === turn.ranking.length &&
          ranking.every((value, index) => value === turn.ranking[index]);
        checks.push({
          label: `Replay seat ${turn.seat} — ${scoreOk ? "pass" : "MISMATCH"}`,
          ok: scoreOk && rankOk,
          detail:
            `score ${score} (recorded ${turn.score})` + (scoreOk && !rankOk ? " · ranking differs" : ""),
        });
      } catch (cause) {
        checks.push({
          label: `Replay seat ${turn.seat}`,
          ok: false,
          detail: cause instanceof Error ? cause.message : "replay failed",
        });
      }
    }
  }

  return checks;
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
