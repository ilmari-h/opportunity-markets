use anchor_lang::prelude::*;

use crate::constants::OPTION_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, WinningOptionSetEvent};
use crate::state::{OpportunityMarket, OpportunityMarketOption};

#[derive(Accounts)]
#[instruction(option_id: u64)]
pub struct SetWinningOption<'info> {
    pub market_authority: Signer<'info>,

    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        seeds = [OPTION_SEED, market.key().as_ref(), &option_id.to_le_bytes()],
        bump = option.bump,
    )]
    pub option: Box<Account<'info, OpportunityMarketOption>>,
}

pub fn set_winning_option(
    ctx: Context<SetWinningOption>,
    _option_id: u64,
    reward_percentage: u8,
) -> Result<()> {
    require!(!ctx.accounts.market.resolved, ErrorCode::WinnerAlreadySelected);
    require!(
        reward_percentage > 0 && reward_percentage <= 100,
        ErrorCode::InvalidParameters,
    );

    let open_timestamp = ctx
        .accounts
        .market
        .open_timestamp
        .ok_or(ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    let stake_end = open_timestamp
        .checked_add(ctx.accounts.market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;

    if !ctx.accounts.market.allow_closing_early {
        require!(
            current_timestamp >= stake_end,
            ErrorCode::ClosingEarlyNotAllowed,
        );
    }

    let select_deadline = stake_end
        .checked_add(ctx.accounts.market.market_resolution_deadline_seconds)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        current_timestamp <= select_deadline,
        ErrorCode::SelectOptionsDeadlinePassed,
    );

    let previous = if ctx.accounts.option.selected {
        ctx.accounts.option.reward_percentage
    } else {
        0
    };
    let new_alloc = ctx
        .accounts
        .market
        .winning_option_allocation
        .checked_sub(previous)
        .ok_or(ErrorCode::Overflow)?
        .checked_add(reward_percentage)
        .ok_or(ErrorCode::Overflow)?;
    require!(new_alloc <= 100, ErrorCode::InvalidParameters);

    ctx.accounts.option.selected = true;
    ctx.accounts.option.reward_percentage = reward_percentage;
    ctx.accounts.market.winning_option_allocation = new_alloc;

    emit_ts!(WinningOptionSetEvent {
        market: ctx.accounts.market.key(),
        market_authority: ctx.accounts.market_authority.key(),
        option: ctx.accounts.option.key(),
        option_id: ctx.accounts.option.id,
        reward_percentage: reward_percentage,
        winning_option_allocation: new_alloc,
    });

    Ok(())
}
