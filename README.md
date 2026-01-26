# Conviction Markets

Conviction Markets allow users to influence decision making by staking their capital on a their preferred option.

Which option the user voted for and with how much stake is stored encrypted on chain and only revealed when the market creator has revealed their choice. Those who put their stake in the chosen option can claim yield. All participants can claim their initial stake back.

Devnet address: `bnchXx34qGANGyEL6MxTYdG8iXmUmSPyQFAGhxj1VKn`

## Build & Test

Arcium v0.6.3 required.

Before testing, make sure you build without the feature `hosted-compdefs`.
In *programs/conviction_market/Cargo.toml* set `default = []`.


```bash
yarn install
arcium build
arcium test
```

## Structure

- `programs/conviction_market/` - Anchor program
- `encrypted-ixs/` - MPC circuits (Arcis)
- `tests/` - Integration tests

## Accounts

| Account | Purpose |
|---------|---------|
| `ConvictionMarket` | Market config, encrypted available shares |
| `ConvictionMarketOption` | Named voting option |
| `VoteTokenAccount` | User's encrypted token balance |
| `ConvictionMarketShare` | User's encrypted position (shares + option) |

## Flow

1. Create market with max options, total shares, time windows
2. Add named options
3. Fund market with SOL, set open timestamp
4. Users mint vote tokens (SOL → encrypted balance)
5. Users buy shares with encrypted inputs (amount + selected option)

## MPC Circuits

- `init_vote_token_account` - Initialize user balance to 0 // TODO: probably can get rid of this circuit...
- `calculate_vote_token_balance` - Buy/sell vote tokens
- `init_market_shares` - Initialize market's available shares
- `buy_conviction_market_shares` - Purchase shares, deduct from user and market balances
