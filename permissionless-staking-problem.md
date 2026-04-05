# Permissionless Staking: Threat Analysis

## Proposal

Make creating stake accounts permissionless and remove the signer constraint from the `stake` instruction for the `owner`, allowing a 3rd party to stake to the benefit of anyone else.

## Threat Analysis

### 1. Griefing via Unwanted Stake Positions

An attacker could create stake accounts on behalf of a victim and stake tokens into them. The victim now "owns" positions they never asked for. This isn't a direct fund-theft risk (the attacker pays the tokens), but it creates a nuisance — the victim's pubkey is now associated with market activity they didn't consent to.

### 2. PDA Namespace Squatting / Denial of Service

The stake account PDA is seeded with `[STAKE_ACCOUNT_SEED, owner, market, stake_account_id]`. An attacker could pre-create stake accounts for a victim across all reasonable `stake_account_id` values for a given market. Since each ID can only be used once, this blocks the victim from creating their own stake accounts (or forces them to use high/unusual IDs). This is a real griefing vector.

### 3. Unstake-Early Cannot Be Called by Victim

`unstake_early` uses the signer's key in the PDA seed (`signer.key().as_ref()`). If the "owner" field on the account differs from whoever actually controls it, the real owner can call `unstake_early` (since the PDA seed still derives from them). This part is fine — **but** the attacker chose the `state_nonce` and the `encrypted_option_ciphertext`, which means:

### 4. Attacker Controls the Encrypted Option & MPC Inputs (Most Serious)

In `stake()`, the caller provides `selected_option_ciphertext`, `input_nonce`, `authorized_reader_nonce`, and `user_pubkey` — all fed into the Arcium MPC computation. If a 3rd party stakes on behalf of someone, the **attacker** chooses which option the victim is staked on and controls the encryption keys. The victim:

- Has no idea which option they're staked on
- Cannot decrypt their own stake data (attacker chose `user_pubkey`)
- Cannot meaningfully participate in reveal (wrong keys)

This means an attacker could stake worthless dust amounts on behalf of many users, associating them with specific options — effectively **forging participation signals** for the market creator to see.

### 5. Signal Pollution / Market Manipulation

The market creator relies on staking data as a high-quality signal. An attacker with tokens could:
- Create many small stake accounts attributed to different "owners" to make it look like broad support exists for a specific option
- Inflate apparent participation counts for an option
- The market creator sees what looks like organic interest from many wallets but it's all one actor

This is the core protocol-level harm: **it undermines the signal quality that the entire protocol is designed to provide**. The "skin in the game" guarantee weakens because the relationship between staker identity and stake intent is severed.

### 6. No Fund-Loss Risk for the Victim

Funds always flow back to the `owner`'s token account via `reclaim_stake`, `do_unstake_early`, and `close_stake_account`. So the victim doesn't lose money — but they also can't easily claim rewards from positions they don't control the encryption keys for.

## Summary

| Risk | Severity |
|---|---|
| Signal manipulation / Sybil staking | **High** — breaks core protocol invariant |
| PDA namespace squatting (DoS) | **Medium** — blocks legitimate users |
| Forged participation (reputation) | **Medium** — false attribution |
| Victim loses funds | **None** — tokens return to owner |
| Attacker loses funds | **Yes** — attacker pays the stake, but may accept that cost to manipulate outcomes |

The biggest concern is that it **breaks the implicit assumption that a stake represents the genuine intent of the owner**. The protocol's value proposition depends on stakes being authentic signals — permissionless staking-on-behalf-of decouples identity from intent, enabling cheap Sybil-like manipulation of the market creator's decision-making.
