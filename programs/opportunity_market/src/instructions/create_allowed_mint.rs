use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{ALLOWED_MINT_SEED, CENTRAL_STATE_SEED};
use crate::error::ErrorCode;
use crate::state::{AllowedMint, CentralState};

#[derive(Accounts)]
pub struct CreateAllowedMint<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        seeds = [CENTRAL_STATE_SEED],
        bump = central_state.bump,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub central_state: Account<'info, CentralState>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + AllowedMint::INIT_SPACE,
        seeds = [ALLOWED_MINT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub allowed_mint: Account<'info, AllowedMint>,

    pub system_program: Program<'info, System>,
}

pub fn create_allowed_mint(ctx: Context<CreateAllowedMint>) -> Result<()> {
    let allowed_mint = &mut ctx.accounts.allowed_mint;
    allowed_mint.bump = ctx.bumps.allowed_mint;
    allowed_mint.mint = ctx.accounts.token_mint.key();
    Ok(())
}
