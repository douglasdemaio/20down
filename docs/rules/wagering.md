# Wagering, escrow & fees

Wagering is **mainnet-only** and stays paused until the independent security
audit and legal/jurisdictional sign-off are complete. Free tables never ask for
a wallet signature; USDC tables are human-only.

## Stakes and fees

- Stake presets: **0.10, 0.25, 0.50 and 1.00 USDC** per player per round. The
  1.00 preset is a per-player ceiling, not a total pot cap.
- Every player at a table stakes the identical amount.
- Platform fee: **0.02 USDC per player, per game**, charged once at final
  settlement, on top of the stake. It is *not* recharged on carry-over
  re-antes.
- The mainnet treasury is assigned with the new program in Phase 5; the address
  in the legacy devnet program is not reused.
- The deposit screen always shows stake + fee before you sign.

## Escrow

Deposits land in a **program-owned escrow token account** — a PDA of the table,
not of the Worker, another player, or any admin. The program pays out directly:

- `pot_stakes` → the winning seat's wallet.
- `pot_fees`  → the treasury's USDC token account.

The program rejects mismatched stakes, over-limit deposits, double claims, and
any payout not backed by an on-chain commitment and settlement record.

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

- 20 Down turns auto-play on timeout (no mid-game card forfeit in this version).
- While a table is in its waiting room, a player may leave and reclaim their
  full stake from escrow. Once a deposit is recorded, the Worker blocks joining
  a different table until the original table settles or refunds.
- If a game cannot start, deposits are refundable in full.

## Compliance

- 18+ confirmation and terms acceptance before the app is usable; wager mode
  additionally reminds every table.
- Geo-blocking is enforced at the Worker edge via `GEO_BLOCKLIST` and the
  Cloudflare country header.
- A per-session loss limit caps cumulative wager deposits; it resets when the
  browser tab closes.
- Responsible-gambling link (BeGambleAware.org) is shown in the gate, the
  header banner and the footer.

There is no devnet-first rollout for this build. Mainnet wagering only ships
after the audit and legal sign-off are recorded.
