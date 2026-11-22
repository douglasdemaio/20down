import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowRight,
  Bot,
  Check,
  Coins,
  Copy,
  Crown,
  Info,
  RefreshCw,
  Search,
  Spade,
  Users,
  Wallet,
} from "lucide-react";
import {
  GAMES,
  PLATFORM_FEE_PER_PLAYER_BASE_UNITS,
  STAKE_PRESETS_BASE_UNITS,
  formatUsdc,
} from "@20down/shared";
import { useGameSocket } from "@/components/game-socket-provider";
import { useMode } from "@/components/mode-provider";
import { useCompliance } from "@/components/compliance-provider";
import { CardBack, PlayingCard } from "@/components/ui/playing-card";
import { config } from "@/lib/config";

const GAME = GAMES["zwanzig-ab"];

export function LobbyClient() {
  const navigate = useNavigate();
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
    quickMatch,
    joinTable,
    refreshLobby,
    error,
  } = useGameSocket();

  const [draftName, setDraftName] = useState(name);
  const [botSeats, setBotSeats] = useState<3 | 4>(3);
  const [stake, setStake] = useState(250_000n);
  const [wagerSeats, setWagerSeats] = useState<3 | 4>(3);
  const [joining, setJoining] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => setDraftName(name), [name]);

  useEffect(() => {
    if (!room || !pendingRef.current) return;
    pendingRef.current = false;
    navigate(`/table/${room.id}`);
  }, [room, navigate]);

  useEffect(() => {
    if (!error) return;
    pendingRef.current = false;
    setJoining(null);
  }, [error]);

  useEffect(() => {
    if (status === "online") refreshLobby();
  }, [status, refreshLobby]);

  const tables = lobby.filter((table) => table.mode === mode);
  const openSeats = tables.reduce((sum, table) => sum + (table.maxPlayers - table.seats), 0);
  const liveRoom =
    room && room.state !== "resolved" && room.state !== "voided" ? room : null;
  const escrowLocked =
    liveRoom?.mode === "wager" &&
    Boolean(liveRoom.seats.find((seat) => seat.seat === liveRoom.yourSeat)?.ready);

  const commitName = () => {
    const clean = draftName.trim();
    if (!clean) return setDraftName(name);
    if (clean !== name) setName(clean);
  };

  const join = (tableId: string) => {
    setJoining(tableId);
    joinTable(tableId);
    navigate(`/table/${tableId}`);
  };

  const copyInvite = async () => {
    if (!liveRoom) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${import.meta.env.BASE_URL}table/${liveRoom.id}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const wagerBlocked = !config.wageringEnabled || !publicKey || limitReached;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 px-5 py-10 shadow-card sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_20%,rgba(212,168,79,0.14),transparent_45%),radial-gradient(circle_at_15%_100%,rgba(29,107,82,0.28),transparent_55%)]" />
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="label flex items-center gap-2">
              <Spade className="h-4 w-4" />
              {mode === "free" ? "The free tables are open" : "USDC tables · Solana mainnet"}
            </p>
            <h1 className="mt-4 max-w-2xl font-display text-5xl leading-[1.05] text-parchment-100 sm:text-6xl">
              Start at twenty.
              <span className="block text-brass-300">Trick your way to zero.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-parchment-200/70 sm:text-lg">
              20 Down is a German trick-taking game for three or four players. Play free with
              friendly bots, invite humans, or find an open table in one click. USDC tables are
              human-only and escrowed on Solana mainnet.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <span className="chip-live !px-3 !py-1.5 !text-[11px]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                {tables.length} open {mode === "wager" ? "wager" : "free"} table
                {tables.length === 1 ? "" : "s"}
              </span>
              <span className="chip !px-3 !py-1.5 !text-[11px]">
                <Users className="h-3.5 w-3.5" /> {openSeats} seats free
              </span>
              <span className="chip !px-3 !py-1.5 !text-[11px]">
                <Spade className="h-3.5 w-3.5" /> 3–4 players
              </span>
              <span className="chip !px-3 !py-1.5 !text-[11px]">
                <Coins className="h-3.5 w-3.5" /> 0.10–1.00 USDC
              </span>
            </div>
          </div>

          <div className="relative hidden justify-self-end lg:block">
            <div className="relative h-64 w-full max-w-sm">
              <div className="absolute left-4 top-10 -rotate-12">
                <PlayingCard card={{ suit: "hearts", rank: 14 }} size="lg" />
              </div>
              <div className="absolute left-20 top-2 rotate-6">
                <PlayingCard card={{ suit: "spades", rank: 10 }} size="lg" />
              </div>
              <div className="absolute left-36 top-14 -rotate-3">
                <PlayingCard card={{ suit: "diamonds", rank: 13 }} size="lg" />
              </div>
              <div className="absolute bottom-0 right-4 -rotate-6">
                <CardBack size="md" />
              </div>
              <span className="absolute -right-2 top-0 rounded-full border border-brass-400/40 bg-ink-950/80 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-brass-300">
                20 → 0
              </span>
            </div>
          </div>
        </div>
      </section>

      {liveRoom ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brass-400/25 bg-brass-500/[0.07] px-4 py-3 text-sm">
          <p className="text-parchment-200/70">
            You are still seated at <span className="font-semibold text-parchment-100">20 Down</span>.
            {escrowLocked
              ? " Finish or refund your USDC seat before opening another table."
              : " Starting another game will release that seat."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={copyInvite}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Link copied" : "Copy invite link"}
            </button>
            <Link to={`/table/${liveRoom.id}`} className="btn-quiet py-1.5 text-xs">
              Return to table <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      ) : null}

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
            <span className={`chip ${publicKey ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""}`}>
              <Wallet className="h-3 w-3" />
              {publicKey
                ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
                : "No wallet"}
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
          <Link to="/rules/wagering" className="btn-quiet px-2 py-1 text-xs">
            Details <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {limitReached ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-coral-400/40 bg-coral-500/10 px-4 py-3 text-sm text-coral-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your session loss limit is used up. You can keep playing free tables, or close this tab
            to reset the session limit. Please take a break.
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
              ? "Bots fill free seats so you can start right away. Human players can still join any open seat."
              : "Every seat deposits stake + fee. Winners take the stake pot; the treasury takes the fee pot."}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <article className="panel group flex flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-brass-400/30">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brass-400/30 bg-brass-500/10 text-brass-300">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-xl text-parchment-100">Deal me in with bots</h3>
                <p className="text-xs text-parchment-200/50">Start alone, bots take the rest.</p>
              </div>
            </div>
            <p className="label mt-5">Table size</p>
            <div className="mt-2 flex gap-2">
              {([3, 4] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setBotSeats(count)}
                  className={botSeats === count ? "btn-primary flex-1 py-2 text-xs" : "btn-ghost flex-1 py-2 text-xs"}
                >
                  {count} players
                </button>
              ))}
            </div>
            <div className="mt-auto pt-5">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={status !== "online" || escrowLocked}
                onClick={() => {
                  pendingRef.current = true;
                  createTable({ game: "zwanzig-ab", mode: "free", vsBots: true, maxPlayers: botSeats });
                }}
              >
                <Spade className="h-4 w-4" /> Deal me in
              </button>
              <Link
                to={GAME.rulesPath}
                className="mt-3 block text-center text-[11px] text-parchment-200/40 underline-offset-2 hover:text-parchment-100 hover:underline"
              >
                How to play
              </Link>
            </div>
          </article>

          <article className="panel group flex flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-brass-400/30">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brass-400/30 bg-brass-500/10 text-brass-300">
                <Users className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-xl text-parchment-100">Open a human table</h3>
                <p className="text-xs text-parchment-200/50">Share the link with friends.</p>
              </div>
            </div>
            <p className="label mt-5">Table size</p>
            <div className="mt-2 flex gap-2">
              {([3, 4] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setBotSeats(count)}
                  className={botSeats === count ? "btn-primary flex-1 py-2 text-xs" : "btn-ghost flex-1 py-2 text-xs"}
                >
                  {count} players
                </button>
              ))}
            </div>
            <div className="mt-auto pt-5">
              <button
                type="button"
                className="btn-ghost w-full"
                disabled={status !== "online" || escrowLocked}
                onClick={() => {
                  pendingRef.current = true;
                  createTable({ game: "zwanzig-ab", mode: "free", vsBots: false, maxPlayers: botSeats });
                }}
              >
                <Users className="h-4 w-4" /> Open human table
              </button>
              <p className="mt-3 text-center text-[10px] text-parchment-200/35">
                Copy the invite link from the table page.
              </p>
            </div>
          </article>

          <article className="panel group flex flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-brass-400/30">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brass-400/30 bg-brass-500/10 text-brass-300">
                <Search className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-xl text-parchment-100">Find an open table</h3>
                <p className="text-xs text-parchment-200/50">One click, first available seat.</p>
              </div>
            </div>
            <p className="label mt-5">Looking for</p>
            <p className="mt-2 text-sm text-parchment-100">
              {mode === "free"
                ? "A free table with an open seat — or a new bot table."
                : `A human-only ${stakeLabel(stake)} wager table.`}
            </p>
            <div className="mt-auto pt-5">
              <button
                type="button"
                className="btn-ghost w-full"
                disabled={
                  status !== "online" ||
                  escrowLocked ||
                  (mode === "wager" && wagerBlocked)
                }
                onClick={() => {
                  pendingRef.current = true;
                  quickMatch({
                    mode,
                    stakeBaseUnits: mode === "wager" ? stake.toString() : undefined,
                    maxPlayers: mode === "wager" ? wagerSeats : botSeats,
                  });
                }}
              >
                <Search className="h-4 w-4" /> Find a table
              </button>
              <p className="mt-3 text-center text-[10px] text-parchment-200/35">
                {tables.length} open {mode} table{tables.length === 1 ? "" : "s"} right now.
              </p>
            </div>
          </article>
        </div>

        {mode === "wager" ? (
          <div className="panel mt-4 flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-[16rem] flex-1">
              <p className="label mb-2">Stake per player</p>
              <div className="flex flex-wrap gap-2">
                {STAKE_PRESETS_BASE_UNITS.map((value) => (
                  <button
                    key={value.toString()}
                    type="button"
                    onClick={() => setStake(value)}
                    className={stake === value ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
                  >
                    {formatUsdc(value)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-parchment-200/45">
                Deposit {formatUsdc(stake + PLATFORM_FEE_PER_PLAYER_BASE_UNITS)} USDC incl. 0.02 fee ·
                human-only · 1.00 USDC is per player, not a pot cap.
              </p>
            </div>
            <div>
              <p className="label mb-2">Seats</p>
              <div className="flex gap-2">
                {([3, 4] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setWagerSeats(count)}
                    className={wagerSeats === count ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
                  >
                    {count}p
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn-coral"
              disabled={status !== "online" || escrowLocked || wagerBlocked}
              onClick={() => {
                pendingRef.current = true;
                createTable({
                  game: "zwanzig-ab",
                  mode: "wager",
                  stakeBaseUnits: stake.toString(),
                  maxPlayers: wagerSeats,
                });
              }}
            >
              <Coins className="h-4 w-4" /> Open USDC table
            </button>
            {!config.wageringEnabled ? (
              <p className="w-full text-[11px] text-coral-400">
                Mainnet wagering is paused until the independent audit and legal sign-off.
              </p>
            ) : null}
          </div>
        ) : null}
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
              <Spade className="h-6 w-6" />
            </span>
            <p className="font-display text-xl text-parchment-100">No tables yet</p>
            <p className="max-w-md text-sm text-parchment-200/50">
              {mode === "free"
                ? "Open a free table above and bots will fill the seats while you wait."
                : "Open a wager table and share the link. Every seat needs a funded mainnet wallet."}
            </p>
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_auto] gap-3 border-b border-white/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-parchment-200/40 sm:grid">
              <span>Table / host</span>
              <span>Stake</span>
              <span>Seats</span>
              <span>State</span>
              <span />
            </div>
            <ul className="divide-y divide-white/5">
              {tables.map((table) => {
                const full = table.seats >= table.maxPlayers;
                const started = table.state !== "waiting";
                const canJoin = !started && !full && status === "online" && !escrowLocked;
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
                      <p className="mt-0.5 font-mono text-[10px] text-parchment-200/40">{table.id}</p>
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
          title="Deals are replayable"
          body="Every deal comes from a committed seed. Reveal the seed and regenerate the exact card order."
        />
        <InfoCard
          icon={<Coins className="h-4 w-4" />}
          title="Transparent fees"
          body="0.02 USDC per player, per game, charged once at settlement. Ties carry the pot."
        />
      </section>
    </div>
  );
}

function stakeLabel(value: bigint): string {
  return `${formatUsdc(value)} USDC`;
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
