use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::EncryptedTokenAccount;

pub const ENCRYPTED_TOKEN_ACCOUNT_SEED: &[u8] = b"encrypted_token_account";

#[derive(Accounts)]
pub struct InitEncryptedTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = signer,
        space = 8 + EncryptedTokenAccount::INIT_SPACE,
        seeds = [ENCRYPTED_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref(), &0u64.to_le_bytes()],
        bump,
    )]
    pub encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// ATA owned by the ETA PDA, holding the actual SPL tokens
    #[account(
        init,
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = encrypted_token_account,
        associated_token::token_program = token_program,
    )]
    pub encrypted_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_encrypted_token_account(
    ctx: Context<InitEncryptedTokenAccount>,
    user_pubkey: [u8; 32],
) -> Result<()> {
    let eta = &mut ctx.accounts.encrypted_token_account;
    eta.bump = ctx.bumps.encrypted_token_account;
    eta.index = 0;
    eta.owner = ctx.accounts.signer.key();
    eta.token_mint = ctx.accounts.token_mint.key();
    eta.state_nonce = 0;
    eta.pending_deposit = 0;
    eta.locked = false;
    eta.user_pubkey = user_pubkey;
    eta.encrypted_state = [[0u8; 32]; 1];
    eta.rent_payer = None;

    Ok(())
}
