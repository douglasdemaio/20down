import type { GameId } from "@wagerwake/shared";

export interface RuleSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  example?: string;
}

export interface RuleDoc {
  slug: string;
  title: string;
  subtitle: string;
  chips: string[];
  intro: string;
  sections: RuleSection[];
  playHref?: string;
}

const ship: RuleDoc = {
  slug: "ship-captain-crew",
  title: "Ship, Captain & Crew",
  subtitle: "Five dice, three rolls, and whatever cargo is left in the hold.",
  chips: ["5 dice", "2–8 players", "3 rolls", "Cargo 2–12"],
  intro:
    "A classic bar game. You are crewing a ship: first find the vessel, then its captain, then the crew. Once all three are aboard, everything else in the cup is cargo — and the heaviest cargo wins.",
  playHref: "/",
  sections: [
    {
      title: "The object",
      paragraphs: [
        "Score the highest cargo total after locking a Ship (6), a Captain (5) and a Crew (4), in that order.",
      ],
    },
    {
      title: "A turn",
      paragraphs: [
        "Roll all five dice. After each roll, the game automatically locks the next required die if it is showing — you never choose whether to keep the ship, captain or crew.",
        "You have at most three rolls in a turn. Before the third roll you may reroll any unlocked dice. The moment the third required die locks, the two remaining dice become your cargo.",
        "If you have rolls left, you may reroll either or both cargo dice to try for a bigger total.",
      ],
      bullets: [
        "Ship = 6, locked first.",
        "Captain = 5, locked second.",
        "Crew = 4, locked third.",
        "Cargo = the two dice still unlocked after all three are aboard.",
      ],
    },
    {
      title: "Scoring",
      paragraphs: [
        "If you finish with all three titles, your score is the sum of the two cargo dice, from 2 to 12.",
        "If you never lock all three, you score 0 for the round.",
      ],
      example:
        "Roll: 6 5 2 1 3. The 6 locks (ship). You reroll the 5? No — you reroll 2 1 3 and get 5 2 4. The 5 locks (captain) and the 4 locks (crew). Cargo is the remaining 2, so the score is 2. With a roll left you may reroll the 2.",
    },
    {
      title: "Winning the round",
      paragraphs: [
        "Highest cargo wins. If two or more players share the highest cargo, the round is a tie.",
        "In free play a tie replays the round. At a wager table the pot carries over and every player must re-ante the same stake to stay in.",
      ],
    },
  ],
};

const horses: RuleDoc = {
  slug: "horses",
  title: "Horses",
  subtitle: "Most of a kind wins — ones are wild, and the leader's call sets the pace.",
  chips: ["5 dice", "2–8 players", "3 rolls", "Ones wild"],
  intro:
    "A push-your-luck matching game. Collect as many dice of one face as you can. The first player's roll count becomes the table's limit, so a brave one-roll hand can shut everyone else out of a reroll.",
  playHref: "/",
  sections: [
    {
      title: "The object",
      paragraphs: [
        "Finish with the most dice showing the same face. A hand of five matching dice is a \"horse\".",
      ],
    },
    {
      title: "Ones are wild",
      paragraphs: [
        "Every 1 can stand in for any face. A hand made entirely of ones counts as five ones — it does not become five sixes, so a natural five-six hand still beats it.",
      ],
    },
    {
      title: "The leader's call",
      paragraphs: [
        "The first player rolls and may use up to three rolls in total. Whatever roll count they finish on becomes the maximum for every player after them.",
        "If the leader finishes in one roll, nobody else may reroll. If they use three rolls, everyone may use up to three. A later player only becomes the leader by beating the current best hand — and their roll count then caps the players after them.",
      ],
      bullets: [
        "More matching dice beats fewer matching dice.",
        "If the match count is equal, fewer rolls used wins.",
        "If both are equal, the higher matching face wins.",
      ],
    },
    {
      title: "Scoring example",
      paragraphs: [
        "You roll 4 4 1 2 6. The two 4s plus the wild 1 make three 4s. With one roll left you could reroll the 2 and 6, but you must finish within the leader's limit.",
      ],
      example:
        "Leader: four 3s in two rolls. You: four 5s in two rolls. You win on the face value because the matches and roll counts are equal.",
    },
    {
      title: "Ties",
      paragraphs: [
        "An exact tie at the top carries the pot at a wager table; in free play the round is replayed.",
      ],
    },
  ],
};

