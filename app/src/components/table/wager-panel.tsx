"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { formatUsdc } from "@20down/shared";
import type { RoomView } from "@20down/shared/protocol";
import { useGameSocket } from "@/components/game-socket-provider";
import { useCompliance } from "@/components/compliance-provider";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/config";
import { submitWagerTransaction } from "@/lib/wager";
import { Countdown } from "./countdown";

export function WagerPanel({ room }: { room: RoomView }) {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const { addSpend, remainingUsdc, limitReached } = useCompliance();
  const { markDeposited, leaveTable } = useGameSocket();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stake = room.stake ? BigInt(room.stake) : 0n;
  const fee = room.fee ? BigInt(room.fee) : 0n;
  const deposit = stake + fee;
  const yourSeat = room.seats.find((seat) => seat.seat === room.yourSeat) ?? null;
  const deposited = Boolean(yourSeat?.ready);
  const tablePda = room.chain?.tablePda ?? null;
  const wallet = publicKey?.toBase58() ?? null;

  const run = async (kind: "join" | "ante" | "leave") => {
    setError(null);
    if (!wallet) {
      setError("Connect a wallet first.");
      return;
    }
    if (!tablePda) {
      setError("The on-chain table is still being created. Try again in a moment.");
      return;
    }
    if (!signTransaction) {
      setError("This wallet does not support transaction signing.");
      return;
    }
    const amount = kind === "ante" ? stake : deposit;
    if (Number(amount) > remainingUsdc) {
      setError(
        `That deposit would exceed your session loss limit ($${remainingUsdc.toFixed(2)} left).`,
      );
      return;
    }

    setBusy(kind);
    try {
      const signer = signTransaction as (transaction: Transaction) => Promise<Transaction>;
      const result = await submitWagerTransaction({
        kind,
        tablePda,
        player: wallet,
        signTransaction: signer,
      });
      if (kind === "leave") {
        leaveTable();
        router.push("/");
        return;
      }
      addSpend(Number(amount) / 1_000_000);
      markDeposited(result.signature);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transaction failed.");
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/table/${room.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-coral-500/[0.07] px-4 py-3">
        <div>
          <p className="label text-coral-400/80">USDC escrow</p>
          <p className="mt-0.5 font-display text-lg text-parchment-100">
            {formatUsdc(stake)} <span className="text-xs text-parchment-200/45">stake + {formatUsdc(fee)} fee</span>
          </p>
        </div>
        <span className="chip-warn">devnet</span>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <div className="stat">
          <p className="label">Stake pot</p>
          <p className="mt-1 font-mono text-sm text-brass-300">{formatUsdc(room.potStakes)} USDC</p>
        </div>
        <div className="stat">
          <p className="label">Fee pot</p>
          <p className="mt-1 font-mono text-sm text-parchment-200/70">{formatUsdc(room.potFees)} USDC</p>
        </div>
      </div>

      {room.state === "ante" && room.anteDeadline ? (
        <div className="mx-3 mb-3 rounded-lg border border-coral-400/30 bg-coral-500/10 px-3 py-2">
          <p className="flex items-center justify-between text-xs text-coral-400">
            <span className="font-semibold">Tie — re-ante to stay in</span>
            <Countdown
              deadline={room.anteDeadline}
              serverTime={room.serverTime}
              totalMs={60_000}
            />
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-parchment-200/55">
            Everyone re-antes the same stake. Players who do not re-ante forfeit their share of
            the pot to the players who do.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 px-3 pb-3">
        {!wallet ? (
          <p className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2 text-xs text-parchment-200/55">
            <Wallet className="h-3.5 w-3.5" /> Connect a wallet from the header to take a wager seat.
          </p>
        ) : null}

        {room.state === "waiting" && !deposited && room.yourSeat !== null ? (
          <>
            <button
              type="button"
              className="btn-coral w-full"
              disabled={!tablePda || !wallet || busy !== null || limitReached}
              onClick={() => void run("join")}
            >
              {busy === "join" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Deposit {formatUsdc(deposit)} USDC
            </button>
            <p className="text-center text-[10px] leading-relaxed text-parchment-200/40">
              {formatUsdc(stake)} stake + {formatUsdc(fee)} platform fee. The fee goes to the
              treasury once, when the game settles.
            </p>
            {limitReached ? (
              <p className="flex items-center gap-1.5 text-[10px] text-coral-400">
                <AlertTriangle className="h-3 w-3" /> Session loss limit reached.
              </p>
            ) : null}
          </>
        ) : null}

        {room.state === "waiting" && deposited ? (
          <>
            <p className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" /> Deposit confirmed. Waiting for the table to fill.
            </p>
            <button type="button" className="btn-ghost w-full" disabled={busy !== null} onClick={share}>
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Link copied" : "Copy table link"}
            </button>
            <button
              type="button"
              className="btn-quiet w-full"
              disabled={busy !== null}
              onClick={() => void run("leave")}
            >
              {busy === "leave" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Leave and refund
            </button>
          </>
        ) : null}

        {room.state === "ante" && room.yourSeat !== null && yourSeat?.active && !yourSeat.anted ? (
          <button
            type="button"
            className="btn-coral w-full"
            disabled={!tablePda || busy !== null}
            onClick={() => void run("ante")}
          >
            {busy === "ante" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Re-ante {formatUsdc(stake)} USDC
          </button>
        ) : null}

        {room.state === "ante" && yourSeat?.anted ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" /> Re-ante confirmed.
          </p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-coral-400/30 bg-coral-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-coral-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
          </p>
        ) : null}
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <p className="label mb-2 flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" /> On-chain state
        </p>
        <dl className="space-y-1.5 text-[10px]">
          <Row label="Status" value={room.chain?.status ?? "off"} />
          <Row
            label="Table"
            value={
              tablePda ? (
                <a
                  href={explorerAddressUrl(tablePda)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-brass-300 hover:text-brass-400"
                >
                  {short(tablePda)} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : (
                "creating…"
              )
            }
          />
          <Row
            label="Escrow"
            value={
              room.chain?.escrowPda ? (
                <a
                  href={explorerAddressUrl(room.chain.escrowPda)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-brass-300 hover:text-brass-400"
                >
                  {short(room.chain.escrowPda)} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="Last tx"
            value={
              room.chain?.lastSignature ? (
                <a
                  href={explorerTxUrl(room.chain.lastSignature)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-brass-300 hover:text-brass-400"
                >
                  {short(room.chain.lastSignature)} <ArrowUpRight className="h-2.5 w-2.5" />
                </a>
              ) : (
                "—"
              )
            }
          />
        </dl>
        {room.verifyUrl ? (
          <Link href={room.verifyUrl} className="btn-quiet mt-2 w-full py-1.5 text-[10px]">
            Verify this round
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-parchment-200/35">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-parchment-200/65">{value}</dd>
    </div>
  );
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
