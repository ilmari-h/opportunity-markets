use anchor_lang::prelude::*;

use crate::error::ErrorCode;

#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub bump: u8,

    // Human-readable platform name
    #[max_len(20)]
    pub name: String,

    pub update_authority: Pubkey,

    // Can claim platform fees
    pub fee_claim_authority: Pubkey,

    // Platform fee in basis points
    pub platform_fee_bp: u16,
    pub reward_pool_fee_bp: u16,
    pub creator_fee_bp: u16,

    pub market_resolution_deadline_seconds: u64,

    pub min_time_to_stake_seconds: u64,

    // Reveal period can be closed within this time-window by market authority.
    // After max time has passed, end_reveal_period becomes permissionless.
    pub min_reveal_period_seconds: u64,
    pub max_reveal_period_seconds: u64,
}

/// Whitelisted token per platform
#[account]
#[derive(InitSpace)]
pub struct AllowedMint {
    pub bump: u8,
    pub platform: Pubkey,
    pub mint: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct OpportunityMarket {
    pub bump: u8,
    pub creator: Pubkey, // part of PDA seed
    pub index: u64,      // part of PDA seed
    pub total_options: u64,

    pub platform: Pubkey,

    // If set, means market is funded and ready to be opened for staking.
    pub open_timestamp: Option<u64>,

    // Seconds from open_timestamp
    pub time_to_stake: u64,

    pub resolved_at_timestamp: Option<u64>,
    pub winning_option_allocation: u16,

    // Reward to be shared with stakers (in SPL token base units)
    pub reward_amount: u64,

    pub market_authority: Pubkey,

    pub reveal_period_authority: Pubkey,

    // SPL token mint for this market (vote tokens and rewards)
    pub mint: Pubkey,

    // Score component configuration
    pub earliness_cutoff_seconds: u64,

    // Peak earliness multiplier, PRECISION-scaled. Range [PRECISION, 2*PRECISION].
    pub earliness_multiplier: u16,

    pub allow_unstaking_early: bool,

    // Public key for voluntary disclosure of encrypted stake data
    pub authorized_reader_pubkey: [u8; 32],

    // If false, market can only be closed after stake period ends
    pub allow_closing_early: bool,

    pub staking_paused: bool,

    pub fees: Fees,

    // Unclaimed platform fees held in the market ATA.
    pub collected_platform_fees: u64,

    // Unclaimed creator fees held in the market ATA.
    pub collected_creator_fees: u64,

    // Authority allowed to claim creator fees (only after winners are selected).
    pub market_fee_claimer: Pubkey,

    // Snapshot from platform at create time.
    pub market_resolution_deadline_seconds: u64,

    pub min_reveal_period_seconds: u64,

    pub max_reveal_period_seconds: u64,

    pub reveal_ended: bool,

    // Minimum stake amount (in SPL token base units) required for a stake.
    pub min_stake_amount: u64,

    // When true, score drops the stake-time factor: score = s · e instead of s · t · e.
    pub disable_time_weighting: bool,
}

#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct Fees {
    pub platform_fee: u64,
    pub reward_pool_fee: u64,
    pub creator_fee: u64,
}

impl Fees {
    pub fn total(&self) -> Result<u64> {
        let total_fee = self
            .platform_fee
            .checked_add(self.reward_pool_fee)
            .ok_or(ErrorCode::Overflow)?
            .checked_add(self.creator_fee)
            .ok_or(ErrorCode::Overflow)?;
        Ok(total_fee)
    }
}

impl OpportunityMarket {
    pub fn calculate_fees(&self, amount: u64) -> Result<Fees> {
        let platform_fee = (amount as u128)
            .checked_mul(self.fees.platform_fee as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;
        let reward_pool_fee = (amount as u128)
            .checked_mul(self.fees.reward_pool_fee as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;
        let creator_fee = (amount as u128)
            .checked_mul(self.fees.creator_fee as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;

        Ok(Fees {
            platform_fee,
            reward_pool_fee,
            creator_fee,
        })
    }

    pub fn deduct_stake_fees(&mut self, fees: &Fees) -> Result<u64> {
        self.reward_amount = self
            .reward_amount
            .checked_sub(fees.reward_pool_fee)
            .ok_or(ErrorCode::Overflow)?;
        self.collected_creator_fees = self
            .collected_creator_fees
            .checked_sub(fees.creator_fee)
            .ok_or(ErrorCode::Overflow)?;
        fees.reward_pool_fee
            .checked_add(fees.creator_fee)
            .ok_or(ErrorCode::Overflow.into())
    }
}

#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub encrypted_option: [u8; 32], // encrypted option ciphertext
    pub state_nonce: u128,
    pub bump: u8,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub user_pubkey: [u8; 32], // x25519 pubkey
    pub encrypted_option_disclosure: [u8; 32],
    pub state_nonce_disclosure: u128,
    pub staked_at_timestamp: Option<u64>,
    pub unstaked_at_timestamp: Option<u64>,
    pub amount: u64, // net stake (after all fees)
    pub fees: Fees,  // fees owed to the platform, reward pool, and creator
    pub revealed_option: Option<u64>,
    pub score: Option<u64>,
    pub total_incremented: bool,
    pub locked: bool,
    pub unstaked: bool, // whether staked tokens have been returned
    pub id: u32,

    // Computation account pubkey of the in-flight stake computation. 
    // `Some` means a stake computation is pending; None means no stake is in flight.
    pub pending_stake_computation: Option<Pubkey>,

    // True while MPC reveal computation is in flight
    pub pending_reveal: bool,                
}

#[account]
#[derive(InitSpace)]
pub struct OpportunityMarketOption {
    pub bump: u8,
    pub id: u64,
    pub created_at: u64,

    pub total_staked: u64,
    pub total_score: u64,

    pub selected: bool,
    pub reward_percentage_bp: u16,
}

#[account]
#[derive(InitSpace)]
pub struct OpportunityMarketSponsor {
    pub bump: u8,
    pub sponsor: Pubkey,
    pub market: Pubkey,
    pub reward_deposited: u64,
    pub reward_locked: bool,
}

