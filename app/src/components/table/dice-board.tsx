"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices, Lock, RotateCcw, Hand, CheckCircle2 } from "lucide-react";
import type { RoomView } from "@wagerwake/shared/protocol";
import { evaluateHorses, describeHorsesHand } from "@wagerwake/shared";
import { useGameSocket } from "@/components/game-socket-provider";
import { Die } from "@/components/ui/die";
import { Countdown } from "./countdown";

const STAGE_COPY = [
  "Hunting the ship — you need a 6.",
  "Ship secured. Now find the captain — a 5.",
  "Captain aboard. Find the crew — a 4.",
  "Qualified. Every remaining die is cargo.",
];

export function DiceBoard({ room }: { room: RoomView }) {
  const { reroll, stand } = useGameSocket();
  const [selected, setSelected] = useState<number[]>([]);

  const dice = room.dice;
  const yourTurn = room.yourSeat !== null && room.currentSeat === room.yourSeat;
  const currentName =
    room.seats.find((seat) => seat.seat === room.currentSeat)?.name ?? "The table";
  const game = room.game;

  const rollSignature = `${room.round}:${room.currentSeat}:${dice?.rollsUsed ?? 0}:${dice?.dice.join("") ?? ""}`;
  useEffect(() => {
    setSelected([]);
  }, [rollSignature]);

  const mask = useMemo(
    () => selected.reduce((value, index) => value | (1 << index), 0),
    [selected],
  );

  const toggle = (index: number) => {
    if (!dice || !yourTurn) return;
    if (dice.locked[index]) return;
    setSelected((current) =>
      current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index],
    );
  };

  const horseHand =
    game === "horses" && dice
      ? (() => {
          try {
            return evaluateHorses(dice.dice, dice.rollsUsed);
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div className="panel-felt relative overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">{game === "horses" ? "Horses" : "Ship, Captain & Crew"}</p>
          <h2 className="mt-1 font-display text-2xl text-parchment-100">
            {yourTurn ? "Your roll" : room.currentSeat === null ? "Round complete" : `${currentName} is rolling`}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {room.turnDeadline ? (
            <Countdown deadline={room.turnDeadline} serverTime={room.serverTime} totalMs={room.turnTimeoutMs} />
          ) : null}
          <span className="chip">
            Round {room.round}
          </span>
        </div>
      </div>

      {game === "ship-captain-crew" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[6, 5, 4].map((face, index) => {
            const reached = (dice?.stage ?? 0) > index;
            return (
              <span
                key={face}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                  reached
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-parchment-200/45"
                }`}
              >
                {reached ? <CheckCircle2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {face === 6 ? "Ship" : face === 5 ? "Captain" : "Crew"} · {face}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="chip">Ones are wild</span>
          <span className="chip">
            Leader&apos;s call: {dice?.rollLimit ?? 3} roll{(dice?.rollLimit ?? 3) === 1 ? "" : "s"} max
          </span>
          {horseHand && dice?.rollsUsed ? (
            <span className="chip border-brass-400/40 bg-brass-500/10 text-brass-300">
              {describeHorsesHand(horseHand)}
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-8 flex min-h-[7rem] flex-wrap items-center justify-center gap-3 sm:gap-4">
        {dice ? (
          dice.dice.map((value, index) => (
            <Die
              key={`${index}-${value}`}
              value={value}
              size="lg"
              held={selected.includes(index)}
              selectable={yourTurn && dice.canReroll && !dice.locked[index]}
              muted={dice.locked[index] && yourTurn && game === "ship-captain-crew"}
              onClick={yourTurn ? () => toggle(index) : undefined}
            />
          ))
        ) : (
          <div className="text-center text-sm text-parchment-200/40">
            <Dices className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {room.phase === "resolved" ? "The round has been settled." : "Waiting for the next roll…"}
          </div>
        )}
      </div>

      {yourTurn && dice ? (
        <div className="mt-7 space-y-3">
          <p className="text-center text-xs leading-relaxed text-parchment-200/55">
            {game === "ship-captain-crew"
              ? STAGE_COPY[dice.stage] ?? STAGE_COPY[3]
              : "Select any dice to reroll, or stand on the hand you have. More matches wins; fewer rolls break the tie."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!dice.canReroll || mask === 0}
              onClick={() => reroll(mask)}
            >
              <RotateCcw className="h-4 w-4" />
              Reroll {selected.length > 0 ? `${selected.length} ${selected.length === 1 ? "die" : "dice"}` : "dice"}
              <span className="font-mono text-[10px] opacity-60">
                roll {dice.rollsUsed}/3
              </span>
            </button>
            <button type="button" className="btn-ghost" disabled={!dice.canStand} onClick={() => stand()}>
              <Hand className="h-4 w-4" /> Stand
            </button>
          </div>
          {game === "ship-captain-crew" && dice.qualified ? (
            <p className="text-center font-mono text-[10px] uppercase tracking-wider text-brass-300">
              Cargo {dice.cargoDice.join(" + ")} = {dice.cargoScore}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-7 text-center text-xs text-parchment-200/45">
          {room.currentSeat === null
            ? "Waiting for the round to be scored."
            : "Select dice and reroll when the turn reaches you."}
        </div>
      )}

      <div className="mt-8 border-t border-white/10 pt-4">
        <p className="label mb-2">Table rolls</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {room.seats.map((seat) => {
            const state = room.diceBySeat[seat.seat] ?? null;
            const done = seat.done || room.phase === "resolved";
            const hand =
              game === "horses" && state
                ? (() => {
                    try {
                      return evaluateHorses(state.dice, state.rollsUsed);
                    } catch {
                      return null;
                    }
                  })()
                : null;
            return (
              <div
                key={seat.seat}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                  room.currentSeat === seat.seat
                    ? "border-brass-400/40 bg-brass-500/[0.08]"
                    : "border-white/5 bg-ink-950/30"
                }`}
              >
                <span className="w-24 shrink-0 truncate text-xs text-parchment-200/60">
                  {seat.name}
                  {room.yourSeat === seat.seat ? " (you)" : ""}
                </span>
                <div className="flex flex-1 items-center gap-1">
                  {state && (done || room.currentSeat === seat.seat) ? (
                    state.dice.map((value, index) => (
                      <Die key={index} value={value} size="sm" muted={state.locked[index]} />
                    ))
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-parchment-200/25">
                      {seat.active ? "not rolled" : "out"}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-right font-mono text-[10px] leading-tight text-parchment-200/45">
                  {game === "ship-captain-crew"
                    ? state?.qualified
                      ? `${state.cargoScore} cargo`
                      : "no qual."
                    : hand
                      ? `${hand.matches}× ${hand.face}`
                      : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
