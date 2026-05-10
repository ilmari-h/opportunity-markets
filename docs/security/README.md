# Security Statement

### What is at stake?

Our contract is meant to secure a large amount of user capital in the form of staked SPL tokens.
Users can deposit any amount of tokens in the program and should always be able to withdraw their stake later.
Users should never face the risk of loss-of-funds.
Users should only ever get their initial stake deposit back OR additionally be rewarded fairly according to the rules of the protocol.

Market sponsors should be able to deposit a market reward, optionally locked in or withdrawable by default, and trust that after the market is resolved, the reward is split according to the rules of the protocol and cannot be stolen by exploit.

We are looking to go live on Solana mainnet as soon as possible, so a security audit is critical to ensure the safety of our users' funds.

### What we have done

Our protocol is build with the Anchor framework and follows best security practices against most common threats.
For example, use of built-in account constraints to restrict access, use of PDA seeds for the same purpose.
We have considered common threats like re-initialization attacks.
Change of authority accounts is time-gated and cancellable.
We have comprehensive test coverage of our protocol including number of unhappy paths and edge-cases.

### Specific Areas of Concern

We use Arcium for shared encrypted on-chain state.
Arcium uses a transaction callback pattern, meaning that some operations that would be atomic within a single transaction, now take one transaction to begin and another transaction to finalize. This leaves an in-between state of waiting for the callback to come, leading to a number of edge-cases.

We operate under the assumption that Arciumn callback transactions can fail to run after initial invocation.
Therefore, if the operation is never finalized, there must be an escape hatch from this in-between state.
We assume that the callback will not continue to fail forever after some number of retries.

Example of this escape-hatch implementation is the `close_stuck_stake_account` instruction for the case that the callback of the `stake` instruction fails to run.

There is no separate escape-hatch instruction for the `reveal_stake` instruction, but instead this instruction can be invoked again to retry the callback as many times as needed.
