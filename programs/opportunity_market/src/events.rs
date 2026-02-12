use anchor_lang::prelude::*;

#[event]
pub struct MarketCreatedEvent {
    pub market: Pubkey,
    pub creator: Pubkey,
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

#[event]
pub struct SharesUnstakedEvent {
    pub buyer: Pubkey,
    pub market: Pubkey,
}

#[event]
pub struct SharesRevealedError {
    pub user: Pubkey,
}

#[event]
pub struct SharesPurchasedError {
    pub user: Pubkey,
}

#[event]
pub struct SharesUnstakedError {
    pub user: Pubkey,
}

#[event]
pub struct VoteTokensClaimedError {
    pub user: Pubkey,
}