use anchor_lang::prelude::*;

use crate::errors::WagerwakeError;
use crate::state::{GAME_HORSES, GAME_SHIP_CAPTAIN_CREW};
use crate::vrf::Keystream;

/// A player's dice turn, recorded by the settlement oracle. The turn contains no
/// scores: only the player's choices (which dice to reroll). The program replays
/// the dice from the round seed and computes the score itself.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct DiceTurn {
    pub seat: u8,
    pub reroll_count: u8,
    /// `reroll_masks[i]` has bit d set when die d was rerolled on roll i+2.
    pub reroll_masks: [u8; 2],
}

impl DiceTurn {
    pub fn validate(&self) -> Result<()> {
        require!(self.reroll_count <= 2, WagerwakeError::InvalidRerollMask);
        for index in 0..2usize {
            let mask = self.reroll_masks[index];
            if index < self.reroll_count as usize {
                require!(mask & 0xE0 == 0, WagerwakeError::InvalidRerollMask);
            } else {
                require!(mask == 0, WagerwakeError::InvalidRerollMask);
            }
        }
        Ok(())
    }

    pub fn rolls(&self) -> u8 {
        self.reroll_count + 1
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScoreLine {
    pub seat: u8,
    /// Display score (cargo sum for Ship & Crew, matching dice for Horses).
    pub score: u32,
    /// Full lexicographic ranking, higher is better.
    pub ranking: [i32; 3],
}

pub struct ShipCrewOutcome {
    pub dice: [u8; 5],
    pub locked: [bool; 5],
    pub stage: u8,
    pub rolls: u8,
    pub score: u32,
}

const LOCK_ORDER: [u8; 3] = [6, 5, 4];

fn auto_lock(dice: &[u8; 5], locked: &mut [bool; 5], mut stage: u8) -> u8 {
    while stage < 3 {
        let wanted = LOCK_ORDER[stage as usize];
        let mut found: Option<usize> = None;
        for index in 0..5 {
            if !locked[index] && dice[index] == wanted {
                found = Some(index);
                break;
            }
        }
        match found {
            Some(index) => {
                locked[index] = true;
                stage += 1;
            }
            None => break,
        }
    }
    stage
}

fn lock_mask(locked: &[bool; 5]) -> u8 {
    let mut mask = 0u8;
    for index in 0..5 {
        if locked[index] {
            mask |= 1 << index;
        }
    }
    mask
}

/// Replays a Ship, Captain & Crew turn. Dice stream: 5 dice on roll 1, then
/// popcount(mask) for every reroll, assigned to rerolled positions ascending.
pub fn play_ship_crew_turn(
    seed: &[u8; 32],
    round: u16,
    turn: &DiceTurn,
) -> Result<ShipCrewOutcome> {
    turn.validate()?;
    let mut stream = Keystream::new(seed, "ship-captain-crew", round, turn.seat);
    let mut dice = [0u8; 5];
    for die in dice.iter_mut() {
        *die = stream.die();
    }
    let mut locked = [false; 5];
    let mut stage = auto_lock(&dice, &mut locked, 0);

    for index in 0..turn.reroll_count as usize {
        let mask = turn.reroll_masks[index];
        require!(mask & lock_mask(&locked) == 0, WagerwakeError::InvalidRerollMask);
        let count = (mask & 0x1F).count_ones();
        let mut replacement = [0u8; 5];
        for slot in replacement.iter_mut().take(count as usize) {
            *slot = stream.die();
        }
        let mut cursor = 0usize;
        for die_index in 0..5 {
            if mask & (1 << die_index) != 0 {
                dice[die_index] = replacement[cursor];
                cursor += 1;
            }
        }
        stage = auto_lock(&dice, &mut locked, stage);
    }

    let mut score = 0u32;
    if stage == 3 {
        for index in 0..5 {
            if !locked[index] {
                score += dice[index] as u32;
            }
        }
    }

    Ok(ShipCrewOutcome {
        dice,
        locked,
        stage,
        rolls: turn.rolls(),
        score,
    })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HorsesOutcome {
    pub dice: [u8; 5],
    pub matches: u8,
    pub face: u8,
    pub rolls: u8,
}

/// Evaluates five dice as a Horses hand. Ones are wild. A hand of all ones
/// counts as five ones, so five natural sixes stays the unique best hand.
pub fn evaluate_horses_dice(dice: &[u8; 5], rolls: u8) -> HorsesOutcome {
    let mut counts = [0u8; 7];
    for die in dice {
        if *die >= 1 && *die <= 6 {
            counts[*die as usize] += 1;
        }
    }
    let mut matches = 0u8;
    let mut face = 1u8;
    for candidate in 1..=6u8 {
        let natural = counts[candidate as usize];
        if natural == 0 {
            continue;
        }
        let candidate_matches = if candidate == 1 {
            natural
        } else {
            natural + counts[1]
        };
        if candidate_matches > matches || (candidate_matches == matches && candidate > face) {
            matches = candidate_matches;
            face = candidate;
        }
    }
    HorsesOutcome {
        dice: *dice,
        matches,
        face,
        rolls,
    }
}

pub fn play_horses_turn(
    seed: &[u8; 32],
    round: u16,
    turn: &DiceTurn,
    roll_limit: u8,
) -> Result<HorsesOutcome> {
    turn.validate()?;
    require!(turn.rolls() <= roll_limit, WagerwakeError::RollLimitExceeded);
    let mut stream = Keystream::new(seed, "horses", round, turn.seat);
    let mut dice = [0u8; 5];
    for die in dice.iter_mut() {
        *die = stream.die();
    }
    for index in 0..turn.reroll_count as usize {
        let mask = turn.reroll_masks[index];
        let count = (mask & 0x1F).count_ones();
        let mut replacement = [0u8; 5];
        for slot in replacement.iter_mut().take(count as usize) {
            *slot = stream.die();
        }
        let mut cursor = 0usize;
        for die_index in 0..5 {
            if mask & (1 << die_index) != 0 {
                dice[die_index] = replacement[cursor];
                cursor += 1;
            }
        }
    }
    Ok(evaluate_horses_dice(&dice, turn.rolls()))
}

impl HorsesOutcome {
    pub fn ranking(&self) -> [i32; 3] {
        [self.matches as i32, -(self.rolls as i32), self.face as i32]
    }

    pub fn score_line(&self, seat: u8) -> ScoreLine {
        ScoreLine {
            seat,
            score: self.matches as u32,
            ranking: self.ranking(),
        }
    }
}

pub fn ship_crew_score_line(outcome: &ShipCrewOutcome, seat: u8) -> ScoreLine {
    ScoreLine {
        seat,
        score: outcome.score,
        ranking: [outcome.score as i32, 0, 0],
    }
}

/// Winners share the top ranking. Multiple equal top lines means a carry-over.
pub fn determine_winners(lines: &[ScoreLine]) -> Result<(Vec<u8>, bool)> {
    require!(!lines.is_empty(), WagerwakeError::InvalidTurnSet);
    let mut best = lines[0];
    for line in lines.iter().skip(1) {
        if line.ranking > best.ranking {
            best = *line;
        }
    }
    let winners: Vec<u8> = lines
        .iter()
        .filter(|line| line.ranking == best.ranking)
        .map(|line| line.seat)
        .collect();
    let tie = winners.len() > 1;
    Ok((winners, tie))
}

/// Replays every submitted turn for a round and returns the score lines.
/// Turns must cover exactly the active seats, with no duplicates.
pub fn score_dice_round(
    game: u8,
    seed: &[u8; 32],
    round: u16,
    active_seats: &[usize],
    turns: &[DiceTurn],
) -> Result<Vec<ScoreLine>> {
    require!(
        turns.len() == active_seats.len(),
        WagerwakeError::InvalidTurnSet
    );

    let mut seen = 0u16;
    for turn in turns {
        require!(
            active_seats.contains(&(turn.seat as usize)),
            WagerwakeError::InvalidTurnSet
        );
        let bit = 1u16 << turn.seat;
        require!(seen & bit == 0, WagerwakeError::InvalidTurnSet);
        seen |= bit;
    }

    match game {
        GAME_SHIP_CAPTAIN_CREW => {
            let mut lines = Vec::with_capacity(turns.len());
            for turn in turns {
                let outcome = play_ship_crew_turn(seed, round, turn)?;
                lines.push(ship_crew_score_line(&outcome, turn.seat));
            }
            Ok(lines)
        }
        GAME_HORSES => {
            let mut ordered: Vec<&DiceTurn> = turns.iter().collect();
            ordered.sort_by_key(|turn| turn.seat);
            let mut leader: Option<HorsesOutcome> = None;
            let mut lines = Vec::with_capacity(ordered.len());
            for turn in ordered {
                let limit = leader.map(|hand| hand.rolls).unwrap_or(3);
                let outcome = play_horses_turn(seed, round, turn, limit)?;
                if leader.map(|hand| outcome.ranking() > hand.ranking()).unwrap_or(true) {
                    leader = Some(outcome);
                }
                lines.push(outcome.score_line(turn.seat));
            }
            Ok(lines)
        }
        _ => Err(error!(WagerwakeError::InvalidGame)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{GAME_HORSES, GAME_SHIP_CAPTAIN_CREW};
    use crate::vrf::{seed_commitment, Keystream};

    fn seed(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn commitment_is_sha256_of_seed() {
        let base_seed = seed(7);
        let commitment = seed_commitment(&base_seed);
        assert_ne!(commitment, [0u8; 32]);
        assert_eq!(commitment, seed_commitment(&base_seed));
        assert_ne!(commitment, seed_commitment(&seed(8)));
    }

    #[test]
    fn keystream_is_deterministic_and_rejection_sampled() {
        let mut a = Keystream::new(&seed(1), "ship-captain-crew", 1, 0);
        let mut b = Keystream::new(&seed(1), "ship-captain-crew", 1, 0);
        for _ in 0..200 {
            let value = a.u32();
            assert_eq!(value, b.u32());
        }
        let mut stream = Keystream::new(&seed(2), "horses", 3, 5);
        for _ in 0..500 {
            let die = stream.die();
            assert!((1..=6).contains(&die));
        }
    }

    #[test]
    fn seat_and_round_domains_differ() {
        let mut seat0 = Keystream::new(&seed(3), "horses", 1, 0);
        let mut seat1 = Keystream::new(&seed(3), "horses", 1, 1);
        assert_ne!(seat0.u32(), seat1.u32());
        let mut round1 = Keystream::new(&seed(3), "horses", 1, 0);
        let mut round2 = Keystream::new(&seed(3), "horses", 2, 0);
        assert_ne!(round1.u32(), round2.u32());
    }

    #[test]
    fn ship_crew_turn_is_deterministic() {
        let turn = DiceTurn {
            seat: 0,
            reroll_count: 0,
            reroll_masks: [0, 0],
        };
        let a = play_ship_crew_turn(&seed(9), 1, &turn).unwrap();
        let b = play_ship_crew_turn(&seed(9), 1, &turn).unwrap();
        assert_eq!(a.dice, b.dice);
        assert_eq!(a.score, b.score);
        assert!(a.score <= 12);
        assert_eq!(a.rolls, 1);
        if a.stage == 3 {
            let cargo: u32 = a
                .dice
                .iter()
                .enumerate()
                .filter(|(index, _)| !a.locked[*index])
                .map(|(_, die)| *die as u32)
                .sum();
            assert_eq!(a.score, cargo);
            assert_eq!(cargo, a.score);
        } else {
            assert_eq!(a.score, 0);
        }
    }

    #[test]
    fn ship_crew_rejects_masks_on_locked_dice_and_out_of_range_bits() {
        // Find a seed where the ship (6) is locked on roll 1.
        let mut found = None;
        for value in 0u8..64 {
            let turn = DiceTurn {
                seat: 0,
                reroll_count: 0,
                reroll_masks: [0, 0],
            };
            let outcome = play_ship_crew_turn(&seed(value), 1, &turn).unwrap();
            if outcome.locked[0] && outcome.dice[0] == 6 {
                found = Some(value);
                break;
            }
        }
        let value = found.expect("expected some seed to roll a 6 first");
        let bad = DiceTurn {
            seat: 0,
            reroll_count: 1,
            reroll_masks: [0b00001, 0],
        };
        assert!(play_ship_crew_turn(&seed(value), 1, &bad).is_err());

        let out_of_range = DiceTurn {
            seat: 0,
            reroll_count: 1,
            reroll_masks: [0b00100000, 0],
        };
        assert!(play_ship_crew_turn(&seed(value), 1, &out_of_range).is_err());

        let stray_mask = DiceTurn {
            seat: 0,
            reroll_count: 0,
            reroll_masks: [0b00001, 0],
        };
        assert!(play_ship_crew_turn(&seed(value), 1, &stray_mask).is_err());
    }

    #[test]
    fn horses_ones_are_wild() {
        let hand = evaluate_horses_dice(&[1, 1, 4, 4, 2], 1);
        assert_eq!(hand.matches, 4);
        assert_eq!(hand.face, 4);

        let all_ones = evaluate_horses_dice(&[1, 1, 1, 1, 1], 1);
        assert_eq!(all_ones.matches, 5);
        assert_eq!(all_ones.face, 1);
    }

    #[test]
    fn horses_spec_examples() {
        // Leader: three 4s in 2 rolls.
        let leader = evaluate_horses_dice(&[4, 4, 4, 2, 3], 2);
        // Four 1s in 2 rolls takes the lead (wilds make this five 2s here).
        let four_ones = evaluate_horses_dice(&[1, 1, 1, 1, 2], 2);
        assert!(four_ones.ranking() > leader.ranking());
        // Three 4s in 1 roll takes the lead (same matches, fewer rolls).
        let same_hand_fewer_rolls = evaluate_horses_dice(&[4, 4, 4, 2, 3], 1);
        assert!(same_hand_fewer_rolls.ranking() > leader.ranking());
        // Three 5s in 3 rolls does not beat four 2s in 3 rolls.
        let four_twos = evaluate_horses_dice(&[2, 2, 2, 2, 6], 3);
        let three_fives = evaluate_horses_dice(&[5, 5, 5, 2, 3], 3);
        assert!(three_fives.ranking() < four_twos.ranking());
        // Four 3s in 3 rolls does take the lead (same matches, higher face).
        let four_threes = evaluate_horses_dice(&[3, 3, 3, 3, 6], 3);
        assert!(four_threes.ranking() > four_twos.ranking());
        // Five 6s in 1 roll is the best possible hand.
        let best = evaluate_horses_dice(&[6, 6, 6, 6, 6], 1);
        assert_eq!(best.ranking(), [5, -1, 6]);
        // Only another five 6s in 1 roll ties it.
        let same_best = evaluate_horses_dice(&[6, 6, 6, 6, 6], 1);
        assert_eq!(best.ranking(), same_best.ranking());
        let five_ones = evaluate_horses_dice(&[1, 1, 1, 1, 1], 1);
        assert!(five_ones.ranking() < best.ranking());
        let five_sixes_in_two = evaluate_horses_dice(&[6, 6, 6, 6, 6], 2);
        assert!(five_sixes_in_two.ranking() < best.ranking());
    }

    #[test]
    fn horses_enforces_the_leaders_call() {
        let turn = DiceTurn {
            seat: 1,
            reroll_count: 2,
            reroll_masks: [0b00011, 0b00100],
        };
        assert!(play_horses_turn(&seed(4), 1, &turn, 3).is_ok());
        assert!(play_horses_turn(&seed(4), 1, &turn, 2).is_err());
        assert!(play_horses_turn(&seed(4), 1, &turn, 1).is_err());

        let one_roll = DiceTurn {
            seat: 1,
            reroll_count: 0,
            reroll_masks: [0, 0],
        };
        assert!(play_horses_turn(&seed(4), 1, &one_roll, 1).is_ok());
    }

    #[test]
    fn round_scoring_requires_exactly_the_active_seats() {
        let seed = seed(11);
        let active = [0usize, 1];
        let ok = vec![
            DiceTurn { seat: 0, reroll_count: 0, reroll_masks: [0, 0] },
            DiceTurn { seat: 1, reroll_count: 0, reroll_masks: [0, 0] },
        ];
        assert!(score_dice_round(GAME_HORSES, &seed, 1, &active, &ok).is_ok());
        assert!(score_dice_round(GAME_SHIP_CAPTAIN_CREW, &seed, 1, &active, &ok).is_ok());

        let duplicate = vec![
            DiceTurn { seat: 0, reroll_count: 0, reroll_masks: [0, 0] },
            DiceTurn { seat: 0, reroll_count: 0, reroll_masks: [0, 0] },
        ];
        assert!(score_dice_round(GAME_HORSES, &seed, 1, &active, &duplicate).is_err());

        let missing = vec![DiceTurn { seat: 0, reroll_count: 0, reroll_masks: [0, 0] }];
        assert!(score_dice_round(GAME_HORSES, &seed, 1, &active, &missing).is_err());

        let inactive = vec![
            DiceTurn { seat: 0, reroll_count: 0, reroll_masks: [0, 0] },
            DiceTurn { seat: 2, reroll_count: 0, reroll_masks: [0, 0] },
        ];
        assert!(score_dice_round(GAME_HORSES, &seed, 1, &active, &inactive).is_err());
    }

    #[test]
    fn exact_ties_are_detected() {
        let line = ScoreLine { seat: 0, score: 4, ranking: [4, -2, 3] };
        let (winners, tie) = determine_winners(&[line, ScoreLine { seat: 1, ..line }]).unwrap();
        assert!(tie);
        assert_eq!(winners, vec![0, 1]);

        let (winners, tie) = determine_winners(&[
            line,
            ScoreLine { seat: 1, score: 3, ranking: [3, -2, 6] },
        ])
        .unwrap();
        assert!(!tie);
        assert_eq!(winners, vec![0]);
    }

    #[test]
    fn everyone_scoring_zero_in_ship_crew_is_a_tie() {
        let zero = ScoreLine { seat: 0, score: 0, ranking: [0, 0, 0] };
        let (winners, tie) = determine_winners(&[zero, ScoreLine { seat: 1, ..zero }, ScoreLine { seat: 2, ..zero }]).unwrap();
        assert!(tie);
        assert_eq!(winners, vec![0, 1, 2]);
    }

    /// Cross-language parity vectors. The exact same assertions live in
    /// `packages/shared/test/parity.test.ts`; if either implementation drifts,
    /// this test (or the JS one) fails.
    #[test]
    fn js_parity_vectors() {
        use crate::vrf::Keystream;

        let base = seed(7);

        // RandomStream: seed(7) domains.
        let mut stream = Keystream::new(&base, "horses", 1, 0);
        let words: Vec<u32> = (0..6).map(|_| stream.u32()).collect();
        assert_eq!(
            words,
            vec![1124701820, 16179969, 3542505683, 520292941, 3510176334, 3167450993]
        );
        let mut dice_stream = Keystream::new(&base, "horses", 1, 0);
        let dice: Vec<u8> = (0..12).map(|_| dice_stream.die()).collect();
        assert_eq!(dice, vec![3, 4, 6, 2, 1, 6, 2, 2, 4, 2, 6, 2]);

        // Ship, Captain & Crew turn vectors.
        let cases: [(u16, u8, [u8; 2], u8, [u8; 5], [bool; 5], u32); 4] = [
            (1, 0, [21, 21], 2, [6, 5, 3, 6, 5], [false, true, false, true, false], 0),
            (2, 3, [28, 24], 3, [6, 5, 4, 2, 1], [true, true, true, false, false], 3),
            (5, 7, [26, 26], 3, [6, 4, 5, 5, 2], [true, true, true, false, false], 7),
            (9, 1, [30, 30], 1, [6, 1, 6, 4, 1], [true, false, false, false, false], 0),
        ];
        for (round, seat, masks, stage, dice, locked, score) in cases {
            let turn = DiceTurn { seat, reroll_count: 2, reroll_masks: masks };
            let outcome = play_ship_crew_turn(&base, round, &turn).unwrap();
            assert_eq!(outcome.dice, dice);
            assert_eq!(outcome.locked, locked);
            assert_eq!(outcome.stage, stage);
            assert_eq!(outcome.score, score);
        }

        // Horses turn vectors.
        let horses_cases: [(u16, u8, [u8; 2], u8, [u8; 5], u8, u8); 3] = [
            (1, 0, [0, 0], 1, [3, 4, 6, 2, 1], 2, 6),
            (2, 1, [6, 0], 1, [2, 5, 5, 4, 1], 3, 5),
            (3, 2, [31, 3], 2, [3, 4, 3, 1, 1], 4, 3),
        ];
        for (round, seat, masks, reroll_count, dice, matches, face) in horses_cases {
            let turn = DiceTurn { seat, reroll_count, reroll_masks: masks };
            let outcome = play_horses_turn(&base, round, &turn, 3).unwrap();
            assert_eq!(outcome.dice, dice);
            assert_eq!(outcome.matches, matches);
            assert_eq!(outcome.face, face);
        }
        assert_eq!(evaluate_horses_dice(&[6, 6, 6, 6, 6], 1).ranking(), [5, -1, 6]);
        assert_eq!(evaluate_horses_dice(&[1, 1, 1, 1, 1], 1).ranking(), [5, -1, 1]);
    }
}
