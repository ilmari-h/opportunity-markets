# Conviction Markets

Conviction Markets allow users to influence decision making by staking. Decision makers benefit from conviction markets by getting access to high-quality signals, helping them make the best choice.

**How it works:**

1. A decision maker creates a market and deposits a reward
2. Participants propose options to vote on
3. The decision maker opens voting
4. Participants stake on their preferred option
5. The decision maker selects a winning option and closes the market
6. All participants withdraw their stake; those who backed the winner split the reward

**Privacy:** While voting is open, individual votes and stake amounts are hidden from everyone except the decision maker. This prevents herd behavior—participants vote based on their own judgment rather than following the crowd.

Devnet address: `berV8jT2dwpZe4HP4PKej7z8kTXo4ziU3rt6zKSvJ8z`

## Build & Test

Arcium v0.6.3 required.

Before testing, make sure you build without the feature `hosted-compdefs`.
In `programs/conviction_market/Cargo.toml` make sure it's not in the defaults array.


```bash
yarn install
arcium build
arcium test
```

## Deployment

1. Enable the `hosted-compdefs` feature by adding to the  defaults in `programs/conviction_market/Cargo.toml`
2. Update the program `declare_id!` macro to use your program keypair's pubkey
3. Run `arcium build with --skip-keys-sync` (last argument ensures step 2. isn't overwritten)
4. Make sure in your Anchor.toml file, the `conviction_market` address matches address of step 2 (in the `[programs.localnet]` section if you have no devnet config there!)

Run `arcium deploy` with the correct parameters.

```bash
arcium deploy --cluster-offset 456 \
  --recovery-set-size 4 \
  --keypair-path <PAYER KEYPAIR> \
  --rpc-url <YOUR RPC URL> \
  --program-keypair  <PROGRAM KEYPAIR > \
  --program-name "conviction_market"
```

Run the compute defs script to initialize compute definitions.

```bash
PROGRAM_ID=<YOUR PROGRAM ID> \
ARCIUM_CLUSTER_OFFSET=456 \
KEYPAIR_PATH=<PAYER KEYPAIR> \
RPC_URL=<YOUR RPC URL> \
npx ts-node scripts/compute-defs.ts
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
