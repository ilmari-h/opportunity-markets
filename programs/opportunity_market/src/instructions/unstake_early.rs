use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::{SharesUnstakedError, SharesUnstakedEvent};
use crate::instructions::stake::SHARE_ACCOUNT_SEED;
use crate::state::{OpportunityMarket, ShareAccount, VoteTokenAccount};
use crate::COMP_DEF_OFFSET_UNSTAKE_EARLY;
use crate::{ArciumSignerAccount, ID, ID_CONST};

#[queue_computation_accounts("unstake_early", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, share_account_id: u32)]
pub struct UnstakeEarly<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
        constraint = market.selected_option.is_none() @ ErrorCode::WinnerAlreadySelected,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        constraint = user_vta.owner == signer.key() @ ErrorCode::Unauthorized,
        constraint = !user_vta.locked @ ErrorCode::Locked,
    )]
    pub user_vta: Box<Account<'info, VoteTokenAccount>>,

    #[account(
        mut,
        seeds = [SHARE_ACCOUNT_SEED, signer.key().as_ref(), market.key().as_ref(), &share_account_id.to_le_bytes()],
        bump = share_account.bump,
        constraint = share_account.unstaked_at_timestamp.is_none() @ ErrorCode::AlreadyUnstaked,
        constraint = !share_account.locked @ ErrorCode::Locked,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSTAKE_EARLY))]
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

pub fn unstake_early(
    ctx: Context<UnstakeEarly>,
    computation_offset: u64,
    _share_account_id: u32,
) -> Result<()> {
    let user_pubkey = ctx.accounts.user_vta.user_pubkey;

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

    let share_account_key = ctx.accounts.share_account.key();
    let share_account_nonce = ctx.accounts.share_account.state_nonce;

    let user_vta_key = ctx.accounts.user_vta.key();
    let user_vta_nonce = ctx.accounts.user_vta.state_nonce;

    // Lock both accounts while MPC computation is pending
    ctx.accounts.user_vta.locked = true;
    ctx.accounts.share_account.locked = true;


    // Build args for encrypted computation
    let is_vta_initialized = user_vta_nonce != 0;
    let args = ArgBuilder::new()
        // Share account encrypted state (Enc<Shared, SharePurchase>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(share_account_nonce)
        .account(share_account_key, 8, 32 * 2)

        // User VTA encrypted state (Enc<Shared, VoteTokenBalance>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(user_vta_nonce)
        .account(user_vta_key, 8, 32 * 1)

        // Is VTA initialized flag
        .plaintext_bool(is_vta_initialized)
        .build();

    // Queue computation with callback
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![UnstakeEarlyCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: user_vta_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: share_account_key,
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("unstake_early")]
#[derive(Accounts)]
pub struct UnstakeEarlyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSTAKE_EARLY))]
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
    pub user_vta: Account<'info, VoteTokenAccount>,
    #[account(mut)]
    pub share_account: Account<'info, ShareAccount>,
}

pub fn unstake_early_callback(
    ctx: Context<UnstakeEarlyCallback>,
    output: SignedComputationOutputs<UnstakeEarlyOutput>,
) -> Result<()> {
    // Unlock accounts
    ctx.accounts.user_vta.locked = false;
    ctx.accounts.share_account.locked = false;

    // Verify output - on error, emit event and return Ok so unlocks persist
    let new_user_balance = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(UnstakeEarlyOutput { field_0 }) => field_0,
        Err(_) => {
            emit!(SharesUnstakedError {
                user: ctx.accounts.user_vta.owner,
            });
            return Ok(());
        }
    };

    // Mark share account as unstaked
    let clock = Clock::get()?;
    ctx.accounts.share_account.unstaked_at_timestamp = Some(clock.unix_timestamp as u64);

    // Update user VTA with refunded balance
    ctx.accounts.user_vta.state_nonce = new_user_balance.nonce;
    ctx.accounts.user_vta.encrypted_state = new_user_balance.ciphertexts;

    emit!(SharesUnstakedEvent {
        buyer: ctx.accounts.user_vta.owner,
        market: ctx.accounts.share_account.market,
    });

    Ok(())
}
