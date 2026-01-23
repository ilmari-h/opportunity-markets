use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ConvictionMarket {
    pub encrypted_available_shares: [[u8; 32]; 1],
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

    pub state_nonce: u128,

    pub total_shares: u64,

    // Optional authority that can select the winning option (same rights as creator)
    pub select_authority: Option<Pubkey>,
}

#[account]
#[derive(InitSpace)]
pub struct VoteTokenAccount {
    pub encrypted_state: [[u8; 32]; 1],  // encrypted token amount
    pub bump: u8,
    pub owner: Pubkey,
    pub state_nonce: u128,
}

#[account]
#[derive(InitSpace)]
pub struct ShareAccount {
    pub encrypted_state: [[u8; 32]; 2],  // share amount and option
    pub state_nonce: u128,
    pub bump: u8,
    pub owner: Pubkey,
    pub market: Pubkey,

    pub encrypted_state_disclosure: [[u8; 32];2],
    pub state_nonce_disclosure: u128,

    pub revealed_in_time: bool,
    pub revealed_amount: Option<u64>,
    pub revealed_option: Option<u16>,
    pub total_incremented: bool
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

#[account]
#[derive(InitSpace)]
pub struct OptionTally {
    pub bump: u8,
    pub total_shares_bought: u64,
}
