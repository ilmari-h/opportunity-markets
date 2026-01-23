#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod constants;

pub use error::ErrorCode;
pub use instructions::*;
pub use state::*;

pub const COMP_DEF_OFFSET_INIT_VOTE_TOKEN_ACCOUNT: u32 = comp_def_offset("init_vote_token_account");
pub const COMP_DEF_OFFSET_CALCULATE_VOTE_TOKEN_BALANCE: u32 = comp_def_offset("calculate_vote_token_balance");
pub const COMP_DEF_OFFSET_BUY_CONVICTION_MARKET_SHARES: u32 = comp_def_offset("buy_conviction_market_shares");
pub const COMP_DEF_OFFSET_INIT_MARKET_SHARES: u32 = comp_def_offset("init_market_shares");
pub const COMP_DEF_OFFSET_REVEAL_SHARES: u32 = comp_def_offset("reveal_shares");

declare_id!("Art6D716XwHHTNUcseMU1aG3gQt9utuaVU6T4zxhBCnt");

#[arcium_program]
pub mod conviction_market {
    use super::*;

    pub fn init_vote_token_account_comp_def(ctx: Context<InitVoteTokenAccountCompDef>) -> Result<()> {
        instructions::init_vote_token_account_comp_def(ctx)
    }

    pub fn calculate_vote_token_balance_comp_def(ctx: Context<CalculateVoteTokenBalanceCompDef>) -> Result<()> {
        instructions::calculate_vote_token_balance_comp_def(ctx)
    }

    pub fn init_market_shares_comp_def(ctx: Context<InitMarketSharesCompDef>) -> Result<()> {
        instructions::init_market_shares_comp_def(ctx)
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
        select_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::create_market(ctx, market_index, computation_offset, max_options, total_shares, time_to_stake, time_to_reveal, nonce, select_authority)
    }

    #[arcium_callback(encrypted_ix = "init_market_shares")]
    pub fn init_market_shares_callback(
        ctx: Context<InitMarketSharesCallback>,
        output: SignedComputationOutputs<InitMarketSharesOutput>,
    ) -> Result<()> {
        instructions::init_market_shares_callback(ctx, output)
    }

    pub fn add_market_option(
        ctx: Context<AddMarketOption>,
        option_index: u16,
        name: String,
    ) -> Result<()> {
        instructions::add_market_option(ctx, option_index, name)
    }

    pub fn open_market(ctx: Context<OpenMarket>, open_timestamp: u64) -> Result<()> {
        instructions::open_market(ctx, open_timestamp)
    }

    pub fn select_option(ctx: Context<SelectOption>, option_index: u16) -> Result<()> {
        instructions::select_option(ctx, option_index)
    }

    pub fn increment_option_tally(ctx: Context<IncrementOptionTally>, option_index: u16) -> Result<()> {
        instructions::increment_option_tally(ctx, option_index)
    }

    pub fn init_share_account(
        ctx: Context<InitShareAccount>,
        state_nonce: u128,
    ) -> Result<()> {
        instructions::init_share_account(ctx, state_nonce)
    }

    pub fn init_vote_token_account(
        ctx: Context<InitVoteTokenAccount>,
        computation_offset: u64,
        nonce: u128,
    ) -> Result<()> {
        instructions::init_vote_token_account(ctx, computation_offset, nonce)
    }

    #[arcium_callback(encrypted_ix = "init_vote_token_account")]
    pub fn init_vote_token_account_callback(
        ctx: Context<InitVoteTokenAccountCallback>,
        output: SignedComputationOutputs<InitVoteTokenAccountOutput>,
    ) -> Result<()> {
        instructions::init_vote_token_account_callback(ctx, output)
    }

    pub fn mint_vote_tokens(
        ctx: Context<MintVoteTokens>,
        computation_offset: u64,
        trade_amount: u64,
        buy: bool,
    ) -> Result<()> {
        instructions::mint_vote_tokens(ctx, computation_offset, trade_amount, buy)
    }

    #[arcium_callback(encrypted_ix = "calculate_vote_token_balance")]
    pub fn calculate_vote_token_balance_callback(
        ctx: Context<CalculateVoteTokenBalanceCallback>,
        output: SignedComputationOutputs<CalculateVoteTokenBalanceOutput>,
    ) -> Result<()> {
        instructions::calculate_vote_token_balance_callback(ctx, output)
    }

    pub fn buy_conviction_market_shares_comp_def(ctx: Context<BuyConvictionMarketSharesCompDef>) -> Result<()> {
        instructions::buy_conviction_market_shares_comp_def(ctx)
    }

    pub fn buy_market_shares(
        ctx: Context<BuyMarketShares>,
        computation_offset: u64,
        amount_ciphertext: [u8; 32],
        selected_option_ciphertext: [u8; 32],
        user_pubkey: [u8; 32],
        input_nonce: u128,

        authorized_reader_pubkey: [u8; 32],
        authorized_reader_nonce: u128,
    ) -> Result<()> {
        instructions::buy_market_shares(
            ctx,
            computation_offset,
            amount_ciphertext,
            selected_option_ciphertext,
            user_pubkey,
            input_nonce,
            authorized_reader_pubkey,
            authorized_reader_nonce,
        )
    }

    #[arcium_callback(encrypted_ix = "buy_conviction_market_shares")]
    pub fn buy_conviction_market_shares_callback(
        ctx: Context<BuyConvictionMarketSharesCallback>,
        output: SignedComputationOutputs<BuyConvictionMarketSharesOutput>,
    ) -> Result<()> {
        instructions::buy_conviction_market_shares_callback(ctx, output)
    }

    pub fn reveal_shares_comp_def(ctx: Context<RevealSharesCompDef>) -> Result<()> {
        instructions::reveal_shares_comp_def(ctx)
    }

    pub fn reveal_shares(
        ctx: Context<RevealShares>,
        computation_offset: u64,
        option_index: u16,
        user_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::reveal_shares(ctx, computation_offset, option_index, user_pubkey)
    }

    #[arcium_callback(encrypted_ix = "reveal_shares")]
    pub fn reveal_shares_callback(
        ctx: Context<RevealSharesCallback>,
        output: SignedComputationOutputs<RevealSharesOutput>,
    ) -> Result<()> {
        instructions::reveal_shares_callback(ctx, output)
    }
}
