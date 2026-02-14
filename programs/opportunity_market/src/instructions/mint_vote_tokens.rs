use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::state::VoteTokenAccount;
use crate::COMP_DEF_OFFSET_BUY_VOTE_TOKENS;
use crate::{ArciumSignerAccount, ID, ID_CONST};

#[queue_computation_accounts("buy_vote_tokens", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct MintVoteTokens<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = vote_token_account.owner == signer.key() @ ErrorCode::Unauthorized,
        constraint = vote_token_account.token_mint == token_mint.key() @ ErrorCode::InvalidMint,
        constraint = !vote_token_account.locked @ ErrorCode::Locked
    )]
    pub vote_token_account: Box<Account<'info, VoteTokenAccount>>,

    /// The signer's token account (source of SPL tokens)
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = signer,
        token::token_program = token_program,
    )]
    pub signer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// ATA owned by the VTA PDA (destination of SPL tokens)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vote_token_account,
        associated_token::token_program = token_program,
    )]
    pub vote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = signer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_VOTE_TOKENS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn mint_vote_tokens(
    ctx: Context<MintVoteTokens>,
    computation_offset: u64,
    amount: u64,
) -> Result<()> {
    let vta = &mut ctx.accounts.vote_token_account;
    let user_pubkey = vta.user_pubkey;
    let vta_pubkey = vta.key();

    // Transfer SPL tokens from signer's token account to VTA's ATA
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.signer_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.vote_token_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // Track the pending deposit for safety (can be reclaimed if callback fails)
    // Lock
    vta.pending_deposit = vta
        .pending_deposit
        .checked_add(amount)
        .ok_or(ErrorCode::Overflow)?;
    vta.locked = true;

    // Build args for encrypted computation
    // Circuit signature: buy_vote_tokens(balance_ctx, is_initialized, amount)
    let is_initialized = vta.state_nonce != 0;
    let args = ArgBuilder::new()
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(vta.state_nonce)
        .account(vta_pubkey, 8, 32 * 1)
        .plaintext_bool(is_initialized)
        .plaintext_u64(amount)
        .build();

    // Queue computation with callback
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![BuyVoteTokensCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: vta_pubkey,
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("buy_vote_tokens")]
#[derive(Accounts)]
pub struct BuyVoteTokensCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_VOTE_TOKENS))]
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

    // Callback accounts
    #[account(mut)]
    pub vote_token_account: Account<'info, VoteTokenAccount>,
}

pub fn buy_vote_tokens_callback(
    ctx: Context<BuyVoteTokensCallback>,
    output: SignedComputationOutputs<BuyVoteTokensOutput>,
) -> Result<()> {
    let encrypted_balance = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(BuyVoteTokensOutput { field_0 }) => field_0,

        // We do not reset account state here because can be done manually via
        // `claim_pending_deposit`
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let vta = &mut ctx.accounts.vote_token_account;

    // Check that pending deposit exists. User could have withdrawn funds.
    require!(vta.pending_deposit > 0 && vta.locked, ErrorCode::InsufficientBalance);

    // Set pending deposit to 0 and unlock account.
    vta.pending_deposit = 0;
    vta.locked = false;

    // Update encrypted state
    vta.state_nonce = encrypted_balance.nonce;
    vta.encrypted_state = encrypted_balance.ciphertexts;

    Ok(())
}
