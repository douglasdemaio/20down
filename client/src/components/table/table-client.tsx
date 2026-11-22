import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Crown,
  Loader2,
  LogOut,
  MessageCircle,
  Play,
  QrCode,
  RotateCcw,
  Share2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { formatUsdc } from "@20down/shared";
import type { RoomView } from "@20down/shared/protocol";
import { useGameSocket } from "@/components/game-socket-provider";
import { ZwanzigBoard } from "./zwanzig-board";
import { SeatList } from "./seat-list";
import { ChatPanel } from "./chat-panel";
import { WagerPanel } from "./wager-panel";
import { RoundSummary, FairnessCard } from "./round-summary";

export function TableClient({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const { status, room, joinTable, leaveTable, setReady, startGame, createTable, chat } =
    useGameSocket();
  const joinAttempted = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    if (status !== "online") {
      joinAttempted.current = false;
      return;
    }
    if (room?.id === tableId) return;
    if (joinAttempted.current) return;
    joinAttempted.current = true;
    joinTable(tableId);
  }, [status, room?.id, tableId, joinTable]);

  useEffect(() => {
    if (room) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(timer);
  }, [room]);

  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}table/${room?.id ?? tableId}`;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setShowShare(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setShowShare(true);
    }
  };

  if (!room || room.id !== tableId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="panel p-8 text-center">
          {timedOut ? (
            <>
              <p className="font-display text-2xl text-parchment-100">Table unavailable</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-parchment-200/55">
                This table may be full, already in progress, or closed. Head back to the lobby and
                pick another seat.
              </p>
              <Link to="/" className="btn-primary mt-5">
                <ArrowLeft className="h-4 w-4" /> Back to the lobby
              </Link>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-brass-300" />
              <p className="mt-4 font-display text-xl text-parchment-100">Taking your seat…</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-parchment-200/35">
                {status === "online" ? `table ${tableId}` : "connecting to the game server"}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const yourSeat = room.seats.find((seat) => seat.seat === room.yourSeat) ?? null;
  const isHost = room.yourSeat === room.hostSeat;
  const deposited = Boolean(yourSeat?.ready);
  const playing = room.state !== "waiting";
  const canRematch = false;

  const leave = () => {
    if (room.mode === "wager" && deposited) return;
    leaveTable();
    navigate("/");
  };

  const newGame = () => {
    createTable(
      {
        game: room.game,
        mode: room.mode,
        stakeBaseUnits: room.stake ?? undefined,
        maxPlayers: room.maxPlayers,
        vsBots: room.seats.some((seat) => seat.isBot),
      },
      (tableId) => navigate(`/table/${tableId}`),
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="btn-quiet !px-2 !py-2" aria-label="Back to lobby">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="label flex items-center gap-1.5">
              {room.mode === "wager" ? (
                <>
                  <Wallet className="h-3 w-3" /> USDC table
                </>
              ) : (
                "Free table"
              )}
            </p>
            <h1 className="font-display text-2xl text-parchment-100 sm:text-3xl">
              {room.gameName}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {room.mode === "wager" && room.stake ? (
            <span className="chip border-coral-400/40 bg-coral-500/10 text-coral-400">
              {formatUsdc(room.stake)} USDC stake
            </span>
          ) : null}
          <span className={room.state === "waiting" ? "chip-live" : "chip"}>
            {stateLabel(room)}
          </span>
          <span className="chip">
            <Users className="h-3 w-3" /> {room.seats.length}/{room.maxPlayers}
          </span>
          <button type="button" className="btn-ghost !py-2 text-xs" onClick={share}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Share"}
          </button>
          {showShare ? (
            <button
              type="button"
              className="btn-quiet !px-2 !py-2 text-xs"
              onClick={() => setShowShare(false)}
              aria-label="Hide share QR code"
              title="Hide QR code"
            >
              <QrCode className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className="btn-quiet !py-2 text-xs"
            onClick={leave}
            disabled={room.mode === "wager" && deposited}
            title={
              room.mode === "wager" && deposited
                ? "Use Leave and refund in the escrow panel"
                : "Leave the table"
            }
          >
            <LogOut className="h-3.5 w-3.5" /> Leave
          </button>
        </div>
      </div>

      {room.notice ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-brass-400/25 bg-brass-500/[0.07] px-4 py-2.5 text-xs leading-relaxed text-brass-300">
          <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {room.notice}
        </div>
      ) : null}

      {showShare ? (
        <div className="mt-4 panel flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <div className="rounded-xl bg-white p-2">
            <QRCode value={shareUrl} size={132} bgColor="#ffffff" fgColor="#0a0c10" />
          </div>
          <div className="min-w-[14rem] flex-1">
            <p className="label flex items-center gap-1.5">
              <QrCode className="h-3 w-3" /> Invite link
            </p>
            <p className="mt-1 text-sm text-parchment-100">Scan to join this table</p>
            <p className="mt-2 break-all rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 font-mono text-[11px] text-parchment-200/70">
              {shareUrl}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost !py-2 text-xs" onClick={share}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                {copied ? "Link copied" : "Copy link"}
              </button>
              <button type="button" className="btn-quiet !py-2 text-xs" onClick={() => setShowShare(false)}>
                <X className="h-3.5 w-3.5" /> Hide
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {room.state === "voided" ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-parchment-200/60">
          This table was voided. Escrowed deposits are refundable from the escrow panel.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {room.phase === "lobby" || room.state === "waiting" ? (
            <WaitingRoom
              room={room}
              isHost={isHost}
              deposited={deposited}
              onReady={() => setReady(!yourSeat?.ready)}
              onStart={() => startGame()}
              onShare={share}
              copied={copied}
            />
          ) : room.state === "starting" ? (
            <div className="panel-felt flex flex-col items-center gap-3 p-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-brass-300" />
              <p className="font-display text-2xl text-parchment-100">Dealing in…</p>
              <p className="text-xs text-parchment-200/45">
                {room.mode === "wager" ? "Starting the on-chain game." : "Shuffling the deck."}
              </p>
            </div>
          ) : (
            <ZwanzigBoard room={room} />
          )}

          {room.lastRound ? <RoundSummary room={room} /> : null}

          {playing && room.state === "resolved" ? (
            <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="text-xs text-parchment-200/55">
                {canRematch
                  ? "Round settled. Stay at the table for another round."
                  : "This table has finished. Start another one whenever you are ready."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`${canRematch ? "btn-ghost" : "btn-primary"} py-2.5 text-xs`}
                  onClick={newGame}
                >
                  <RotateCcw className="h-4 w-4" /> New game
                </button>
                <Link to="/" className="btn-ghost py-2.5 text-xs">
                  Back to lobby
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          {room.mode === "wager" ? <WagerPanel room={room} /> : null}

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <p className="label">Players</p>
              <span className="font-mono text-[10px] text-parchment-200/35">
                {room.seats.length}/{room.maxPlayers} seated
              </span>
            </div>
            <SeatList room={room} />
            {room.hostSeat === room.yourSeat && room.state === "waiting" ? (
              <p className="border-t border-white/5 px-4 py-2 text-[10px] text-parchment-200/35">
                You are the host. Start unlocks when every seat is ready.
              </p>
            ) : null}
          </div>

          <FairnessCard room={room} />

          <div className="panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <MessageCircle className="h-3.5 w-3.5 text-brass-300" />
              <p className="label">Table chat</p>
            </div>
            <ChatPanel chat={chat} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function WaitingRoom({
  room,
  isHost,
  deposited,
  onReady,
  onStart,
  onShare,
  copied,
}: {
  room: RoomView;
  isHost: boolean;
  deposited: boolean;
  onReady: () => void;
  onStart: () => void;
  onShare: () => void;
  copied: boolean;
}) {
  const yourSeat = room.seats.find((seat) => seat.seat === room.yourSeat) ?? null;
  const readyCount = room.seats.filter((seat) => seat.ready || seat.isBot).length;
  const allReady = readyCount === room.seats.length;
  const enoughPlayers = room.seats.length >= room.minPlayers;
  const canStart = isHost && allReady && enoughPlayers;

  return (
    <div className="panel-felt relative overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Waiting room</p>
          <h2 className="mt-1 font-display text-3xl text-parchment-100">
            {room.mode === "wager" ? "Fund your seat" : "Ready when you are"}
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-parchment-200/55">
            {room.mode === "wager"
              ? `Each seat deposits ${room.stake ? formatUsdc(room.stake) : "—"} USDC plus the fee. The game starts as soon as every player has deposited.`
              : "Share the table link to invite friends, or let the bots fill the seats. The game starts when everyone is ready."}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-950/50 px-4 py-3 text-center">
          <p className="font-display text-3xl text-brass-300">
            {readyCount}
            <span className="text-base text-parchment-200/35">/{room.maxPlayers}</span>
          </p>
          <p className="label mt-1">ready</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="stat">
          <p className="label">Players</p>
          <p className="mt-1 text-sm text-parchment-100">
            {room.seats.length} seated · min {room.minPlayers}
          </p>
        </div>
        <div className="stat">
          <p className="label">Mode</p>
          <p className="mt-1 text-sm text-parchment-100">
            {room.mode === "wager" ? `${room.stake ? formatUsdc(room.stake) : "—"} USDC wager` : "Free play"}
          </p>
        </div>
        <div className="stat">
          <p className="label">Table code</p>
          <p className="mt-1 truncate font-mono text-xs text-parchment-200/65">{room.id}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {room.mode === "free" && yourSeat ? (
          <button
            type="button"
            className={yourSeat.ready ? "btn-ghost" : "btn-primary"}
            onClick={onReady}
          >
            <Check className="h-4 w-4" /> {yourSeat.ready ? "Not ready" : "I'm ready"}
          </button>
        ) : null}

        {room.mode === "wager" && yourSeat ? (
          <span
            className={`chip ${
              deposited ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""
            }`}
          >
            {deposited ? "Deposit confirmed" : "Use the escrow panel to deposit"}
          </span>
        ) : null}

        <button type="button" className="btn-ghost" onClick={onShare}>
          {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {copied ? "Link copied" : "Invite players"}
        </button>

        {isHost ? (
          <button type="button" className="btn-coral" disabled={!canStart} onClick={onStart}>
            <Play className="h-4 w-4" />
            {canStart
              ? "Start the game"
              : !enoughPlayers
                ? `Need ${room.minPlayers - room.seats.length} more player${room.minPlayers - room.seats.length === 1 ? "" : "s"}`
                : "Waiting for ready"}
          </button>
        ) : null}
      </div>

      {room.mode === "free" && !isHost ? (
        <p className="mt-3 text-[10px] text-parchment-200/35">
          The host starts the game once every seat is ready.
        </p>
      ) : null}
    </div>
  );
}

function stateLabel(room: RoomView): string {
  switch (room.state) {
    case "waiting":
      return "waiting";
    case "starting":
      return "starting";
    case "ante":
      return "re-ante";
    case "voided":
      return "voided";
    case "resolved":
      return "settled";
    default:
      return room.phase === "play" ? "in play" : room.phase;
  }
}
