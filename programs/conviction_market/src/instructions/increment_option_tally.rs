use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::buy_market_shares::SHARE_ACCOUNT_SEED;
use crate::state::{ConvictionMarket, ConvictionMarketOption, ShareAccount};

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
        mut,
        seeds = [b"option", market.key().as_ref(), &option_index.to_le_bytes()],
        bump = option.bump,
    )]
    pub option: Account<'info, ConvictionMarketOption>,

    pub system_program: Program<'info, System>,
}

pub fn increment_option_tally(ctx: Context<IncrementOptionTally>, _option_index: u16) -> Result<()> {
    if let Some(revealed_amount) = ctx.accounts.share_account.revealed_amount {
        // Initialize total_shares to 0 if None, then add revealed_amount
        let current_total = ctx.accounts.option.total_shares.unwrap_or(0);
        ctx.accounts.option.total_shares = Some(
            current_total
                .checked_add(revealed_amount)
                .ok_or(ErrorCode::Overflow)?
        );

        ctx.accounts.share_account.total_incremented = true;
        Ok(())
    } else {
        Err(ErrorCode::NotRevealed.into())
    }
}
