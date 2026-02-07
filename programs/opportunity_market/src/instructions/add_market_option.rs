use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{OpportunityMarket, OpportunityMarketOption};

#[derive(Accounts)]
#[instruction(option_index: u16)]
pub struct AddMarketOption<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        constraint = market.selected_option.is_none() @ ErrorCode::WinnerAlreadySelected,
    )]
    pub market: Account<'info, OpportunityMarket>,
    #[account(
        init,
        payer = creator,
        space = 8 + OpportunityMarketOption::INIT_SPACE,
        seeds = [b"option", market.key().as_ref(), &option_index.to_le_bytes()],
        bump,
    )]
    pub option: Account<'info, OpportunityMarketOption>,
    pub system_program: Program<'info, System>,
}

pub fn add_market_option(
    ctx: Context<AddMarketOption>,
    option_index: u16,
    name: String,
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Option index must match total_options + 1
    require!(
        option_index == market.total_options + 1,
        ErrorCode::InvalidOptionIndex
    );

    // Increment total options
    market.total_options = option_index;

    // Initialize the option account
    let option = &mut ctx.accounts.option;
    option.bump = ctx.bumps.option;
    option.name = name;
    option.total_shares = None;
    option.total_score = None;
    option.creator = ctx.accounts.creator.key();

    Ok(())
}
