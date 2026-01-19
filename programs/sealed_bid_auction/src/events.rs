use anchor_lang::prelude::*;

#[event]
pub struct MarketCreatedEvent {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub reward_amount: u64,
    pub index: u64,
}

#[event]
pub struct VoteTokenPurchasedEvent {
    pub vote_token: Pubkey,
    pub buyer: Pubkey,
    pub lamports_spent: u64,
}
