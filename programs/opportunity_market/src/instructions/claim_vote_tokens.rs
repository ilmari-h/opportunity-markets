use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::instructions::init_vote_token_account::VOTE_TOKEN_ACCOUNT_SEED;
use crate::state::VoteTokenAccount;
use crate::COMP_DEF_OFFSET_CLAIM_VOTE_TOKENS;
use crate::{ID, ID_CONST, ArciumSignerAccount};

#[queue_computation_accounts("claim_vote_tokens", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ClaimVoteTokens<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, token_mint.key().as_ref(), signer.key().as_ref()],
        bump = vote_token_account.bump,
    )]
    pub vote_token_account: Box<Account<'info, VoteTokenAccount>>,

    /// ATA owned by VTA PDA (source of SPL tokens for withdrawal)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vote_token_account,
        associated_token::token_program = token_program,
    )]
    pub vote_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Signer's token account (destination for claimed tokens)
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = signer,
        token::token_program = token_program,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLAIM_VOTE_TOKENS))]
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

pub fn claim_vote_tokens(
    ctx: Context<ClaimVoteTokens>,
    computation_offset: u64,
    user_pubkey: [u8; 32],
    amount: u64,
) -> Result<()> {
    let vta = &mut ctx.accounts.vote_token_account;
    let vta_pubkey = vta.key();

    // Build args for encrypted computation
    // Circuit signature: claim_vote_tokens(balance_ctx, amount)
    let args = ArgBuilder::new()
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(vta.state_nonce)
        .account(vta_pubkey, 8, 32 * 1)
        .plaintext_u64(amount)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    // Pass VTA, user_token_account, vote_token_ata, token_mint, token_program as callback accounts
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![ClaimVoteTokensCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: vta_pubkey,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.user_token_account.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.vote_token_ata.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.token_mint.key(),
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.token_program.key(),
                    is_writable: false,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("claim_vote_tokens")]
#[derive(Accounts)]
pub struct ClaimVoteTokensCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CLAIM_VOTE_TOKENS))]
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

    // Callback accounts (order must match CallbackAccount vec above)
    #[account(mut)]
    pub vote_token_account: Account<'info, VoteTokenAccount>,

    /// User's token account to receive claimed SPL tokens
    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// VTA's ATA holding SPL tokens (source for withdrawal)
    #[account(mut)]
    pub vote_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token mint for transfer_checked
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Token program for CPI
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_vote_tokens_callback(
    ctx: Context<ClaimVoteTokensCallback>,
    output: SignedComputationOutputs<ClaimVoteTokensOutput>,
) -> Result<()> {
    // Output is (bool, u64, Enc<Mxe, VoteTokenBalance>)
    // field_0 = error boolean (true = insufficient balance)
    // field_1 = how many vote tokens were sold
    // field_2 = updated encrypted balance
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(ClaimVoteTokensOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let vta = &mut ctx.accounts.vote_token_account;
    let error = res.field_0;
    let amount_sold = res.field_1;
    let encrypted_balance = res.field_2;

    if error {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    // If tokens were sold, transfer SPL tokens from VTA's ATA to user's token account
    if amount_sold > 0 {
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
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: vta.to_account_info(),
                },
                signer_seeds,
            ),
            amount_sold,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    // Update encrypted state
    vta.state_nonce = encrypted_balance.nonce;
    vta.encrypted_state = encrypted_balance.ciphertexts;

    Ok(())
}
