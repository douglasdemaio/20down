# Ship, Captain & Crew — house rules

Five dice, up to three rolls per turn. Crew the ship, then take cargo.

## The object

Lock a **Ship (6)**, a **Captain (5)** and a **Crew (4)**, in that order and only
in that order. Once all three are locked, the two remaining dice are your
**cargo**. The player with the highest cargo total (2–12) wins the round.

## A turn

1. Roll all five dice.
2. Locking is automatic and greedy: after every roll the engine immediately
   locks the first available required die — the 6 first, then the 5, then the
   4. You never choose whether to keep the ship, captain or crew.
3. You may reroll any unlocked dice up to twice more (three rolls total).
   A reroll mask is only legal when it leaves locked dice untouched.
4. The moment the 6-5-4 trio is complete, the unlocked dice become cargo. If
   rolls remain you may reroll either or both cargo dice, or stand.

## Scoring

- Qualified: score = the sum of the two cargo dice (2–12).
- Unqualified (never locked all three): score 0.

Example: `6 5 2 1 3`. The 6 locks. Reroll `2 1 3` and get `5 2 4` — the 5 locks
(captain) and the 4 locks (crew). Cargo is the other 2, score 2; with a roll
left you may reroll the 2.

## Winning

Highest cargo wins. Equal highest cargo — including everyone scoring 0 — is a
tie: the pot carries over and every wager player must re-ante.

## Verification

Locking is deterministic, so a turn is fully described by the round seed plus
the reroll masks you sent. The on-chain `resolve_dice_round` replays the whole
round from those inputs, so a payout can never differ from what the seed says.
