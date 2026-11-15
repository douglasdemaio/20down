"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowRight,
  Bot,
  Check,
  Coins,
  Crown,
  Dices,
  Info,
  RefreshCw,
  Spade,
  Users,
  Wallet,
} from "lucide-react";
import {
  GAME_IDS,
  GAMES,
  PLATFORM_FEE_PER_PLAYER_BASE_UNITS,
  formatUsdc,
  type GameId,
  type PlayMode,
} from "@wagerwake/shared";
import { useGameSocket } from "@/components/game-socket-provider";
import { useMode } from "@/components/mode-provider";
import { useCompliance } from "@/components/compliance-provider";
import { Die } from "@/components/ui/die";
import { CardBack, PlayingCard } from "@/components/ui/playing-card";

const STAKES = [10_000n, 20_000n, 50_000n, 100_000n, 250_000n, 500_000n, 1_000_000n];

export function LobbyClient() {
  const router = useRouter();
  const { mode } = useMode();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { accepted, remainingUsdc, limitReached, state } = useCompliance();
  const {
    status,
    lobby,
    room,
    name,
    setName,
    createTable,
    joinTable,
    refreshLobby,
  } = useGameSocket();

  const [draftName, setDraftName] = useState(name);
  const pendingCreateRef = useRef(false);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => setDraftName(name), [name]);

  useEffect(() => {
    if (!room || !pendingCreateRef.current) return;
    pendingCreateRef.current = false;
    router.push(`/table/${room.id}`);
  }, [room, router]);

  useEffect(() => {
    if (status === "online") refreshLobby();
  }, [status, refreshLobby]);

  const tables = lobby.filter((table) => table.mode === mode);
  const openSeats = tables.reduce((sum, table) => sum + table.seats, 0);

  const commitName = () => {
    const clean = draftName.trim();
    if (!clean) {
      setDraftName(name);
      return;
    }
    if (clean !== name) setName(clean);
  };

  const join = (tableId: string) => {
    setJoining(tableId);
    joinTable(tableId);
    router.push(`/table/${tableId}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 px-5 py-8 shadow-card sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(212,168,79,0.14),transparent_45%),radial-gradient(circle_at_15%_100%,rgba(29,107,82,0.28),transparent_55%)]" />
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="label flex items-center gap-2">
              <Spade className="h-3.5 w-3.5" />
              {mode === "free" ? "The free tables are open" : "USDC tables · Solana devnet"}
            </p>
            <h1 className="mt-3 max-w-2xl font-display text-4xl leading-[1.05] text-parchment-100 sm:text-5xl">
              Pull up a chair.
              <span className="block text-brass-300">Roll the bones. Play the hand.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-parchment-200/65 sm:text-base">
              Three classic pub games, one table. Ship, Captain &amp; Crew and Horses use five
              dice; Zwanzig ab is a German trick-taker. Play free with bots or friends — or open a
              USDC table escrowed by an on-chain Solana program.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="chip-live">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                {tables.length} {mode === "wager" ? "wager" : "free"} table
                {tables.length === 1 ? "" : "s"}
              </span>
              <span className="chip">
                <Users className="h-3 w-3" /> {openSeats} seated
              </span>
              <span className="chip">
                <Dices className="h-3 w-3" /> 2–8 players
              </span>
              <span className="chip">
                <Coins className="h-3 w-3" /> 0.01–1.00 USDC
              </span>
            </div>
          </div>

          <div className="relative hidden justify-self-end lg:block">
            <div className="relative h-64 w-full max-w-sm">
              <div className="absolute left-2 top-10 -rotate-12">
                <PlayingCard card={{ suit: "hearts", rank: 14 }} size="lg" />
              </div>
              <div className="absolute left-16 top-4 rotate-6">
                <PlayingCard card={{ suit: "spades", rank: 10 }} size="lg" />
              </div>
              <div className="absolute left-32 top-12 -rotate-3">
                <PlayingCard card={{ suit: "diamonds", rank: 13 }} size="lg" />
              </div>
              <div className="absolute bottom-0 right-2 flex gap-2 rounded-2xl border border-white/10 bg-ink-950/70 p-3 shadow-card backdrop-blur">
                <Die value={6} size="sm" />
                <Die value={5} size="sm" />
                <Die value={4} size="sm" />
                <Die value={3} size="sm" />
                <Die value={2} size="sm" />
              </div>
              <span className="absolute -right-2 top-0 rounded-full border border-brass-400/40 bg-ink-950/80 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-brass-300">
                cargo 9
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brass-400/40 bg-brass-500/10 text-brass-300">
            <Crown className="h-4 w-4" />
          </span>
          <label className="min-w-[12rem] flex-1">
            <span className="label">Your table name</span>
            <input
              className="mt-1 w-full border-0 bg-transparent p-0 font-display text-xl text-parchment-100 outline-none placeholder:text-white/25"
              value={draftName}
              maxLength={24}
              placeholder="Guest"
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitName();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`chip ${publicKey ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""}`}
            >
              <Wallet className="h-3 w-3" />
              {publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "No wallet"}
            </span>
            {!publicKey ? (
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setVisible(true)}>
                Connect
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="label">Session limit</p>
            <p className="mt-1 text-sm text-parchment-100">
              {accepted ? (
                <>
                  ${remainingUsdc.toFixed(2)}{" "}
                  <span className="text-xs text-parchment-200/50">of ${state.lossLimitUsdc.toFixed(2)} left</span>
                </>
              ) : (
                <span className="text-parchment-200/50">Accept the house check</span>
              )}
            </p>
          </div>
          <Link href="/rules/wagering" className="btn-quiet px-2 py-1 text-xs">
            Details <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {limitReached ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-coral-400/40 bg-coral-500/10 px-4 py-3 text-sm text-coral-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your session loss limit is used up. You can keep playing free tables, or close this
            tab to reset the session limit. Please take a break.
          </p>
        </div>
      ) : null}

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label">Choose your table</p>
            <h2 className="mt-1 font-display text-2xl text-parchment-100">
              {mode === "free" ? "Free play, no wallet needed" : "USDC tables, escrowed on-chain"}
            </h2>
          </div>
          <p className="max-w-md text-right text-xs leading-relaxed text-parchment-200/45">
            {mode === "free"
              ? "Free tables start with friendly bots after the first player is ready. Invite humans by sharing the table link."
              : "Every seat deposits stake + fee. The winner takes the stake pot; the treasury takes the fee pot at settlement."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {GAME_IDS.map((gameId) => (
            <GameCard
              key={gameId}
              gameId={gameId}
              mode={mode}
              disabled={status !== "online" || (mode === "wager" && (!publicKey || limitReached))}
              onFree={(withBots) => {
                pendingCreateRef.current = true;
                createTable({ game: gameId, mode: "free", vsBots: withBots });
              }}
              onWager={(stake, maxPlayers) => {
                pendingCreateRef.current = true;
                createTable({
                  game: gameId,
                  mode: "wager",
                  stakeBaseUnits: stake.toString(),
                  maxPlayers,
                });
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="label">Open tables</p>
            <h2 className="mt-1 font-display text-2xl text-parchment-100">
              {mode === "free" ? "Free tables" : "Wager tables"}
            </h2>
          </div>
          <button
            type="button"
            onClick={refreshLobby}
            className="btn-quiet px-3 py-1.5 text-xs"
            disabled={status !== "online"}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {tables.length === 0 ? (
          <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-brass-300">
              <Dices className="h-6 w-6" />
            </span>
            <p className="font-display text-xl text-parchment-100">No tables yet</p>
            <p className="max-w-md text-sm text-parchment-200/50">
              {mode === "free"
                ? "Open a free table above and we'll deal in a couple of friendly bots while you wait."
                : "Open a wager table and share the link. Every seat needs a funded devnet wallet with USDC."}
            </p>
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_auto] gap-3 border-b border-white/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-parchment-200/40 sm:grid">
              <span>Game / host</span>
              <span>Stake</span>
              <span>Seats</span>
              <span>State</span>
              <span />
            </div>
            <ul className="divide-y divide-white/5">
              {tables.map((table) => {
                const full = table.seats >= table.maxPlayers;
                const started = table.state !== "waiting";
                const canJoin = !started && !full && status === "online";
                return (
                  <li
                    key={table.id}
                    className="grid gap-2 px-4 py-3 transition hover:bg-white/[0.03] sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-parchment-100">
                        {table.gameName}
                        {table.mode === "wager" ? (
                          <span className="chip-warn !px-1.5 !py-0.5 !text-[8px]">USDC</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-parchment-200/45">hosted by {table.hostName}</p>
                    </div>
                    <div className="font-mono text-xs text-brass-300">
                      {table.stake ? `${formatUsdc(table.stake)} USDC` : "Free"}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-parchment-200/70">
                      <Users className="h-3.5 w-3.5" /> {table.seats}/{table.maxPlayers}
                    </div>
                    <div>
                      <span className={started ? "chip" : "chip-live"}>
                        {started ? table.state.replace("-", " ") : "waiting"}
                      </span>
                    </div>
                    <div className="sm:text-right">
                      <button
                        type="button"
                        onClick={() => join(table.id)}
                        disabled={!canJoin || joining === table.id}
                        className={canJoin ? "btn-ghost px-3 py-1.5 text-xs" : "btn-quiet px-3 py-1.5 text-xs"}
                      >
                        {started ? "In progress" : full ? "Full" : "Join"}
                        {canJoin ? <ArrowRight className="h-3 w-3" /> : null}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        <InfoCard
          icon={<Bot className="h-4 w-4" />}
          title="Bots fill free seats"
          body="Free tables add friendly bots so you can start in seconds. Human players can still join open seats."
        />
        <InfoCard
          icon={<Check className="h-4 w-4" />}
          title="Dice are replayable"
          body="Every dice round is derived from a committed seed and reroll masks, so anyone can re-run the round."
        />
        <InfoCard
          icon={<Coins className="h-4 w-4" />}
          title="Transparent fees"
          body="0.02 USDC per player, per game, charged once at settlement on top of the stake. Ties carry the pot."
        />
      </section>
    </div>
  );
}

function GameCard({
  gameId,
  mode,
  disabled,
  onFree,
  onWager,
}: {
  gameId: GameId;
  mode: PlayMode;
  disabled?: boolean;
  onFree: (withBots: boolean) => void;
  onWager: (stake: bigint, maxPlayers: number) => void;
}) {
  const meta = GAMES[gameId];
  const [stake, setStake] = useState<bigint>(50_000n);
  const [maxPlayers, setMaxPlayers] = useState(meta.maxPlayers);
  const seats = Array.from(
    { length: meta.maxPlayers - meta.minPlayers + 1 },
    (_, index) => meta.minPlayers + index,
  );

  return (
    <article className="panel group relative flex flex-col overflow-hidden">
      <div className="relative flex h-36 items-center justify-center overflow-hidden border-b border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent">
        <GameArt gameId={gameId} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-xl text-parchment-100">{meta.name}</h3>
            <p className="mt-1 text-xs leading-relaxed text-parchment-200/55">{meta.blurb}</p>
          </div>
          <span className="chip shrink-0">{meta.minPlayers}–{meta.maxPlayers}p</span>
        </div>

        <div className="mt-4 flex-1" />

        {mode === "wager" ? (
          <div className="space-y-3">
            <div>
              <p className="label mb-1.5">Stake per player</p>
              <div className="flex flex-wrap gap-1.5">
                {STAKES.map((value) => (
                  <button
                    key={value.toString()}
                    type="button"
                    onClick={() => setStake(value)}
                    className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition ${
                      stake === value
                        ? "border-brass-400 bg-brass-500 text-ink-950"
                        : "border-white/10 bg-white/5 text-parchment-200/70 hover:border-brass-400/40"
                    }`}
                  >
                    {formatUsdc(value)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-parchment-200/60">
                Seats
                <select
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(Number(event.target.value))}
                  className="rounded-lg border border-white/15 bg-ink-950 px-2 py-1 text-parchment-100 outline-none"
                >
                  {seats.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-right font-mono text-[10px] leading-tight text-parchment-200/45">
                Deposit {formatUsdc(stake + PLATFORM_FEE_PER_PLAYER_BASE_UNITS)} USDC
                <br />
                <span className="text-coral-400/80">incl. 0.02 fee</span>
              </p>
            </div>
            <button
              type="button"
              className="btn-coral w-full"
              disabled={disabled}
              onClick={() => onWager(stake, maxPlayers)}
            >
              <Coins className="h-4 w-4" /> Open USDC table
            </button>
            <p className="text-center text-[10px] leading-relaxed text-parchment-200/35">
              Winner takes {formatUsdc(stake)} USDC × seats. Fee goes to the treasury.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              className="btn-primary w-full"
              disabled={disabled}
              onClick={() => onFree(true)}
            >
              <Dices className="h-4 w-4" /> Deal me in with bots
            </button>
            <button
              type="button"
              className="btn-ghost w-full"
              disabled={disabled}
              onClick={() => onFree(false)}
            >
              <Users className="h-4 w-4" /> Open a human table
            </button>
            <Link
              href={meta.rulesPath}
              className="block text-center text-[11px] text-parchment-200/40 underline-offset-2 hover:text-parchment-100 hover:underline"
            >
              How to play
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}

function GameArt({ gameId }: { gameId: GameId }) {
  if (gameId === "ship-captain-crew") {
    return (
      <div className="flex items-end gap-2 transition duration-500 group-hover:-translate-y-1">
        <Die value={6} size="lg" />
        <Die value={5} size="md" />
        <Die value={4} size="md" />
        <span className="mb-2 font-mono text-[10px] uppercase tracking-wider text-brass-300/70">
          ship · captain · crew
        </span>
      </div>
    );
  }
  if (gameId === "horses") {
    return (
      <div className="flex items-end gap-1.5 transition duration-500 group-hover:-translate-y-1">
        {[3, 3, 1, 3, 3].map((value, index) => (
          <Die key={index} value={value} size={index === 2 ? "md" : "sm"} />
        ))}
        <span className="mb-1 ml-1 font-mono text-[10px] uppercase tracking-wider text-brass-300/70">
          4 horses
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-end transition duration-500 group-hover:-translate-y-1">
      <div className="-rotate-12">
        <PlayingCard card={{ suit: "hearts", rank: 14 }} />
      </div>
      <div className="-ml-3 rotate-6">
        <PlayingCard card={{ suit: "clubs", rank: 10 }} />
      </div>
      <div className="-ml-3 -rotate-3">
        <PlayingCard card={{ suit: "spades", rank: 12 }} />
      </div>
      <div className="-ml-3 rotate-12">
        <CardBack size="md" />
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="panel flex gap-3 p-4">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brass-400/30 bg-brass-500/10 text-brass-300">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-parchment-100">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-parchment-200/50">{body}</p>
      </div>
    </div>
  );
}
