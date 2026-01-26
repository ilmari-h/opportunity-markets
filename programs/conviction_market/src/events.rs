use anchor_lang::prelude::*;

#[event]
pub struct MarketCreatedEvent {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub max_shares: u64,
    pub index: u64,
}

#[event]
pub struct VoteTokenPurchasedEvent {
    pub vote_token: Pubkey,
    pub buyer: Pubkey,
    pub lamports_spent: u64,
}

#[event]
pub struct SharesPurchasedEvent {
    pub buyer: Pubkey,
    pub encrypted_disclosed_amount: [u8; 32],
    pub nonce: u128,
}

#[event]
pub struct SharesRevealedEvent {
    pub buyer: Pubkey,
    pub shares_amount: u64,
    pub selected_option: u16,
}