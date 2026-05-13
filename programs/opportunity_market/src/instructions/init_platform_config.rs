use anchor_lang::prelude::*;

use crate::constants::{MAX_PLATFORM_FEE_BP, MAX_TOTAL_FEE_BP, PLATFORM_CONFIG_SEED};
use crate::error::ErrorCode;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct InitPlatformConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [PLATFORM_CONFIG_SEED, payer.key().as_ref()],
        bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn init_platform_config(
    ctx: Context<InitPlatformConfig>,
    platform_fee_bp: u16,
    reward_pool_fee_bp: u16,
    fee_claim_authority: Pubkey,
    min_time_to_stake_seconds: u64,
    min_time_to_reveal_seconds: u64,
) -> Result<()> {
    require!(
        platform_fee_bp <= MAX_PLATFORM_FEE_BP,
        ErrorCode::InvalidParameters
    );
    require!(
        (platform_fee_bp as u32) + (reward_pool_fee_bp as u32) <= MAX_TOTAL_FEE_BP as u32,
        ErrorCode::InvalidParameters
    );

    let platform_config = &mut ctx.accounts.platform_config;
    platform_config.bump = ctx.bumps.platform_config;
    platform_config.update_authority = ctx.accounts.payer.key();
    platform_config.platform_fee_bp = platform_fee_bp;
    platform_config.reward_pool_fee_bp = reward_pool_fee_bp;
    platform_config.fee_claim_authority = fee_claim_authority;
    platform_config.min_time_to_stake_seconds = min_time_to_stake_seconds;
    platform_config.min_time_to_reveal_seconds = min_time_to_reveal_seconds;

    Ok(())
}
