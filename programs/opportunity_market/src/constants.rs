pub const MAX_PLATFORM_FEE_BP: u16 = 300;

pub const MAX_CREATOR_FEE_BP: u16 = 500;

/// Minimum and maximum length (in bytes) of a platform name.
pub const MIN_PLATFORM_NAME_LEN: usize = 3;
pub const MAX_PLATFORM_NAME_LEN: usize = 20;

/// 100%
/// total fee = platform fee + creator fee + reward pool fee
pub const MAX_TOTAL_FEE_BP: u16 = 10_000;

/// Fixed timelock delay: 48 hours
pub const TIMELOCK_DELAY_SECONDS: i64 = 48 * 60 * 60;

/// Maximum unstake delay: 3 days
pub const MAX_UNSTAKE_DELAY_SECONDS: u64 = 3 * 24 * 60 * 60;

#[cfg(feature = "production-settings")]
pub const MIN_MARKET_RESOLUTION_DEADLINE_SECONDS: u64 = 7 * 24 * 60 * 60;

pub const MAX_EARLINESS_MULTIPLIER: u16 = 20_000;

/// PDA seeds
pub const PLATFORM_CONFIG_SEED: &[u8] = b"platform_config";
pub const ALLOWED_MINT_SEED: &[u8] = b"allowed_mint";
pub const OPPORTUNITY_MARKET_SEED: &[u8] = b"opportunity_market";
pub const OPTION_SEED: &[u8] = b"option";
pub const STAKE_ACCOUNT_SEED: &[u8] = b"stake_account";
pub const SPONSOR_SEED: &[u8] = b"sponsor";
pub const TIMELOCKED_CHANGE_SEED: &[u8] = b"timelocked_change";
pub const UPDATE_AUTHORITY_SEED: &[u8] = b"update_authority";
pub const FEE_CLAIM_AUTHORITY_SEED: &[u8] = b"fee_claim_authority";
