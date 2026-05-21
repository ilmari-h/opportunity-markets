use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, StakingResumedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct ResumeStaking<'info> {
    pub market_authority: Signer<'info>,
    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn resume_staking(ctx: Context<ResumeStaking>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(market.stake_end_timestamp.is_some(), ErrorCode::MarketNotOpen);
    require!(
        market.resolved_at_timestamp.is_none(),
        ErrorCode::WinnerAlreadySelected,
    );
    require!(market.staking_paused, ErrorCode::MarketNotPaused);

    market.staking_paused = false;

    emit_ts!(StakingResumedEvent {
        market: market.key(),
    });

    Ok(())
}
