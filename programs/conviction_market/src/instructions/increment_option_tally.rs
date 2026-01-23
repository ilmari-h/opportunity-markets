use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::buy_market_shares::SHARE_ACCOUNT_SEED;
use crate::state::{ConvictionMarket, OptionTally, ShareAccount};

pub const OPTION_TALLY_SEED: &[u8] = b"option_tally";

#[derive(Accounts)]
#[instruction(option_index: u16)]
pub struct IncrementOptionTally<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: this is a permissionless operation
    pub owner: UncheckedAccount<'info>,

    pub market: Account<'info, ConvictionMarket>,

    #[account(
        mut,
        seeds = [SHARE_ACCOUNT_SEED, owner.key().as_ref(), market.key().as_ref()],
        bump = share_account.bump,
        constraint = share_account.revealed_in_time @ ErrorCode::RevealedTooLate,
        constraint = !share_account.total_incremented @ ErrorCode::TallyAlreadyIncremented,
    )]
    pub share_account: Account<'info, ShareAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + OptionTally::INIT_SPACE,
        seeds = [OPTION_TALLY_SEED, market.key().as_ref(), &option_index.to_le_bytes()],
        bump,
    )]
    pub option_tally: Account<'info, OptionTally>,

    pub system_program: Program<'info, System>,
}

pub fn increment_option_tally(ctx: Context<IncrementOptionTally>, _option_index: u16) -> Result<()> {
    // Initialize bump if this is a new account
    if ctx.accounts.option_tally.bump == 0 {
        ctx.accounts.option_tally.bump = ctx.bumps.option_tally;
    }

    if let Some(revealed_amount) = ctx.accounts.share_account.revealed_amount {
        ctx.accounts.option_tally.total_shares_bought = ctx
            .accounts
            .option_tally
            .total_shares_bought
            .checked_add(revealed_amount)
            .ok_or(ErrorCode::Overflow)?;

        ctx.accounts.share_account.total_incremented = true;
        return Ok(())
    } else {
        return Err(ErrorCode::NotRevealed.into());
    }
}
