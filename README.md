# 20 Down

A three- or four-player trick-taking game with free play against bots and
mainnet USDC wagering on Solana.

The product is being rebuilt as a static GitHub Pages client backed by
Cloudflare Workers and Durable Objects. The approved design and staged plan
live in:

- `docs/superpowers/specs/2026-11-22-20down-redesign-design.md`
- `docs/superpowers/plans/2026-11-22-20down-redesign.md`
- `docs/20down-phase0-spikes.md`

> **Launch status:** free play is the product today. Mainnet wagering stays
> disabled until an independent security audit and legal/jurisdictional
> sign-off are complete. `wageringEnabled` is `false` in the shipped client
> config.

## Repository layout

```
client/     Vite + React + TypeScript static frontend deployed to GitHub Pages
packages/   Shared 20 Down engine, RNG, settlement rules and wire protocol
worker/     Cloudflare Worker + Durable Objects backend (Phase 4)
programs/   Anchor programs; wagerwake is the legacy devnet program only
docs/       Design, implementation plan and phase findings
app/        Legacy Next.js shell (kept until the static client cutover)
server/     Legacy Node hub (kept until the Worker cutover)
```

The deployed devnet program `CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt` is
retained for history and testing only. It is not modified, redeployed, or used
by the new product. A new mainnet program will get a new program ID and
treasury.

## Game and stakes

- 32-card deck: A, 10, K, Q, J, 9, 8, 7 in each suit.
- Start at 20 points. Win a trick to remove 1 point. Take no tricks and add 5.
- Hearts as trump doubles every score change; diamonds forces everyone to play.
- Stake presets: `0.10`, `0.25`, `0.50` and `1.00` USDC per player. The `1.00`
  preset is a per-player ceiling, not a total pot cap.
- Platform fee: `0.02` USDC per player, charged once at settlement.
- Free tables are 3 or 4 players and may be filled by bots. USDC tables are
  human-only.

## Develop locally

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

The dev server runs the static client on <http://localhost:5173/20down/>. By
default `client/public/config.js` uses the in-browser mock Worker, so the
lobby, quick match, table deep links and a full bot game work without a backend
or wallet.

### Runtime config

`client/public/config.js` is shipped with the static site and read at startup,
so the same build can be promoted without rebuilding:

| Key | Purpose |
| --- | ------- |
| `apiBaseUrl` | Worker HTTP origin; empty means same-origin API routes |
| `wsUrl` | Explicit WebSocket URL; empty derives it from `apiBaseUrl` |
| `mock` | `true` uses the local browser simulator; `false` uses the Worker |
| `rpcUrl` | Solana mainnet RPC endpoint for wallet adapter connections |
| `programId` | Mainnet program ID (empty until Phase 5) |
| `wageringEnabled` | Master switch; stays `false` until audit and legal sign-off |

The GitHub Pages workflow builds `client/` and deploys `client/dist`, including
a `404.html` copy of the SPA shell so `/20down/table/<id>` deep links load the
client.

## Checks

```bash
npm run typecheck   # shared package + static client
npm test            # shared engine, RNG, settlement and parity tests
npm run build       # type-check and build the static client
```

Legacy shells still have their own scripts (`typecheck:legacy`,
`build:legacy`, `test:legacy-server`) until Phases 4 and 7 remove them.

## Player protection

The client keeps an 18+ and terms gate, jurisdiction check, per-session loss
limit and responsible-gambling links in the gate, header, footer and settings.
Geo blocking is enforced by the Worker once configured. Free tables never ask
for a wallet signature.

## License

MIT.
