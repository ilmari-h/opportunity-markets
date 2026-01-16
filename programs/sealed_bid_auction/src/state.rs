use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionType {
    FirstPrice,
    Vickrey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionStatus {
    Open,
    Closed,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub bump: u8,
    pub authority: Pubkey,
    pub auction_type: AuctionType,
    pub status: AuctionStatus,
    pub min_bid: u64,
    pub end_time: i64,
    pub bid_count: u8,
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 5],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Closed,
    Resolved,
}


#[account]
#[derive(InitSpace)]
pub struct ConvictionMarket {
    pub bump: u8,
    pub creator: Pubkey,
    pub index: u64,

    pub reward_token_mint: Pubkey,
    pub current_options: u16,
    pub max_options: u16
}