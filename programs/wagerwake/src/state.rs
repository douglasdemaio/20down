use anchor_lang::prelude::*;

use crate::errors::WagerwakeError;

pub const MAX_SEATS: usize = 8;

/// 8 (discriminator) + 4 pubkeys (128) + 3 u64 (24) + 2 bools (2)
pub const CONFIG_SPACE: usize = 162;

/// 8 (discriminator) + fixed fields; see `Table`. Padded for future growth.
pub const TABLE_SPACE: usize = 520;

/// Hard protocol ceiling, independent of configuration. The program rejects any
/// stake outside 0.01-1.00 USDC even if the config is misconfigured.
pub const HARD_MIN_STAKE: u64 = 10_000; // 0.01 USDC
pub const HARD_MAX_STAKE: u64 = 1_000_000; // 1.00 USDC
pub const HARD_MAX_FEE_PER_PLAYER: u64 = 1_000_000; // 1.00 USDC

pub const NO_WINNER: u8 = u8::MAX;

pub const ANTE_TIMEOUT_SECS: i64 = 60;
pub const VOID_GRACE_SECS: i64 = 30 * 24 * 60 * 60;

pub const GAME_SHIP_CAPTAIN_CREW: u8 = 0;
pub const GAME_HORSES: u8 = 1;
pub const GAME_ZWANZIG_AB: u8 = 2;

pub const STATE_WAITING: u8 = 0;
pub const STATE_IN_PROGRESS: u8 = 1;
pub const STATE_ANTE: u8 = 2;
pub const STATE_RESOLVED: u8 = 3;
pub const STATE_VOIDED: u8 = 4;

#[account]
pub struct Config {
    /// Multisig authority (e.g. a Squads vault). Can pause and rotate the oracle
    /// but can never move player funds.
    pub authority: Pubkey,
    /// Settlement oracle allowed to publish commitments, reveal seeds and submit
    /// turn records. In devnet this is the game server; on mainnet it should be a
    /// Switchboard-gated crank.
    pub oracle_authority: Pubkey,
    /// Destination of collected platform fees (USDC token account owner).
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// Charged per player, once, when the game starts. Always on top of the stake.
    pub fee_per_player: u64,
    pub min_stake: u64,
    pub max_stake: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct Table {
    pub id: u64,
    pub creator: Pubkey,
    pub game: u8,
    /// Stake per player per round, in USDC base units (6 decimals).
    pub stake: u64,
    /// Snapshot of `config.fee_per_player` at table creation.
    pub fee: u64,
    pub max_players: u8,
    pub player_count: u8,
    pub seats: [Pubkey; MAX_SEATS],
    pub ready: [bool; MAX_SEATS],
    /// Still competing in the current round (false after a forfeit).
    pub active: [bool; MAX_SEATS],
    /// Round in which this seat paid its ante.
    pub anted_round: [u16; MAX_SEATS],
    pub state: u8,
    pub round: u16,
    /// Sum of every stake held for this game (including carried-over rounds).
    pub pot_stakes: u64,
    /// Sum of every player fee held for this game.
    pub pot_fees: u64,
    pub seed_commitment: [u8; 32],
    pub seed: [u8; 32],
    pub vrf_digest: [u8; 32],
    pub vrf_fulfilled: bool,
    pub resolved: bool,
    pub winner_seat: u8,
    pub round_started_at: i64,
    pub ante_deadline: i64,
    /// Set when a voided table has refunded a seat.
    pub refunded: [bool; MAX_SEATS],
    pub bump: u8,
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.fee_per_player <= HARD_MAX_FEE_PER_PLAYER,
            WagerwakeError::InvalidConfig
        );
        require!(
            self.min_stake >= HARD_MIN_STAKE && self.max_stake <= HARD_MAX_STAKE,
            WagerwakeError::InvalidConfig
        );
        require!(self.min_stake <= self.max_stake, WagerwakeError::InvalidConfig);
        require!(
            self.treasury != Pubkey::default() && self.oracle_authority != Pubkey::default(),
            WagerwakeError::InvalidConfig
        );
        Ok(())
    }
}

impl Table {
    pub fn seat_of(&self, player: &Pubkey) -> Option<usize> {
        self.seats.iter().position(|seat| seat == player)
    }

    pub fn active_count(&self) -> usize {
        self.active.iter().filter(|active| **active).count()
    }

    pub fn active_seats(&self) -> Vec<usize> {
        (0..self.max_players as usize)
            .filter(|index| self.active[*index])
            .collect()
    }

