use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct SelectOption<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = market.creator == authority.key()
            || market.market_authority == Some(authority.key()) @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn select_option(ctx: Context<SelectOption>, option_index: u16) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Enforce option exists
    require!(
        option_index >= 1 && option_index <= market.total_options,
        ErrorCode::InvalidOptionIndex
    );

    // Enforce market is open
    let open_timestamp = market.open_timestamp.ok_or_else(|| ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(
        current_timestamp >= open_timestamp,
        ErrorCode::InvalidTimestamp
    );

    // If staking is still open, close it by setting time_to_stake to end now
    let stake_end_timestamp = open_timestamp + market.time_to_stake;
    if current_timestamp < stake_end_timestamp {
        market.time_to_stake = (current_timestamp - open_timestamp).saturating_sub(1);
    }

    // Save the selected option
    market.selected_option = Some(option_index);

    Ok(())
}
