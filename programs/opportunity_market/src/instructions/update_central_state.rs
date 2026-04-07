use anchor_lang::prelude::*;

use crate::constants::MAX_PROTOCOL_FEE_BP;
use crate::error::ErrorCode;
use crate::state::CentralState;

#[derive(Accounts)]
pub struct UpdateCentralState<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"central_state"],
        bump = central_state.bump,
        constraint = central_state.authority == authority.key() @ ErrorCode::Unauthorized,
    )]
    pub central_state: Account<'info, CentralState>,
}

pub fn update_central_state(
    ctx: Context<UpdateCentralState>,
    protocol_fee_bp: u16,
    fee_recipient: Pubkey,
) -> Result<()> {
    require!(
        protocol_fee_bp <= MAX_PROTOCOL_FEE_BP,
        ErrorCode::ProtocolFeeTooHigh
    );

    let central_state = &mut ctx.accounts.central_state;
    central_state.protocol_fee_bp = protocol_fee_bp;
    central_state.fee_recipient = fee_recipient;
    Ok(())
}
