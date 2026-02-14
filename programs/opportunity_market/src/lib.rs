#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod score;

pub use error::ErrorCode;
pub use instructions::*;
pub use state::*;

pub const COMP_DEF_OFFSET_BUY_VOTE_TOKENS: u32 = comp_def_offset("buy_vote_tokens");
pub const COMP_DEF_OFFSET_CLAIM_VOTE_TOKENS: u32 = comp_def_offset("claim_vote_tokens");
pub const COMP_DEF_OFFSET_BUY_OPPORTUNITY_MARKET_SHARES: u32 = comp_def_offset("buy_opportunity_market_shares");
pub const COMP_DEF_OFFSET_REVEAL_SHARES: u32 = comp_def_offset("reveal_shares");
pub const COMP_DEF_OFFSET_UNSTAKE_EARLY: u32 = comp_def_offset("unstake_early");
pub const COMP_DEF_OFFSET_ADD_OPTION_STAKE: u32 = comp_def_offset("add_option_stake");

declare_id!("jsK4sUrViFZvKTCFw2ekhyTtCydyntGZ1fdY7PXtbgw");

#[arcium_program]
pub mod opportunity_market {
    use super::*;

    pub fn buy_vote_tokens_comp_def(ctx: Context<BuyVoteTokensCompDef>) -> Result<()> {
        instructions::buy_vote_tokens_comp_def(ctx)
    }

    pub fn claim_vote_tokens_comp_def(ctx: Context<ClaimVoteTokensCompDef>) -> Result<()> {
        instructions::claim_vote_tokens_comp_def(ctx)
    }

    pub fn reveal_shares_comp_def(ctx: Context<RevealSharesCompDef>) -> Result<()> {
        instructions::reveal_shares_comp_def(ctx)
    }

    pub fn unstake_early_comp_def(ctx: Context<UnstakeEarlyCompDef>) -> Result<()> {
        instructions::unstake_early_comp_def(ctx)
    }

    pub fn add_option_stake_comp_def(ctx: Context<AddOptionStakeCompDef>) -> Result<()> {
        instructions::add_option_stake_comp_def(ctx)
    }

    pub fn init_central_state(
        ctx: Context<InitCentralState>,
        earliness_cutoff_seconds: u64,
        min_option_deposit: u64,
    ) -> Result<()> {
        instructions::init_central_state(ctx, earliness_cutoff_seconds, min_option_deposit)
    }

    pub fn transfer_central_state_authority(
        ctx: Context<TransferCentralStateAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::transfer_central_state_authority(ctx, new_authority)
    }

    pub fn update_central_state(
        ctx: Context<UpdateCentralState>,
        earliness_cutoff_seconds: u64,
        min_option_deposit: u64,
    ) -> Result<()> {
        instructions::update_central_state(ctx, earliness_cutoff_seconds, min_option_deposit)
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_index: u64,
        reward_amount: u64,
        time_to_stake: u64,
        time_to_reveal: u64,
        market_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::create_market(
            ctx,
            market_index,
            reward_amount,
            time_to_stake,
            time_to_reveal,
            market_authority
        )
    }

    pub fn add_market_option(
        ctx: Context<AddMarketOption>,
        computation_offset: u64,
        option_index: u16,
        share_account_id: u32,
        name: String,
        amount_ciphertext: [u8; 32],
        input_nonce: u128,
        authorized_reader_pubkey: [u8; 32],
        authorized_reader_nonce: u128,
    ) -> Result<()> {
        instructions::add_market_option(
            ctx,
            computation_offset,
            option_index,
            share_account_id,
            name,
            amount_ciphertext,
            input_nonce,
            authorized_reader_pubkey,
            authorized_reader_nonce,
        )
    }

    #[arcium_callback(encrypted_ix = "add_option_stake")]
    pub fn add_option_stake_callback(
        ctx: Context<AddOptionStakeCallback>,
        output: SignedComputationOutputs<AddOptionStakeOutput>,
    ) -> Result<()> {
        instructions::add_market_option_callback(ctx, output)
    }

    pub fn open_market(ctx: Context<OpenMarket>, open_timestamp: u64) -> Result<()> {
        instructions::open_market(ctx, open_timestamp)
    }

    pub fn select_option(ctx: Context<SelectOption>, option_index: u16) -> Result<()> {
        instructions::select_option(ctx, option_index)
    }

    pub fn extend_reveal_period(ctx: Context<ExtendRevealPeriod>, new_time_to_reveal: u64) -> Result<()> {
        instructions::extend_reveal_period(ctx, new_time_to_reveal)
    }

