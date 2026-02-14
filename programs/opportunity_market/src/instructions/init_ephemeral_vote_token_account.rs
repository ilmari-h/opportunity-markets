use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::error::ErrorCode;
use crate::state::VoteTokenAccount;

use super::init_vote_token_account::VOTE_TOKEN_ACCOUNT_SEED;

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct InitEphemeralVoteTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: The VTA owner - not required to sign (permissionless init)
    pub owner: UncheckedAccount<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Source VTA - must be a regular VTA (derived with index 0)
    #[account(
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), owner.key().as_ref(), &0u64.to_le_bytes()],
        bump = source_vote_token_account.bump,
        constraint = source_vote_token_account.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub source_vote_token_account: Box<Account<'info, VoteTokenAccount>>,

    /// New ephemeral VTA - derived with index in seed
    #[account(
        init,
        payer = signer,
        space = 8 + VoteTokenAccount::INIT_SPACE,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub ephemeral_vote_token_account: Box<Account<'info, VoteTokenAccount>>,

    /// ATA owned by the ephemeral VTA PDA
    #[account(
        init,
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = ephemeral_vote_token_account,
        associated_token::token_program = token_program,
    )]
    pub ephemeral_vote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_ephemeral_vote_token_account(
    ctx: Context<InitEphemeralVoteTokenAccount>,
    index: u64,
) -> Result<()> {
    let vta = &mut ctx.accounts.ephemeral_vote_token_account;
    vta.bump = ctx.bumps.ephemeral_vote_token_account;
    vta.index = index;
    vta.owner = ctx.accounts.owner.key();
    vta.token_mint = ctx.accounts.token_mint.key();
    vta.state_nonce = 0;
    vta.pending_deposit = 0;
    vta.locked = false;
    // Copy user_pubkey from source VTA
    vta.user_pubkey = ctx.accounts.source_vote_token_account.user_pubkey;
    vta.encrypted_state = [[0u8; 32]; 1];

    Ok(())
}
