use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::ConvictionMarket;

#[derive(Accounts)]
pub struct OpenMarket<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        has_one = creator @ ErrorCode::Unauthorized,
        constraint = market.open_timestamp.is_none() @ ErrorCode::MarketAlreadyOpen,
    )]
    pub market: Account<'info, ConvictionMarket>,
}

pub fn open_market(ctx: Context<OpenMarket>, open_timestamp: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Check that market account has at least reward_amount lamports
    let market_lamports = market.to_account_info().lamports();
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(market.to_account_info().data_len());
    let available_lamports = market_lamports.saturating_sub(min_rent);

    require!(
        available_lamports >= market.reward_amount,
        ErrorCode::InsufficientRewardFunding
    );

    // Check that open_timestamp is in the future
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(
        open_timestamp > current_timestamp,
        ErrorCode::InvalidTimestamp
    );

    // Set open_timestamp and transition state to Funded
    market.open_timestamp = Some(open_timestamp);

    Ok(())
}
