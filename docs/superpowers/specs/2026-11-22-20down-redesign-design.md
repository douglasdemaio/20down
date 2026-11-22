# 20 Down — product redesign and platform migration design

Date: 2026-11-22

## Summary

Turn the current multi-game, Fly-hosted "Dice & Cards" app into a single-game
product called **20 Down**, hosted as a static site on GitHub Pages with a
Cloudflare Workers + Durable Objects backend. Keep the existing, tested Zwanzig
(20 Down) engine and JSON protocol; remove the dice games and Next.js/Fly
server from the product surface; keep both free play and USDC wagering, with
mainnet USDC as the target network.

## Decisions already made with the user

- Hosting style: static site, like `bamberg.quest`. Frontend on GitHub Pages;
  live game backend on Cloudflare Workers + Durable Objects.
- Backend placement: Cloudflare Workers + Durable Objects, not the existing Fly
  hub.
- Game scope: 20 Down only. Delete Horses and Ship, Captain & Crew from the
  product everywhere **except** the already-deployed devnet Anchor program,
  which is left untouched.
- Table sizes: 3 or 4 players for every table (bot, friend, and wager).
- Wager stakes: 0.10, 0.25, 0.50 and 1.00 USDC per player per round. 1.00 USDC
  is the per-player stake ceiling (confirmed), not a total-pot cap; a full
  four-player table can therefore hold a 4.00 USDC stake pot.
- Lobby: keep "Deal me in with bots" and "Open a human table"; add one-click
  "Find an open table" quick match, while keeping the live list of open tables.
- Wallet/USDC integration stays. Network is **mainnet only** for the new build;
  no devnet-first phase.
- Repo rename: `douglasdemaio/wagerwake` → `douglasdemaio/20down`, including
  package names and branding.
- Player protection: 18+ gate + terms, geo blocking at the edge, session loss
  limit, and responsible-gambling links.

## Product shape

1. The product is "20 Down" (Zwanzig ab). All copy, metadata, routes, docs and
   art refer to the card game only. Wording such as "Dice & Cards", "roll the
   bones", "cargo", "ship", "captain", "crew" and "horses" is removed.
2. `GameId` collapses to a single value (`zwanzig-ab`). Dice protocol messages
   (`reroll`, `stand`) and `DicePublicState` are removed. Zwanzig actions
   (`trump`, `exchange`, `announce`, `playCard`, `nextDeal`, `ante`, chat) stay.
3. `GAMES["zwanzig-ab"].minPlayers` changes from 2 to 3; `maxPlayers` stays 4.
   Bot tables let the host choose 3 or 4 players; human and wager tables also
   expose only 3- or 4-seat choices.
4. Lobby actions:
   - "Deal me in with bots" — creates a free table and fills empty seats with
     bots up to the chosen 3 or 4 seats.
   - "Open a human table" — creates a table whose link can be shared with
     specific people.
   - "Find an open table" — asks the Lobby DO for a suitable waiting public
     table and joins it immediately; if none is available, creates one public
     table matching the player's chosen mode and stake. The browsable list of
     waiting tables remains available.
5. Free tables are bot-filled; USDC wager tables are human-only. Shareable
   table links work for both modes.
6. Stake presets are exactly 0.10 / 0.25 / 0.50 / 1.00 USDC per player per
   round. The platform fee remains 0.02 USDC per player, charged once at final
   settlement. Ties carry the pot into a re-ante round; timeouts forfeit;
   leaving a waiting table refunds the deposit.

## Architecture

### Static client (`client/`)

- Vite + React + TypeScript + Tailwind, replacing the Next.js app.
- Solana wallet adapter (Phantom, Solflare) runs entirely in the browser.
- Published to GitHub Pages at `https://douglasdemaio.github.io/20down/` by
  GitHub Actions. No server-side routes. A 404 fallback (or hash routing) keeps
  `/table/<id>` deep links working.
- Reuses `@20down/shared` for the engine, protocol and formatting. The client
  only sends intents and never decides payouts.

### Worker and Durable Objects (`worker/`)

- The Worker serves `/health`, `/api/config`, `/api/lobby`, `/api/tx`,
  `/api/tx/submit`, and WebSocket upgrades at `/ws` and `/ws/lobby`.
- CORS is restricted to the GitHub Pages origin. Geo blocking is enforced here
  from Cloudflare's country header with a configurable ISO blocklist; the
  frontend gate alone is not authoritative.
