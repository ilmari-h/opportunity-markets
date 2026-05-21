use anchor_lang::prelude::*;
use crate::constants::MAX_TIME_TO_STAKE_SECONDS;
use crate::error::ErrorCode;
use crate::events::{emit_ts, MarketOpenedEvent};
use crate::state::{OpportunityMarket, PlatformConfig};

#[derive(Accounts)]
pub struct OpenMarket<'info> {
    pub market_authority: Signer<'info>,

    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
        constraint = market.stake_end_timestamp.is_none() @ ErrorCode::MarketAlreadyOpen,
    )]
    pub market: Account<'info, OpportunityMarket>,

    #[account(address = market.platform @ ErrorCode::Unauthorized)]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn open_market(ctx: Context<OpenMarket>, time_to_stake: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let clock = Clock::get()?;
    let open_timestamp = clock.unix_timestamp as u64;

    require!(
        time_to_stake >= ctx.accounts.platform_config.min_time_to_stake_seconds
            && time_to_stake <= MAX_TIME_TO_STAKE_SECONDS,
        ErrorCode::InvalidParameters
    );

    let stake_end_timestamp = open_timestamp
        .checked_add(time_to_stake)
        .ok_or(ErrorCode::Overflow)?;

    market.stake_end_timestamp = Some(stake_end_timestamp);

    emit_ts!(MarketOpenedEvent {
        market: market.key(),
        creator: market.creator,
        stake_end_timestamp: stake_end_timestamp,
    });

    Ok(())
}
