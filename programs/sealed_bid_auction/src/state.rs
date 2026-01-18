use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ConvictionMarket {
    pub bump: u8,
    pub creator: Pubkey,      // part of PDA seed
    pub index: u64,           // part of PDA seed
    pub reward_token_mint: Pubkey,
    pub reward_token_amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct VoteToken {
    pub encrypted_state: [[u8; 32]; 1],  // encrypted token amount
    pub bump: u8,
    pub owner: Pubkey,
    pub state_nonce: u128,
}

#[account]
#[derive(InitSpace)]
pub struct VoteTokenVault {
    pub bump: u8,
    pub bought_lamports: u64,
}