    pub fn increment_option_tally(ctx: Context<IncrementOptionTally>, option_index: u16, share_account_id: u32) -> Result<()> {
        instructions::increment_option_tally(ctx, option_index, share_account_id)
    }

    pub fn close_share_account(ctx: Context<CloseShareAccount>, option_index: u16, share_account_id: u32) -> Result<()> {
        instructions::close_share_account(ctx, option_index, share_account_id)
    }

    pub fn claim_pending_deposit(ctx: Context<ClaimPendingDeposit>) -> Result<()> {
        instructions::claim_pending_deposit(ctx)
    }

    pub fn init_share_account(
        ctx: Context<InitShareAccount>,
        state_nonce: u128,
        share_account_id: u32,
    ) -> Result<()> {
        instructions::init_share_account(ctx, state_nonce, share_account_id)
    }

    pub fn init_vote_token_account(
        ctx: Context<InitVoteTokenAccount>,
        user_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::init_vote_token_account(ctx, user_pubkey)
    }

    pub fn init_ephemeral_vote_token_account(
        ctx: Context<InitEphemeralVoteTokenAccount>,
        index: u64,
    ) -> Result<()> {
        instructions::init_ephemeral_vote_token_account(ctx, index)
    }

    pub fn mint_vote_tokens(
        ctx: Context<MintVoteTokens>,
        computation_offset: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::mint_vote_tokens(ctx, computation_offset, amount)
    }

    #[arcium_callback(encrypted_ix = "buy_vote_tokens")]
    pub fn buy_vote_tokens_callback(
        ctx: Context<BuyVoteTokensCallback>,
        output: SignedComputationOutputs<BuyVoteTokensOutput>,
    ) -> Result<()> {
        instructions::buy_vote_tokens_callback(ctx, output)
    }

    pub fn claim_vote_tokens(
        ctx: Context<ClaimVoteTokens>,
        computation_offset: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::claim_vote_tokens(ctx, computation_offset, amount)
    }

    #[arcium_callback(encrypted_ix = "claim_vote_tokens")]
    pub fn claim_vote_tokens_callback(
        ctx: Context<ClaimVoteTokensCallback>,
        output: SignedComputationOutputs<ClaimVoteTokensOutput>,
    ) -> Result<()> {
        instructions::claim_vote_tokens_callback(ctx, output)
    }

    pub fn buy_opportunity_market_shares_comp_def(ctx: Context<BuyOpportunityMarketSharesCompDef>) -> Result<()> {
        instructions::buy_opportunity_market_shares_comp_def(ctx)
    }

    pub fn stake(
        ctx: Context<Stake>,
        computation_offset: u64,
        share_account_id: u32,
        amount_ciphertext: [u8; 32],
        selected_option_ciphertext: [u8; 32],
        input_nonce: u128,

        authorized_reader_pubkey: [u8; 32],
        authorized_reader_nonce: u128,
    ) -> Result<()> {
        instructions::stake(
            ctx,
            computation_offset,
            share_account_id,
            amount_ciphertext,
            selected_option_ciphertext,
            input_nonce,
            authorized_reader_pubkey,
            authorized_reader_nonce,
        )
    }

    #[arcium_callback(encrypted_ix = "buy_opportunity_market_shares")]
    pub fn buy_opportunity_market_shares_callback(
        ctx: Context<BuyOpportunityMarketSharesCallback>,
        output: SignedComputationOutputs<BuyOpportunityMarketSharesOutput>,
    ) -> Result<()> {
        instructions::buy_opportunity_market_shares_callback(ctx, output)
    }
    pub fn reveal_shares(
        ctx: Context<RevealShares>,
        computation_offset: u64,
        share_account_id: u32,
    ) -> Result<()> {
        instructions::reveal_shares(ctx, computation_offset, share_account_id)
    }

    #[arcium_callback(encrypted_ix = "reveal_shares")]
    pub fn reveal_shares_callback(
        ctx: Context<RevealSharesCallback>,
        output: SignedComputationOutputs<RevealSharesOutput>,
    ) -> Result<()> {
        instructions::reveal_shares_callback(ctx, output)
    }

    pub fn unstake_early(
        ctx: Context<UnstakeEarly>,
        computation_offset: u64,
        share_account_id: u32,
    ) -> Result<()> {
        instructions::unstake_early(ctx, computation_offset, share_account_id)
    }

    #[arcium_callback(encrypted_ix = "unstake_early")]
    pub fn unstake_early_callback(
        ctx: Context<UnstakeEarlyCallback>,
        output: SignedComputationOutputs<UnstakeEarlyOutput>,
    ) -> Result<()> {
        instructions::unstake_early_callback(ctx, output)
    }
}
