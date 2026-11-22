"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Hand, Heart, LogOut, Sparkles, HelpCircle } from "lucide-react";
import {
  MAX_EXCHANGE,
  SUIT_SYMBOL,
  cardId,
  type Suit,
} from "@20down/shared";
import type { RoomView } from "@20down/shared/protocol";
import { useGameSocket } from "@/components/game-socket-provider";
import { CardBack, PlayingCard } from "@/components/ui/playing-card";
import { Countdown } from "./countdown";

const SUITS: Suit[] = ["clubs", "spades", "hearts", "diamonds"];
const SUIT_NAME: Record<Suit, string> = {
  clubs: "Clubs",
  spades: "Spades",
  hearts: "Hearts",
  diamonds: "Diamonds",
};

export function ZwanzigBoard({ room }: { room: RoomView }) {
  const { chooseTrump, exchange, announce, playCard, nextDeal } = useGameSocket();
  const view = room.zwanzig;
  const [selected, setSelected] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  const seatKey = view ? `${view.dealNumber}:${view.currentActor}:${view.phase}` : "none";
  useEffect(() => setSelected([]), [seatKey]);

  if (!view) {
    return (
      <div className="panel-felt p-8 text-center text-sm text-parchment-200/50">
        Taking a seat at the card table…
      </div>
    );
  }

  const seatName = (seat: number | null) =>
    seat === null ? "—" : (room.seats.find((entry) => entry.seat === seat)?.name ?? `Seat ${seat + 1}`);
  const yourTurn = view.currentActor === view.seat;
  const exchangeBudget = MAX_EXCHANGE - (view.exchangesUsed[view.seat] ?? 0);
  const hand = view.hand;
  const legal = new Set(view.legalCards);
  const sortedHand = useMemo(() => sortHand(hand), [hand]);

  const toggleCard = (id: string) => {
    if (!yourTurn || view.phase !== "exchange" || view.exchangesUsed[view.seat]! > 0) return;
    setSelected((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (current.length >= exchangeBudget) return current;
      return [...current, id];
    });
  };

  const winner = view.winner;

  return (
    <div className="space-y-4">
      <div className="panel-felt relative overflow-hidden p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Zwanzig ab · 20 Down</p>
            <h2 className="mt-1 font-display text-2xl text-parchment-100">
              {view.phase === "game-over"
                ? `${seatName(winner)} wins the game`
                : view.phase === "deal-scored"
                  ? "Deal scored"
                  : yourTurn
                    ? "Your move"
                    : `${seatName(view.currentActor)} to act`}
            </h2>
            <p className="mt-1 text-xs text-parchment-200/50">
              Deal {view.dealNumber} · {view.playerCount} players ·{" "}
              {view.forcedHearts ? "hearts forced (doubled)" : view.trump ? `${SUIT_NAME[view.trump]} trump${view.trump === "hearts" ? " (doubled)" : ""}` : "trump not chosen"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {room.turnDeadline ? (
              <Countdown
                deadline={room.turnDeadline}
                serverTime={room.serverTime}
                totalMs={room.turnTimeoutMs}
                label={view.phase === "deal-scored" ? "Review clock" : "Turn clock"}
              />
            ) : null}
            <span className={view.trump === "hearts" ? "chip-warn" : "chip"}>
              {view.trump ? `${SUIT_SYMBOL[view.trump]} ${SUIT_NAME[view.trump]}` : "no trump"}
            </span>
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="rounded-full border border-white/15 bg-white/5 p-2 text-parchment-200/70 transition hover:border-brass-400/50 hover:text-parchment-100"
              aria-label="How to play"
              title="How to play"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showHelp ? (
          <div className="mt-4 rounded-xl border border-brass-400/30 bg-brass-500/[0.06] p-4 text-xs leading-relaxed text-parchment-200/70">
            <p>
              <strong className="text-parchment-100">Goal:</strong> Be the first to reach 0 points
              or less. Start at 20; each trick you win is −1. Win no tricks and you get +5. Hearts
              trump doubles all changes. Follow suit if you can, otherwise play a trump. The
              lowest score wins — most negative breaks ties.
            </p>
          </div>
        ) : null}

        {view.trump ? (
          <div
            className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
              view.trump === "hearts"
                ? "border-coral-400/60 bg-coral-500/[0.12]"
                : view.trump === "diamonds"
                  ? "border-brass-400/60 bg-brass-500/[0.12]"
                  : "border-brass-400/40 bg-brass-500/[0.08]"
            }`}
          >
            <span
              className={`font-display text-4xl leading-none ${
                view.trump === "hearts" || view.trump === "diamonds"
                  ? "text-red-300"
                  : "text-parchment-100"
              }`}
              aria-hidden
            >
              {SUIT_SYMBOL[view.trump]}
            </span>
            <div>
              <p className="label">Trump suit</p>
              <p className="font-display text-lg leading-tight text-parchment-100">
                {SUIT_NAME[view.trump]}
                {view.trump === "hearts" ? " — doubled" : ""}
              </p>
            </div>
            <p className="ml-auto max-w-xs text-[11px] leading-relaxed text-parchment-200/55">
              {view.trump === "hearts"
                ? "Every score change is doubled while hearts are trump."
                : view.trump === "diamonds"
                  ? "Diamonds are trump — everyone must play this deal."
                  : `Highest ${SUIT_NAME[view.trump]} wins the trick.`}
            </p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {view.scores.map((score, seat) => {
            const isYou = seat === view.seat;
            const out = !view.inHand[seat];
            const announced = view.announces[seat];
            const winning = winner === seat;
            return (
              <div
                key={seat}
                className={`rounded-xl border px-3 py-2.5 ${
                  winning
                    ? "border-brass-400 bg-brass-500/15"
                    : view.currentActor === seat
                      ? "border-brass-400/50 bg-brass-500/[0.07]"
                      : "border-white/10 bg-ink-950/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm text-parchment-100">
                    <span className="truncate">{seatName(seat)}</span>
                    {isYou ? <span className="chip !px-1.5 !py-0 !text-[8px] text-emerald-200">you</span> : null}
                    {winning ? <Crown className="h-3.5 w-3.5 text-brass-400" /> : null}
                  </p>
                  <span className={`font-display text-xl ${score <= 0 ? "text-brass-300" : "text-parchment-100"}`}>
                    {score}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[10px] text-parchment-200/40">
                  {out ? (
                    <span className="text-coral-400/80">dropped out</span>
                  ) : (
                    <span>
                      {view.tricksWon[seat]} trick{view.tricksWon[seat] === 1 ? "" : "s"}
                      {view.exchangesUsed[seat] > 0 ? ` · swapped ${view.exchangesUsed[seat]}` : ""}
                    </span>
                  )}
                  {announced === false ? <span>· passed</span> : null}
                  {announced === true ? <span>· playing</span> : null}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-ink-950/40 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="label">
              Trick {view.trickNumber} of 5
              {view.trick?.ledSuit ? ` · ${SUIT_NAME[view.trick.ledSuit]} led` : " · awaiting lead"}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-parchment-200/35">
              {view.declarer === view.seat ? "you are declarer" : `${seatName(view.declarer)} declared`}
            </p>
          </div>

          <div className="mt-4 flex min-h-[9rem] flex-wrap items-center justify-center gap-3">
            {view.trick && view.trick.cards.length > 0 ? (
              view.trick.cards.map((entry) => (
                <div key={`${entry.seat}-${cardId(entry.card)}`} className="text-center">
                  <PlayingCard card={entry.card} trump={entry.card.suit === view.trump} />
                  <p className="mt-1 max-w-[4.5rem] truncate font-mono text-[9px] uppercase tracking-wider text-parchment-200/45">
                    {seatName(entry.seat)}
                  </p>
                </div>
              ))
            ) : view.phase === "play" ? (
              <p className="text-xs text-parchment-200/40">
                {seatName(view.trick?.leader ?? view.declarer)} leads the trick.
              </p>
            ) : (
              <div className="flex items-center gap-2 text-parchment-200/30">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs">The table waits for the first card.</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="label">Your hand</p>
            <p className="text-[10px] text-parchment-200/35">
              {view.phase === "play" && yourTurn
                ? `${legal.size} legal card${legal.size === 1 ? "" : "s"}`
                : view.phase === "exchange"
                  ? `${exchangeBudget} swap${exchangeBudget === 1 ? "" : "s"} left`
                  : "5 cards"}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {sortedHand.map((card) => {
              const id = cardId(card);
              const isLegal = legal.has(id);
              const isSelected = selected.includes(id);
              const selectable =
                yourTurn && view.phase === "exchange" && view.exchangesUsed[view.seat] === 0;
              const playable = yourTurn && view.phase === "play" && isLegal;
              return (
                <PlayingCard
                  key={id}
                  card={card}
                  trump={card.suit === view.trump}
                  selected={isSelected}
                  dimmed={view.phase === "play" && yourTurn && !isLegal}
                  onClick={
                    selectable
                      ? () => toggleCard(id)
                      : playable
                        ? () => playCard(id)
                        : undefined
                  }
                />
              );
            })}
          </div>
        </div>

        <ActionPanel
          view={view}
          yourTurn={yourTurn}
          selected={selected}
          exchangeBudget={exchangeBudget}
          seatName={seatName}
          onChooseTrump={chooseTrump}
          onExchange={() => {
            exchange(selected);
            setSelected([]);
          }}
          onAnnounce={announce}
          onNextDeal={nextDeal}
        />
      </div>

      <div className="panel p-4">
        <p className="label mb-3">At the table</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {view.handCounts.map((count, seat) => (
            <div
              key={seat}
              className={`rounded-xl border px-3 py-2 ${
                view.currentActor === seat ? "border-brass-400/40 bg-brass-500/[0.07]" : "border-white/5 bg-ink-950/30"
              }`}
            >
              <p className="truncate text-xs text-parchment-200/65">{seatName(seat)}</p>
              <div className="mt-1.5 flex items-center gap-1">
                {Array.from({ length: count }, (_, index) => (
                  <CardBack key={index} size="sm" />
                ))}
                {count === 0 ? (
                  <span className="text-[10px] text-parchment-200/25">no cards</span>
                ) : null}
              </div>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-parchment-200/35">
                {view.inHand[seat] ? "in the deal" : "dropped out"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {view.phase === "deal-scored" && view.lastDealDeltas ? (
        <div className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label">Deal {view.dealNumber} result</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {view.lastDealDeltas.map((delta, seat) => (
                  <span
                    key={seat}
                    className={`chip ${
                      delta < 0 ? "border-emerald-400/30 text-emerald-200" : delta > 0 ? "border-coral-400/30 text-coral-400" : ""
                    }`}
                  >
                    {seatName(seat)} {delta > 0 ? `+${delta}` : delta}
                  </span>
                ))}
              </div>
            </div>
            <button type="button" className="btn-ghost" onClick={nextDeal}>
              Next deal →
            </button>
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="label">Hands won this deal</p>
            <p className="mt-1 text-[10px] text-parchment-200/40">
              The winning card is outlined in green — check a trick to confirm who took it.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {view.scores.map((_, seat) => {
                const tricks = view.trickHistory.filter(
                  (trick) => trick.deal === view.dealNumber && trick.winner === seat,
                );
                return (
                  <div key={seat} className="rounded-xl border border-white/10 bg-ink-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-parchment-100">
                        {seatName(seat)}
                        {seat === view.seat ? (
                          <span className="ml-1.5 font-normal text-emerald-300">you</span>
                        ) : null}
                      </p>
                      <span className="shrink-0 font-mono text-[10px] text-parchment-200/40">
                        {tricks.length} trick{tricks.length === 1 ? "" : "s"} won
                      </span>
                    </div>
                    {tricks.length ? (
                      <div className="mt-3 space-y-3">
                        {tricks.map((trick) => (
                          <div key={`${trick.deal}-${trick.trick}`}>
                            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-parchment-200/40">
                              Trick {trick.trick}
                              {trick.ledSuit ? ` · ${SUIT_NAME[trick.ledSuit]} led` : ""}
                            </p>
                            <div className="flex flex-wrap items-end gap-1.5">
                              {trick.cards.map((entry) => (
                                <div key={`${entry.seat}-${cardId(entry.card)}`} className="text-center">
                                  <PlayingCard
                                    card={entry.card}
                                    size="sm"
                                    won={entry.seat === trick.winner}
                                    trump={entry.card.suit === view.trump}
                                  />
                                  <p
                                    className={`mt-1 max-w-[2.75rem] truncate text-[8px] ${
                                      entry.seat === trick.winner
                                        ? "font-semibold text-emerald-300"
                                        : "text-parchment-200/40"
                                    }`}
                                  >
                                    {seatName(entry.seat)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] text-parchment-200/35">No tricks won.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionPanel({
  view,
  yourTurn,
  selected,
  exchangeBudget,
  seatName,
  onChooseTrump,
  onExchange,
  onAnnounce,
  onNextDeal,
}: {
  view: NonNullable<RoomView["zwanzig"]>;
  yourTurn: boolean;
  selected: string[];
  exchangeBudget: number;
  seatName: (seat: number | null) => string;
  onChooseTrump: (suit: Suit) => void;
  onExchange: () => void;
  onAnnounce: (play: boolean) => void;
  onNextDeal: () => void;
}) {
  if (view.phase === "game-over") {
    return (
      <div className="mt-5 rounded-xl border border-brass-400/40 bg-brass-500/10 px-4 py-3 text-center">
        <p className="font-display text-xl text-brass-300">
          {seatName(view.winner)} reached zero first
        </p>
        <p className="mt-1 text-xs text-parchment-200/55">
          Lowest score wins. Start a new table from the lobby to play another game.
        </p>
      </div>
    );
  }

  if (view.phase === "deal-scored") {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3">
        <p className="text-xs text-parchment-200/55">
          Take your time reviewing the hands won. The next deal begins when the review clock runs
          out — use Deal now to start early.
        </p>
        <button type="button" className="btn-ghost" onClick={onNextDeal}>
          Deal now
        </button>
      </div>
    );
  }

  if (view.phase === "trump") {
    if (!yourTurn) {
      return (
        <p className="mt-5 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3 text-center text-xs text-parchment-200/50">
          {seatName(view.currentActor)} is choosing trump.
        </p>
      );
    }
    return (
      <div className="mt-5 rounded-xl border border-brass-400/30 bg-brass-500/[0.06] p-3">
        <p className="label mb-2">Choose trump — you are declarer</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SUITS.map((suit) => (
            <button
              key={suit}
              type="button"
              onClick={() => onChooseTrump(suit)}
              className={`btn justify-between border-white/15 bg-ink-950/60 text-parchment-100 hover:border-brass-400/60 ${
                suit === "hearts" || suit === "diamonds" ? "text-red-300" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-xl leading-none">{SUIT_SYMBOL[suit]}</span>
                {SUIT_NAME[suit]}
              </span>
              {suit === "hearts" ? <Heart className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-parchment-200/40">
          Hearts doubles every score change. Diamonds forces everyone to play. You cannot drop out
          of the deal as declarer.
        </p>
      </div>
    );
  }

  if (view.phase === "exchange") {
    if (!yourTurn) {
      return (
        <p className="mt-5 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3 text-center text-xs text-parchment-200/50">
          {seatName(view.currentActor)} is swapping or announcing.
        </p>
      );
    }
    const swapped = view.exchangesUsed[view.seat] ?? 0;
    return (
      <div className="mt-5 rounded-xl border border-brass-400/30 bg-brass-500/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label">
            {swapped > 0 ? "Hand set — announce your intention" : "Swap up to three cards, then announce"}
          </p>
          <p className="text-[10px] text-parchment-200/40">
            {swapped > 0 ? `${swapped} swapped` : `${selected.length}/${exchangeBudget} selected`}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {swapped === 0 ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={selected.length === 0}
              onClick={onExchange}
            >
              <Sparkles className="h-4 w-4" />
              Exchange {selected.length > 0 ? `${selected.length} card${selected.length === 1 ? "" : "s"}` : "cards"}
            </button>
          ) : null}
          <button type="button" className="btn-primary" onClick={() => onAnnounce(true)}>
            <Hand className="h-4 w-4" /> Play this deal
          </button>
          <button
            type="button"
            className="btn-quiet border border-white/10"
            disabled={!view.canDropOut}
            onClick={() => onAnnounce(false)}
            title={view.canDropOut ? "Sit this deal out" : "You must play this deal"}
          >
            <LogOut className="h-4 w-4" /> Drop out
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-parchment-200/40">
          {view.canDropOut
            ? "Dropping out costs nothing. Play and win tricks to shed points; take no tricks and you add five."
            : view.forcedHearts
              ? "Hearts is forced after eight deals — everyone must play."
              : view.trump === "diamonds"
                ? "Diamonds are trump — everyone must play this deal."
                : "You are the declarer and must play this deal."}
        </p>
      </div>
    );
  }

  if (view.phase === "play") {
    if (!yourTurn) {
      return (
        <p className="mt-5 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3 text-center text-xs text-parchment-200/50">
          {seatName(view.currentActor)} is playing a card.
        </p>
      );
    }
    return (
      <p className="mt-5 rounded-xl border border-brass-400/30 bg-brass-500/[0.06] px-4 py-3 text-center text-xs text-parchment-200/65">
        Your lead. {view.legalCards.length === view.hand.length
          ? "Play any card in your hand."
          : "Follow suit if you can — otherwise play a trump, or any card if you have neither."}
      </p>
    );
  }

  return null;
}

const SUIT_ORDER: Record<Suit, number> = { clubs: 0, spades: 1, hearts: 2, diamonds: 3 };

function sortHand(hand: NonNullable<RoomView["zwanzig"]>["hand"]) {
  return [...hand].sort((a, b) => {
    const suit = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suit !== 0) return suit;
    const strength = (rank: number) => (rank === 14 ? 8 : rank === 10 ? 7 : rank === 13 ? 6 : rank === 12 ? 5 : rank === 11 ? 4 : rank === 9 ? 3 : rank === 8 ? 2 : 1);
    return strength(b.rank) - strength(a.rank);
  });
}
