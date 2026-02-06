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

    // User input for buying market shares (encrypted)
    pub struct BuySharesInput {
        pub amount: u64,
        pub selected_option: u16,
    }

    // Bought shares amount for ShareAccount
    #[derive(Clone, Copy)]
    pub struct SharePurchase {
        pub amount: u64,
        pub selected_option: u16
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
        mxe: Shared
    ) -> Enc<Shared, VoteTokenBalance> {
        let state = VoteTokenBalance { amount: 0 };
        mxe.from_arcis(state)
    }

    // Buy vote tokens: add to balance
    // Returns (amount_bought, new_encrypted_balance) where amount_bought is plaintext for token transfer
    #[instruction]
    pub fn buy_vote_tokens(
        balance_ctx: Enc<Shared, VoteTokenBalance>,
        amount: u64,
    ) -> (u64, Enc<Shared, VoteTokenBalance>) {
        let mut balance = balance_ctx.to_arcis();
        balance.amount = balance.amount + amount;
        (amount.reveal(), balance_ctx.owner.from_arcis(balance))
    }

    // Claim vote tokens (sell): subtract from balance
    // Returns (error, amount_sold, new_balance) where error=true means insufficient balance
    #[instruction]
    pub fn claim_vote_tokens(
        balance_ctx: Enc<Shared, VoteTokenBalance>,
        amount: u64,
    ) -> (bool, u64, Enc<Shared, VoteTokenBalance>) {
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

    // Buy shares: deduct from user's vote token balance and market's available shares
    // TODO: enforce that selected option > 0 <= max_options
    // Returns: (error, new_user_balance, new_market_shares, bought_shares_mxe, bought_shares_shared)
    #[instruction]
    pub fn buy_opportunity_market_shares(
        input_ctx: Enc<Shared, BuySharesInput>,
        shares_recipient_ctx: Shared,
        user_vta_ctx: Enc<Shared, VoteTokenBalance>,
        market_shares_ctx: Enc<Mxe, MarketShareState>,
        share_account_ctx: Shared,
    ) -> (
        bool,
        Enc<Shared, VoteTokenBalance>,
        Enc<Mxe, MarketShareState>,
        Enc<Shared, SharePurchase>,
        Enc<Shared, SharePurchase>
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

        // Calculate bought shares (0 on error)
        let bought_amount = if error { 0 } else { amount };
        let bought_shares = SharePurchase {
            amount: bought_amount,
            selected_option: input.selected_option
        };

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

        (
            error.reveal(),
            user_vta_ctx.owner.from_arcis(user_balance),
            market_shares_ctx.owner.from_arcis(market_shares),
            share_account_ctx.from_arcis(bought_shares),
            shares_recipient_ctx.from_arcis(bought_shares)
        )
    }

    // Reveal shares: decrypt share account
    #[instruction]
    pub fn reveal_shares(
        share_account_ctx: Enc<Shared, SharePurchase>,
        user_vta_ctx: Enc<Shared, VoteTokenBalance>,
    ) -> (
        u64,                               // revealed_amount
        u16,                               // revealed_option
        Enc<Shared, VoteTokenBalance>,     // updated VTA balance
    ) {
        let share_data = share_account_ctx.to_arcis();
        let mut user_balance = user_vta_ctx.to_arcis();


        // Only credit balance if option matches
        user_balance.amount = user_balance.amount + share_data.amount;

        (
            share_data.amount.reveal(),
            share_data.selected_option.reveal(),
            user_vta_ctx.owner.from_arcis(user_balance),
        )
    }
}
