# Fairness: randomness, commitments and verification

## 1. Commit

At the start of every round the server generates a 32-byte seed and publishes
`sha256(seed)` as the **seed commitment** — at a wager table on-chain, before
any roll or shuffle (`commit_seed` from the oracle to the table PDA). Because
the commit exists before play, the server cannot later pick a friendlier seed.

## 2. Derive

All dice and card order comes from a deterministic SHA-256 counter-mode stream
keyed by `(seed, game, round, seat)`. Values are unbiased via rejection
sampling — no modulo bias in any die or shuffle. The server records only the
players' **reroll masks**: the complete dice turn is re-derived from the seed
and those masks, making dice rounds fully reproducible.

## 3. Reveal and replay

When a round resolves, the seed is revealed and recorded on-chain
(`record_vrf`) together with `vrf_digest = sha256(seed || 0x00)`. Anyone can:

1. hash the revealed seed and compare it to the on-chain commitment;
2. re-run the shared TypeScript (`@20down/shared`) or the Rust engine;
3. compare the replayed scores to the published round record;

never trusting the server for the result. The **Verify** page does exactly
this in the browser against `/api/verify?room=<id>&round=<n>`.

## 4. What the chain enforces at payout

For dice games the program itself replays the round (`resolve_dice_round`)
from `table.seed`, the recorded reroll masks and the active seats, so the
program — not the server — computes the winner, and `pay_out` will not accept
a different one. Ship & Crew and Horses are therefore fully trust-minimised.

## 5. Trust boundaries (v1)

- **Dice (Ship & Crew, Horses):** on-chain replay. The server cannot choose
  outcomes because the masks plus seed fully determine them.
- **Cards (Zwanzig ab):** devnet v1 publishes a *log hash*
  (sha256(seed ‖ 0x00 ‖ canonical log)) with the result via
  `submit_card_result`. The seed and every action are bound, but the chain
  does not independently replay each card — the settlement oracle is trusted.
  On-chain card verification is on the roadmap.
- **Devnet randomness:** the oracle signs `record_vrf`. This binding is
  intentionally limited so the production swap to a real VRF source is a
  config change, not a rewrite.

## 6. Production path (Switchboard On-Demand)

The documented production seam is a Switchboard On-Demand randomness account:
the server creates a randomness request tied to the table and round, and the
program verifies the account's signature/attestation before accepting it as
`table.seed`. Commitment, derivation and verification code are unchanged, so
replay-based fairness survives the swap.

## 7. What to check yourself

- `/verify` in the app (or `docs/others`: reconcile a room transcript).
- `packages/shared/test/parity.test.ts` and
  `programs/wagerwake/src/games.rs::js_parity_vectors` prove the TS and Rust
  engines agree bit-for-bit on the same vectors.
