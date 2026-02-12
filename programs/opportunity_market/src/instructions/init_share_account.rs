use anchor_lang::prelude::*;

use crate::state::{OpportunityMarket, ShareAccount};
use crate::instructions::stake::SHARE_ACCOUNT_SEED;

#[derive(Accounts)]
#[instruction(state_nonce: u128, share_account_id: u32)]
pub struct InitShareAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub market: Account<'info, OpportunityMarket>,

    #[account(
        init,
        payer = signer,
        space = 8 + ShareAccount::INIT_SPACE,
        seeds = [SHARE_ACCOUNT_SEED, signer.key().as_ref(), market.key().as_ref(), &share_account_id.to_le_bytes()],
        bump,
    )]
    pub share_account: Account<'info, ShareAccount>,

    pub system_program: Program<'info, System>,
}

pub fn init_share_account(
    ctx: Context<InitShareAccount>,
    state_nonce: u128,
    _share_account_id: u32,
) -> Result<()> {
    let share_account = &mut ctx.accounts.share_account;

    share_account.bump = ctx.bumps.share_account;
    share_account.owner = ctx.accounts.signer.key();
    share_account.market = ctx.accounts.market.key();
    share_account.state_nonce = state_nonce;
    share_account.state_nonce_disclosure = 0; // initialized later
    share_account.encrypted_state = [[0u8; 32]; 2];
    share_account.encrypted_state_disclosure = [[0u8; 32]; 2];
    share_account.revealed_amount = None;
    share_account.revealed_option = None;
    share_account.locked = false;

    Ok(())
}
