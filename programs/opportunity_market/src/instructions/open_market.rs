use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::error::ErrorCode;
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct OpenMarket<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ ErrorCode::Unauthorized,
        constraint = market.open_timestamp.is_none() @ ErrorCode::MarketAlreadyOpen,
    )]
    pub market: Account<'info, OpportunityMarket>,

    #[account(address = market.mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Market's ATA holding reward tokens
    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn open_market(ctx: Context<OpenMarket>, open_timestamp: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Check that market ATA has enough tokens for rewards
    require!(
        ctx.accounts.market_token_ata.amount >= market.reward_amount,
        ErrorCode::InsufficientRewardFunding
    );

    // Check that open_timestamp is in the future
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(
        open_timestamp > current_timestamp,
        ErrorCode::InvalidTimestamp
    );

    // Set open_timestamp and transition state to Funded
    market.open_timestamp = Some(open_timestamp);

    Ok(())
}
