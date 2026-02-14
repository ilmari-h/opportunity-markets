use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::VoteTokenAccount;

pub const VOTE_TOKEN_ACCOUNT_SEED: &[u8] = b"vote_token_account";

#[derive(Accounts)]
pub struct InitVoteTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = signer,
        space = 8 + VoteTokenAccount::INIT_SPACE,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub vote_token_account: Box<Account<'info, VoteTokenAccount>>,

    /// ATA owned by the VTA PDA, holding the actual SPL tokens
    #[account(
        init,
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = vote_token_account,
        associated_token::token_program = token_program,
    )]
    pub vote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_vote_token_account(
    ctx: Context<InitVoteTokenAccount>,
    user_pubkey: [u8; 32],
) -> Result<()> {
    let vta = &mut ctx.accounts.vote_token_account;
    vta.bump = ctx.bumps.vote_token_account;
    vta.owner = ctx.accounts.signer.key();
    vta.token_mint = ctx.accounts.token_mint.key();
    vta.state_nonce = 0;
    vta.pending_deposit = 0;
    vta.locked = false;
    vta.user_pubkey = user_pubkey;
    vta.encrypted_state = [[0u8; 32]; 1];

    Ok(())
}
