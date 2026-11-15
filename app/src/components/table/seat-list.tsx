"use client";

import { Bot, Check, CircleDashed, Crown, Dot, Wallet } from "lucide-react";
import type { RoomView } from "@wagerwake/shared/protocol";

export function SeatList({ room }: { room: RoomView }) {
  return (
    <ul className="divide-y divide-white/5">
      {room.seats.map((seat) => {
        const you = room.yourSeat === seat.seat;
        const turn = room.currentSeat === seat.seat;
        const status =
          room.state === "waiting"
            ? seat.isBot
              ? "Bot · ready"
              : room.mode === "wager"
                ? seat.ready
                  ? "Deposited"
                  : "Awaiting deposit"
                : seat.ready
                  ? "Ready"
                  : "Waiting"
            : !seat.active
              ? "Out of round"
              : turn
                ? "Playing"
                : seat.done
                  ? "Done"
                  : "Waiting";

        return (
          <li
            key={seat.seat}
            className={`flex items-center gap-3 px-4 py-2.5 ${
              turn ? "bg-brass-500/[0.07]" : ""
            }`}
          >
            <span
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                turn
                  ? "border-brass-400 bg-brass-500/20 text-brass-300"
                  : you
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-parchment-200/70"
              }`}
            >
              {seat.isBot ? <Bot className="h-4 w-4" /> : initials(seat.name)}
              {turn ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-brass-400" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm text-parchment-100">
                <span className="truncate">{seat.name}</span>
                {you ? <span className="chip !px-1.5 !py-0 !text-[8px] text-emerald-200">you</span> : null}
                {room.hostSeat === seat.seat ? <Crown className="h-3 w-3 text-brass-400" /> : null}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-parchment-200/40">
                {status}
                {seat.wallet ? (
                  <>
                    <Dot className="h-2.5 w-2.5" />
                    <Wallet className="h-2.5 w-2.5" />
                    {seat.wallet.slice(0, 4)}…{seat.wallet.slice(-4)}
                  </>
                ) : null}
              </p>
            </div>
            <StatusGlyph
              state={room.state}
              ready={seat.ready}
              done={seat.done}
              anted={seat.anted}
            />
          </li>
        );
      })}
    </ul>
  );
}

function StatusGlyph({
  state,
  ready,
  done,
  anted,
}: {
  state: RoomView["state"];
  ready: boolean;
  done: boolean;
  anted: boolean;
}) {
  if (state === "waiting") {
    return ready ? (
      <Check className="h-4 w-4 text-emerald-300" />
    ) : (
      <CircleDashed className="h-4 w-4 text-parchment-200/30" />
    );
  }
  if (done) return <Check className="h-4 w-4 text-emerald-300" />;
  if (state === "ante") {
    return anted ? (
      <Check className="h-4 w-4 text-emerald-300" />
    ) : (
      <CircleDashed className="h-4 w-4 text-coral-400/70" />
    );
  }
  return <CircleDashed className="h-4 w-4 text-parchment-200/25" />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}
