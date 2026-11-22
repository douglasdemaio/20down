import type { GameId } from "@20down/shared";

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

const twentyDown: RuleDoc = {
  slug: "20-down",
  title: "20 Down",
  subtitle: "A German trick-taker where the lowest score wins. Start at 20 and trick your way down.",
  chips: ["32-card deck", "3–4 players", "5 cards", "Start at 20"],
  intro:
    'Zwanzig ab means "twenty down". Everyone begins at 20 points. Win tricks to knock points off your score; the first player to reach zero or below wins. It is a trick-taking game with a trump decision, a small exchange, and a very expensive penalty for taking no tricks at all.',
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
  title: "Seeds & verification",
  subtitle: "How the deal is committed, revealed and checked.",
  chips: ["Commit–reveal", "Replayable deals", "On-chain record"],
  intro:
    "Cards are never dealt in your browser, and the game server cannot quietly pick a winner. Every deal is derived from a seed that is committed before play and revealed after it, then the card order is regenerated from the seed by anyone who wants to check.",
  sections: [
    {
      title: "1. Commit",
      paragraphs: [
        "At the start of a game the server generates a 32-byte seed and publishes sha256(seed) as the seed commitment. At a wager table the commitment is written to the on-chain table before any card is dealt.",
      ],
    },
    {
      title: "2. Derive",
      paragraphs: [
        "Card order comes from a deterministic SHA-256 counter-mode stream keyed by the seed, the game and the deal number. Values are rejection-sampled, so there is no modulo bias.",
        "The shuffle is platform-independent. The TypeScript and Rust implementations are checked against the same published parity vectors.",
      ],
    },
    {
      title: "3. Reveal and replay",
      paragraphs: [
        "When a game ends the seed is revealed and, for USDC tables, recorded on-chain. Anyone can recompute the deal and compare it to the published result.",
        "Use the Verify page to paste a table code and round, or follow the verification link on a settled table.",
      ],
    },
    {
      title: "Trust boundaries",
      paragraphs: [
        "The mainnet program binds the seed commitment and the oracle-attested play log hash before releasing any payout. The hash commits to the complete sequence of card actions; the chain does not replay every trick.",
        "That distinction is deliberate and is documented as a trust caveat. An on-chain card replay verifier is future work.",
      ],
    },
  ],
};

const wagering: RuleDoc = {
  slug: "wagering",
  title: "Wagering, escrow & fees",
  subtitle: "How mainnet USDC tables work, what the program enforces, and where the money goes.",
  chips: ["0.10–1.00 USDC", "0.02 fee / player", "Human-only tables"],
  intro:
    "Wager tables are opt-in and human-only. Every seat deposits the same stake plus a flat platform fee into a program-owned escrow account. The winner receives the stake pot; the treasury receives the fee pot. Free tables never touch a wallet.",
  sections: [
    {
      title: "Launch status",
      paragraphs: [
        "Mainnet wagering is disabled until an independent security audit and legal/jurisdictional sign-off are complete. Free play remains available.",
      ],
    },
    {
      title: "Stakes and fees",
      bullets: [
        "Stake per player: 0.10, 0.25, 0.50 or 1.00 USDC only.",
        "1.00 USDC is a per-player ceiling, not a cap on the total pot.",
        "Every player at a table must use the identical stake.",
        "Platform fee: 0.02 USDC per player, per game, charged once at final settlement on top of the stake.",
        "The fee is not charged again on a carry-over re-ante.",
      ],
      paragraphs: [
        "At the 0.10 USDC stake, the 0.02 USDC fee is a fifth of the stake. The deposit screen always shows the total before you sign.",
      ],
    },
    {
      title: "Escrow and payout",
      paragraphs: [
        "Deposits go to a program-owned escrow token account (a PDA of the table), not to the server or another player. On settlement the program pays the stake pot to the winning seat's wallet and the fee pot to the treasury.",
        "The program rejects mismatched stakes, stakes outside the four presets, double claims, and payouts that are not backed by an on-chain state record.",
      ],
    },
    {
      title: "Ties and re-antes",
      bullets: [
        "A tied game carries the entire pot into a new game.",
        "Every player has 60 seconds to re-ante the same stake.",
        "Players who do not re-ante forfeit their share of the carried pot to the players who do.",
        "The platform fee is charged only once for the whole carried game.",
      ],
    },
    {
      title: "Timeouts, forfeits and refunds",
      bullets: [
        "A card turn has a 60-second clock.",
        "At a wager table a timed-out seat forfeits its stake to the remaining players.",
        "In free play the server auto-plays the timed-out seat to keep the table moving.",
        "If a game cannot start, deposits are refundable. You can leave and reclaim your stake while the table is still in its waiting room.",
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

export const RULE_DOCS: RuleDoc[] = [twentyDown, fairness, wagering];

export function ruleDoc(slug: string): RuleDoc | null {
  return RULE_DOCS.find((doc) => doc.slug === slug) ?? null;
}

export const GAME_RULES: Record<GameId, RuleDoc> = {
  "zwanzig-ab": twentyDown,
};
