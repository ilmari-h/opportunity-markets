use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::instructions::mint_vote_tokens::VOTE_TOKEN_ACCOUNT_SEED;
use crate::state::{ConvictionMarket, VoteTokenAccount};
use crate::COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES;
use crate::{ID, ID_CONST, ArciumSignerAccount};

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
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, signer.key().as_ref()],
        bump
    )]
    pub user_vta: Account<'info, VoteTokenAccount>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES))]
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

pub fn buy_market_shares(
    ctx: Context<BuyMarketShares>,
    computation_offset: u64,
    amount_ciphertext: [u8; 32],
    selected_option_ciphertext: [u8; 32],

    user_pubkey: [u8; 32],
    input_nonce_user: u128,

    // Optional voluntary disclosure - to opt out, pass user's own pubkey.

    // TODO: how to share with authorized reader? Just share the shared secret?
    // This is NOT the actual account pubkey but an ephemeral pubkey
    // Perhaps no need to pass another pubkey - sufficient to share the shared secret with observer.
    authorized_reader_pubkey: [u8; 32],
    input_nonce_authorized_reader: u128,
) -> Result<()> {
    let user_vta_key = ctx.accounts.user_vta.key();
    let user_vta_nonce = ctx.accounts.user_vta.state_nonce;

    let market_key = ctx.accounts.market.key();
    let market_state_nonce = ctx.accounts.market.state_nonce;

    // Build args for encrypted computation
    let args = ArgBuilder::new()
        // User's trade input
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(input_nonce_user)
        .encrypted_u64(amount_ciphertext)
        .encrypted_u16(selected_option_ciphertext)

        // Voluntary disclosure
        .x25519_pubkey(authorized_reader_pubkey)
        .plaintext_u128(input_nonce_authorized_reader)

        // User's VTA
        .plaintext_u128(user_vta_nonce)
        .account(user_vta_key, 8, 32 * 1)

        // Available market shares
        .plaintext_u128(market_state_nonce)
        .account(market_key, 8, 32 * 1)
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
                          pubkey: market_key,                                                                                     
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
    pub user_vote_token_account: Account<'info, VoteTokenAccount>,

    #[account(mut)]
    pub market: Account<'info, ConvictionMarket>,
}

pub fn buy_conviction_market_shares_callback(
    ctx: Context<BuyConvictionMarketSharesCallback>,
    output: SignedComputationOutputs<BuyConvictionMarketSharesOutput>,
) -> Result<()> {

    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(BuyConvictionMarketSharesOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };
    let has_error = res.field_0;
    let new_user_balance = res.field_1;
    let new_market_shares = res.field_2;
    let new_user_balance_disclosed = res.field_3;

    if has_error {
        return Err(ErrorCode::SharePurchaseFailed.into());
    }

    // Update user balance
    ctx.accounts.user_vote_token_account.state_nonce = new_user_balance.nonce;
    ctx.accounts.user_vote_token_account.encrypted_state = new_user_balance.ciphertexts;

    // Update market shares
    ctx.accounts.market.state_nonce = new_market_shares.nonce;
    ctx.accounts.market.encrypted_available_shares = new_market_shares.ciphertexts;

    // Update voluntary disclosure fields
    ctx.accounts.user_vote_token_account.encrypted_state_disclosure = new_user_balance_disclosed.ciphertexts;
    ctx.accounts.user_vote_token_account.state_nonce_disclosure = new_user_balance_disclosed.nonce;

    Ok(())
}
