use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::error::ErrorCode;
use crate::state::EncryptedTokenAccount;

use super::init_encrypted_token_account::ENCRYPTED_TOKEN_ACCOUNT_SEED;

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct InitEphemeralEncryptedTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: The ETA owner - not required to sign (permissionless init)
    pub owner: UncheckedAccount<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Source ETA - must be a regular ETA (derived with index 0)
    #[account(
        seeds = [ENCRYPTED_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), owner.key().as_ref(), &0u64.to_le_bytes()],
        bump = source_encrypted_token_account.bump,
        constraint = source_encrypted_token_account.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub source_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// New ephemeral ETA - derived with index in seed
    #[account(
        init,
        payer = signer,
        space = 8 + EncryptedTokenAccount::INIT_SPACE,
        seeds = [ENCRYPTED_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), owner.key().as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub ephemeral_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// ATA owned by the ephemeral ETA PDA
    #[account(
        init,
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = ephemeral_encrypted_token_account,
        associated_token::token_program = token_program,
    )]
    pub ephemeral_encrypted_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_ephemeral_encrypted_token_account(
    ctx: Context<InitEphemeralEncryptedTokenAccount>,
    index: u64,
) -> Result<()> {
    let eta = &mut ctx.accounts.ephemeral_encrypted_token_account;
    eta.bump = ctx.bumps.ephemeral_encrypted_token_account;
    eta.index = index;
    eta.owner = ctx.accounts.owner.key();
    eta.token_mint = ctx.accounts.token_mint.key();
    eta.state_nonce = 0;
    eta.pending_deposit = 0;
    eta.locked = false;
    // Copy user_pubkey from source ETA
    eta.user_pubkey = ctx.accounts.source_encrypted_token_account.user_pubkey;
    eta.encrypted_state = [[0u8; 32]; 1];
    // Track who paid rent so they can be refunded when closing
    eta.rent_payer = Some(ctx.accounts.signer.key());

    Ok(())
}