const zwanzig: RuleDoc = {
  slug: "zwanzig-ab",
  title: "Zwanzig ab (20 Down)",
  subtitle: "A German trick-taker where the lowest score wins. Start at 20 and shed a point per trick.",
  chips: ["32-card deck", "2–4 players", "5 cards", "Start at 20"],
  intro:
    "Zwanzig ab means \"twenty down\". Everyone begins at 20 points. Win tricks to knock points off your score; the first player to reach zero or below wins. It is a trick-taking game with a trump decision, a small exchange, and a very expensive penalty for taking no tricks at all.",
  playHref: "/",
  sections: [
    {
      title: "The deck and rank",
      paragraphs: [
        "A 32-card French deck is used: A, 10, K, Q, J, 9, 8, 7 in each suit. The unusual part is that the 10 outranks the King.",
      ],
      bullets: ["Rank order, high to low: A, 10, K, Q, J, 9, 8, 7."],
    },
    {
      title: "The deal",
      paragraphs: [
        "Each player receives five cards. The dealer deals two cards to each player, then the player to the dealer's left — the declarer — chooses trump. The remaining three cards per player are then dealt.",
        "Starting with the declarer, each player may swap up to three cards with the talon (the undealt stock). Swapping is optional.",
        "After the exchange, each player announces whether they will play the deal or drop out. The declarer may never drop out.",
      ],
    },
    {
      title: "Scoring a deal",
      paragraphs: [
        "Each trick you win removes 1 point from your score. A player who plays the deal but wins no tricks adds 5 points instead.",
        "If hearts are trump, every score change is doubled: −2 per trick and +10 for taking no trick.",
      ],
      bullets: [
        "Win a trick: −1 point (−2 with hearts).",
        "Play but win nothing: +5 points (+10 with hearts).",
        "Drop out before play: no change.",
      ],
    },
    {
      title: "Playing a trick",
      paragraphs: [
        "The declarer leads the first trick. Follow suit if you can. If you cannot follow, play a trump if you have one; otherwise play any card.",
        "There is no obligation to overtake. The highest trump wins the trick; if no trump was played, the highest card of the led suit wins. The winner leads the next trick.",
      ],
    },
    {
      title: "Special trumps and the endgame",
      bullets: [
        "Hearts as trump: all scoring is doubled.",
        "Diamonds as trump: nobody may drop out of the deal.",
        "The declarer can never drop out.",
        "After eight deals, hearts is forced trump, nobody may drop out, and scores stay doubled.",
      ],
      paragraphs: [
        "The first player to reach zero or below wins. If several players get there on the same deal, the most negative score wins. If the lowest scores are equal, another deal is played.",
      ],
    },
  ],
};