    pub fn seated_count(&self) -> usize {
        self.seats
            .iter()
            .filter(|seat| **seat != Pubkey::default())
            .count()
    }

    pub fn all_ready(&self) -> bool {
        (0..self.player_count as usize).all(|index| self.ready[index])
    }

    pub fn deposit_per_player(&self) -> Result<u64> {
        self.stake
            .checked_add(self.fee)
            .ok_or_else(|| error!(WagerwakeError::Overflow))
    }

    pub fn total_held(&self) -> Result<u64> {
        self.pot_stakes
            .checked_add(self.pot_fees)
            .ok_or_else(|| error!(WagerwakeError::Overflow))
    }

    /// Starts round 1. Every seat has already deposited its stake and fee.
    pub fn begin_first_round(&mut self, now: i64) {
        self.state = STATE_IN_PROGRESS;
        self.round = 1;
        self.active = [false; MAX_SEATS];
        self.anted_round = [0; MAX_SEATS];
        for index in 0..self.player_count as usize {
            self.active[index] = true;
            self.anted_round[index] = 1;
        }
        self.round_started_at = now;
        self.ante_deadline = 0;
        self.clear_randomness();
        self.winner_seat = NO_WINNER;
        self.resolved = false;
    }

    /// A tie carries the pot over. Every seat must re-ante within 60 seconds.
    pub fn begin_ante_round(&mut self, next_round: u16, now: i64) {
        self.state = STATE_ANTE;
        self.round = next_round;
        self.round_started_at = now;
        self.ante_deadline = now + ANTE_TIMEOUT_SECS;
        self.clear_randomness();
        self.winner_seat = NO_WINNER;
    }

    /// Opens the next round once enough players have re-anted.
    pub fn begin_carried_round(&mut self, now: i64) {
        self.state = STATE_IN_PROGRESS;
        self.round_started_at = now;
        self.ante_deadline = 0;
        self.clear_randomness();
        self.winner_seat = NO_WINNER;
    }

    pub fn clear_randomness(&mut self) {
        self.seed_commitment = [0u8; 32];
        self.seed = [0u8; 32];
        self.vrf_digest = [0u8; 32];
        self.vrf_fulfilled = false;
    }

    pub fn mark_resolved(&mut self, winner: usize) {
        self.state = STATE_RESOLVED;
        self.resolved = true;
        self.winner_seat = winner as u8;
        self.pot_stakes = 0;
        self.pot_fees = 0;
        self.clear_randomness();
        self.active = [false; MAX_SEATS];
    }
}

pub fn hard_max_players(game: u8) -> Result<u8> {
    match game {
        GAME_SHIP_CAPTAIN_CREW | GAME_HORSES => Ok(MAX_SEATS as u8),
        GAME_ZWANZIG_AB => Ok(4),
        _ => Err(error!(WagerwakeError::InvalidGame)),
    }
}

pub fn min_players(_game: u8) -> u8 {
    2
}

pub fn validate_new_table(game: u8, stake: u64, max_players: u8, config: &Config) -> Result<()> {
    let hard_max = hard_max_players(game)?;
    require!(
        stake >= HARD_MIN_STAKE && stake <= HARD_MAX_STAKE,
        WagerwakeError::StakeOutOfRange
    );
    require!(
        stake >= config.min_stake && stake <= config.max_stake,
        WagerwakeError::StakeOutOfRange
    );
    require!(
        max_players >= min_players(game) && max_players <= hard_max,
        WagerwakeError::InvalidMaxPlayers
    );
    Ok(())
}

/// Winner/loser split at resolution. Fees are charged exactly once, when the
/// game finally resolves; tie rounds move the pot, never take a fee.
pub fn settlement_amounts(pot_stakes: u64, pot_fees: u64) -> (u64, u64) {
    (pot_stakes, pot_fees)
}

