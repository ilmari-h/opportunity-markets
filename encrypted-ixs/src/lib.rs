use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // Conviction market state - tracks vote counts for all options
    pub struct MarketState {
        pub votes: [u64; 7],
    }

    #[instruction]
    pub fn init_market_state(mxe: Mxe) -> Enc<Mxe, MarketState> {
        let initial_state = MarketState {
            votes: [0, 0, 0, 0, 0, 0, 0],
        };
        mxe.from_arcis(initial_state)
    }

    // Vote token state - tracks encrypted token amount for a user
    pub struct UserVoteTokenBalance {
        pub amount: u64,
    }

    // User's share position in a conviction market
    pub struct UserMarketSharePosition {
        pub share_amount: u64,
        pub selected_option: u16,
    }

    // User input for buying market shares (encrypted)
    pub struct BuySharesInput {
        pub amount: u64,
        pub selected_option: u16,
    }

    // Initialize empty vote token balance for user
    #[instruction]
    pub fn init_vote_token_account(
        mxe: Mxe
    ) -> Enc<Mxe, UserVoteTokenBalance> {
        let state = UserVoteTokenBalance { amount: 0 };
        mxe.from_arcis(state)
    }

    // Calculate vote token balance for buy/sell operations
    // Returns (error, new_balance) where error=true means insufficient balance for sell
    #[instruction]
    pub fn calculate_vote_token_balance(
        balance_ctx: Enc<Mxe, UserVoteTokenBalance>,
        amount: u64,
        sell: bool
    ) -> (bool, u64, Enc<Mxe, UserVoteTokenBalance>) {
        let mut balance = balance_ctx.to_arcis();
        let sold: u64 = if sell { amount } else {0};

        // Check for insufficient balance when selling
        let insufficient_balance = sell && (amount > balance.amount);

        // Calculate new balance based on operation type and validity
        let new_amount = if sell {
            if insufficient_balance {
                balance.amount  // Keep unchanged on error
            } else {
                balance.amount - amount
            }
        } else {
            balance.amount + amount
        };

        balance.amount = new_amount;

        // Return error flag (true = error) and updated balance
        (insufficient_balance.reveal(), sold, balance_ctx.owner.from_arcis(balance))
    }

    // Buy conviction market shares - transfer vote tokens from user to market
    // and update user's share position
    // Returns (error, user_vta, market_vta, user_share) where error combines insufficient balance and invalid option
    #[instruction]
    pub fn buy_conviction_market_shares(
        input_ctx: Enc<Shared, BuySharesInput>,
        user_vta_ctx: Enc<Mxe, UserVoteTokenBalance>,
        market_vta_ctx: Enc<Mxe, UserVoteTokenBalance>,
        user_share_ctx: Enc<Mxe, UserMarketSharePosition>,
        total_options: u16,
    ) -> (
        bool,
        Enc<Mxe, UserVoteTokenBalance>,
        Enc<Mxe, UserVoteTokenBalance>,
        Enc<Mxe, UserMarketSharePosition>,
    ) {
        let input = input_ctx.to_arcis();
        let mut user_balance = user_vta_ctx.to_arcis();
        let mut market_balance = market_vta_ctx.to_arcis();
        let mut user_share = user_share_ctx.to_arcis();

        let amount = input.amount;
        let selected_option = input.selected_option;

        // Check if selected option is within bounds
        let invalid_option = selected_option >= total_options;

        // Check if user has sufficient balance
        let insufficient_balance = amount > user_balance.amount;

        // Any error prevents the operation (combined for anonymity)
        let has_error = invalid_option || insufficient_balance;

        // Update balances only if no errors
        let new_user_amount = if has_error {
            user_balance.amount
        } else {
            user_balance.amount - amount
        };

        let new_market_amount = if has_error {
            market_balance.amount
        } else {
            market_balance.amount + amount
        };

        let new_share_amount = if has_error {
            user_share.share_amount
        } else {
            user_share.share_amount + amount
        };

        let new_selected_option = if has_error {
            user_share.selected_option
        } else {
            selected_option
        };

        user_balance.amount = new_user_amount;
        market_balance.amount = new_market_amount;
        user_share.share_amount = new_share_amount;
        user_share.selected_option = new_selected_option;

        (
            has_error.reveal(),
            user_vta_ctx.owner.from_arcis(user_balance),
            market_vta_ctx.owner.from_arcis(market_balance),
            user_share_ctx.owner.from_arcis(user_share),
        )
    }
}
