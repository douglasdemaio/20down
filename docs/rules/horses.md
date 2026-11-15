# Horses — house rules

Five dice, up to three rolls. Most matching dice wins, ones are wild, and the
leader makes the call.

## The object

Collect the most dice showing one face. Ranking is compared in this order:

1. **Matching dice** — more is better (5 > 4 > 3 > 2 > 1).
2. **Fewer rolls used** wins on an equal match count.
3. **Higher face value** wins only after roll count ties — 6 high, 1 low.

## Ones are wild

Every 1 may stand for any face. A hand made entirely of ones counts as five
ones (face 1) — it does **not** become five sixes, so a natural five-six hand
remains the unique best hand.

## The leader's call

The first player may use up to three rolls. Whatever roll count they *finish*
on becomes the maximum roll count for every later player:

- Leader finishes in one roll → nobody else may reroll.
- Leader uses three → everyone may use up to three.
- A later player becomes the leader only by beating the current best hand, and
  their roll count then caps the players still to come.

Unit-test examples that must always hold:

- Leader: three 4s in 2 rolls. Four 1s in 2 rolls **takes the lead**. Three 4s
  in 1 roll **takes the lead**.
- Leader: four 2s in 3 rolls. Three 5s in 3 rolls **does not take the lead**.
  Four 3s in 3 rolls **does take the lead**.
- Five 6s in 1 roll is the best possible hand. Only another five 6s in 1 roll
  ties it — and an exact tie pushes the pot.

## Ties

An exact tie at the top carries the pot over at a wager table and replays the
round in free play.
