# 20 Down redesign — implementation plan

Source spec: `docs/superpowers/specs/2026-11-22-20down-redesign-design.md`

This is a staged rebuild. Each phase has an exit criterion; do not start the
next phase until the current one passes. Mainnet launch remains gated on an
external audit and legal sign-off.

## Phase 0 — Spikes (do these first)

1. **Solana Kit + Anchor inside a Worker.** Build a throwaway Worker that
   loads the oracle keypair from a secret, builds one Anchor instruction from
   the existing IDL with `@solana/kit`, signs it and submits it to mainnet RPC.
   Confirm no Node-only APIs are required.
   - Exit: successful signed transaction (or a documented blocker and
     alternative adapter design).
2. **Durable Object WebSocket hibernation + alarms.** Run the Cloudflare
   hibernation example locally with Miniflare; verify session attachments
   survive eviction and an alarm fires a turn timeout.
   - Exit: passing local test showing reconnect and alarm behavior.
3. **GitHub Pages static routing.** Confirm a Vite SPA deep link such as
   `/table/abc123` works with a Pages 404 fallback, and that cross-origin WSS
   plus CORS to the Worker behave as expected.
   - Exit: deployed test page loads a deep link and opens a test WebSocket.

Deliverable: a short spike notes file in `docs/` with findings and any plan
adjustments.

## Phase 1 — Rename and working-tree safety

1. Inspect the pre-existing uncommitted changes (`app/next.config.mjs`,
   `server/src/chain.ts`, Dockerfile/Fly files). Ask the user whether to commit
   or stash them before any deletion. Never overwrite user work.
2. Rename the GitHub repo: `gh repo rename 20down --yes` from the repo, then
   `git remote set-url origin https://github.com/douglasdemaio/20down.git`.
3. Rename workspace packages `@wagerwake/*` → `@20down/*` across
   `package.json`, lockfile, imports, wrangler/tsconfig configs, README and
   docs. Rewrite the brand from "Dice & Cards" / "wagerwake" to "20 Down" /
   "20down".
4. Exit: `npm install`, `npm run typecheck`, `npm test` all pass on the renamed
   repo, and `gh repo view` shows the new name.

## Phase 2 — Trim the shared package to 20 Down

1. Collapse `GameId` to `"zwanzig-ab"`; set `minPlayers: 3`, keep
   `maxPlayers: 4`; update `GAME_IDS`, `isGameId`, `seatsFor`.
2. Delete `games/shipCaptainCrew.ts`, `games/horses.ts` and dice-related
   protocol types/messages (`DicePublicState`, `reroll`, `stand`). Remove dice
   parity vectors and tests.
3. Add the four stake presets as a shared constant and use them in
   `validateStake`, keeping 1.00 USDC as the ceiling and 0.02 USDC as the fee.
4. Exit: `npm run test:shared` passes with card-game-only coverage; no dice
   identifiers remain outside the deployed-program artifact and its history.

## Phase 3 — Static client shell

1. Create `client/` with Vite + React + TypeScript + Tailwind; port the visual
   system, header/footer, compliance gate shell, lobby and table board from
   `app/src/components`.
2. Wire the wallet adapter (Phantom/Solflare) client-side only; add runtime
   config for the Worker HTTP/WS base URLs.
3. Build lobby actions: "Deal me in with bots" (3/4 seats), "Open a human
   table" (copyable link), "Find an open table" (quick match), plus the live
   open-tables list. Initially drive them against a mock Worker.
4. Add GitHub Actions workflow to build `client/` and deploy to GitHub Pages
   with a 404 fallback for `/table/<id>`.
5. Exit: Pages deployment loads lobby and a table deep link with mocked data;
   no Next.js server routes remain in the client.

## Phase 4 — Worker and Durable Objects backend

1. Create `worker/` with the Worker router: `/health`, `/api/config`,
   `/api/lobby`, `/api/tx`, `/api/tx/submit`, `/ws`, `/ws/lobby`; CORS to the
   GitHub Pages origin; edge geo blocking from the Cloudflare country header.
2. Implement the Lobby DO: table registry, subscribe/list, quick-match request,
   and lifecycle updates from Table DOs.
3. Implement the Table DO: port `Room` seat logic, bot filling, Zwanzig session
   driving, chat, seed commitment, round history, reconnect, escrow guard,
   hibernating WebSockets and alarm-driven turn/ante timers. Persist state in
   DO storage.
4. Add Miniflare/Vitest tests: quick match, 3/4 seating, reconnect, timeouts,
   chat, escrow guards, broadcast shape, CORS and geo blocking.
5. Delete the old `server/` hub, Fly configs and Node hub tests.
6. Exit: `npm run test:worker` passes; a locally running Worker serves a full
   three-player bot game from the static client.

## Phase 5 — Mainnet program and wager flow

1. Create `programs/20down/` from the existing Anchor source with dice paths
   removed; configure mainnet USDC mint, new treasury and new program ID.
   Restrict stakes to the four presets on-chain.
2. Port `server/src/chain.ts` to a Worker chain adapter using the Phase 0
   spike findings; read oracle keypair from Worker secrets; implement
   build/sign/submit, table creation, deposits, settlement, ties, forfeits and
   refunds.
3. Wire `/api/tx` and `/api/tx/submit` to the Table DO escrow state, including
   the live-deposit guard when switching tables.
4. Add Anchor tests for stake presets, payout/fee split, ties, forfeits,
   refunds, seed commitment and double-claim rejection; add mocked-RPC tests
   for the adapter.
5. Exit: `anchor test` and adapter tests pass; a mainnet-configured Worker
   (small value, test wallet) completes a human-only 3-player wager game.

## Phase 6 — Player protection polish

1. Keep and restyle the 18+ and terms gate; keep session loss limit and
   responsible-gambling links in header, footer and gate.
2. Move loss-limit enforcement into the Lobby/Table DO keyed by player ID; the
   client displays the DO-authoritative remaining amount.
3. Exit: tests show clearing browser storage does not reset the session limit;
   geo-blocked country cannot create or join a table.

## Phase 7 — Docs, CI/CD, and cutover

1. Rewrite README and `docs/`: 20 Down rules, wagering, fairness, Worker/DO
   operations, GitHub Pages deployment, Wrangler secrets, and the mainnet
   audit/legal gate. Remove Fly, dice and devnet-only instructions.
2. Finish GitHub Actions: tests on PRs, Pages deploy on `main`, Wrangler deploy
   for `worker/`. Configure Cloudflare secrets out of band.
3. Run end-to-end verification: bot game, shared-link friend game, quick-match
   public game, and a small wager game.
4. Exit: all checks green, docs match reality, user has a deployment checklist.

## Explicit non-goals for this plan

- No devnet-first deployment of the new build; mainnet only.
- No modification or redeploy of the existing devnet Anchor program.
- No mainnet launch before independent audit and legal sign-off.
- No support for 2-player tables or bot-filled wager tables.
