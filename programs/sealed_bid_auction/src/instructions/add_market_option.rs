use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{ConvictionMarket, ConvictionMarketOption};

#[derive(Accounts)]
#[instruction(option_index: u16)]
pub struct AddMarketOption<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        has_one = creator @ ErrorCode::Unauthorized,
        constraint = market.open_timestamp.is_none() @ ErrorCode::MarketAlreadyOpen,
    )]
    pub market: Account<'info, ConvictionMarket>,
    #[account(
        init,
        payer = creator,
        space = 8 + ConvictionMarketOption::INIT_SPACE,
        seeds = [b"option", market.key().as_ref(), &option_index.to_le_bytes()],
        bump,
    )]
    pub option: Account<'info, ConvictionMarketOption>,
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

    // Cannot exceed max_options
    require!(
        option_index <= market.max_options,
        ErrorCode::MaxOptionsExceeded
    );

    // Increment total options
    market.total_options = option_index;

    // Initialize the option account
    let option = &mut ctx.accounts.option;
    option.bump = ctx.bumps.option;
    option.name = name;
    option.total_shares = None;
    option.creator = ctx.accounts.creator.key();

    Ok(())
}
