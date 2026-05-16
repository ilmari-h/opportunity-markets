use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, RevealPeriodEndedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct EndRevealPeriod<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn end_reveal_period(ctx: Context<EndRevealPeriod>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(!market.reveal_ended, ErrorCode::RevealPeriodEnded);

    let resolved_at = market
        .resolved_at_timestamp
        .ok_or(ErrorCode::MarketNotResolved)?;
    let earliest_end = resolved_at
        .checked_add(market.min_reveal_period_seconds)
        .ok_or(ErrorCode::Overflow)?;
    require!(current_timestamp >= earliest_end, ErrorCode::TimeWindowMismatch);

    // This instruction becomes permissionless after max_reveal_period elapses
    let permissionless_at = resolved_at
        .checked_add(market.max_reveal_period_seconds)
        .ok_or(ErrorCode::Overflow)?;
    if current_timestamp < permissionless_at {
        require!(
            ctx.accounts.signer.key() == market.reveal_period_authority,
            ErrorCode::Unauthorized,
        );
    }

    market.reveal_ended = true;

    emit_ts!(RevealPeriodEndedEvent {
        market: market.key(),
        signer: ctx.accounts.signer.key(),
    });

    Ok(())
}
