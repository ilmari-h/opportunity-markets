use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, StuckStakeClosedEvent};
use crate::constants::{STAKE_ACCOUNT_SEED, TOKEN_VAULT_SEED};
use crate::state::{OpportunityMarket, StakeAccount, TokenVault};

#[derive(Accounts)]
#[instruction(stake_account_id: u32)]
pub struct CloseStuckStakeAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        close = signer,
        seeds = [STAKE_ACCOUNT_SEED, signer.key().as_ref(), market.key().as_ref(), &stake_account_id.to_le_bytes()],
        bump = stake_account.bump,
        constraint = stake_account.owner == signer.key() @ ErrorCode::Unauthorized,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(address = market.mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Signer's token account to receive refund
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = signer,
        token::token_program = token_program,
    )]
    pub signer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub token_vault: Box<Account<'info, TokenVault>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault,
        associated_token::token_program = token_program,
    )]
    pub token_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn close_stuck_stake_account(
    ctx: Context<CloseStuckStakeAccount>,
    stake_account_id: u32,
) -> Result<()> {
    let stake_account = &ctx.accounts.stake_account;

    // Only closeable if MPC computation is still in flight (or callback failed/never came)
    require!(stake_account.pending_stake, ErrorCode::StakeNotStuck);

    let market = &ctx.accounts.market;
    let amount = stake_account.amount;
    let fee = stake_account.fee;
    let total_refund = amount.checked_add(fee).ok_or(ErrorCode::Overflow)?;

    if total_refund > 0 {
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
                    to: ctx.accounts.signer_token_account.to_account_info(),
                    authority: ctx.accounts.token_vault.to_account_info(),
                },
                vault_seeds,
            ),
            total_refund,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    // The failed stake never incremented `token_vault.collected_fees`
    // (callback never ran), so no counter update is needed.

    emit_ts!(StuckStakeClosedEvent {
        owner: ctx.accounts.signer.key(),
        market: market.key(),
        stake_account: ctx.accounts.stake_account.key(),
        stake_account_id: stake_account_id,
        refunded_amount: amount,
        refunded_fee: fee,
    });

    Ok(())
}
