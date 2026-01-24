use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::state::VoteTokenAccount;
use crate::COMP_DEF_OFFSET_INIT_VOTE_TOKEN_ACCOUNT;
use crate::{ID, ID_CONST, ArciumSignerAccount};

pub const VOTE_TOKEN_VAULT_SEED: &[u8] = b"vote_token_vault";

#[queue_computation_accounts("init_vote_token_account", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitVoteTokenAccount<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + VoteTokenAccount::INIT_SPACE,
        seeds = [b"vote_token_account", signer.key().as_ref()],
        bump,
    )]
    pub vote_token_account: Account<'info, VoteTokenAccount>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VOTE_TOKEN_ACCOUNT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn init_vote_token_account(
    ctx: Context<InitVoteTokenAccount>,
    computation_offset: u64,
    user_pubkey: [u8; 32],
    nonce: u128
) -> Result<()> {
    // Initialize vote token fields
    let vote_token = &mut ctx.accounts.vote_token_account;
    vote_token.bump = ctx.bumps.vote_token_account;
    vote_token.owner = ctx.accounts.signer.key();
    vote_token.state_nonce = 0;

    // Build args for encrypted computation
    let args = ArgBuilder::new()
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(nonce)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![InitVoteTokenAccountCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.vote_token_account.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("init_vote_token_account")]
#[derive(Accounts)]
pub struct InitVoteTokenAccountCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VOTE_TOKEN_ACCOUNT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub vote_token: Account<'info, VoteTokenAccount>,
}

pub fn init_vote_token_account_callback(
    ctx: Context<InitVoteTokenAccountCallback>,
    output: SignedComputationOutputs<InitVoteTokenAccountOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(InitVoteTokenAccountOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let vote_token = &mut ctx.accounts.vote_token;
    vote_token.state_nonce = o.nonce;
    vote_token.encrypted_state = o.ciphertexts;

    Ok(())
}
