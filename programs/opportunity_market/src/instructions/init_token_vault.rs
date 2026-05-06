use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CENTRAL_STATE_SEED, TOKEN_VAULT_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, TokenVaultInitializedEvent};
use crate::state::{CentralState, TokenVault};

/// Initializes the per-mint TokenVault. The vault's existence whitelists
/// the mint for `create_market`, and its ATA holds every staked token,
/// every sponsored reward, and every collected fee for that mint.
#[derive(Accounts)]
pub struct InitTokenVault<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        seeds = [CENTRAL_STATE_SEED],
        bump = central_state.bump,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub central_state: Box<Account<'info, CentralState>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + TokenVault::INIT_SPACE,
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub token_vault: Box<Account<'info, TokenVault>>,

    #[account(
        init,
        payer = update_authority,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault,
        associated_token::token_program = token_program,
    )]
    pub token_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_token_vault(ctx: Context<InitTokenVault>) -> Result<()> {
    let vault = &mut ctx.accounts.token_vault;
    vault.bump = ctx.bumps.token_vault;
    vault.mint = ctx.accounts.token_mint.key();
    vault.collected_fees = 0;

    emit_ts!(TokenVaultInitializedEvent {
        token_vault: vault.key(),
        mint: vault.mint,
    });

    Ok(())
}
