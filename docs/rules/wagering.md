# Wagering, escrow & fees

## Stakes and fees

- Stake per player: **0.01–1.00 USDC**, enforced by the program; any stake above
  the cap rejects the transaction.
- Every player at a table stakes the **identical** amount.
- Platform fee: **0.02 USDC per player, per game**, charged once at final
  settlement, on top of the stake. It is *not* recharged on carry-over
  re-antes.
- Fee recipient: `J59EPyPHf9wtoLjf8rG4f9cARnLnUPKCdNwZX241rakh`.
- The deposit screen always shows stake + fee before you sign.

At the minimum stake (0.01) the fee is twice the stake — by design the fee is a
fixed per-player cost, so small tables mainly pay for the platform.

## Escrow

Deposits land in a **program-owned escrow token account** — a PDA of the table,
not of the server, another player, or any admin. The program pays out directly:

- `pot_stakes` → the winning seat's wallet.
- `pot_fees`  → the treasury's USDC token account.

The program rejects mismatched stakes, over-limit deposits, double claims, and
any payout not backed by an on-chain randomness record.

## Ties and carry-over

1. A tied round leaves nobody paid and the whole carry pot in escrow.
2. The table enters an **ante round** with a 60-second clock.
3. **Every player** — not only the tied winners — must re-ante the identical
   stake during the window.
4. A player who does not re-ante forfeits their share of the pot to the
   players who do.
5. If nobody re-antes, the table is voided and everyone reclaims their stake.
6. The platform fee is charged once for the entire carried game.

## Timeouts, refunds and leaving

- Dice turns: a 60-second clock. Wager seats that time out forfeit their stake
  to the remaining players; free tables auto-stand to keep the game moving.
- Zwanzig turns auto-play on timeout (no mid-game card forfeit in this version).
- While a table is in its waiting room, a player may leave and reclaim their
  full stake from escrow.
- If a game cannot start, deposits are refundable in full.

## Compliance

- 18+ confirmation and terms acceptance before the app is usable; wager mode
  additionally reminds every table.
- Geo-blocking is configurable via `GEO_BLOCKED_COUNTRIES` (server-side header
  check, `x-vercel-ip-country` / `cf-ipcountry` / `x-country-code`).
- A per-session loss limit caps cumulative wager deposits; it resets when the
  browser tab closes.
- Responsible-gambling link (BeGambleAware.org) is shown in the gate, the
  header banner and the footer.

Always build the devnet experience first; a mainnet roll-out happens only after
an audit of the Anchor program.
