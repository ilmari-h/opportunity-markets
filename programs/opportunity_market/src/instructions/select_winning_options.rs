use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{WinningOptionsSelectedEvent, emit_ts};
use crate::state::{OpportunityMarket, WinningOption};

#[derive(Accounts)]
pub struct SelectWinningOptions<'info> {
    pub market_authority: Signer<'info>,
    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn select_winning_options(ctx: Context<SelectWinningOptions>, selections: Vec<WinningOption>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(market.selected_options.is_none(), ErrorCode::WinnerAlreadySelected);

    // Validate selection count
    require!(!selections.is_empty() && selections.len() <= 10, ErrorCode::InvalidParameters);

    // Validate each selection
    let mut percentage_sum: u16 = 0;
    for (i, sel) in selections.iter().enumerate() {
        // Percentage must be > 0
        require!(sel.reward_percentage > 0, ErrorCode::InvalidParameters);
        percentage_sum += sel.reward_percentage as u16;

        // Check for duplicates
        for other in &selections[..i] {
            require!(
                sel.option_id != other.option_id,
                ErrorCode::InvalidParameters
            );
        }
    }

    // Percentages must sum to 100
    require!(percentage_sum == 100, ErrorCode::InvalidParameters);

    // Enforce market was opened
    let open_timestamp = market.open_timestamp.ok_or_else(|| ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(
        current_timestamp >= open_timestamp,
        ErrorCode::InvalidParameters
    );

    // Check if closing early is allowed
    let stake_end_timestamp = open_timestamp
        .checked_add(market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;
    if !market.allow_closing_early {
        require!(
            current_timestamp >= stake_end_timestamp,
            ErrorCode::ClosingEarlyNotAllowed
        );
    }

    // Block selection after the deadline: once stake_end + max_select_options_seconds
    // has passed, stakers may take fee refunds via close_stake_account.
    let select_deadline = stake_end_timestamp
        .checked_add(market.max_select_options_seconds)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        current_timestamp <= select_deadline,
        ErrorCode::SelectOptionsDeadlinePassed
    );

    // If staking is still open, close it by setting time_to_stake to end now
    if current_timestamp < stake_end_timestamp {
        market.time_to_stake = current_timestamp
            .checked_sub(open_timestamp)
            .ok_or(ErrorCode::Overflow)?;
    }

    // Save the selected options
    market.selected_options = Some(selections.clone());

    emit_ts!(WinningOptionsSelectedEvent{
        market: market.key(),
        market_authority: ctx.accounts.market_authority.key(),
        selected_options: selections,
    });

    Ok(())
}
