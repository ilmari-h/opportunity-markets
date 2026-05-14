use anchor_lang::prelude::*;

use crate::constants::{MAX_CREATOR_FEE_BP, MAX_PLATFORM_FEE_BP, MAX_TOTAL_FEE_BP};
#[cfg(feature = "production-settings")]
use crate::constants::MIN_MARKET_RESOLUTION_DEADLINE_SECONDS;
use crate::error::ErrorCode;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct UpdatePlatformConfig<'info> {
    pub update_authority: Signer<'info>,

    #[account(
        mut,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn update_platform_config(
    ctx: Context<UpdatePlatformConfig>,
    platform_fee_bp: u16,
    reward_pool_fee_bp: u16,
    creator_fee_bp: u16,
    min_time_to_stake_seconds: u64,
    min_reveal_period_seconds: u64,
    market_resolution_deadline_seconds: u64,
) -> Result<()> {
    require!(
        platform_fee_bp <= MAX_PLATFORM_FEE_BP,
        ErrorCode::InvalidParameters
    );
    require!(
        creator_fee_bp <= MAX_CREATOR_FEE_BP,
        ErrorCode::InvalidParameters
    );
    require!(
        (platform_fee_bp as u32) + (reward_pool_fee_bp as u32) + (creator_fee_bp as u32)
            <= MAX_TOTAL_FEE_BP as u32,
        ErrorCode::InvalidParameters
    );
    #[cfg(feature = "production-settings")]
    require!(
        market_resolution_deadline_seconds >= MIN_MARKET_RESOLUTION_DEADLINE_SECONDS,
        ErrorCode::InvalidParameters
    );

    let platform_config = &mut ctx.accounts.platform_config;
    platform_config.platform_fee_bp = platform_fee_bp;
    platform_config.reward_pool_fee_bp = reward_pool_fee_bp;
    platform_config.creator_fee_bp = creator_fee_bp;
    platform_config.min_time_to_stake_seconds = min_time_to_stake_seconds;
    platform_config.min_reveal_period_seconds = min_reveal_period_seconds;
    platform_config.market_resolution_deadline_seconds = market_resolution_deadline_seconds;
    Ok(())
}
