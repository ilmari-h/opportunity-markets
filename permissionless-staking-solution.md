# Permissionless Staking: Solution Design

## Goal

Allow a 3rd party to create stake accounts and stake on behalf of a user (with the user's consent), without requiring durable nonces or the user to be the transaction signer.

## Approach

Use [brine-ed25519](https://github.com/zfedoran/brine-ed25519) for on-chain Ed25519 signature verification (~30k CU, no extra lamports, no instruction sysvar). The user signs an off-chain message authorizing the specific stake action. The 3rd party submitter includes that signature in the instruction data.

## Owner == Payer Bypass

If the `owner` is the transaction signer (i.e. they are paying for and submitting the transaction themselves), skip the ed25519 signature check entirely. They have already proven identity by signing the Solana transaction. The ed25519 consent signature is only required when `owner != signer`.

## Message Format

The user signs a deterministic byte message that commits to all parameters they are consenting to. The message should be domain-separated per instruction to prevent cross-instruction replay.

### `init_stake_account`

```
"init_stake_account|<market_pubkey>|<owner_pubkey>|<stake_account_id>|<state_nonce>|<expiry_slot>"
```

### `stake`

```
"stake|<market_pubkey>|<owner_pubkey>|<stake_account_id>|<amount>|<selected_option_ciphertext>|<expiry_slot>"
```

The `expiry_slot` gives the 3rd party a submission window (e.g. a few hundred slots / ~2-3 minutes), after which the signature is invalid. This replaces durable nonces.

## On-Chain Verification

```rust
// Additional instruction args when owner != signer
user_signature: [u8; 64],   // ed25519 sig from the owner
expiry_slot: u64,

// In the handler:
if owner.key() != signer.key() {
    let clock = Clock::get()?;
    require!(clock.slot <= expiry_slot, ErrorCode::SignatureExpired);

    let message = [
        b"stake|",
        market.key().as_ref(),
        owner.key().as_ref(),
        &stake_account_id.to_le_bytes(),
        &amount.to_le_bytes(),
        &selected_option_ciphertext,
        &expiry_slot.to_le_bytes(),
    ].concat();

    brine_ed25519::sig_verify(
        owner.key().as_ref(),
        &user_signature,
        &message,
    )?;
}
```

## Account Changes

### `init_stake_account`

- `owner` becomes an `UncheckedAccount` (not a `Signer`)
- `signer` remains as `Signer` and `payer`
- PDA seed stays `[STAKE_ACCOUNT_SEED, owner, market, stake_account_id]`
- Add `user_signature: [u8; 64]` and `expiry_slot: u64` to instruction args
- If `owner == signer`, skip sig check

### `stake`

- `signer` becomes the 3rd party payer
- Add `owner` as `UncheckedAccount`
- PDA seed uses `owner.key()` (not `signer.key()`)
- Token transfer comes from `signer_token_account` (payer funds the stake)
- Add `user_signature: [u8; 64]` and `expiry_slot: u64` to instruction args
- If `owner == signer`, skip sig check

## Replay Protection

No separate nonce store is needed. The PDA constraints already prevent replay:
- `init_stake_account`: can't init the same `stake_account_id` twice (PDA already exists)
- `stake`: constraint `stake_account.staked_at_timestamp.is_none()` prevents double-staking

## Threat Mitigation

See `permissionless-staking-problem.md` for the full threat model. This approach mitigates all identified threats:

| Threat | Mitigated | How |
|---|---|---|
| Signal manipulation / Sybil | Yes | Can't forge ed25519 sigs for other wallets |
| PDA namespace squatting | Yes | Can't init accounts without owner's signature |
| Forged participation | Yes | Option choice is committed in the signed message |
| Attacker controls MPC inputs | Yes | Ciphertext and nonces are in the signed message |

## Tradeoffs

- **~30k CU overhead** per sig verification (only when `owner != signer`). The `stake` instruction already uses significant CU for Arcium's `queue_computation` — verify total stays within limits.
- **Expiry window tuning** — too short and the 3rd party can't submit in time; too long and it's effectively a standing authorization. A few hundred slots (~2-3 minutes) is a reasonable default.
- **Off-chain coordination** — requires the user to sign the message and transmit it to the 3rd party before the expiry window closes. The JS SDK will need helpers for message construction and signing.

## Dependencies

Add to `programs/opportunity_market/Cargo.toml`:

```toml
brine-ed25519 = { git = "https://github.com/zfedoran/brine-ed25519" }
```
