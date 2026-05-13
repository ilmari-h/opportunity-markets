use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::ALLOWED_MINT_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, AllowedMintInitializedEvent};
use crate::state::{AllowedMint, PlatformConfig};

/// Whitelists a token mint for the given platform.
#[derive(Accounts)]
pub struct InitAllowedMint<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Box<Account<'info, PlatformConfig>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + AllowedMint::INIT_SPACE,
        seeds = [ALLOWED_MINT_SEED, platform_config.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub allowed_mint: Box<Account<'info, AllowedMint>>,

    pub system_program: Program<'info, System>,
}

pub fn init_allowed_mint(ctx: Context<InitAllowedMint>) -> Result<()> {
    let allowed_mint = &mut ctx.accounts.allowed_mint;
    allowed_mint.bump = ctx.bumps.allowed_mint;
    allowed_mint.platform = ctx.accounts.platform_config.key();
    allowed_mint.mint = ctx.accounts.token_mint.key();

    emit_ts!(AllowedMintInitializedEvent {
        allowed_mint: allowed_mint.key(),
        platform: allowed_mint.platform,
        mint: allowed_mint.mint,
    });

    Ok(())
}