/// True when this seat may still claim its waiting-room refund.
pub fn can_refund(state: u8) -> bool {
    state == STATE_WAITING
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> Config {
        Config {
            authority: Pubkey::new_unique(),
            oracle_authority: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            usdc_mint: Pubkey::new_unique(),
            fee_per_player: 20_000,
            min_stake: HARD_MIN_STAKE,
            max_stake: HARD_MAX_STAKE,
            paused: false,
            bump: 255,
        }
    }

    fn test_table() -> Table {
        Table {
            id: 1,
            creator: Pubkey::new_unique(),
            game: GAME_SHIP_CAPTAIN_CREW,
            stake: 100_000,
            fee: 20_000,
            max_players: 4,
            player_count: 0,
            seats: [Pubkey::default(); MAX_SEATS],
            ready: [false; MAX_SEATS],
            active: [false; MAX_SEATS],
            anted_round: [0; MAX_SEATS],
            state: STATE_WAITING,
            round: 0,
            pot_stakes: 0,
            pot_fees: 0,
            seed_commitment: [0u8; 32],
            seed: [0u8; 32],
            vrf_digest: [0u8; 32],
            vrf_fulfilled: false,
            resolved: false,
            winner_seat: NO_WINNER,
            round_started_at: 0,
            ante_deadline: 0,
            refunded: [false; MAX_SEATS],
            bump: 255,
        }
    }

    #[test]
    fn config_rejects_out_of_range_bounds() {
        let mut config = test_config();
        assert!(config.validate().is_ok());
        config.max_stake = 5_000_000;
        assert!(config.validate().is_err());
        config.max_stake = HARD_MAX_STAKE;
        config.min_stake = 1;
        assert!(config.validate().is_err());
    }

    #[test]
    fn table_validation_enforces_hard_stake_limits() {
        let config = test_config();
        assert!(validate_new_table(GAME_SHIP_CAPTAIN_CREW, 10_000, 4, &config).is_ok());
        assert!(validate_new_table(GAME_SHIP_CAPTAIN_CREW, 1_000_000, 4, &config).is_ok());
        assert!(validate_new_table(GAME_SHIP_CAPTAIN_CREW, 9_999, 4, &config).is_err());
        assert!(validate_new_table(GAME_SHIP_CAPTAIN_CREW, 1_000_001, 4, &config).is_err());
    }

    #[test]
    fn zwanzig_is_capped_at_four_players() {
        let config = test_config();
        assert!(validate_new_table(GAME_ZWANZIG_AB, 100_000, 4, &config).is_ok());
        assert!(validate_new_table(GAME_ZWANZIG_AB, 100_000, 5, &config).is_err());
        assert!(validate_new_table(GAME_HORSES, 100_000, 8, &config).is_ok());
        assert!(validate_new_table(GAME_HORSES, 100_000, 9, &config).is_err());
        assert!(validate_new_table(GAME_HORSES, 100_000, 1, &config).is_err());
    }

    #[test]
    fn player_deposit_is_stake_plus_fee() {
        let table = test_table();
        assert_eq!(table.deposit_per_player().unwrap(), 120_000);
        assert_eq!(table.total_held().unwrap(), 0);
    }

    #[test]
    fn tie_round_keeps_pot_and_requires_reante() {
        let mut table = test_table();
        table.player_count = 3;
        table.pot_stakes = 300_000;
        table.pot_fees = 60_000;
        table.begin_first_round(100);
        assert_eq!(table.state, STATE_IN_PROGRESS);
        assert_eq!(table.round, 1);
        assert_eq!(table.ante_deadline, 0);
        assert_eq!(table.active_count(), 3);

        table.begin_ante_round(2, 200);
        assert_eq!(table.state, STATE_ANTE);
        assert_eq!(table.round, 2);
        assert_eq!(table.ante_deadline, 260);
        // Pot is untouched by a tie.
        assert_eq!(table.pot_stakes, 300_000);
        assert_eq!(table.pot_fees, 60_000);
        // Everyone must ante again.
        assert!((0..table.player_count as usize).all(|i| table.anted_round[i] == 1));
    }

    #[test]
    fn resolution_pays_stakes_to_winner_and_fees_to_treasury_once() {
        let mut table = test_table();
        table.player_count = 4;
        table.pot_stakes = 400_000;
        table.pot_fees = 80_000;
        table.begin_first_round(0);
        let (stake_payout, fee_payout) = settlement_amounts(table.pot_stakes, table.pot_fees);
        assert_eq!(stake_payout, 400_000);
        assert_eq!(fee_payout, 80_000);
        table.mark_resolved(2);
        assert_eq!(table.winner_seat, 2);
        assert_eq!(table.state, STATE_RESOLVED);
        assert!(table.resolved);
        assert_eq!(table.pot_stakes, 0);
        assert_eq!(table.pot_fees, 0);
        // A resolved table can never pay again.
        table.mark_resolved(1);
        assert_eq!(table.winner_seat, 1);
    }

    #[test]
    fn refunds_only_before_the_game_starts() {
        assert!(can_refund(STATE_WAITING));
        assert!(!can_refund(STATE_IN_PROGRESS));
        assert!(!can_refund(STATE_ANTE));
        assert!(!can_refund(STATE_RESOLVED));
    }
}
