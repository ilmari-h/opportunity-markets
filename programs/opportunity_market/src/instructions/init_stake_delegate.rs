use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::STAKE_DELEGATE_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, StakeDelegateInitializedEvent};
use crate::state::{OpportunityMarket, StakeAccount, StakeDelegate};

#[derive(Accounts)]
pub struct InitStakeDelegate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        constraint = stake_account.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(
        address = stake_account.market,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(address = market.mint @ ErrorCode::InvalidMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = owner,
        space = 8 + StakeDelegate::INIT_SPACE,
        seeds = [STAKE_DELEGATE_SEED, stake_account.key().as_ref()],
        bump,
    )]
    pub stake_delegate: Box<Account<'info, StakeDelegate>>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = stake_delegate,
        associated_token::token_program = token_program,
    )]
    pub stake_delegate_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_stake_delegate(
    ctx: Context<InitStakeDelegate>,
    authority: Option<Pubkey>,
) -> Result<()> {
    let owner_key = ctx.accounts.owner.key();
    let resolved_authority = authority.unwrap_or(owner_key);

    let stake_delegate = &mut ctx.accounts.stake_delegate;
    stake_delegate.bump = ctx.bumps.stake_delegate;
    stake_delegate.stake_account = ctx.accounts.stake_account.key();
    stake_delegate.authority = resolved_authority;

    emit_ts!(StakeDelegateInitializedEvent {
        stake_delegate: stake_delegate.key(),
        stake_account: stake_delegate.stake_account,
        owner: owner_key,
        authority: resolved_authority,
    });

    Ok(())
}
