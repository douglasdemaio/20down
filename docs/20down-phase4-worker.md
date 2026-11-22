# Phase 4 — Worker and Durable Objects notes

## What shipped

- `worker/`: Cloudflare Worker router with `/health`, `/api/config`,
  `/api/lobby`, `/api/verify`, `/api/tx`, `/api/tx/submit`, `/ws` and
  `/ws/table/<id>`, CORS allowlist, Cloudflare-country geo blocking, WebSocket
  origin checks and a 16 KB JSON body limit.
- `LobbyDurableObject`: single named hub and table registry, `create`, `join`,
  `quickMatch`, `leave`, reconnect, lobby broadcasts and per-viewer room fanout.
- `TableDurableObject`: 3/4 seats, bot filling, serialized Zwanzig state,
  hibernating WebSockets, alarm-driven bot/turn/review timers, seed commitment
  and reveal, round history/log hash, chat and escrow guards.
- Tables are created with all seat slots present, so quick match fills open
  human seats before creating a new bot-filled table. Two-seat tables are
  impossible: seat counts are clamped to 3 or 4.
- Legacy `app/`, `server/`, hub tests and the devnet end-to-end hub script were
  removed. Product docs now describe 20 Down only; the deployed devnet Anchor
  program remains untouched.

## Checks run

```
npm run typecheck   # shared, static client and Worker passed
npm test            # 68 shared + 11 Worker/DO integration tests passed
npm run build       # static client build passed
```

Worker coverage includes health/config CORS, preflight and unknown routes, geo
blocking, WebSocket origin rejection, paused wagering endpoints, wager-table
creation block, a full three-player bot game with a verified log hash, quick
match with no two-seat tables, four-seat bot filling, chat, reconnect by player
id and room hint, personalized hand broadcasts, turn-timeout auto-play and
escrow guards.

## Local end-to-end verification

With `wrangler dev --port 8787 --local` running and `client/public/config.js`
temporarily set to `mock: false`, the static client build was served from
`http://127.0.0.1:4173/20down/` and pointed at the local Worker. A client
speaking the same JSON messages as `GameSocketProvider` then played a complete
three-player bot game:

- table `T-2BF7E109`, seats `Static Client`, `Mara`, `Jonas`;
- seven deals through to `resolved`, winner seat 1 (0 / 29 / 11 final scores);
- revealed seed `200e59d7…7044d` matched the commitment published before play;
- `GET /api/verify?room=T-2BF7E109&round=7` returned the same seed and log hash
  `902ba2d7…df758`.

`client/public/config.js` was restored to `mock: true` afterwards so the live
GitHub Pages site keeps working before the Worker is deployed.

## Deferred to Phase 5

- Mainnet program with new program ID and treasury, restricted to the four stake
  presets.
- Worker chain adapter for build/sign/submit, deposits, settlement, ties,
  forfeits and refunds.
- `/api/tx` and `/api/tx/submit` leave their paused stubs once the audit and
  legal sign-off are recorded.
