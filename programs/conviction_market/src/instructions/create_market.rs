use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::state::ConvictionMarket;
use crate::events::MarketCreatedEvent;
use crate::COMP_DEF_OFFSET_INIT_MARKET_SHARES;
use crate::{ID, ID_CONST, ArciumSignerAccount};

#[queue_computation_accounts("init_market_shares", creator)]
#[derive(Accounts)]
#[instruction(market_index: u64, computation_offset: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + ConvictionMarket::INIT_SPACE,
        seeds = [b"conviction_market", creator.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, ConvictionMarket>,

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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_MARKET_SHARES))]
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

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_index: u64,
    computation_offset: u64,
    max_options: u16,
    total_shares: u64,
    time_to_stake: u64,
    time_to_reveal: u64,
    nonce: u128,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.bump = ctx.bumps.market;
    market.creator = ctx.accounts.creator.key();
    market.index = market_index;
    market.total_options = 0;
    market.max_options = max_options;
    market.total_shares = total_shares;
    market.time_to_stake = time_to_stake;
    market.time_to_reveal = time_to_reveal;
    market.selected_option = None;
    market.state_nonce = 0;

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build args: plaintext nonce and plaintext total_shares
    let args = ArgBuilder::new()
        .plaintext_u128(nonce)
        .plaintext_u64(total_shares)
        .build();

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![InitMarketSharesCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.market.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    emit!(MarketCreatedEvent {
        market: ctx.accounts.market.key(),
        creator: ctx.accounts.creator.key(),
        total_shares: total_shares,
        index: market_index,
    });

    Ok(())
}

#[callback_accounts("init_market_shares")]
#[derive(Accounts)]
pub struct InitMarketSharesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_MARKET_SHARES))]
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
    pub market: Account<'info, ConvictionMarket>,
}

pub fn init_market_shares_callback(
    ctx: Context<InitMarketSharesCallback>,
    output: SignedComputationOutputs<InitMarketSharesOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(InitMarketSharesOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let market = &mut ctx.accounts.market;
    market.state_nonce = o.nonce;
    market.encrypted_available_shares = o.ciphertexts;

    Ok(())
}
