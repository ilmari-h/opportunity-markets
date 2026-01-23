use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Computation aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Insufficient reward funding")]
    InsufficientRewardFunding,
    #[msg("Timestamp must be in the future")]
    InvalidTimestamp,
    #[msg("Market is already open")]
    MarketAlreadyOpen,
    #[msg("Invalid option index")]
    InvalidOptionIndex,
    #[msg("Maximum options exceeded")]
    MaxOptionsExceeded,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Invalid option or not enough balance")]
    SharePurchaseFailed,
    #[msg("Staking period is not active")]
    StakingNotActive,
    #[msg("Market winner already selected")]
    WinnerAlreadySelected,
    #[msg("Shares already revealed")]
    AlreadyRevealed,
    #[msg("Option index does not match encrypted value")]
    OptionMismatch,
    #[msg("Staking period not over")]
    MarketNotResolved,
    #[msg("Shares not yet revealed")]
    NotRevealed,
    #[msg("Revealed after deadline")]
    RevealedTooLate,
    #[msg("Tally already incremented for this share account")]
    TallyAlreadyIncremented,
    #[msg("Arithmetic overflow")]
    Overflow,
}
