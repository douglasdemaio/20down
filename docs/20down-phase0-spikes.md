# 20 Down — Phase 0 spike findings

Date: 2026-11-22
Environment: Node v24.22.3, npm 11.19.1, workerd via `@cloudflare/vitest-plugin`
1.9.0 / Vitest 4.1.12 / Wrangler 4.166.0, `@solana/kit` 8.6.0,
`@solana-program/system` 0.16.0, Vite 8.3.8.

All spikes ran in a throwaway directory (`/tmp/opencode/20down-spike`); no
production files were changed. 12 tests pass and `tsc --noEmit` is clean.

## Spike 1 — Solana Kit + Anchor inside a Worker

**Result: supported, with two required adaptations.**

- `@solana/kit` builds and signs a v0 transaction entirely inside workerd. No
  Node-only APIs are needed for key generation, signing, or transaction
  serialization.
- Workers expose SubtleCrypto but do **not** set `isSecureContext`. Kit asserts
  that flag before touching Web Crypto, so the Worker must set it once at
  module load:
  ```ts
  if (!globalThis.isSecureContext) {
    Object.defineProperty(globalThis, "isSecureContext", {
      value: true,
      configurable: true,
    });
  }
  ```
- Anchor instruction discriminators can be derived in-Worker with Web Crypto:
  `sha256("global:<instruction_name>")[0..8]`. No Anchor Node client needed.
- When building an instruction by hand, a signer account meta must carry the
  signer object itself, not just its address:
  ```ts
  { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer }
  ```
  Passing only the `Address` produces `Transaction is missing signatures for
  addresses: …` at signing time. (This is what Kit's generated instruction
  builders do internally via `getAccountMetaFactory`.)
- Outbound JSON-RPC from the Worker works with `createSolanaRpc(...).getSlot().send()`.

**Blocker / constraint:** public Solana RPC endpoints block cloud IPs. From
workerd, `https://api.mainnet-beta.solana.com` and `https://api.devnet.solana.com`
return `403 {"message":"Your IP or provider is blocked from this endpoint"}`.
`https://solana-rpc.publicnode.com` works for reads but is unsuitable for a
production oracle. **A dedicated RPC provider (API key in Worker secrets) is
required.** The new mainnet program ID and treasury are distinct from the
existing devnet program (`CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt`).

**Exit criterion status:** signing met the exit criterion; on-chain submission
was not performed. There is no funded oracle keypair or mainnet deployment yet,
and launch is gated on audit + legal sign-off. The chain adapter can be built
on the patterns above; submission testing belongs in Phase 2 with a dedicated
RPC provider and a test key.

## Spike 2 — Durable Object WebSocket hibernation + alarms

**Result: supported in local Miniflare.**

- Hibernation API works: `ctx.acceptWebSocket(server)`,
  `ws.serializeAttachment()` / `ws.deserializeAttachment()`,
  `ctx.getWebSockets()`, and `ctx.setWebSocketAutoResponse(new
  WebSocketRequestResponsePair("ping", "pong"))`.
- Session attachment round-trips correctly and distinguishes two concurrent
  connections (`playerId: alice` vs `playerId: bob`, `connections: 2`).
- `ctx.storage.setAlarm(Date.now() + delay)` fires `alarm()`, which both
  persists state and broadcasts a timeout message to open sockets.
- One gotcha: in `webSocketClose`, close codes 1005/1006 are invalid to echo
  back — calling `ws.close(1005, …)` throws `InvalidAccessError`. Sanitize the
  code before replying.

**Caveat:** Miniflare does not force Hibernate eviction, so "attachment survives
actual eviction" was not directly observed. The attachment is serialized into
DO storage by the runtime API, which is the documented mechanism; reconnect
after a real eviction should be re-verified in staging.

## Spike 3 — GitHub Pages static routing + cross-origin worker

**Result: supported.**

- Vite `base: "/20down/"` emits absolute `/20down/assets/...` URLs, so a
  document served at `/20down/table/<id>` still loads its JS/CSS.
- A build plugin copies `dist/index.html` → `dist/404.html`. GitHub Pages serves
  that file for unknown paths, so deep links load the SPA (verified with a
  local static server simulating Pages: `/20down/table/tbl_123` returned the
  SPA HTML with working asset paths).
- Cross-origin API calls: Worker returns `Access-Control-Allow-Origin` reflecting
  the allowlisted origin, `Vary: Origin`, `Access-Control-Allow-Methods`, and
  answers `OPTIONS` preflight with 204. Unknown origins get `null` (no wildcard
  reflection).
- WebSockets are not governed by CORS. The Worker must check the `Origin` header
  itself; allowlisted GitHub Pages / localhost origins are accepted and others
  are rejected with 403. Recommended allowlist:
  `https://douglasdemaio.github.io` (repo rename → `20down` changes this URL to
  `https://douglasdemaio.github.io/20down/`, but the Origin header is just the
  scheme+host, so the existing entry remains correct) and `http://localhost:5173`
  for development.

**Caveat:** the plan's exit criterion says "deployed test page loads a deep link
and opens a test WebSocket." This spike verified the build output and local
static serving plus Worker-side origin/CORS handling in Miniflare; it did not
deploy to GitHub Pages. A live smoke test should be done in Phase 3 once the
repo is renamed and Pages is enabled.

## Plan adjustments

1. Add a dedicated Solana mainnet RPC provider + API key secret to Phase 2
   (blocking for the chain adapter, not for the spike).
2. Treat on-chain submission verification as a Phase 2 task with a funded test
   key, not a Phase 0 exit requirement.
3. Include an origin allowlist check in the Worker WebSocket upgrade path when
   porting `server/src/index.ts` (Phase 2).
4. Include a live GitHub Pages deep-link smoke test in Phase 3 (or in the
   deployment section of Phase 5) since the local simulation passed.
5. No changes to the overall phase order or architecture are needed.
