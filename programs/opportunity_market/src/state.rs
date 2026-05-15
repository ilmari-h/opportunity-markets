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

    // Only this address can call claim_fees on markets tied to this platform
    pub fee_claim_authority: Pubkey,

    // Platform fee in basis points
    pub platform_fee_bp: u16,

    // Reward-pool fee in basis points
    pub reward_pool_fee_bp: u16,

    // Creator fee in basis points (claimable by market_fee_claimer once winners are selected)
    pub creator_fee_bp: u16,

    // Grace period after stake_end during which market_authority may set winning options and
    // resolve the market. Past this, the market is "expired" and stakers may recover
    // reward_pool_fee + creator_fee.
    pub market_resolution_deadline_seconds: u64,

    // Minimum time_to_stake (seconds) accepted by create_market
    pub min_time_to_stake_seconds: u64,

    // Grace period after staking ends to reveal stakes
    // Reveal period can be closed only after this has passed.
    pub min_reveal_period_seconds: u64,
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

    pub resolved: bool,
    pub winning_option_allocation: u8,

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

    // Unstake delay seconds
    pub unstake_delay_seconds: u64,

    // Public key for voluntary disclosure of encrypted stake data
    pub authorized_reader_pubkey: [u8; 32],

    // If false, market can only be closed after stake period ends
    pub allow_closing_early: bool,

    pub staking_paused: bool,

    // Fee policy snapshotted from the platform at create time.
    pub platform_fee_bp: u16,
    pub reward_pool_fee_bp: u16,
    pub creator_fee_bp: u16,

    // Unclaimed platform fees held in the market ATA.
    pub collected_platform_fees: u64,

    // Unclaimed creator fees held in the market ATA.
    pub collected_creator_fees: u64,

    // Authority allowed to claim creator fees (only after winners are selected).
    pub market_fee_claimer: Pubkey,

    // Snapshot from platform at create time.
    pub market_resolution_deadline_seconds: u64,

    pub min_reveal_period_seconds: u64,

    pub reveal_ended_at: Option<u64>,

    // Minimum stake amount (in SPL token base units) required for a stake.
    pub min_stake_amount: u64,
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
            .checked_mul(self.platform_fee_bp as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;
        let reward_pool_fee = (amount as u128)
            .checked_mul(self.reward_pool_fee_bp as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::Overflow)? as u64;
        let creator_fee = (amount as u128)
            .checked_mul(self.creator_fee_bp as u128)
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
    pub unstakeable_at_timestamp: Option<u64>,
    pub locked: bool,
    pub stake_reclaimed: bool, // whether staked tokens have been returned
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

    // Total tallies, collected in `increment_option_tally`
    pub total_staked: u64,
    pub total_score: u64,

    pub selected: bool,
    pub reward_percentage: u8,
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

#[account]
#[derive(InitSpace)]
pub struct TimelockedAccountChange {
    pub bump: u8,
    pub current_value: Pubkey,
    pub proposed_value: Pubkey,
    pub execute_after: i64,
}
