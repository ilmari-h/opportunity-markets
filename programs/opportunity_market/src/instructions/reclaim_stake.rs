use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, StakeReclaimedEvent};
use crate::constants::{STAKE_ACCOUNT_SEED, TOKEN_VAULT_SEED};
use crate::state::{OpportunityMarket, StakeAccount, TokenVault};

#[derive(Accounts)]
#[instruction(stake_account_id: u32)]
pub struct ReclaimStake<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: Any account — this is the stake account owner. Permissionless.
    pub owner: UncheckedAccount<'info>,

    #[account(
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        seeds = [STAKE_ACCOUNT_SEED, owner.key().as_ref(), market.key().as_ref(), &stake_account_id.to_le_bytes()],
        bump = stake_account.bump,
        constraint = !stake_account.stake_reclaimed @ ErrorCode::AlreadyUnstaked,
        constraint = stake_account.staked_at_timestamp.is_some() @ ErrorCode::StakingNotActive,
        constraint = stake_account.unstaked_at_timestamp.is_none() @ ErrorCode::AlreadyUnstaked,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    // SPL token accounts
    #[account(address = market.mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub token_vault: Box<Account<'info, TokenVault>>,

    /// Token vault ATA holding all program-held tokens for this mint.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault,
        associated_token::token_program = token_program,
    )]
    pub token_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Owner's token account to receive staked tokens
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn reclaim_stake(
    ctx: Context<ReclaimStake>,
    _stake_account_id: u32,
) -> Result<()> {
    let market = &ctx.accounts.market;

    let open_timestamp = market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;
    let stake_end = open_timestamp
        .checked_add(market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    require!(current_timestamp >= stake_end, ErrorCode::StakingNotActive);

    let amount = ctx.accounts.stake_account.amount;

    if amount > 0 {
        let vault_bump = ctx.accounts.token_vault.bump;
        let mint_key = ctx.accounts.token_mint.key();
        let vault_seeds: &[&[&[u8]]] = &[&[
            TOKEN_VAULT_SEED,
            mint_key.as_ref(),
            &[vault_bump],
        ]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault_ata.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.token_vault.to_account_info(),
                },
                vault_seeds,
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    ctx.accounts.stake_account.stake_reclaimed = true;

    emit_ts!(StakeReclaimedEvent {
        owner: ctx.accounts.stake_account.owner,
        market: market.key(),
        stake_account: ctx.accounts.stake_account.key(),
        stake_account_id: ctx.accounts.stake_account.id,
        amount: amount,
    });

    Ok(())
}
