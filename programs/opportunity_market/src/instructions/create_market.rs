use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{ALLOWED_MINT_SEED, MAX_UNSTAKE_DELAY_SECONDS, OPPORTUNITY_MARKET_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, MarketCreatedEvent};
use crate::state::{AllowedMint, OpportunityMarket, PlatformConfig};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub platform_config: Box<Account<'info, PlatformConfig>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + OpportunityMarket::INIT_SPACE,
        seeds = [OPPORTUNITY_MARKET_SEED, creator.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    /// This ATA holds all of the market's program-held tokens (stakes, rewards, fees).
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [ALLOWED_MINT_SEED, platform_config.key().as_ref(), token_mint.key().as_ref()],
        bump = allowed_mint.bump,
        constraint = allowed_mint.platform == platform_config.key() @ ErrorCode::Unauthorized,
        constraint = allowed_mint.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub allowed_mint: Box<Account<'info, AllowedMint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_index: u64,
    time_to_stake: u64,
    time_to_reveal: u64,
    market_authority: Pubkey,
    unstake_delay_seconds: u64,
    authorized_reader_pubkey: [u8; 32],
    allow_closing_early: bool,
    reveal_period_authority: Pubkey,
    earliness_cutoff_seconds: u64,
    min_stake_amount: u64,
    market_fee_claimer: Pubkey,
) -> Result<()> {
    require!(
        time_to_stake >= ctx.accounts.platform_config.min_time_to_stake_seconds
            && time_to_reveal >= ctx.accounts.platform_config.min_time_to_reveal_seconds
            && earliness_cutoff_seconds <= time_to_stake
            && unstake_delay_seconds <= MAX_UNSTAKE_DELAY_SECONDS,
        ErrorCode::InvalidParameters
    );

    let creator_key = ctx.accounts.creator.key();
    let platform_key = ctx.accounts.platform_config.key();
    let platform_fee_bp = ctx.accounts.platform_config.platform_fee_bp;
    let reward_pool_fee_bp = ctx.accounts.platform_config.reward_pool_fee_bp;
    let creator_fee_bp = ctx.accounts.platform_config.creator_fee_bp;
    let max_select_options_seconds = ctx.accounts.platform_config.max_select_options_seconds;
    let market = &mut ctx.accounts.market;
    let mint = ctx.accounts.token_mint.key();
    market.bump = ctx.bumps.market;
    market.creator = creator_key;
    market.index = market_index;
    market.platform = platform_key;
    market.time_to_stake = time_to_stake;
    market.time_to_reveal = time_to_reveal;
    market.mint = mint;
    market.market_authority = market_authority;
    market.reveal_period_authority = reveal_period_authority;
    market.earliness_cutoff_seconds = earliness_cutoff_seconds;
    market.unstake_delay_seconds = unstake_delay_seconds;
    market.authorized_reader_pubkey = authorized_reader_pubkey;
    market.allow_closing_early = allow_closing_early;
    market.platform_fee_bp = platform_fee_bp;
    market.reward_pool_fee_bp = reward_pool_fee_bp;
    market.creator_fee_bp = creator_fee_bp;
    market.market_fee_claimer = market_fee_claimer;
    market.max_select_options_seconds = max_select_options_seconds;
    market.min_stake_amount = min_stake_amount;

    emit_ts!(MarketCreatedEvent {
        market: market.key(),
        creator: creator_key,
        platform: platform_key,
        index: market_index,
        mint: mint,
        time_to_reveal: time_to_reveal,
        time_to_stake: time_to_stake,
        market_authority: market_authority,
        authorized_reader_pubkey: authorized_reader_pubkey,
        unstake_delay_seconds: unstake_delay_seconds,
        allow_closing_early: allow_closing_early,
        earliness_cutoff_seconds: earliness_cutoff_seconds,
        min_stake_amount: min_stake_amount,
        platform_fee_bp: platform_fee_bp,
        reward_pool_fee_bp: reward_pool_fee_bp,
        creator_fee_bp: creator_fee_bp,
        market_fee_claimer: market_fee_claimer,
        max_select_options_seconds: max_select_options_seconds,
    });

    Ok(())
}
