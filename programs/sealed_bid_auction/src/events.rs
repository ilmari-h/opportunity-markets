use anchor_lang::prelude::*;

use crate::state::AuctionType;

#[event]
pub struct AuctionCreatedEvent {
    pub auction: Pubkey,
    pub authority: Pubkey,
    pub auction_type: AuctionType,
    pub min_bid: u64,
    pub end_time: i64,
}

#[event]
pub struct BidPlacedEvent {
    pub auction: Pubkey,
    pub bid_count: u8,
}

#[event]
pub struct AuctionClosedEvent {
    pub auction: Pubkey,
    pub bid_count: u8,
}

#[event]
pub struct AuctionResolvedEvent {
    pub auction: Pubkey,
    pub winner: [u8; 32],
    pub payment_amount: u64,
    pub auction_type: AuctionType,
}
