use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ConvictionMarket {
    pub bump: u8,
    pub creator: Pubkey,      // part of PDA seed
    pub index: u64,           // part of PDA seed
    pub total_options: u16,
    pub max_options: u16,

    // If set, means market is funded and ready to be opened for staking.
    // What actions are possible depends on current timestamp in relation to
    // `open_timestamp`, `time_to_stake` and `time_to_reveal`
    pub open_timestamp: Option<u64>,
    
    // Seconds from open_timestamp
    pub time_to_stake: u64,

    // Seconds from open_timestamp + time_to_stake
    pub time_to_reveal: u64,

    pub selected_option: Option<u16>,

    pub reward_amount: u64,
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
pub struct ConvictionMarketOption {
    pub bump: u8,
    pub creator: Pubkey,

    /// Name of the option
    #[max_len(50)]
    pub name: String,

    pub total_shares: Option<u64>
}

#[account]
#[derive(InitSpace)]
pub struct ConvictionMarketShare {
    // [share_amount, selected_option]
    pub encrypted_state: [[u8; 32]; 2],
    pub bump: u8,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub state_nonce: u128,
}