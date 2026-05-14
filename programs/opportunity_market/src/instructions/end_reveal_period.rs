use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, RevealPeriodEndedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct EndRevealPeriod<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = market.reveal_period_authority == authority.key() @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn end_reveal_period(ctx: Context<EndRevealPeriod>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let open_timestamp = market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;

    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(market.reveal_ended_at.is_none(), ErrorCode::RevealPeriodEnded);

    let stake_end = open_timestamp
        .checked_add(market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;
    let earliest_end = stake_end
        .checked_add(market.min_reveal_period_seconds)
        .ok_or(ErrorCode::Overflow)?;
    require!(current_timestamp >= earliest_end, ErrorCode::TimeWindowMismatch);

    market.reveal_ended_at = Some(current_timestamp);

    emit_ts!(RevealPeriodEndedEvent {
        market: market.key(),
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
