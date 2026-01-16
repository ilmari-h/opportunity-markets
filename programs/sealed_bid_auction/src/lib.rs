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

pub const COMP_DEF_OFFSET_INIT_AUCTION_STATE: u32 = comp_def_offset("init_auction_state");
pub const COMP_DEF_OFFSET_PLACE_BID: u32 = comp_def_offset("place_bid");
pub const COMP_DEF_OFFSET_DETERMINE_WINNER_FIRST_PRICE: u32 =
    comp_def_offset("determine_winner_first_price");
pub const COMP_DEF_OFFSET_DETERMINE_WINNER_VICKREY: u32 = comp_def_offset("determine_winner_vickrey");

declare_id!("D1Zf4HpT6LpLZhGbUD4QXqAHjseNq2Ni8C4aVE2urtuw");

#[arcium_program]
pub mod sealed_bid_auction {
    use super::*;

    pub fn init_auction_state_comp_def(ctx: Context<InitAuctionStateCompDef>) -> Result<()> {
        instructions::init_auction_state_comp_def(ctx)
    }

    pub fn init_place_bid_comp_def(ctx: Context<InitPlaceBidCompDef>) -> Result<()> {
        instructions::init_place_bid_comp_def(ctx)
    }

    pub fn init_determine_winner_first_price_comp_def(
        ctx: Context<InitDetermineWinnerFirstPriceCompDef>,
    ) -> Result<()> {
        instructions::init_determine_winner_first_price_comp_def(ctx)
    }

    pub fn init_determine_winner_vickrey_comp_def(
        ctx: Context<InitDetermineWinnerVickreyCompDef>,
    ) -> Result<()> {
        instructions::init_determine_winner_vickrey_comp_def(ctx)
    }

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        computation_offset: u64,
        auction_type: AuctionType,
        min_bid: u64,
        end_time: i64,
        nonce: u128,
    ) -> Result<()> {
        instructions::create_auction(ctx, computation_offset, auction_type, min_bid, end_time, nonce)
    }

    #[arcium_callback(encrypted_ix = "init_auction_state")]
    pub fn init_auction_state_callback(
        ctx: Context<InitAuctionStateCallback>,
        output: SignedComputationOutputs<InitAuctionStateOutput>,
    ) -> Result<()> {
        instructions::init_auction_state_callback(ctx, output)
    }

    pub fn place_bid(
        ctx: Context<PlaceBid>,
        computation_offset: u64,
        encrypted_bidder_lo: [u8; 32],
        encrypted_bidder_hi: [u8; 32],
        encrypted_amount: [u8; 32],
        bidder_pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        instructions::place_bid(
            ctx,
            computation_offset,
            encrypted_bidder_lo,
            encrypted_bidder_hi,
            encrypted_amount,
            bidder_pubkey,
            nonce,
        )
    }

    #[arcium_callback(encrypted_ix = "place_bid")]
    pub fn place_bid_callback(
        ctx: Context<PlaceBidCallback>,
        output: SignedComputationOutputs<PlaceBidOutput>,
    ) -> Result<()> {
        instructions::place_bid_callback(ctx, output)
    }

    pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
        instructions::close_auction(ctx)
    }

    pub fn determine_winner_first_price(
        ctx: Context<DetermineWinnerFirstPrice>,
        computation_offset: u64,
    ) -> Result<()> {
        instructions::determine_winner_first_price(ctx, computation_offset)
    }

    #[arcium_callback(encrypted_ix = "determine_winner_first_price")]
    pub fn determine_winner_first_price_callback(
        ctx: Context<DetermineWinnerFirstPriceCallback>,
        output: SignedComputationOutputs<DetermineWinnerFirstPriceOutput>,
    ) -> Result<()> {
        instructions::determine_winner_first_price_callback(ctx, output)
    }

    pub fn determine_winner_vickrey(
        ctx: Context<DetermineWinnerVickrey>,
        computation_offset: u64,
    ) -> Result<()> {
        instructions::determine_winner_vickrey(ctx, computation_offset)
    }

    #[arcium_callback(encrypted_ix = "determine_winner_vickrey")]
    pub fn determine_winner_vickrey_callback(
        ctx: Context<DetermineWinnerVickreyCallback>,
        output: SignedComputationOutputs<DetermineWinnerVickreyOutput>,
    ) -> Result<()> {
        instructions::determine_winner_vickrey_callback(ctx, output)
    }
}
