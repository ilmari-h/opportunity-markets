use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;


    // Encrypted token state - tracks encrypted token amount
    #[derive(Clone,Copy)]
    pub struct EncryptedTokenBalance {
        pub amount: u64,
    }

    // Stake data: amount and selected option
    #[derive(Clone, Copy)]
    pub struct StakeData {
        pub amount: u64,
        pub selected_option: u16
    }

    // Wrap encrypted tokens: add to balance
    // If is_initialized is false (state_nonce == 0), creates fresh state instead of decrypting
    // Returns new_encrypted_balance
    #[instruction]
    pub fn wrap_encrypted_tokens(
        balance_ctx: Enc<Shared, EncryptedTokenBalance>,
        is_initialized: bool,
        amount: u64,
    ) -> Enc<Shared, EncryptedTokenBalance> {
        let mut balance = if is_initialized {
            balance_ctx.to_arcis()
        } else {
            EncryptedTokenBalance { amount: 0 }
        };
        balance.amount = balance.amount + amount;
        balance_ctx.owner.from_arcis(balance)
    }

    // Unwrap encrypted tokens (sell): subtract from balance
    // Returns (error, amount_sold, new_balance) where error=true means insufficient balance
    #[instruction]
    pub fn unwrap_encrypted_tokens(
        balance_ctx: Enc<Shared, EncryptedTokenBalance>,
        amount: u64,
    ) -> (bool, u64, Enc<Shared, EncryptedTokenBalance>) {
        let mut balance = balance_ctx.to_arcis();

        // Check for insufficient balance
        let insufficient_balance = amount > balance.amount;

        // Calculate new balance and amount sold
        let (new_amount, sold) = if insufficient_balance {
            (balance.amount, 0)  // Keep unchanged on error, sold = 0
        } else {
            (balance.amount - amount, amount)
        };

        balance.amount = new_amount;

        // Return error flag (true = error), amount sold (revealed), and updated balance
        (insufficient_balance.reveal(), sold.reveal(), balance_ctx.owner.from_arcis(balance))
    }

    // Input for add_option_stake circuit (encrypted amount)
    pub struct AddOptionStakeData {
        pub amount: u64,
    }

    // Add option + stake: deduct from user's ETA, create stake data
    // selected_option passed as plaintext u64 (no plaintext_u16 in ArgBuilder)
    #[instruction]
    pub fn add_option_stake(
        input_ctx: Enc<Shared, AddOptionStakeData>,
        stake_recipient_ctx: Shared,
        user_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        stake_account_ctx: Shared,
        min_deposit: u64,
        selected_option: u64,
    ) -> (
        bool,
        Enc<Shared, EncryptedTokenBalance>,
        Enc<Shared, StakeData>,
        Enc<Shared, StakeData>
    ) {
        let input = input_ctx.to_arcis();
        let mut user_balance = user_eta_ctx.to_arcis();

        let amount = input.amount;

        // Check minimum deposit
        let below_min = amount < min_deposit;

        // Check if user has sufficient encrypted token balance
        let insufficient_user_balance = amount > user_balance.amount;

        let error = below_min || insufficient_user_balance;

        let bought_amount = if error { 0 } else { amount };
        let stake_data = StakeData {
            amount: bought_amount,
            selected_option: selected_option as u16,
        };

        user_balance.amount = if error {
            user_balance.amount
        } else {
            user_balance.amount - amount
        };

        (
            error.reveal(),
            user_eta_ctx.owner.from_arcis(user_balance),
            stake_account_ctx.from_arcis(stake_data),
            stake_recipient_ctx.from_arcis(stake_data),
        )
    }

    // Stake: deduct from user's encrypted token balance
    // Returns: (error, new_user_balance, stake_data_mxe, stake_data_shared)
    #[instruction]
    pub fn stake(
        input_ctx: Enc<Shared, StakeData>,
        stake_recipient_ctx: Shared,
        user_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        stake_account_ctx: Shared,
    ) -> (
        bool,
        Enc<Shared, EncryptedTokenBalance>,
        Enc<Shared, StakeData>,
        Enc<Shared, StakeData>
    ) {
        let input = input_ctx.to_arcis();
        let mut user_balance = user_eta_ctx.to_arcis();

        let amount = input.amount;

        // Check if user has sufficient encrypted token balance
        let insufficient_user_balance = amount > user_balance.amount;

        let error = insufficient_user_balance;

        // Calculate stake amount (0 on error)
        let bought_amount = if error { 0 } else { amount };
        let stake_data = StakeData {
            amount: bought_amount,
            selected_option: input.selected_option
        };

        // Deduct from user balance (keep unchanged on error)
        user_balance.amount = if error {
            user_balance.amount
        } else {
            user_balance.amount - amount
        };

        (
            error.reveal(),
            user_eta_ctx.owner.from_arcis(user_balance),
            stake_account_ctx.from_arcis(stake_data),
            stake_recipient_ctx.from_arcis(stake_data)
        )
    }

    // Reveal stake: decrypt stake account and credit ETA
    // If is_eta_initialized is false (state_nonce == 0), treat existing balance as 0
    #[instruction]
    pub fn reveal_stake(
        stake_account_ctx: Enc<Shared, StakeData>,
        user_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        is_eta_initialized: bool,
    ) -> (
        u64,                               // revealed_amount
        u16,                               // revealed_option
        Enc<Shared, EncryptedTokenBalance>,     // updated ETA balance
    ) {
        let stake_data = stake_account_ctx.to_arcis();
        let mut user_balance = if is_eta_initialized {
            user_eta_ctx.to_arcis()
        } else {
            EncryptedTokenBalance { amount: 0 }
        };

        // Credit stake amount to ETA balance
        user_balance.amount = user_balance.amount + stake_data.amount;

        (
            stake_data.amount.reveal(),
            stake_data.selected_option.reveal(),
            user_eta_ctx.owner.from_arcis(user_balance),
        )
    }

    // Unstake early: refund ETA
    // If is_eta_initialized is false (state_nonce == 0), treat existing balance as 0
    #[instruction]
    pub fn unstake_early(
        stake_account_ctx: Enc<Shared, StakeData>,
        user_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        is_eta_initialized: bool,
    ) -> Enc<Shared, EncryptedTokenBalance> {
        let stake_data = stake_account_ctx.to_arcis();
        let mut user_balance = if is_eta_initialized {
            user_eta_ctx.to_arcis()
        } else {
            EncryptedTokenBalance { amount: 0 }
        };

        user_balance.amount = user_balance.amount + stake_data.amount;

        user_eta_ctx.owner.from_arcis(user_balance)
    }

    // Close ephemeral ETA: transfer balance to regular ETA
    // If is_regular_eta_initialized is false (state_nonce == 0), treat existing balance as 0
    // Returns new regular ETA balance
    #[instruction]
    pub fn close_ephemeral_encrypted_token_account(
        ephemeral_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        regular_eta_ctx: Enc<Shared, EncryptedTokenBalance>,
        is_regular_eta_initialized: bool,
    ) -> Enc<Shared, EncryptedTokenBalance> {
        let ephemeral_balance = ephemeral_eta_ctx.to_arcis();
        let mut regular_balance = if is_regular_eta_initialized {
            regular_eta_ctx.to_arcis()
        } else {
            EncryptedTokenBalance { amount: 0 }
        };

        // Transfer entire balance from ephemeral to regular
        regular_balance.amount = regular_balance.amount + ephemeral_balance.amount;

        regular_eta_ctx.owner.from_arcis(regular_balance)
    }
}
