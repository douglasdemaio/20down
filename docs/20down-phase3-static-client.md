# Phase 3 — static client notes

## What shipped

- New `client/` workspace: Vite 5, React 18, TypeScript, Tailwind, React Router.
- Parchment-and-felt visual system ported from the legacy app, with the die
  shadow token renamed to `shadow-raised`.
- Lobby actions:
  - Deal me in with bots (3 or 4 seats).
  - Open a human table with a copyable invite link.
  - Find an open table (quick match) through the new `quickMatch` protocol message.
  - Live open-tables list and one-click refresh.
- Table shell: waiting room, seat list, countdowns, table chat, fairness card,
  round summary, wager/escrow panel and the reused Zwanzig card board.
- Phantom/Solflare wallet adapters are imported only in the static client.
- `client/public/config.js` provides runtime Worker HTTP/WS and mainnet RPC
  configuration. Mock mode is on by default; wagering is off.
- `client/dist/404.html` is generated from `index.html` at build time so GitHub
  Pages serves the SPA for `/20down/table/<id>` deep links.
- `.github/workflows/deploy-pages.yml` builds `client/` and deploys `client/dist`
  to GitHub Pages on pushes to `main`.

## Wire protocol change

`ClientMessage` gained a `quickMatch` variant with `mode`, `stakeBaseUnits`,
`maxPlayers`, `name` and `wallet`. The shared type guard now accepts it.

## Checks run

```
npm run typecheck   # passed
npm test            # 68 shared tests passed
npm run build       # passed; dist has index.html, 404.html, config.js, .nojekyll
```

A Pages-like static server was used to verify:

- `/20down/` returns the app shell, `/20down/config.js` is readable, and
  `/20down/table/T-SMOKE` returns the 404 fallback with absolute `/20down/`
  asset URLs.
- The built bundle renders offline in a DOM harness with no console errors.
  Lobby DOM contains “Deal me in with bots”, “Open a human table”, “Find an
  open table” and the age/terms gate. The table deep-link DOM contains the
  mocked table code `T-SMOKE`.

## Deferred to Phase 4

- Real Worker HTTP/WebSocket transport replaces `MockSocket`.
- `/api/geo`, `/api/tx`, `/api/tx/submit` and `/api/verify` are implemented by
  the Worker; the client already calls those paths when `mock` is false.
- Lobby and Table Durable Objects become authoritative for quick match, seats,
  timers and session loss limits.
