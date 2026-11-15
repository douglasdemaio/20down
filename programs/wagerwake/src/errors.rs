use anchor_lang::prelude::*;

#[error_code]
pub enum WagerwakeError {
    #[msg("The platform is paused for new tables and games")]
    Paused,
    #[msg("Only the configured authority can perform this action")]
    Unauthorized,
    #[msg("Only the configured settlement oracle can perform this action")]
    UnauthorizedOracle,
    #[msg("Invalid game id")]
    InvalidGame,
    #[msg("Stake must be between 0.01 and 1.00 USDC")]
    StakeOutOfRange,
    #[msg("Invalid maximum player count for this game")]
    InvalidMaxPlayers,
    #[msg("The table is not accepting players")]
    TableClosed,
    #[msg("The table is full")]
    TableFull,
    #[msg("You are already seated at this table")]
    AlreadySeated,
    #[msg("You are not seated at this table")]
    NotSeated,
    #[msg("Not all players are ready")]
    NotReady,
    #[msg("Not enough players to start")]
    NotEnoughPlayers,
    #[msg("The table is in the wrong state for this action")]
    WrongState,
    #[msg("The round seed commitment has not been published")]
    MissingCommitment,
    #[msg("Randomness for this round has already been recorded")]
    RandomnessAlreadyRecorded,
    #[msg("A seed commitment has already been published this round")]
    CommitmentAlreadyPublished,
    #[msg("This seat has already paid its ante for the round")]
    AlreadyAnted,
    #[msg("Randomness has not been recorded for this round yet")]
    RandomnessMissing,
    #[msg("The revealed seed does not match the published commitment")]
    CommitmentMismatch,
    #[msg("Invalid or duplicate player turn supplied")]
    InvalidTurnSet,
    #[msg("Reroll mask is invalid for this turn")]
    InvalidRerollMask,
    #[msg("The leader's call forbids this many rolls")]
    RollLimitExceeded,
    #[msg("Winner is not an active player")]
    InvalidWinner,
    #[msg("The game has already been resolved")]
    AlreadyResolved,
    #[msg("The stake escrow does not hold the expected amount")]
    EscrowMismatch,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Refunds are not available in the current table state")]
    RefundUnavailable,
    #[msg("Refund has already been claimed")]
    AlreadyRefunded,
    #[msg("The ante deadline has not passed yet")]
    AnteStillOpen,
    #[msg("The ante deadline has passed")]
    AnteExpired,
    #[msg("A void is only allowed after the grace period, in the first round")]
    VoidNotAllowed,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid configuration value")]
    InvalidConfig,
}
