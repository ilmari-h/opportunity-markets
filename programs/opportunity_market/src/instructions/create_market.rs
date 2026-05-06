use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{CENTRAL_STATE_SEED, OPPORTUNITY_MARKET_SEED, TOKEN_VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, MarketCreatedEvent};
use crate::state::{CentralState, OpportunityMarket, TokenVault};

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + OpportunityMarket::INIT_SPACE,
        seeds = [OPPORTUNITY_MARKET_SEED, creator.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        seeds = [CENTRAL_STATE_SEED],
        bump = central_state.bump,
    )]
    pub central_state: Box<Account<'info, CentralState>>,

    /// Existence of a TokenVault for this mint is what whitelists it for
    /// market creation. The vault's ATA holds all program-held tokens.
    #[account(
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub token_vault: Box<Account<'info, TokenVault>>,

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
) -> Result<()> {
    require!(
        earliness_cutoff_seconds <= time_to_stake,
        ErrorCode::EarlinessCutoffTooLarge
    );

    let creator_key = ctx.accounts.creator.key();
    let protocol_fee_bp = ctx.accounts.central_state.protocol_fee_bp;
    let market = &mut ctx.accounts.market;
    let mint = ctx.accounts.token_mint.key();
    market.bump = ctx.bumps.market;
    market.creator = creator_key;
    market.index = market_index;
    market.time_to_stake = time_to_stake;
    market.time_to_reveal = time_to_reveal;
    market.mint = mint;
    market.market_authority = market_authority;
    market.reveal_period_authority = reveal_period_authority;
    market.earliness_cutoff_seconds = earliness_cutoff_seconds;
    market.unstake_delay_seconds = unstake_delay_seconds;
    market.authorized_reader_pubkey = authorized_reader_pubkey;
    market.allow_closing_early = allow_closing_early;
    market.protocol_fee_bp = protocol_fee_bp;
    market.min_stake_amount = min_stake_amount;

    emit_ts!(MarketCreatedEvent {
        market: market.key(),
        creator: creator_key,
        index: market_index,
        mint: mint,
        time_to_reveal: time_to_reveal,
        time_to_stake: time_to_stake,
        market_authority: market_authority,
        authorized_reader_pubkey: authorized_reader_pubkey,
        unstake_delay_seconds: unstake_delay_seconds,
        allow_closing_early: allow_closing_early,
        earliness_cutoff_seconds: earliness_cutoff_seconds,
        min_stake_amount: min_stake_amount
    });

    Ok(())
}
