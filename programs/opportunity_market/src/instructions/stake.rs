use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::constants::STAKE_ACCOUNT_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, StakedEvent};
use crate::state::{OpportunityMarket, StakeAccount};
use crate::COMP_DEF_OFFSET_STAKE;
use crate::{ID, ID_CONST, ArciumSignerAccount};

#[queue_computation_accounts("stake", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, stake_account_id: u32)]
pub struct Stake<'info> {
    #[account(
        constraint = signer.key() == stake_account.owner @ ErrorCode::Unauthorized,
    )]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
        constraint = market.selected_options.is_none() @ ErrorCode::WinnerAlreadySelected,
        constraint = !market.paused @ ErrorCode::MarketPaused,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        mut,
        seeds = [STAKE_ACCOUNT_SEED, stake_account.owner.as_ref(), market.key().as_ref(), &stake_account_id.to_le_bytes()],
        bump = stake_account.bump,
        constraint = stake_account.staked_at_timestamp.is_none() @ ErrorCode::AlreadyStaked,
        constraint = stake_account.unstaked_at_timestamp.is_none() @ ErrorCode::AlreadyUnstaked,
        constraint = !stake_account.locked @ ErrorCode::Locked,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    // SPL token accounts
    #[account(address = market.mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Funds the stake.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = signer,
        token::token_program = token_program,
    )]
    pub signer_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STAKE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn stake(
    ctx: Context<Stake>,
    computation_offset: u64,
    _stake_account_id: u32,
    amount: u64,
    selected_option_ciphertext: [u8; 32],
    input_nonce: u128,
    authorized_reader_nonce: u128,
    user_pubkey: [u8; 32],
    state_nonce: u128,
) -> Result<()> {
    require!(amount > 0, ErrorCode::InsufficientBalance);
    require!(
        amount >= ctx.accounts.market.min_stake_amount,
        ErrorCode::StakeBelowMinimum
    );

    // Enforce staking period is active
    let market = &ctx.accounts.market;
    let authorized_reader_pubkey = market.authorized_reader_pubkey;
    let open_timestamp = market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    let stake_end_timestamp = open_timestamp
        .checked_add(market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;

    require!(
        current_timestamp >= open_timestamp && current_timestamp <= stake_end_timestamp,
        ErrorCode::StakeWindowMismatch
    );

    let platform_fee = (amount as u128)
        .checked_mul(market.platform_fee_bp as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::Overflow)? as u64;
    let reward_pool_fee = (amount as u128)
        .checked_mul(market.reward_pool_fee_bp as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::Overflow)? as u64;
    let creator_fee = (amount as u128)
        .checked_mul(market.creator_fee_bp as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::Overflow)? as u64;
    let total_fee = platform_fee
        .checked_add(reward_pool_fee)
        .ok_or(ErrorCode::Overflow)?
        .checked_add(creator_fee)
        .ok_or(ErrorCode::Overflow)?;
    let net_amount = amount
        .checked_sub(total_fee)
        .ok_or(ErrorCode::Overflow)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.signer_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.market_token_ata.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // Set stake account fields
    ctx.accounts.stake_account.staked_at_timestamp = Some(current_timestamp);
    ctx.accounts.stake_account.amount = net_amount;
    ctx.accounts.stake_account.platform_fee = platform_fee;
    ctx.accounts.stake_account.reward_pool_fee = reward_pool_fee;
    ctx.accounts.stake_account.creator_fee = creator_fee;
    ctx.accounts.stake_account.user_pubkey = user_pubkey;
    ctx.accounts.stake_account.state_nonce = state_nonce;
    ctx.accounts.stake_account.locked = true;
    ctx.accounts.stake_account.pending_stake = true;

    let stake_account_key = ctx.accounts.stake_account.key();
    let market_key = ctx.accounts.market.key();

    // Build args for encrypted computation
    let args = ArgBuilder::new()
        // User's option input (Enc<Shared, SelectedOption>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(input_nonce)
        .encrypted_u64(selected_option_ciphertext)

        // Authorized reader context (Shared)
        .x25519_pubkey(authorized_reader_pubkey)
        .plaintext_u128(authorized_reader_nonce) // .account => no locking by hand

        // Stake account context (Shared for MXE output encryption)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(state_nonce)
        .build();

    // Queue computation with callback
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![StakeCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: stake_account_key,
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

#[callback_accounts("stake")]
#[derive(Accounts)]
pub struct StakeCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STAKE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Callback accounts
    #[account(mut)]
    pub stake_account: Box<Account<'info, StakeAccount>>,
    #[account(mut)]
    pub market: Box<Account<'info, OpportunityMarket>>,
}

pub fn stake_callback(
    ctx: Context<StakeCallback>,
    output: SignedComputationOutputs<StakeOutput>,
) -> Result<()> {
    // On failure, revert so the account stays stuck.
    // The owner can recover via close_stuck_stake_account.
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(StakeOutput { field_0 }) => field_0,
        Err(e) => return Err(e),
    };

    // Only run on the queue-time stake_account.
    // A late callback delivered after close_stuck + re-init would see pending_stake=false.
    require!(
        ctx.accounts.stake_account.pending_stake,
        ErrorCode::InvalidAccountState
    );

    // Unlock
    ctx.accounts.stake_account.locked = false;
    ctx.accounts.stake_account.pending_stake = false;

    let stake_data_mxe = res.field_0;
    let stake_data_shared = res.field_1;

    // Update stake account with encrypted option data
    ctx.accounts.stake_account.state_nonce = stake_data_mxe.nonce;
    ctx.accounts.stake_account.encrypted_option = stake_data_mxe.ciphertexts[0];
    ctx.accounts.stake_account.state_nonce_disclosure = stake_data_shared.nonce;
    ctx.accounts.stake_account.encrypted_option_disclosure = stake_data_shared.ciphertexts[0];

    let platform_fee = ctx.accounts.stake_account.platform_fee;
    let reward_pool_fee = ctx.accounts.stake_account.reward_pool_fee;
    let creator_fee = ctx.accounts.stake_account.creator_fee;
    if platform_fee > 0 {
        ctx.accounts.market.collected_platform_fees = ctx.accounts.market
            .collected_platform_fees
            .checked_add(platform_fee)
            .ok_or(ErrorCode::Overflow)?;
    }
    if reward_pool_fee > 0 {
        ctx.accounts.market.reward_amount = ctx.accounts.market
            .reward_amount
            .checked_add(reward_pool_fee)
            .ok_or(ErrorCode::Overflow)?;
    }
    if creator_fee > 0 {
        ctx.accounts.market.collected_creator_fees = ctx.accounts.market
            .collected_creator_fees
            .checked_add(creator_fee)
            .ok_or(ErrorCode::Overflow)?;
    }

    emit_ts!(StakedEvent {
        user: ctx.accounts.stake_account.owner,
        market: ctx.accounts.stake_account.market,
        stake_account: ctx.accounts.stake_account.key(),
        stake_account_id: ctx.accounts.stake_account.id,
        stake_encrypted_option: stake_data_mxe.ciphertexts[0],
        stake_state_nonce: stake_data_mxe.nonce,
        stake_encrypted_option_disclosure: stake_data_shared.ciphertexts[0],
        stake_state_disclosure_nonce: stake_data_shared.nonce,
        amount: ctx.accounts.stake_account.amount,
    });

    Ok(())
}
