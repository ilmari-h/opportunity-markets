use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::{emit_ts, EphemeralAccountClosedEvent, EphemeralAccountClosedError};
use crate::instructions::init_encrypted_token_account::ENCRYPTED_TOKEN_ACCOUNT_SEED;
use crate::state::EncryptedTokenAccount;

use crate::COMP_DEF_OFFSET_CLOSE_EPHEMERAL_ENCRYPTED_TOKEN_ACCOUNT;
use crate::{ArciumSignerAccount, ID, ID_CONST};

#[queue_computation_accounts("close_ephemeral_encrypted_token_account", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, index: u64)]
pub struct CloseEphemeralEncryptedTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [ENCRYPTED_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref(), &0u64.to_le_bytes()],
        bump = regular_encrypted_token_account.bump,
        constraint = regular_encrypted_token_account.owner == signer.key() @ ErrorCode::Unauthorized,
        constraint = regular_encrypted_token_account.token_mint == token_mint.key() @ ErrorCode::InvalidMint,
        constraint = !regular_encrypted_token_account.locked @ ErrorCode::Locked,
    )]
    pub regular_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// Ephemeral ETA to close (index != 0), must be owned by signer
    #[account(
        mut,
        seeds = [ENCRYPTED_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref(), &index.to_le_bytes()],
        bump = ephemeral_encrypted_token_account.bump,
        constraint = ephemeral_encrypted_token_account.owner == signer.key() @ ErrorCode::Unauthorized,
        constraint = ephemeral_encrypted_token_account.token_mint == token_mint.key() @ ErrorCode::InvalidMint,
        constraint = ephemeral_encrypted_token_account.index != 0 @ ErrorCode::InvalidAccountState,
        constraint = !ephemeral_encrypted_token_account.locked @ ErrorCode::Locked,
    )]
    pub ephemeral_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// CHECK: Rent recipient - must match rent_payer stored in ephemeral ETA
    #[account(
        mut,
        constraint = ephemeral_encrypted_token_account.rent_payer == Some(rent_recipient.key()) @ ErrorCode::Unauthorized,
    )]
    pub rent_recipient: UncheckedAccount<'info>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = signer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLOSE_EPHEMERAL_ENCRYPTED_TOKEN_ACCOUNT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn close_ephemeral_encrypted_token_account(
    ctx: Context<CloseEphemeralEncryptedTokenAccount>,
    computation_offset: u64,
    _index: u64,
) -> Result<()> {
    let ephemeral_eta = &mut ctx.accounts.ephemeral_encrypted_token_account;
    let regular_eta = &mut ctx.accounts.regular_encrypted_token_account;

    // Both ETAs share the same user_pubkey (copied during ephemeral init)
    let user_pubkey = ephemeral_eta.user_pubkey;

    let ephemeral_eta_key = ephemeral_eta.key();
    let ephemeral_eta_nonce = ephemeral_eta.state_nonce;

    let regular_eta_key = regular_eta.key();
    let regular_eta_nonce = regular_eta.state_nonce;

    // Lock both ETAs while MPC computation is pending
    ephemeral_eta.locked = true;
    regular_eta.locked = true;

    // Build args for encrypted computation
    // Circuit: close_ephemeral_encrypted_token_account(ephemeral_ctx, regular_ctx, is_regular_initialized)
    let is_regular_eta_initialized = regular_eta_nonce != 0;
    let args = ArgBuilder::new()
        // Ephemeral ETA encrypted state
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(ephemeral_eta_nonce)
        .account(ephemeral_eta_key, 8, 32 * 1)
        // Regular ETA encrypted state
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(regular_eta_nonce)
        .account(regular_eta_key, 8, 32 * 1)
        // Is regular ETA initialized flag
        .plaintext_bool(is_regular_eta_initialized)
        .build();

    // Queue computation with callback
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![CloseEphemeralEncryptedTokenAccountCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: regular_eta_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ephemeral_eta_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.rent_recipient.key(),
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("close_ephemeral_encrypted_token_account")]
#[derive(Accounts)]
pub struct CloseEphemeralEncryptedTokenAccountCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLOSE_EPHEMERAL_ENCRYPTED_TOKEN_ACCOUNT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Callback accounts (order must match CallbackAccount vec above)
    #[account(mut)]
    pub regular_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    #[account(mut)]
    pub ephemeral_encrypted_token_account: Box<Account<'info, EncryptedTokenAccount>>,

    /// CHECK: Receives rent from closed ephemeral ETA
    #[account(mut)]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn close_ephemeral_encrypted_token_account_callback(
    ctx: Context<CloseEphemeralEncryptedTokenAccountCallback>,
    output: SignedComputationOutputs<CloseEphemeralEncryptedTokenAccountOutput>,
) -> Result<()> {
    let regular_eta = &mut ctx.accounts.regular_encrypted_token_account;
    let ephemeral_eta = &mut ctx.accounts.ephemeral_encrypted_token_account;

    // Unlock regular ETA (ephemeral will be closed)
    regular_eta.locked = false;

    // Verify output - on error, unlock ephemeral too and return
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(CloseEphemeralEncryptedTokenAccountOutput { field_0 }) => field_0,
        Err(_) => {
            ephemeral_eta.locked = false;
            emit_ts!(EphemeralAccountClosedError {
                user: regular_eta.owner,
            });
            return Ok(());
        }
    };

    // Update regular ETA with new balance (ephemeral balance transferred in)
    // No SPL token transfer needed - tokens are already in the common TokenVault
    regular_eta.state_nonce = res.nonce;
    regular_eta.encrypted_state = res.ciphertexts;

    emit_ts!(EphemeralAccountClosedEvent {
        user: regular_eta.owner,
        encrypted_token_account: regular_eta.key(),
        encrypted_new_balance: res.ciphertexts[0],
        nonce: res.nonce,
    });

    // Close ephemeral ETA account (rent to rent_recipient)
    let ephemeral_eta_info = ephemeral_eta.to_account_info();
    let rent_recipient_info = ctx.accounts.rent_recipient.to_account_info();

    let ephemeral_lamports = ephemeral_eta_info.lamports();
    **ephemeral_eta_info.try_borrow_mut_lamports()? = 0;
    **rent_recipient_info.try_borrow_mut_lamports()? = rent_recipient_info
        .lamports()
        .checked_add(ephemeral_lamports)
        .ok_or(ErrorCode::Overflow)?;

    Ok(())
}
