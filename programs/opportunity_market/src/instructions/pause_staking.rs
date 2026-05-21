use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, StakingPausedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct PauseStaking<'info> {
    pub market_authority: Signer<'info>,
    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn pause_staking(ctx: Context<PauseStaking>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(market.stake_end_timestamp.is_some(), ErrorCode::MarketNotOpen);
    require!(
        market.resolved_at_timestamp.is_none(),
        ErrorCode::WinnerAlreadySelected,
    );
    require!(!market.staking_paused, ErrorCode::MarketPaused);

    market.staking_paused = true;

    emit_ts!(StakingPausedEvent {
        market: market.key(),
    });

    Ok(())
}
