#![allow(ambiguous_glob_reexports)]

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use error::ErrorCode;
pub use instructions::*;
pub use state::*;

pub const COMP_DEF_OFFSET_INIT_MARKET_STATE: u32 = comp_def_offset("init_market_state");
pub const COMP_DEF_OFFSET_INIT_VOTE_TOKEN_ACCOUNT: u32 = comp_def_offset("init_vote_token_account");
pub const COMP_DEF_OFFSET_CALCULATE_VOTE_TOKEN_BALANCE: u32 = comp_def_offset("calculate_vote_token_balance");

declare_id!("HFd2ZC5pGNY8RrUFXxbreawK5UCa617qaJEfo1aUhdU7");

#[arcium_program]
pub mod sealed_bid_auction {
    use super::*;

    pub fn init_market_state_comp_def(ctx: Context<InitMarketStateCompDef>) -> Result<()> {
        instructions::init_market_state_comp_def(ctx)
    }

    pub fn init_vote_token_account_comp_def(ctx: Context<InitVoteTokenAccountCompDef>) -> Result<()> {
        instructions::init_vote_token_account_comp_def(ctx)
    }

    pub fn calculate_vote_token_balance_comp_def(ctx: Context<CalculateVoteTokenBalanceCompDef>) -> Result<()> {
        instructions::calculate_vote_token_balance_comp_def(ctx)
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_index: u64,
        reward_token_amount: u64,
    ) -> Result<()> {
        instructions::create_market(ctx, market_index, reward_token_amount)
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
}
