use anchor_lang::prelude::*;

use crate::constants::{CENTRAL_STATE_SEED, DEPLOYER_AUTHORITY, MAX_PROTOCOL_FEE_BP};
use crate::error::ErrorCode;
use crate::state::CentralState;

#[derive(Accounts)]
pub struct InitCentralState<'info> {
    #[account(
        mut,
        address = DEPLOYER_AUTHORITY @ ErrorCode::Unauthorized,
    )]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + CentralState::INIT_SPACE,
        seeds = [CENTRAL_STATE_SEED],
        bump,
    )]
    pub central_state: Account<'info, CentralState>,

    pub system_program: Program<'info, System>,
}

pub fn init_central_state(
    ctx: Context<InitCentralState>,
    protocol_fee_bp: u16,
    fee_claimer: Pubkey,
    min_time_to_stake_seconds: u64,
    min_time_to_reveal_seconds: u64,
) -> Result<()> {
    require!(
        protocol_fee_bp <= MAX_PROTOCOL_FEE_BP,
        ErrorCode::InvalidParameters
    );

    let central_state = &mut ctx.accounts.central_state;
    central_state.bump = ctx.bumps.central_state;
    central_state.update_authority = ctx.accounts.payer.key();
    central_state.protocol_fee_bp = protocol_fee_bp;
    central_state.fee_claimer = fee_claimer;
    central_state.min_time_to_stake_seconds = min_time_to_stake_seconds;
    central_state.min_time_to_reveal_seconds = min_time_to_reveal_seconds;

    Ok(())
}
