use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::SharesRevealedEvent;
use crate::instructions::buy_market_shares::SHARE_ACCOUNT_SEED;
use crate::state::{OpportunityMarket, ShareAccount, VoteTokenAccount};
use crate::COMP_DEF_OFFSET_REVEAL_SHARES;
use crate::{ArciumSignerAccount, ID, ID_CONST};

#[queue_computation_accounts("reveal_shares", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RevealShares<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: Any account, this operation is permissionless.
    pub owner: UncheckedAccount<'info>,

    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        seeds = [SHARE_ACCOUNT_SEED, owner.key().as_ref(), market.key().as_ref()],
        bump = share_account.bump,
        constraint = share_account.revealed_amount.is_none() @ ErrorCode::AlreadyRevealed,
    )]
    pub share_account: Box<Account<'info, ShareAccount>>,

    #[account(mut)]
    pub user_vta: Box<Account<'info, VoteTokenAccount>>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_SHARES))]
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


// This operation is permissionless:
// after the staking period has ended and an option has been selected, anyone can reveal anyones vote.
pub fn reveal_shares(
    ctx: Context<RevealShares>,
    computation_offset: u64,
    user_pubkey: [u8; 32],
) -> Result<()> {

    require!(ctx.accounts.user_vta.owner.key().eq(&ctx.accounts.owner.key()), ErrorCode::Unauthorized);
    require!(ctx.accounts.market.mint.eq(&ctx.accounts.user_vta.token_mint.key()), ErrorCode::InvalidMint);

    let market = &ctx.accounts.market;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    // Check that staking period is over.
    let reveal_start = market
        .open_timestamp
        .ok_or(ErrorCode::MarketNotOpen)?
        .saturating_add(market.time_to_stake);

    require!(current_timestamp >= reveal_start, ErrorCode::MarketNotResolved);

    let share_account_key = ctx.accounts.share_account.key();
    let share_account_nonce = ctx.accounts.share_account.state_nonce;

    let user_vta_key = ctx.accounts.user_vta.key();
    let user_vta_nonce = ctx.accounts.user_vta.state_nonce;

    // Build args for encrypted computation
    let args = ArgBuilder::new()

        // Share account encrypted state (Enc<Shared, SharePurchase>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(share_account_nonce)
        .account(share_account_key, 8, 32 * 2)

        // User VTA encrypted state (Enc<Shared, VoteTokenBalance>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(user_vta_nonce)
        .account(user_vta_key, 8, 32 * 1)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![RevealSharesCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: share_account_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: user_vta_key,
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("reveal_shares")]
#[derive(Accounts)]
pub struct RevealSharesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_SHARES))]
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
    pub share_account: Account<'info, ShareAccount>,
    #[account(mut)]
    pub user_vta: Account<'info, VoteTokenAccount>,
}

pub fn reveal_shares_callback(
    ctx: Context<RevealSharesCallback>,
    output: SignedComputationOutputs<RevealSharesOutput>,
) -> Result<()> {
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(RevealSharesOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let revealed_amount = res.field_0;
    let revealed_option = res.field_1;
    let new_user_balance = res.field_2;

    // Update share account with revealed values
    ctx.accounts.share_account.revealed_amount = Some(revealed_amount);
    ctx.accounts.share_account.revealed_option = Some(revealed_option);

    // Update user VTA with credited balance
    ctx.accounts.user_vta.state_nonce = new_user_balance.nonce;
    ctx.accounts.user_vta.encrypted_state = new_user_balance.ciphertexts;

    emit!(SharesRevealedEvent{
        buyer: ctx.accounts.user_vta.owner,
        shares_amount: revealed_amount,
        selected_option: revealed_option
    });

    Ok(())
}
