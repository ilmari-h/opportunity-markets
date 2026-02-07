use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::state::OpportunityMarket;
use crate::events::MarketCreatedEvent;
use crate::COMP_DEF_OFFSET_INIT_MARKET_SHARES;
use crate::{ID, ID_CONST, ArciumSignerAccount};

#[queue_computation_accounts("init_market_shares", creator)]
#[derive(Accounts)]
#[instruction(market_index: u64, computation_offset: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + OpportunityMarket::INIT_SPACE,
        seeds = [b"opportunity_market", creator.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    /// ATA owned by market PDA, holds reward tokens
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_index: u64,
    computation_offset: u64,
    max_shares: u64,
    reward_amount: u64,
    time_to_stake: u64,
    time_to_reveal: u64,
    nonce: u128,
    market_authority: Option<Pubkey>,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.bump = ctx.bumps.market;
    market.creator = ctx.accounts.creator.key();
    market.index = market_index;
    market.total_options = 0;
    market.max_shares = max_shares;
    market.time_to_stake = time_to_stake;
    market.time_to_reveal = time_to_reveal;
    market.selected_option = None;
    market.state_nonce = 0;
    market.reward_amount = reward_amount;
    market.mint = ctx.accounts.token_mint.key();
    market.market_authority = market_authority;

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build args: plaintext nonce and plaintext total_shares
    let args = ArgBuilder::new()
        .plaintext_u128(nonce)
        .plaintext_u64(max_shares)
        .build();

    // Queue computation with callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
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
        max_shares: max_shares,
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
    pub market: Account<'info, OpportunityMarket>,
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
