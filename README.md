# 20 Down

A three- or four-player trick-taking game with free play against bots and
USDC wagering on Solana mainnet.

This repository is being rebuilt as a static GitHub Pages client backed by
Cloudflare Workers and Durable Objects. The approved design and staged
implementation plan live in:

- `docs/superpowers/specs/2026-11-22-20down-redesign-design.md`
- `docs/superpowers/plans/2026-11-22-20down-redesign.md`
- `docs/20down-phase0-spikes.md`

> **Status:** the sections below still describe the legacy Next.js/Node hub
> build and the already-deployed devnet program. They are retained for reference
> until the rebuild's documentation rewrite (plan Phase 7). The legacy devnet
> program is not being modified or redeployed.

```
app/        Next.js + TypeScript + Tailwind frontend (Phantom/Solflare wallet)
server/     Node realtime hub: rooms, turns, timers, transaction signing flow
packages/   Shared TS engines, protocol, chain helpers (runs in browser + Node)
programs/   Anchor program: escrow, commit/reveal, settlement, forfeits
docs/       Rules, fairness ("vrf") and wagering documentation
scripts/    Devnet bootstrap + end-to-end wager round runner
```

## Programme notes

| Item | Value |
| ---- | ----- |
| Program id | `CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt` |
| Stakes | 0.01–1.00 USDC (program-enforced), equal for every seat |
| Platform fee | 0.02 USDC per player, per game, once at settlement |
| Treasury | `J59EPyPHf9wtoLjf8rG4f9cARnLnUPKCdNwZX241rakh` |
| Ties | All players re-ante the same stake for 60 s; non-anters forfeit |
| Turn clock | 60 s (wager dice forfeit; free auto-stands; Zwanzig auto-plays) |
| Randomness | commit–reveal; dice replayed on-chain; devnet oracle-signed record_vrf with Switchboard On-Demand as the production seam (`docs/vrf.md`) |

## 1. Prerequisites

- Node ≥ 20 (repo is developed on Node 24)
- Solana CLI + Anchor 1.0.x (`anchor --version`) and `solana --version`
- Rust toolchain (stable) for the program
- A funded Solana keypair for the devnet oracle:
  ```bash
  solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
  solana airdrop 2 -u devnet     # repeat as needed or ask the devnet faucet
  ```

Install everything:

```bash
npm install
```

## 2. Build and test the program

```bash
anchor build                      # writes target/deploy/wagerwake.so + idl
anchor test                       # program tests are `cargo test`-based (1.x)
```

Unit suites (engine + hub, no validator needed):

```bash
npm run test:shared               # 96 tests: engines, protocol, parity vectors
npm run test:server               # 27 tests: dice/Zwanzig sessions, rooms, HTTP+WS hub
```

Cross-language invariants are pinned in `packages/shared/test/parity.test.ts`
and mirrored in Rust (`games.rs::js_parity_vectors`).

## 3. Deploy to devnet

```bash
solana program deploy target/deploy/wagerwake.so \
  --program-id target/deploy/wagerwake-keypair.json \
  --url https://api.devnet.solana.com \
  --with-compute-unit-price
```

Then copy the deployed program id into the environment (or keep the checked-in
id). Start the devnet bootstrap once:

```bash
SOLANA_CLUSTER=devnet \
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
npx tsx scripts/init-devnet.ts --oracle ~/.config/solana/id.json
```

This ensures the oracle wallet has SOL and that the treasury's USDC token
account exists (the fee pot needs a destination). For a **fresh** deployment
let the server initialise the program config on the first wager table:

```bash
CHAIN_ENABLED=true ALLOW_CONFIG_INIT=true npm run dev:server
```

Remove `ALLOW_CONFIG_INIT` afterwards — production config is immutable and
only the recorded treasury/mint/fee can be used from then on.

## 4. Run everything locally

