use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::instructions::init_vote_token_account::VOTE_TOKEN_ACCOUNT_SEED;
use crate::state::VoteTokenAccount;

#[derive(Accounts)]
pub struct ClaimPendingDeposit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref()],
        bump = vote_token_account.bump,
        constraint = vote_token_account.owner == signer.key(),
    )]
    pub vote_token_account: Account<'info, VoteTokenAccount>,

    /// ATA owned by VTA PDA (source of pending tokens)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vote_token_account,
        associated_token::token_program = token_program,
    )]
    pub vote_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// Signer's token account (destination for claimed tokens)
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = signer,
        token::token_program = token_program,
    )]
    pub signer_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_pending_deposit(ctx: Context<ClaimPendingDeposit>) -> Result<()> {
    let vta = &mut ctx.accounts.vote_token_account;
    let pending = vta.pending_deposit;

    // If no pending deposit, return success (no-op)
    if pending == 0 {
        return Ok(());
    }

    // Transfer pending tokens from VTA ATA back to signer
    let mint_key = vta.token_mint;
    let owner_key = vta.owner;
    let bump = vta.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        VOTE_TOKEN_ACCOUNT_SEED,
        mint_key.as_ref(),
        owner_key.as_ref(),
        &[bump],
    ]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vote_token_ata.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.signer_token_account.to_account_info(),
                authority: vta.to_account_info(),
            },
            signer_seeds,
        ),
        pending,
        ctx.accounts.token_mint.decimals,
    )?;

    // Clear pending deposit
    vta.pending_deposit = 0;

    Ok(())
}
