use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;


    // Vote token state - tracks encrypted token amount
    #[derive(Clone,Copy)]
    pub struct VoteTokenBalance {
        pub amount: u64,
    }

    // Vote token state - tracks encrypted token amount
    pub struct MarketShareState {
        pub shares: u64,
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

    // Market available shares state
    pub struct MarketAvailableShares {
        pub available_shares: u64,
    }

    // Initialize market available shares with total_shares
    #[instruction]
    pub fn init_market_shares(
        mxe: Mxe,
        total_shares: u64,
    ) -> Enc<Mxe, MarketAvailableShares> {
        let state = MarketAvailableShares { available_shares: total_shares };
        mxe.from_arcis(state)
    }

    // Initialize empty vote token balance for user
    #[instruction]
    pub fn init_vote_token_account(
        mxe: Mxe
    ) -> Enc<Mxe, VoteTokenBalance> {
        let state = VoteTokenBalance { amount: 0 };
        mxe.from_arcis(state)
    }

    // Calculate vote token balance for buy/sell operations
    // Returns (error, new_balance) where error=true means insufficient balance for sell
    #[instruction]
    pub fn calculate_vote_token_balance(
        balance_ctx: Enc<Mxe, VoteTokenBalance>,
        amount: u64,
        sell: bool
    ) -> (bool, u64, Enc<Mxe, VoteTokenBalance>) {
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

    // Buy shares: deduct from user's vote token balance and market's available shares
    // Returns true if error (insufficient user balance or market shares), false if OK
    #[instruction]
    pub fn buy_conviction_market_shares(
        input_ctx: Enc<Shared, BuySharesInput>,
        authorized_reader_ctx: Shared,
        user_vta_ctx: Enc<Mxe, VoteTokenBalance>,
        market_shares_ctx: Enc<Mxe, MarketShareState>,
    ) -> (
        bool,
        Enc<Mxe, VoteTokenBalance>,
        Enc<Mxe, MarketShareState>,
        Enc<Shared, VoteTokenBalance>
    ) {
        let input = input_ctx.to_arcis();
        let mut user_balance = user_vta_ctx.to_arcis();
        let mut market_shares = market_shares_ctx.to_arcis();

        let amount = input.amount;

        // Check if user has sufficient vote token balance
        let insufficient_user_balance = amount > user_balance.amount;

        // Check if market has sufficient shares available
        let insufficient_market_shares = amount > market_shares.shares;

        // Error if either check fails
        let error = insufficient_user_balance || insufficient_market_shares;

        // Deduct from user balance (keep unchanged on error)
        user_balance.amount = if error {
            user_balance.amount
        } else {
            user_balance.amount - amount
        };

        // Deduct from market shares (keep unchanged on error)
        market_shares.shares = if error {
            market_shares.shares
        } else {
            market_shares.shares - amount
        };

        let shared: Enc<Shared, VoteTokenBalance> = authorized_reader_ctx.from_arcis(user_balance);
        (
            error.reveal(),
            user_vta_ctx.owner.from_arcis(user_balance),
            market_shares_ctx.owner.from_arcis(market_shares),
            shared
        )
    }
}
