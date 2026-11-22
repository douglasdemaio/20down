# Fairness & verification

See [`docs/vrf.md`](../vrf.md) for the full commit–reveal design, the exact
stream derivation, what the chain enforces at settlement, and the honest trust
boundary for the card game in this version.

Quick start:

- Open `/verify` in the app and enter a table code (and round).
- Or query the Worker directly: `GET /api/verify?room=<room>&round=<n>` and
  re-derive the card order and play log yourself with `@20down/shared`.
- The seed commitment is published before any cards are dealt; the revealed
  seed is published with the final round record. Wager tables also record both
  on-chain (`commit_seed`, `record_vrf`) once the mainnet program ships.
