
# The Opportunity Markets protocol

## Summary of how the protocol works

An Opportunity Market goes through the following stages:

1. A decision maker creates an Opportunity Market and funds the reward pool (reward can also be deposited by a 3rd party)
    - For example, a VC firm can create an Opportunity Market titled *"Which companies should we invest in next quarter?"*
2. The market can have an arbitrary number of options to choose from
    - For example, *"Acme Inc"*
3. Participants stake on their preferred options
4. The decision maker selects the winning option(s)
5. All participants withdraw their stake; those who backed the winning options split the reward

While the market is open, the following information is kept confidential:

1. How much stake each option has
2. For which option(s) a given user staked and with how much capital

Keeping this information hidden from the public prevents herd behavior — participants vote based on their own judgment rather than following the crowd.
The decision maker **does** have access to this information the whole time and uses it to help their decision making.

Basically, you can think of the Opportunity Markets protocol as something similar to a voting protocol with a couple key distinctions:

1. **Opportunity Markets serve an advisory function in decision making**

The options with majority stake do not automatically win.
The market creator has the right to choose the winning options according to whichever they believe are the most valuable.
There can be multiple winning options, each assigned a differently sized slice of the total reward pool.

2. **Opportunity Markets provide the market creator with capital backed signals of new opportunities**

The market creator has exclusive access to these signals through selective disclosure of encrypted staking data.
Staking data is confidential while the market is open, allowing the creator to take advantage of opportunities before the public knows about them.

## Opportunity Market lifecycle in detail

Following describes the complete lifecycle of an Opportunity Market (later referred to as just "market") and what purpose different instructions serve at which points of the lifecycle.

#### Creating a market

A decision maker creates a market by calling the `create_market` instruction.
The creator can adjust some of the market's configuration with parameters passed into this instruction.
Some configuration is inherited from a `PlatformConfig` account.
Each opportunity market belongs to a *platform* which defines some rules for it like fee percentages for example.
The market is associated with one SPL token mint, which must be whitelisted by the platform update authority account.
This token mint dictates the token that is used for rewards and fees within the market.

#### Adding initial options

The market is not yet open to staking, but users can already start adding options to the market.
This is done with the `add_market_option` instruction (TODO: this is not yet permissionless but will be, anyone can add options).


> [!NOTE]  
> For keeping the user's option choice confidential, the user should not add an option using a wallet that can be linked to the wallet they stake with.
> Otherwise, it will be quite obvious that they probably staked on the option they themselves created earlier.

Options can also be added after the market is opened for staking, until the staking period closes.

#### Funding the market

The market has a reward pool that at the end is distributed to those that staked on the winning options.

A sponsor can choose to fund the market with the `add_reward` instruction during the staking period or before it.
They can lock the reward permanently or choose to add a withdrawable reward.
A withdrawable reward can be withdrawn during the staking period or before it.

In the case that the market creator fails to choose winning options for the market within the given time period, all rewards, including locked ones, can be withdrawn. More about this in the *Resolving the market* section.

#### Staking

The market creator can open the market to staking by calling `open_market`.

After the market is opened, users can stake in it. How long staking is possible is dictated by the market account field `time_to_stake`.

A user stakes in a market by calling the `stake` instruction. It accepts the following payload:

- `amount` - stake amount in base units of the market's token
- `selected_option_ciphertext` - encrypted ID of the option the user chose to stake for
- `input_nonce` - random nonce used in the encryption of `selected_option_ciphertext`
- `authorized_reader_nonce` - random nonce used by following encrypted circuit invocation for selective disclosure of the option choice
- `user_pubkey` - user's x25519 pubkey used by following encrypted circuit invocation
- `state_nonce` - random nonce used by following encrypted circuit invocation

The `stake` instruction triggers an Arcium encrypted computation.
This computation takes the user's encrypted option choice and re-encrypts it so that the owner of the market's `authorized_reader_pubkey` can also decrypt and view it. This gives the market creator real-time access to the stake data.

The stake is finalized when the callback instruction (invoked by the Arcium network) runs.
It is possible that the callback fails to run. In this case, the user can recover their stuck stake with the `close_stuck_stake_account`.

#### Staking fee structure

The `stake` instruction also collects fees, split into 3 configurable components:

1. Platform fee
    - Goes to the platform
2. Creator fee
    - Goes to the market creator
3. Reward pool fee
    - Goes to the reward pool

Creator fee and reward pool fee are refunded to the winners later together with their reward.
The reason being that, with a large amount of stake on the winning option, it is possible the reward would get dilluted to the point where a winning stake's reward no longer covers the fees, and a winning staker ends up with a net-loss.

The reward pool fee can be set to a very high value. For example following configuration is possible:

Platform fee = 1%, creator fee 1%, reward pool fee 98%

This setup effectively turns the opportunity market into a speculative market à la prediction markets, with significant downside for the losers and great upside for the winners. If this kind of setup were to be used, early unstaking should be disabled in the market as the user of course has nothing to unstake since their stake goes to the reward pool.

#### Closing the market