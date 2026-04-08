use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::CentralState;

#[derive(Accounts)]
pub struct TransferCentralStateAuthority<'info> {
    pub update_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"central_state"],
        bump = central_state.bump,
        constraint = central_state.update_authority == update_authority.key() @ ErrorCode::Unauthorized,
    )]
    pub central_state: Account<'info, CentralState>,
}

pub fn transfer_central_state_authority(
    ctx: Context<TransferCentralStateAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    ctx.accounts.central_state.update_authority = new_authority;
    Ok(())
}
