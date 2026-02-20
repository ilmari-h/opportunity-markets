use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::events::{emit_ts, EncryptedTokenAccountInitializedEvent};
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

    pub system_program: Program<'info, System>,
}

pub fn init_encrypted_token_account(
    ctx: Context<InitEncryptedTokenAccount>,
    user_pubkey: [u8; 32],
    state_nonce: u128,
) -> Result<()> {
    let eta = &mut ctx.accounts.encrypted_token_account;
    eta.bump = ctx.bumps.encrypted_token_account;
    eta.index = 0;
    eta.owner = ctx.accounts.signer.key();
    eta.token_mint = ctx.accounts.token_mint.key();
    eta.state_nonce = state_nonce;
    eta.pending_deposit = 0;
    eta.locked = false;
    eta.user_pubkey = user_pubkey;
    eta.encrypted_state = [[0u8; 32]; 1];
    eta.rent_payer = None;
    eta.is_initialized = false;

    emit_ts!(EncryptedTokenAccountInitializedEvent {
        encrypted_token_account: eta.key(),
        owner: eta.owner,
        token_mint: eta.token_mint,
    });

    Ok(())
}
