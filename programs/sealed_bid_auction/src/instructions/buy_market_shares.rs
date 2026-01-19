use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::instructions::mint_vote_tokens::VOTE_TOKEN_ACCOUNT_SEED;
use crate::state::{ConvictionMarket, ConvictionMarketShare, VoteToken};
use crate::COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES;
use crate::{ID, ID_CONST, SignerAccount};

pub const CONVICTION_MARKET_SHARE_SEED: &[u8] = b"conviction_market_share";

#[queue_computation_accounts("buy_conviction_market_shares", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
    )]
    pub market: Account<'info, ConvictionMarket>,

    #[account(
        mut,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, signer.key().as_ref()],
        bump = user_vote_token_account.bump,
    )]
    pub user_vote_token_account: Account<'info, VoteToken>,

    #[account(
        mut,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, market.key().as_ref()],
        bump = market_vote_token_account.bump,
    )]
    pub market_vote_token_account: Account<'info, VoteToken>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + ConvictionMarketShare::INIT_SPACE,
        seeds = [CONVICTION_MARKET_SHARE_SEED, market.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub user_share: Account<'info, ConvictionMarketShare>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = signer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn buy_market_shares(
    ctx: Context<BuyMarketShares>,
    computation_offset: u64,
    amount_ciphertext: [u8; 32],
    selected_option_ciphertext: [u8; 32],
    user_pubkey: [u8; 32],
    input_nonce: u128,
) -> Result<()> {
    let user_vta_key = ctx.accounts.user_vote_token_account.key();
    let user_vta_nonce = ctx.accounts.user_vote_token_account.state_nonce;

    let market_vta_key = ctx.accounts.market_vote_token_account.key();
    let market_vta_nonce = ctx.accounts.market_vote_token_account.state_nonce;

    let user_share_key = ctx.accounts.user_share.key();
    let market_key = ctx.accounts.market.key();
    let signer_key = ctx.accounts.signer.key();
    let total_options = ctx.accounts.market.total_options as u16;

    // Initialize user_share if it's newly created
    let user_share = &mut ctx.accounts.user_share;
    let user_share_nonce = if user_share.owner == Pubkey::default() {
        user_share.bump = ctx.bumps.user_share;
        user_share.owner = signer_key;
        user_share.market = market_key;
        user_share.state_nonce = 0;
        user_share.encrypted_state = [[0u8; 32]; 2];
        0u128
    } else {
        user_share.state_nonce
    };

    // Build args for encrypted computation
    // Circuit signature: buy_conviction_market_shares(input_ctx, user_vta_ctx, market_vta_ctx, user_share_ctx, total_options)
    let args = ArgBuilder::new()
        // Encrypted input (Enc<Shared, BuySharesInput>): pubkey + nonce + ciphertexts
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(input_nonce)
        .encrypted_u64(amount_ciphertext)
        .encrypted_u16(selected_option_ciphertext)
        // User VTA: nonce + encrypted state
        .plaintext_u128(user_vta_nonce)
        .account(user_vta_key, 8, 32 * 1)
        // Market VTA: nonce + encrypted state
        .plaintext_u128(market_vta_nonce)
        .account(market_vta_key, 8, 32 * 1)
        // User share: nonce + encrypted state (2 ciphertexts for share_amount and selected_option)
        .plaintext_u128(user_share_nonce)
        .account(user_share_key, 8, 32 * 2)
        // Plaintext total_options for bounds check
        .plaintext_u16(total_options)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![BuyConvictionMarketSharesCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: user_vta_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: market_vta_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: user_share_key,
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("buy_conviction_market_shares")]
#[derive(Accounts)]
pub struct BuyConvictionMarketSharesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES))]
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
    pub user_vote_token_account: Account<'info, VoteToken>,

    #[account(mut)]
    pub market_vote_token_account: Account<'info, VoteToken>,

    #[account(mut)]
    pub user_share: Account<'info, ConvictionMarketShare>,
}

pub fn buy_conviction_market_shares_callback(
    ctx: Context<BuyConvictionMarketSharesCallback>,
    output: SignedComputationOutputs<BuyConvictionMarketSharesOutput>,
) -> Result<()> {
    // Output is (bool, Enc<UserVoteTokenBalance>, Enc<UserVoteTokenBalance>, Enc<UserMarketSharePosition>)
    // field_0 = error boolean (insufficient balance OR invalid option - combined for anonymity)
    // field_1 = updated user VTA encrypted balance
    // field_2 = updated market VTA encrypted balance
    // field_3 = updated user share encrypted state
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(BuyConvictionMarketSharesOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let has_error = res.field_0;
    let user_vta_encrypted = res.field_1;
    let market_vta_encrypted = res.field_2;
    let user_share_encrypted = res.field_3;

    if has_error {
        return Err(ErrorCode::SharePurchaseFailed.into());
    }

    // Update user vote token account
    let user_vta = &mut ctx.accounts.user_vote_token_account;
    user_vta.state_nonce = user_vta_encrypted.nonce;
    user_vta.encrypted_state = user_vta_encrypted.ciphertexts;

    // Update market vote token account
    let market_vta = &mut ctx.accounts.market_vote_token_account;
    market_vta.state_nonce = market_vta_encrypted.nonce;
    market_vta.encrypted_state = market_vta_encrypted.ciphertexts;

    // Update user share
    let user_share = &mut ctx.accounts.user_share;
    user_share.state_nonce = user_share_encrypted.nonce;
    user_share.encrypted_state = user_share_encrypted.ciphertexts;

    Ok(())
}
