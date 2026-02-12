use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::SharesPurchasedEvent;
use crate::state::{CentralState, OpportunityMarket, OpportunityMarketOption, ShareAccount, VoteTokenAccount};
use crate::instructions::stake::SHARE_ACCOUNT_SEED;
use crate::COMP_DEF_OFFSET_ADD_OPTION_STAKE;
use crate::{ID, ID_CONST, ArciumSignerAccount};

#[queue_computation_accounts("add_option_stake", creator)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, option_index: u16, share_account_id: u32)]
pub struct AddMarketOption<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = market.selected_option.is_none() @ ErrorCode::WinnerAlreadySelected,
        constraint = market.open_timestamp.is_some() @ ErrorCode::MarketNotOpen,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        seeds = [b"central_state"],
        bump = central_state.bump,
    )]
    pub central_state: Box<Account<'info, CentralState>>,

    #[account(
        init,
        payer = creator,
        space = 8 + OpportunityMarketOption::INIT_SPACE,
        seeds = [b"option", market.key().as_ref(), &option_index.to_le_bytes()],
        bump,
    )]
    pub option: Box<Account<'info, OpportunityMarketOption>>,

    #[account(
        mut,
        constraint = source_vta.owner == creator.key() @ ErrorCode::Unauthorized,
        constraint = source_vta.token_mint == market.mint @ ErrorCode::InvalidMint,
        constraint = !source_vta.locked @ ErrorCode::Locked,
    )]
    pub source_vta: Box<Account<'info, VoteTokenAccount>>,

    #[account(
        init,
        payer = creator,
        space = 8 + ShareAccount::INIT_SPACE,
        seeds = [SHARE_ACCOUNT_SEED, creator.key().as_ref(), market.key().as_ref(), &share_account_id.to_le_bytes()],
        bump,
    )]
    pub share_account: Box<Account<'info, ShareAccount>>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = creator,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_OPTION_STAKE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn add_market_option(
    ctx: Context<AddMarketOption>,
    computation_offset: u64,
    option_index: u16,
    _share_account_id: u32,
    name: String,
    amount_ciphertext: [u8; 32],
    user_pubkey: [u8; 32],
    input_nonce: u128,
    authorized_reader_pubkey: [u8; 32],
    authorized_reader_nonce: u128,
    share_account_nonce: u128,
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // Option index must match total_options + 1
    require!(
        option_index == market.total_options + 1,
        ErrorCode::InvalidOptionIndex
    );

    // Enforce staking period is active
    let open_timestamp = market.open_timestamp.ok_or_else(|| ErrorCode::MarketNotOpen)?;
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;
    let stake_end_timestamp = open_timestamp + market.time_to_stake;

    require!(
        current_timestamp >= open_timestamp && current_timestamp <= stake_end_timestamp,
        ErrorCode::StakingNotActive
    );

    // Increment total options
    market.total_options = option_index;

    // Initialize the option account
    let option = &mut ctx.accounts.option;
    option.bump = ctx.bumps.option;
    option.name = name;
    option.total_shares = None;
    option.total_score = None;
    option.creator = ctx.accounts.creator.key();

    // Initialize the share account
    let share_account = &mut ctx.accounts.share_account;
    share_account.bump = ctx.bumps.share_account;
    share_account.owner = ctx.accounts.creator.key();
    share_account.market = market.key();
    share_account.state_nonce = share_account_nonce;
    share_account.state_nonce_disclosure = 0;
    share_account.encrypted_state = [[0u8; 32]; 2];
    share_account.encrypted_state_disclosure = [[0u8; 32]; 2];
    share_account.revealed_amount = None;
    share_account.revealed_option = None;
    share_account.revealed_score = None;
    share_account.total_incremented = false;
    share_account.staked_at_timestamp = Some(current_timestamp);
    share_account.unstaked_at_timestamp = None;

    let source_vta_key = ctx.accounts.source_vta.key();
    let source_vta_nonce = ctx.accounts.source_vta.state_nonce;

    let share_account_key = ctx.accounts.share_account.key();

    ctx.accounts.source_vta.locked = true;

    // Build args for encrypted computation
    let args = ArgBuilder::new()
        // Encrypted amount input (Enc<Shared, AddOptionStakeInput>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(input_nonce)
        .encrypted_u64(amount_ciphertext)

        // Authorized reader context (Shared) - voluntary disclosure
        .x25519_pubkey(authorized_reader_pubkey)
        .plaintext_u128(authorized_reader_nonce)

        // User's VTA (Enc<Shared, VoteTokenBalance>)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(source_vta_nonce)
        .account(source_vta_key, 8, 32 * 1)

        // Share account context (Shared)
        .x25519_pubkey(user_pubkey)
        .plaintext_u128(share_account_nonce)

        // Plaintext: min_deposit from central_state
        .plaintext_u64(ctx.accounts.central_state.min_option_deposit)

        // Plaintext: selected_option (u64 because no plaintext_u16)
        .plaintext_u64(option_index as u64)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![AddOptionStakeCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: source_vta_key,
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

#[callback_accounts("add_option_stake")]
#[derive(Accounts)]
pub struct AddOptionStakeCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_OPTION_STAKE))]
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
    pub source_vta: Account<'info, VoteTokenAccount>,

    #[account(mut)]
    pub share_account: Account<'info, ShareAccount>,
}

pub fn add_market_option_callback(
    ctx: Context<AddOptionStakeCallback>,
    output: SignedComputationOutputs<AddOptionStakeOutput>,
) -> Result<()> {
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(AddOptionStakeOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let has_error = res.field_0;
    let new_user_balance = res.field_1;
    let bought_shares_mxe = res.field_2;
    let bought_shares_shared = res.field_3;

    if has_error {
        return Err(ErrorCode::AddOptionStakeFailed.into());
    }

    // Update source VTA balance
    ctx.accounts.source_vta.state_nonce = new_user_balance.nonce;
    ctx.accounts.source_vta.encrypted_state = new_user_balance.ciphertexts;
    ctx.accounts.source_vta.locked = false;

    // Update share account encrypted state
    ctx.accounts.share_account.state_nonce = bought_shares_mxe.nonce;
    ctx.accounts.share_account.encrypted_state = bought_shares_mxe.ciphertexts;
    ctx.accounts.share_account.state_nonce_disclosure = bought_shares_shared.nonce;
    ctx.accounts.share_account.encrypted_state_disclosure = bought_shares_shared.ciphertexts;

    emit!(SharesPurchasedEvent {
        buyer: ctx.accounts.source_vta.owner,
        encrypted_disclosed_amount: bought_shares_shared.ciphertexts[0],
        nonce: bought_shares_shared.nonce
    });

    Ok(())
}