- **Lobby DO** (single named instance): authoritative registry of public tables
  (id, mode, stake, seat count, max seats, state, host name). Table DOs report
  creation, seat changes, start and destruction to it. It answers lobby list
  and quick-match requests and broadcasts updates to connected clients.
- **Table DO** (one per table id): owns seats, `ZwanzigSession`, chat, seed
  commitment, round history, and turn/ante timers via Durable Object alarms.
  Uses the hibernation WebSocket API, serializes session attachments so state
  survives eviction, and persists authoritative state in DO storage. It keeps
  the escrow guard that prevents switching away from a table with a live
  deposit.
- Client-to-table data flow: create or join → Worker routes upgrade to the Table
  DO by table id → browser sends existing JSON protocol messages → DO validates
  with the shared engine → DO broadcasts the updated `RoomView` → settlement is
  requested through the chain adapter and the signature is returned in the room
  view. Reconnection uses the stored player ID plus the table ID from the URL.

### Chain adapter

- Port the wager path to `@solana/kit` (fetch-based RPC, no Node APIs) so it
  runs in Workers. Build Anchor instructions from the IDL/discriminators rather
  than relying on Node-only `@solana/web3.js` behavior.
- Oracle keypair is a Cloudflare Worker secret with only enough SOL for fees.
  Treasury is a separate mainnet address.
- **Highest-risk item.** Spike the Kit + Anchor signing and submission flow
  before building out the rest of the UI.

## Mainnet program and compliance

- Deploy a fresh mainnet Anchor program (`programs/20down`) from the existing
  source with dice paths removed and mainnet USDC mint, new treasury, and a
  new program ID. The existing devnet program and its immutable config are not
  redeployed or modified.
- On-chain stake validation accepts exactly the four presets; stake range and
  equal-stake enforcement remain. Fee split, tie carry-over, forfeits, refunds,
  seed commitment and settlement verification carry over.
- Keep the 18+ and terms gate before the app is usable; keep the per-session
  loss limit and responsible-gambling links in the header, footer and gate.
  Enforce the loss limit in the Lobby/Table DO keyed by player ID so clearing
  browser storage does not reset it; keep the browser display as a view of that
  state.
- Mainnet launch is blocked until an independent security audit of the program
  and Worker adapter is complete and the user obtains legal/jurisdictional
  sign-off. Code completion does not imply launch readiness.

## Repository, layout, and delivery

1. Rename the GitHub repo with `gh`, update the local `origin`, then rename
   workspaces and packages from `@wagerwake/*` to `@20down/*` and rewrite all
   branding, README and docs.
2. Final layout:
   - `client/` — static React app
   - `worker/` — Worker, Lobby DO, Table DO, chain adapter
   - `packages/shared/` — trimmed Zwanzig engine, protocol, formatting
   - `programs/20down/` — Anchor source for the mainnet program
   - `docs/` — rules (20 Down, wagering, fairness), deployment, operations
   Delete `app/`, `server/`, Fly configs, dice engines/sessions/tests/docs and
   devnet-only scripts. The deployed devnet program itself is untouched.
3. GitHub Actions: run tests on every PR; build and deploy `client/` to GitHub
   Pages; build and deploy `worker/` with Wrangler. Secrets live in Cloudflare,
   never in the repository.
4. Tests:
   - Trim shared engine/protocol tests to the card game and rename them.
   - Miniflare/Vitest tests for Lobby and Table DOs: quick match, 3/4-player
     seating, reconnect, alarms/timeouts, chat, escrow guards, settlement
     messages, CORS and geo blocking.
   - Chain adapter tests with mocked RPC for transaction building, submission
     and error handling.
   - Anchor tests for preset stakes, payout and fee split, ties, forfeits,
     refunds, seed commitment and double-claim rejection.
   - End-to-end run of a bot game, a shared-link friend game, and a quick-match
     game against the deployed Worker.

## Risks and ordering

1. Spike Solana Kit + Anchor transaction building in Workers.
2. Verify hibernating WebSocket routing and DO alarms with Miniflare.
3. Verify GitHub Pages SPA deep-link fallback, CORS and cross-origin WSS.
4. Build the static client and lobby/quick-match flow.
5. Port the wager flow and add the new mainnet program.
6. Run tests and documentation update; mainnet launch waits for audit/legal.
