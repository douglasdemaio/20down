# Fairness: randomness, commitments and verification

## 1. Commit

When a deal starts, the Table Durable Object generates a 32-byte seed and
publishes `sha256(seed)` as the **seed commitment** before any cards are dealt.
On a wager table this commitment is written on-chain (`commit_seed` from the
oracle to the table PDA) before play, so the server cannot later pick a
friendlier seed.

## 2. Derive

Card order comes from a deterministic SHA-256 counter-mode stream keyed by
`(seed, game, deal, ...)` in `@20down/shared`. Values are unbiased via rejection
sampling; the 32-card deck is shuffled with the same stream. The seed and the
complete play log determine every trick, score change and winner.

## 3. Reveal and replay

When the game resolves, the seed is revealed with the final round record and
recorded on-chain (`record_vrf`) together with `vrf_digest = sha256(seed || 0x00)`.
Anyone can:

1. hash the revealed seed and compare it to the published commitment;
2. re-run the shared TypeScript engine against the recorded actions;
3. compare the replayed scores to the published round record;
4. check the log hash, `sha256(seed ‖ 0x00 ‖ canonical log)`, bound to the
   result.

The **Verify** page does this in the browser against
`/api/verify?room=<id>&round=<n>` on the Worker.

## 4. What the chain enforces at payout

The mainnet program binds the payout to the committed seed, the published log
hash and the settlement oracle's attestation. It rejects a different winner, a
duplicate claim and a payout without a matching on-chain record. Full on-chain
card replay is not part of this version; the log hash plus oracle attestation
is the honest trust boundary.

## 5. Trust boundaries (v1)

- **Cards (20 Down):** committed seed + log hash + oracle attestation. The
  settlement oracle is trusted not to fabricate a play log; the seed and every
  action are bound to it.
- **Devnet history:** the legacy `programs/wagerwake` devnet program also
  supported two retired games with on-chain replay. It is retained for history
  only and is not used by the new product.
- **Randomness:** the oracle signs `record_vrf`. This binding is intentionally
  limited so the swap to a real VRF source is a config change, not a rewrite.

## 6. Production path (Switchboard On-Demand)

The documented production seam is a Switchboard On-Demand randomness account:
the server creates a randomness request tied to the table and round, and the
program verifies the account's signature/attestation before accepting it as
`table.seed`. Commitment, derivation and verification code are unchanged, so
the same fairness story survives the swap.

## 7. What to check yourself

- `/verify` in the client against any published table code and round.
- `packages/shared/test/parity.test.ts` proves the TypeScript engine's dealing
  and scoring stay bit-for-bit stable against the recorded vectors.
- `npm run test:worker` verifies the Worker publishes a seed commitment before
  play, drives a full three-player game to resolution and serves the resulting
  verified log hash from `/api/verify`.
