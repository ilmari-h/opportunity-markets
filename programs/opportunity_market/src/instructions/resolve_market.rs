use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, MarketResolvedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub market_authority: Signer<'info>,

    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.resolved_at_timestamp.is_none(),
        ErrorCode::WinnerAlreadySelected,
    );
    require!(
        market.winning_option_allocation == 10_000,
        ErrorCode::InvalidParameters,
    );

    let stake_end = market.stake_end_timestamp.ok_or(ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    if !market.allow_closing_early {
        require!(
            current_timestamp >= stake_end,
            ErrorCode::ClosingEarlyNotAllowed,
        );
    }

    let select_deadline = stake_end
        .checked_add(market.market_resolution_deadline_seconds)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        current_timestamp <= select_deadline,
        ErrorCode::SelectOptionsDeadlinePassed,
    );

    if current_timestamp < stake_end {
        market.stake_end_timestamp = Some(current_timestamp);
    }

    market.resolved_at_timestamp = Some(current_timestamp);

    emit_ts!(MarketResolvedEvent {
        market: market.key(),
        market_authority: ctx.accounts.market_authority.key(),
    });

    Ok(())
}
