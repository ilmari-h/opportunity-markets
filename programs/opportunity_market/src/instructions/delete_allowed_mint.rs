use anchor_lang::prelude::*;

use crate::constants::{ALLOWED_MINT_SEED, CENTRAL_STATE_SEED};
use crate::error::ErrorCode;
use crate::state::{AllowedMint, CentralState};

#[derive(Accounts)]
pub struct DeleteAllowedMint<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        seeds = [CENTRAL_STATE_SEED],
        bump = central_state.bump,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub central_state: Account<'info, CentralState>,

    #[account(
        mut,
        close = update_authority,
        seeds = [ALLOWED_MINT_SEED, allowed_mint.mint.as_ref()],
        bump = allowed_mint.bump,
    )]
    pub allowed_mint: Account<'info, AllowedMint>,
}

pub fn delete_allowed_mint(_ctx: Context<DeleteAllowedMint>) -> Result<()> {
    Ok(())
}
