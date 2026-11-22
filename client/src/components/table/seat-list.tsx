import { Bot, Check, CircleDashed, Crown, Wallet } from "lucide-react";
import type { RoomView } from "@20down/shared/protocol";

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
            className={`flex items-center gap-3 px-4 py-3 ${
              turn ? "bg-brass-500/[0.06]" : you ? "bg-white/[0.02]" : ""
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                you
                  ? "border-brass-400/70 bg-brass-500/15 text-brass-300"
                  : "border-white/10 bg-white/5 text-parchment-200/60"
              }`}
            >
              {seat.seat + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm text-parchment-100">
                {seat.name}
                {you ? <span className="font-mono text-[9px] text-emerald-300">you</span> : null}
                {seat.seat === room.hostSeat ? <Crown className="h-3 w-3 text-brass-400" /> : null}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-parchment-200/40">
                {seat.isBot ? <Bot className="h-3 w-3" /> : null}
                {seat.wallet ? <Wallet className="h-3 w-3" /> : null}
                {status}
              </p>
            </div>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                seat.connected ? "bg-emerald-400/80" : "bg-parchment-200/20"
              }`}
              title={seat.connected ? "Connected" : "Disconnected"}
            />
            {room.state === "waiting" && seat.ready ? (
              <Check className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <CircleDashed className="h-3.5 w-3.5 text-parchment-200/20" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
