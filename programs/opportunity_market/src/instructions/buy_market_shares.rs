use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::SharesPurchasedEvent;
use crate::state::{OpportunityMarket, ShareAccount, VoteTokenAccount};
use crate::COMP_DEF_OFFSET_BUY_OPPORTUNITY_MARKET_SHARES;
use crate::{ID, ID_CONST, ArciumSignerAccount};

pub const SHARE_ACCOUNT_SEED: &[u8] = b"share_account";

#[queue_computation_accounts("buy_opportunity_market_shares", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
        constraint = market.selected_option.is_none() @ ErrorCode::WinnerAlreadySelected,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        constraint = user_vta.owner == signer.key() @ ErrorCode::Unauthorized,
    )]
    pub user_vta: Box<Account<'info, VoteTokenAccount>>,

    // Boxed due to heap overflow
    #[account(
        mut,
        seeds = [SHARE_ACCOUNT_SEED, signer.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub share_account: Box<Account<'info, ShareAccount>>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_OPPORTUNITY_MARKET_SHARES))]
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
    input_nonce: u128,

    // Optional voluntary disclosure - to opt out, pass user's own pubkey or of deleted keypair.
    authorized_reader_pubkey: [u8; 32],
    authorized_reader_nonce: u128,
) -> Result<()> {

    require!(ctx.accounts.market.mint.eq(&ctx.accounts.user_vta.token_mint), ErrorCode::InvalidMint);

    // Enforce staking period is active
    let market = &ctx.accounts.market;
    let open_timestamp = market.open_timestamp.ok_or_else(|| ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    let stake_end_timestamp = open_timestamp + market.time_to_stake;

    require!(
        current_timestamp >= open_timestamp && current_timestamp <= stake_end_timestamp,
        ErrorCode::StakingNotActive
    );

    // Capture timestamp when the buy is queued, not when callback runs
    ctx.accounts.share_account.bought_at_timestamp = current_timestamp;

    let user_vta_key = ctx.accounts.user_vta.key();
    let user_vta_nonce = ctx.accounts.user_vta.state_nonce;

    let market_key = ctx.accounts.market.key();
    let market_state_nonce = ctx.accounts.market.state_nonce;

    // Build args for encrypted computation
    let args = ArgBuilder::new()
        // User's trade input (Enc<Shared, BuySharesInput>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(input_nonce)
        .encrypted_u64(amount_ciphertext)
        .encrypted_u16(selected_option_ciphertext)

        // Authorized reader context (Shared)
        .x25519_pubkey(authorized_reader_pubkey)
        .plaintext_u128(authorized_reader_nonce)

        // User's VTA (Enc<Shared, VoteTokenBalance>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(user_vta_nonce)
        .account(user_vta_key, 8, 32 * 1)

        // Available market shares (Enc<Mxe, MarketShareState>)
        .plaintext_u128(market_state_nonce)
        .account(market_key, 8, 32 * 1)

        // Share account context (Mxe for output encryption)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(ctx.accounts.share_account.state_nonce)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![BuyOpportunityMarketSharesCallback::callback_ix(
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
                CallbackAccount {
                    pubkey: ctx.accounts.share_account.key(),
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("buy_opportunity_market_shares")]
#[derive(Accounts)]
pub struct BuyOpportunityMarketSharesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_BUY_OPPORTUNITY_MARKET_SHARES))]
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
    pub market: Account<'info, OpportunityMarket>,

    #[account(mut)]
    pub share_account: Account<'info, ShareAccount>,
}

pub fn buy_opportunity_market_shares_callback(
    ctx: Context<BuyOpportunityMarketSharesCallback>,
    output: SignedComputationOutputs<BuyOpportunityMarketSharesOutput>,
) -> Result<()> {

    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(BuyOpportunityMarketSharesOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };
    let has_error = res.field_0;
    let new_user_balance = res.field_1;
    let new_market_shares = res.field_2;
    let bought_shares_mxe = res.field_3;
    let bought_shares_shared = res.field_4;

    if has_error {
        return Err(ErrorCode::SharePurchaseFailed.into());
    }

    // Update user balance to <previous balance> - <bought shares>
    ctx.accounts.user_vote_token_account.state_nonce = new_user_balance.nonce;
    ctx.accounts.user_vote_token_account.encrypted_state = new_user_balance.ciphertexts;

    // Update market shares, decrement user shares.
    ctx.accounts.market.state_nonce = new_market_shares.nonce;
    ctx.accounts.market.encrypted_available_shares = new_market_shares.ciphertexts;

    // Update share account to the value of bought shares.
    ctx.accounts.share_account.state_nonce = bought_shares_mxe.nonce;
    ctx.accounts.share_account.encrypted_state = bought_shares_mxe.ciphertexts;
    ctx.accounts.share_account.state_nonce_disclosure = bought_shares_shared.nonce;
    ctx.accounts.share_account.encrypted_state_disclosure = bought_shares_shared.ciphertexts;

    emit!(SharesPurchasedEvent{
        buyer: ctx.accounts.user_vote_token_account.owner,
        encrypted_disclosed_amount: bought_shares_shared.ciphertexts[0],
        nonce: bought_shares_shared.nonce
    });

    Ok(())
}