```bash
cp .env.example .env          # adjust ORACLE_KEYPAIR / mint as needed
export $(grep -v '^#' .env | xargs)
npm run dev                   # hub on :8787 (tsx watch) + Next on :3000
```

Free play works with no wallet. For wager play connect Phantom (or Solflare),
fetch some devnet USDC for the test wallets, then set `CHAIN_ENABLED=true`.

### End-to-end wager round on-chain

```bash
npx tsx scripts/e2e-devnet.ts \
  --oracle ~/.config/solana/id.json \
  --player-a ~/.config/solana/playerA.json \
  --player-b ~/.config/solana/playerB.json
```

The script boots the real hub over a throwaway port, then walks the exact
browser flow — create table → `/api/tx` build → **player-signed** deposit →
`start_game` on-chain → a live Ship, Captain & Crew round → `commit_seed` /
`record_vrf` / `resolve_dice_round` — and finally asserts:

- the winner's USDC delta is exactly `2×stake − (stake+fee)` per round;
- the loser's is `−(stake+fee)` per round;
- the escrow token account ends empty.

Fund the two player wallets first (test USDC on devnet or localnet via
`scripts/init-devnet.ts --test-mint-authority … --fund-player …`).

## 5. Environment

All variables live in `.env.example`. Highlights:

| Variable | Purpose |
| -------- | ------- |
| `SOLANA_CLUSTER`, `SOLANA_RPC_URL` | cluster + RPC for server and scripts |
| `PROGRAM_ID`, `USDC_MINT`, `TREASURY` | on-chain wiring |
| `ORACLE_KEYPAIR` | server identity that tables/settles |
| `CHAIN_ENABLED` | master switch: wager mode on/off |
| `ALLOW_CONFIG_INIT` | one-time program config init (devnet/localnet) |
| `FEE_PER_PLAYER` | base units (default `20000` = 0.02 USDC) |
| `NEXT_PUBLIC_*` | mirror of the above for the Next.js app |
| `GEO_BLOCKED_COUNTRIES` | ISO codes blocked at the geo endpoint |

## 6. App structure

```
app/src/app/                      routes: /, /table/[id], /rules/[game], /verify, /settings
app/src/components/               providers, lobby, table boards (dice + cards), wager panel
app/src/lib/                      cluster config, wager tx build/sign/submit, compliance state
server/src/                       Hub (+ REST control plane), rooms, game sessions, chain adapter
packages/shared/src/              engines (dice/horses/zwanzig), RNG, protocol, PDAs, IDL
programs/wagerwake/src/           Anchor program: state, instructions, on-chain resolver
```

Wager flow (browser never builds program instructions, never sees the oracle):

1. Player creates/joins → hub calls `create_table` (oracle) and exposes the
   on-chain `tablePda` / `escrowPda`.
2. Browser asks `/api/tx` for a prebuilt `join_table` + `set_ready` bundle,
   signs it with the wallet, POSTs to `/api/tx/submit` (server submits +
   confirms, releasing seats on refunds).
3. When every seat is ready the hub runs `start_game`, publishes a seed
   commitment, and plays the round; settlement calls `commit_seed` /
   `record_vrf` / the replay instruction for the game.

## 7. Tests to know

- `npm run test:shared` — engines + protocol + **TS↔Rust parity vectors**.
- `npm run test:server` — sessions, room lifecycle (ties, timeouts, deposits),
  and the WS/HTTP hub.
- `anchor test` — stake limits, equal-stake checks, payout+fee split, tie
  carry-over and ante handling, timeout forfeits, refunds, replay and
  double-claim rejections, seed commitment binding.

Mainnet only after an audit.

## 8. Compliance

18+ gate and terms acceptance appear before the app is usable; wager mode adds
a persistent "Real USDC wagering active" banner, geo-blocking is configured
with `GEO_BLOCKED_COUNTRIES`, a per-session loss limit caps deposits
(session storage), and a responsible-gambling link (BeGambleAware.org) is in
the footer, the gate and the header.

## License

MIT.