const fairness: RuleDoc = {
  slug: "fairness",
  title: "Seeds, VRF & verification",
  subtitle: "How the dice are generated, committed and replayed.",
  chips: ["Commit–reveal", "Replayable dice", "On-chain record"],
  intro:
    "Dice are never rolled in your browser, and the game server cannot quietly pick a winner. Every round is derived from a seed that is committed before play and revealed after it, then the dice are replayed from the seed and the players' reroll choices.",
  sections: [
    {
      title: "1. Commit",
      paragraphs: [
        "At the start of a round the server generates a 32-byte seed and publishes sha256(seed) as the seed commitment. At a wager table the commitment is written to the on-chain table before any roll.",
      ],
    },
    {
      title: "2. Derive",
      paragraphs: [
        "Dice and card order come from a deterministic SHA-256 counter-mode stream keyed by the seed, the game and the round. Values are rejection-sampled, so there is no modulo bias.",
        "For the dice games the server records only your reroll masks — which dice you chose to reroll. The complete turn is re-derived from the seed and those masks.",
      ],
    },
    {
      title: "3. Reveal and replay",
      paragraphs: [
        "When a round ends the seed is revealed and, for USDC tables, recorded on-chain. Anyone can recompute every die and compare it to the published result.",
        "Use the Verify page to paste a room and round, or follow the verification link on a settled table. The verifier runs the same TypeScript engine the server uses.",
      ],
    },
    {
      title: "Trust boundaries",
      paragraphs: [
        "Dice rounds are fully replayed by the Solana program (resolve_dice_round), so a payout cannot be recorded for a score the chain cannot reproduce.",
        "Zwanzig ab card play is resolved by an oracle-attested log hash in this version. The hash binds the seed and the complete play log, but the chain does not independently replay every card. This is documented as a trust caveat; an on-chain card verifier is on the roadmap.",
        "Devnet randomness is an oracle-signed record_vrf. The production seam is a Switchboard On-Demand randomness account; the commitment, derivation and verification code is unchanged.",
      ],
    },
  ],
};

const wagering: RuleDoc = {
  slug: "wagering",
  title: "Wagering, escrow & fees",
  subtitle: "How USDC tables work, what the program enforces, and where the money goes.",
  chips: ["0.01–1.00 USDC", "0.02 fee / player", "On-chain escrow"],
  intro:
    "Wager tables are opt-in. Every seat deposits the same stake plus a flat platform fee into a program-owned escrow account. The winner receives the full stake pot; the treasury receives the fee pot. Free tables never touch a wallet.",
  sections: [
    {
      title: "Stakes and fees",
      bullets: [
        "Stake per player: 0.01 to 1.00 USDC, enforced by the program.",
        "Every player at a table must use the identical stake.",
        "Platform fee: 0.02 USDC per player, per game, charged once at final settlement on top of the stake.",
        "The fee is not charged again on a carry-over re-ante.",
      ],
      paragraphs: [
        "At the minimum 0.01 USDC stake, the 0.02 USDC fee is twice the stake. The deposit screen always shows the total before you sign.",
      ],
    },
    {
      title: "Escrow and payout",
      paragraphs: [
        "Deposits go to a program-owned escrow token account (a PDA of the table), not to the server or another player. On settlement the program pays the stake pot to the winning seat's wallet and the fee pot to the treasury.",
        "The program rejects mismatched stakes, deposits above 1.00 USDC, double claims, and payouts that are not backed by an on-chain randomness record.",
      ],
    },
    {
      title: "Ties and re-antes",
      bullets: [
        "A tied round carries the entire pot into a new round.",
        "Every player has 60 seconds to re-ante the same stake.",
        "Players who do not re-ante forfeit their share of the carried pot to the players who do.",
        "The platform fee is charged only once for the whole carried game.",
      ],
    },
    {
      title: "Timeouts, refunds and leaving",
      paragraphs: [
        "A dice turn has a 60-second clock. At a wager table a timed-out seat forfeits its stake to the remaining players; in free play the server simply stands or auto-plays to keep the table moving.",
        "If a game cannot start, deposits are refundable. You can leave and reclaim your stake while the table is still in its waiting room.",
        "Zwanzig ab turns auto-play on timeout because card settlement has no mid-game forfeit path in this version.",
      ],
    },
    {
      title: "Responsible play",
      bullets: [
        "18+ only, and only where online wagering is legal.",
        "Geo-blocking is enforced when the deployment configures blocked regions.",
        "Every session has a loss limit that caps cumulative wager deposits; it resets when the tab closes.",
        "Need a break? Visit BeGambleAware.org.",
      ],
    },
  ],
};

export const RULE_DOCS: RuleDoc[] = [ship, horses, zwanzig, fairness, wagering];

export function ruleDoc(slug: string): RuleDoc | null {
  return RULE_DOCS.find((doc) => doc.slug === slug) ?? null;
}

export const GAME_RULES: Record<GameId, RuleDoc> = {
  "ship-captain-crew": ship,
  horses,
  "zwanzig-ab": zwanzig,
};
