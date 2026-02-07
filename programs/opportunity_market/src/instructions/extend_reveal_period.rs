use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct ExtendRevealPeriod<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = market.creator == authority.key()
            || market.market_authority == Some(authority.key()) @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn extend_reveal_period(ctx: Context<ExtendRevealPeriod>, new_time_to_reveal: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Market must be open
    let open_timestamp = market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;

    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    // Calculate when reveal period ends
    let reveal_end = open_timestamp
        .checked_add(market.time_to_stake)
        .and_then(|t| t.checked_add(market.time_to_reveal))
        .ok_or(ErrorCode::Overflow)?;

    // Cannot extend after reveal period has ended
    require!(current_timestamp < reveal_end, ErrorCode::RevealPeriodEnded);

    // New value must be greater than current (extension only, no shortening)
    require!(new_time_to_reveal > market.time_to_reveal, ErrorCode::InvalidTimestamp);

    market.time_to_reveal = new_time_to_reveal;

    Ok(())
}
