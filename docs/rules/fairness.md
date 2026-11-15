# Fairness & verification

See [`docs/vrf.md`](../vrf.md) for the full commit–reveal design, the exact
stream derivation, what the on-chain program replays at settlement, and the
honest trust boundary for card games in this version.

Quick start:

- Open `/verify` in the app and enter a table code (and round).
- Or query the hub directly: `GET /api/verify?room=<room>&round=<n>` and
  re-derive the dice yourself with `@wagerwake/shared`.
- The seed commitment is published before play; the revealed seed is published
  with the settlement. Both are recorded on wager tables (`commit_seed`,
  `record_vrf`).
