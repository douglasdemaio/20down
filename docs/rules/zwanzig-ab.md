# Zwanzig ab (20 Down) — house rules

A German trick-taker. Everyone starts at 20 points, tricks count you down, and
the first player to reach zero or below wins.

## Deck and rank

A 32-card French deck: A, 10, K, Q, J, 9, 8, 7 in each suit. The 10 outranks
the King. Three or four players, five cards each.

## The deal

1. The dealer gives each player two cards.
2. The player to the dealer's left (the **declarer**) chooses trump after
   seeing only these two cards. **The declarer may never drop out.**
3. Remaining cards are dealt — three more per player.
4. Starting with the declarer, each player may **exchange** up to three cards
   with the talon (optional, may pass).
5. Each player then **announces** whether they play the deal or drop out.
   - Nobody may drop out when diamonds is trump.
   - After deal 8 hearts is forced and nobody may drop out.

## Special trumps

- **Hearts** as trump: all score changes double (−2 per trick, +10 for none).
- **Diamonds** as trump: everyone must play this deal.

## Scoring a deal

| Result                        | Normal | Hearts |
| ----------------------------- | ------ | ------ |
| Win a trick                   | −1     | −2     |
| Play but win **no** trick     | +5     | +10    |
| Drop out before play          | 0      | 0      |

Scores lower is better: start at 20, and the first player to reach **zero or
below wins**. If several reach it on the same deal, the most negative score
wins; if the lowest scores are equal, deal again.

## Playing a trick

The declarer leads. Follow suit if able; otherwise play a trump if you have
one; otherwise play any card. You are never forced to overtake. The highest
trump wins, else the highest card of the led suit. The trick winner leads.

## Trust note

Card order comes from the committed seed. This version settles Zwanzig deals
with an oracle-attested log hash (`submit_card_result`) rather than a full
on-chain card replay — the hash binds the seed and the complete play log, but
the chain does not independently replay every card. See `docs/vrf.md`.
