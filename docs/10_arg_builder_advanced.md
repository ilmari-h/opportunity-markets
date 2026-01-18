# Advanced ArgBuilder: Account Passing Deep Dive

This document provides detailed guidance on using `ArgBuilder` to pass encrypted data stored in Solana accounts to Arcium encrypted instructions. Understanding account passing is critical for building stateful encrypted applications.

---

## Overview: Why Pass Accounts?

When encrypted data is too large to fit in a single transaction, or when you want to avoid repeated storage costs, you can store ciphertexts in Solana accounts and pass them **by reference** to encrypted instructions. The MPC nodes will fetch the data directly from the account during computation.

**Two ways to pass encrypted data:**

| Method | Syntax | Use Case |
|--------|--------|----------|
| By Value | `.encrypted_u64(ciphertext)` | Small data, fits in transaction |
| By Reference | `.account(pubkey, offset, size)` | Large data stored in accounts |

---

## The `.account()` Method Explained

```rust
.account(account_pubkey, byte_offset, byte_size)
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `account_pubkey` | `Pubkey` | The Solana account containing the encrypted data |
| `byte_offset` | `usize` | Where to start reading in the account (in bytes) |
| `byte_size` | `usize` | How many bytes to read from that offset |

### What Happens at Runtime

1. Your program calls `queue_computation()` with ArgBuilder args
2. The computation is queued on-chain
3. MPC nodes pick up the computation
4. **MPC nodes fetch account data from Solana at the specified offset/size**
5. Nodes decrypt and compute on the data
6. Results are returned via callback

---

## Account Layout Fundamentals

### Anchor Account Structure

Every Anchor account has this layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Bytes 0-7: Discriminator (8 bytes) - Anchor's type identifier│
├──────────────────────────────────────────────────────────────┤
│ Bytes 8+:  Your struct fields in declaration order           │
└──────────────────────────────────────────────────────────────┘
```

### Field Size Reference

| Rust Type | Size (bytes) | Notes |
|-----------|--------------|-------|
| `u8`, `bool` | 1 | |
| `u16` | 2 | |
| `u32` | 4 | |
| `u64` | 8 | |
| `u128` | 16 | Common for nonces |
| `Pubkey` | 32 | |
| `[u8; 32]` | 32 | Single ciphertext |
| `[[u8; 32]; N]` | 32 × N | Array of ciphertexts |

---

## Real Example: Blackjack Game

Let's study the blackjack example to understand account passing in practice.

### The Account Structure

```rust
#[account]
#[derive(InitSpace)]
pub struct BlackjackGame {
    // Encrypted deck: 3 chunks of 32 bytes each (52 cards packed into 3 u128s)
    pub deck: [[u8; 32]; 3],        // Offset: 8,   Size: 96  (3 × 32)
    // Player's encrypted hand
    pub player_hand: [u8; 32],       // Offset: 104, Size: 32
    // Dealer's encrypted hand
    pub dealer_hand: [u8; 32],       // Offset: 136, Size: 32
    // Nonces for each encrypted field
    pub deck_nonce: u128,            // Offset: 168, Size: 16
    pub client_nonce: u128,          // Offset: 184, Size: 16
    pub dealer_nonce: u128,          // Offset: 200, Size: 16
    // Other fields...
    pub game_id: u64,                // Offset: 216, Size: 8
    pub player_pubkey: Pubkey,       // Offset: 224, Size: 32
    pub player_enc_pubkey: [u8; 32], // Offset: 256, Size: 32
    pub bump: u8,                    // Offset: 288, Size: 1
    // ...
}
```

### Offset Calculation Table

| Field | Calculation | Offset | Size |
|-------|-------------|--------|------|
| `deck` | 8 (discriminator) | **8** | 96 |
| `player_hand` | 8 + 96 | **104** | 32 |
| `dealer_hand` | 8 + 96 + 32 | **136** | 32 |
| `deck_nonce` | 8 + 96 + 32 + 32 | **168** | 16 |
| `client_nonce` | 8 + 96 + 32 + 32 + 16 | **184** | 16 |
| `dealer_nonce` | 8 + 96 + 32 + 32 + 16 + 16 | **200** | 16 |

---

## Case Study: `player_hit` Function

### The Circuit Definition

```rust
// encrypted-ixs/src/lib.rs
#[instruction]
pub fn player_hit(
    deck_ctxt: Enc<Mxe, Deck>,           // MXE-encrypted deck (by reference)
    player_hand_ctxt: Enc<Shared, Hand>, // Shared-encrypted hand (by reference)
    player_hand_size: u8,                // Plaintext
    dealer_hand_size: u8,                // Plaintext
) -> (Enc<Shared, Hand>, bool) {
    // ...
}
```

### The ArgBuilder Call

```rust
// programs/blackjack/src/lib.rs
pub fn player_hit(ctx: Context<PlayerHit>, computation_offset: u64, _game_id: u64) -> Result<()> {
    let args = ArgBuilder::new()
        // ═══════════════════════════════════════════════════════════════
        // PARAMETER 1: deck_ctxt: Enc<Mxe, Deck>
        // For Enc<Mxe, T>, we need: nonce + ciphertext data
        // ═══════════════════════════════════════════════════════════════
        .plaintext_u128(ctx.accounts.blackjack_game.deck_nonce)  // Nonce from account
        .account(
            ctx.accounts.blackjack_game.key(),  // Account pubkey
            8,                                   // Offset: skip discriminator
            32 * 3                               // Size: 3 ciphertexts × 32 bytes = 96
        )

        // ═══════════════════════════════════════════════════════════════
        // PARAMETER 2: player_hand_ctxt: Enc<Shared, Hand>
        // For Enc<Shared, T>, we need: pubkey + nonce + ciphertext data
        // ═══════════════════════════════════════════════════════════════
        .x25519_pubkey(ctx.accounts.blackjack_game.player_enc_pubkey)  // User's pubkey
        .plaintext_u128(ctx.accounts.blackjack_game.client_nonce)      // Nonce from account
        .account(
            ctx.accounts.blackjack_game.key(),  // Same account
            8 + 32 * 3,                          // Offset: discriminator + deck = 104
            32                                   // Size: 1 ciphertext × 32 bytes
        )

        // ═══════════════════════════════════════════════════════════════
        // PARAMETER 3: player_hand_size: u8 (plaintext)
        // ═══════════════════════════════════════════════════════════════
        .plaintext_u8(ctx.accounts.blackjack_game.player_hand_size)

        // ═══════════════════════════════════════════════════════════════
        // PARAMETER 4: dealer_hand_size: u8 (plaintext)
        // ═══════════════════════════════════════════════════════════════
        .plaintext_u8(ctx.accounts.blackjack_game.dealer_hand_size)

        .build();

    // ... queue_computation()
}
```

### Visual Breakdown

```
Circuit Parameter Order:          ArgBuilder Order (MUST MATCH):
─────────────────────────         ──────────────────────────────
1. deck_ctxt: Enc<Mxe, Deck>  →   .plaintext_u128(deck_nonce)
                                  .account(key, 8, 96)

2. player_hand: Enc<Shared, Hand> → .x25519_pubkey(pubkey)
                                    .plaintext_u128(client_nonce)
                                    .account(key, 104, 32)

3. player_hand_size: u8       →   .plaintext_u8(hand_size)

4. dealer_hand_size: u8       →   .plaintext_u8(dealer_size)
```

---

## Pattern: Reading Multiple Fields from Same Account

The blackjack example shows how to read different encrypted fields from the same account at different offsets.

### `dealer_play` Function

```rust
// Circuit
#[instruction]
pub fn dealer_play(
    deck_ctxt: Enc<Mxe, Deck>,
    dealer_hand_ctxt: Enc<Mxe, Hand>,
    client: Shared,
    player_hand_size: u8,
    dealer_hand_size: u8,
) -> (Enc<Mxe, Hand>, Enc<Shared, Hand>, u8) { ... }

// ArgBuilder
let args = ArgBuilder::new()
    // Deck at offset 8
    .plaintext_u128(ctx.accounts.blackjack_game.deck_nonce)
    .account(ctx.accounts.blackjack_game.key(), 8, 32 * 3)

    // Dealer hand at offset 8 + 96 + 32 = 136 (skip deck and player_hand)
    .plaintext_u128(ctx.accounts.blackjack_game.dealer_nonce)
    .account(ctx.accounts.blackjack_game.key(), 8 + 32 * 3 + 32, 32)

    // Client (Shared) owner - pubkey + nonce for output encryption
    .x25519_pubkey(ctx.accounts.blackjack_game.player_enc_pubkey)
    .plaintext_u128(nonce)

    // Plaintext sizes
    .plaintext_u8(ctx.accounts.blackjack_game.player_hand_size)
    .plaintext_u8(ctx.accounts.blackjack_game.dealer_hand_size)
    .build();
```

### `resolve_game` Function

```rust
// Circuit
#[instruction]
pub fn resolve_game(
    player_hand: Enc<Shared, Hand>,
    dealer_hand: Enc<Mxe, Hand>,
    player_hand_length: u8,
    dealer_hand_length: u8,
) -> u8 { ... }

// ArgBuilder
let args = ArgBuilder::new()
    // Player hand (Shared) at offset 104
    .x25519_pubkey(ctx.accounts.blackjack_game.player_enc_pubkey)
    .plaintext_u128(ctx.accounts.blackjack_game.client_nonce)
    .account(ctx.accounts.blackjack_game.key(), 8 + 32 * 3, 32)

    // Dealer hand (Mxe) at offset 136
    .plaintext_u128(ctx.accounts.blackjack_game.dealer_nonce)
    .account(ctx.accounts.blackjack_game.key(), 8 + 32 * 3 + 32, 32)

    // Plaintext sizes
    .plaintext_u8(ctx.accounts.blackjack_game.player_hand_size)
    .plaintext_u8(ctx.accounts.blackjack_game.dealer_hand_size)
    .build();
```

---

## Offset Calculation Formula

### General Formula

```
offset = 8 + sum(sizes of all preceding fields)
```

### Step-by-Step Process

1. **Start with 8** (Anchor discriminator)
2. **Add each field's size** in declaration order until you reach your target field
3. **Use that sum** as the offset parameter

### Example Calculation

Given this account:
```rust
#[account]
pub struct GameState {
    pub bump: u8,                    // +1
    pub scores: [[u8; 32]; 2],       // +64
    pub nonce: u128,                 // +16
    pub player_data: [u8; 32],       // +32  ← We want this
    pub authority: Pubkey,           // +32
}
```

To read `player_data`:
```
offset = 8 (discriminator) + 1 (bump) + 64 (scores) + 16 (nonce) = 89
size = 32
```

```rust
.account(game_state.key(), 89, 32)
```

---

## Pattern Reference: ArgBuilder for Different Types

### Enc<Mxe, T> by Reference

```rust
// Circuit: state_ctxt: Enc<Mxe, MyStruct>
// where MyStruct has 2 u64 fields = 2 ciphertexts

.plaintext_u128(account.nonce)        // Nonce for this encrypted data
.account(account.key(), OFFSET, 64)   // 2 ciphertexts × 32 bytes
```

### Enc<Shared, T> by Reference

```rust
// Circuit: input_ctxt: Enc<Shared, MyInput>
// where MyInput has 1 u32 field = 1 ciphertext

.x25519_pubkey(user_pubkey)           // User's X25519 public key
.plaintext_u128(input_nonce)          // Nonce for this encrypted data
.account(account.key(), OFFSET, 32)   // 1 ciphertext × 32 bytes
```

### Enc<Mxe, T> by Value (small data, passed in transaction)

```rust
// Circuit: value_ctxt: Enc<Mxe, u64>

.plaintext_u128(nonce)
.encrypted_u64(ciphertext)            // Single 32-byte ciphertext
```

### Enc<Shared, T> by Value

```rust
// Circuit: input_ctxt: Enc<Shared, bool>

.x25519_pubkey(user_pubkey)
.plaintext_u128(nonce)
.encrypted_bool(ciphertext)           // Single 32-byte ciphertext
```

### Plaintext Values

```rust
.plaintext_u8(value)
.plaintext_u16(value)
.plaintext_u32(value)
.plaintext_u64(value)
.plaintext_u128(value)
```

---

## Common Mistakes and How to Avoid Them

### Mistake 1: Forgetting the Discriminator

```rust
// WRONG: Starting at offset 0
.account(account.key(), 0, 32)

// CORRECT: Skip 8-byte discriminator
.account(account.key(), 8, 32)
```

**Rule:** Anchor accounts ALWAYS start with an 8-byte discriminator. Your data starts at offset 8.

### Mistake 2: Wrong Field Order in Offset Calculation

```rust
// Account struct:
pub struct MyAccount {
    pub field_a: [u8; 32],    // 32 bytes
    pub field_b: u128,        // 16 bytes
    pub field_c: [u8; 32],    // 32 bytes ← want this
}

// WRONG: Forgot to include field_b
.account(key, 8 + 32, 32)  // offset = 40 (WRONG!)

// CORRECT: Include all preceding fields
.account(key, 8 + 32 + 16, 32)  // offset = 56 (CORRECT)
```

**Rule:** Sum ALL fields before your target, not just the immediately preceding one.

### Mistake 3: Wrong Size Calculation

```rust
// Struct with 3 u64 fields = 3 ciphertexts
pub struct ThreeValues {
    pub a: u64,
    pub b: u64,
    pub c: u64,
}

// WRONG: Only reading 1 ciphertext
.account(key, 8, 32)

// CORRECT: Read all 3 ciphertexts
.account(key, 8, 32 * 3)  // 96 bytes
```

**Rule:** Size = (number of scalar values in struct) × 32 bytes

### Mistake 4: ArgBuilder Order Doesn't Match Circuit

```rust
// Circuit parameters:
fn my_circuit(
    first: Enc<Shared, u32>,
    second: Enc<Mxe, u64>,
)

// WRONG: Reversed order
let args = ArgBuilder::new()
    .plaintext_u128(second_nonce)    // second parameter first - WRONG!
    .encrypted_u64(second_ct)
    .x25519_pubkey(pubkey)
    .plaintext_u128(first_nonce)
    .encrypted_u32(first_ct)
    .build();

// CORRECT: Same order as circuit
let args = ArgBuilder::new()
    // First parameter: Enc<Shared, u32>
    .x25519_pubkey(pubkey)
    .plaintext_u128(first_nonce)
    .encrypted_u32(first_ct)
    // Second parameter: Enc<Mxe, u64>
    .plaintext_u128(second_nonce)
    .encrypted_u64(second_ct)
    .build();
```

**Rule:** ArgBuilder parameters MUST be in the exact same order as the circuit function signature.

### Mistake 5: Using Nonce from Wrong Source

```rust
// WRONG: Using a fresh nonce instead of stored nonce
let fresh_nonce = random_nonce();
.plaintext_u128(fresh_nonce)  // MPC can't decrypt with wrong nonce!

// CORRECT: Use the nonce that was used during encryption
.plaintext_u128(account.stored_nonce)
```

**Rule:** The nonce passed to ArgBuilder must match the nonce used when the data was encrypted.

### Mistake 6: Missing x25519_pubkey for Enc<Shared, T>

```rust
// Circuit: input: Enc<Shared, u32>

// WRONG: Missing pubkey
let args = ArgBuilder::new()
    .plaintext_u128(nonce)
    .encrypted_u32(ct)
    .build();

// CORRECT: Include pubkey before nonce
let args = ArgBuilder::new()
    .x25519_pubkey(user_pubkey)  // Required for Shared!
    .plaintext_u128(nonce)
    .encrypted_u32(ct)
    .build();
```

**Rule:** `Enc<Shared, T>` always requires `.x25519_pubkey()` before the nonce and ciphertext.

---

## Size Calculation for Complex Structs

### Counting Scalar Values

Each encrypted scalar becomes one 32-byte ciphertext:

```rust
pub struct PlayerState {
    pub health: u64,      // 1 scalar
    pub mana: u64,        // 1 scalar
    pub level: u8,        // 1 scalar
    pub alive: bool,      // 1 scalar
}
// Total: 4 scalars = 4 × 32 = 128 bytes
```

### Arrays

```rust
pub struct Inventory {
    pub items: [u32; 10],  // 10 scalars = 10 × 32 = 320 bytes
}
```

### Nested Structs

```rust
pub struct Position {
    pub x: u32,  // 1 scalar
    pub y: u32,  // 1 scalar
}

pub struct Entity {
    pub pos: Position,  // 2 scalars (from Position)
    pub id: u64,        // 1 scalar
}
// Total: 3 scalars = 3 × 32 = 96 bytes
```

---

## Account Design Best Practices

### 1. Group Encrypted Data Together

```rust
// GOOD: Encrypted fields grouped at start
#[account]
pub struct GameAccount {
    pub encrypted_state: [[u8; 32]; 4],  // Offset 8, easy to calculate
    pub state_nonce: u128,
    pub other_data: u64,
}

// HARDER: Encrypted fields scattered
#[account]
pub struct MessyAccount {
    pub some_flag: bool,
    pub encrypted_a: [u8; 32],       // Offset 9
    pub counter: u64,
    pub encrypted_b: [u8; 32],       // Offset 49 (9 + 32 + 8)
}
```

### 2. Keep Nonces Near Their Data

```rust
#[account]
pub struct WellOrganized {
    // Encrypted field followed by its nonce
    pub encrypted_balance: [u8; 32],
    pub balance_nonce: u128,

    pub encrypted_score: [u8; 32],
    pub score_nonce: u128,
}
```

### 3. Document Your Offsets

```rust
#[account]
pub struct DocumentedAccount {
    // Offset 8: Encrypted game state (2 u64 fields = 64 bytes)
    pub game_state: [[u8; 32]; 2],
    // Offset 72: Encrypted player data (1 u32 field = 32 bytes)
    pub player_data: [u8; 32],
    // Offset 104: Nonce for game_state
    pub state_nonce: u128,
    // Offset 120: Nonce for player_data
    pub player_nonce: u128,
}
```

---

## Quick Reference: Complete ArgBuilder Pattern

```rust
// For a circuit with this signature:
#[instruction]
pub fn my_circuit(
    mxe_data: Enc<Mxe, StateStruct>,      // 3 fields = 3 ciphertexts
    shared_input: Enc<Shared, InputStruct>, // 2 fields = 2 ciphertexts
    count: u32,                             // plaintext
) -> Enc<Shared, OutputStruct> { ... }

// ArgBuilder construction:
let args = ArgBuilder::new()
    // 1. mxe_data: Enc<Mxe, StateStruct>
    .plaintext_u128(state_nonce)              // Nonce from account
    .account(state_account.key(), 8, 32 * 3)  // 3 ciphertexts at offset 8

    // 2. shared_input: Enc<Shared, InputStruct>
    .x25519_pubkey(user_pubkey)               // User's public key
    .plaintext_u128(input_nonce)              // Input nonce
    .account(input_account.key(), 8, 32 * 2)  // 2 ciphertexts at offset 8

    // 3. count: u32
    .plaintext_u32(count_value)

    .build();
```

---

## Debugging Checklist

When account passing doesn't work, verify:

- [ ] Offset starts at 8 (not 0) to skip discriminator
- [ ] Offset includes sizes of ALL preceding fields
- [ ] Size = (number of scalar values) × 32
- [ ] ArgBuilder order matches circuit parameter order exactly
- [ ] `Enc<Shared, T>` has `.x25519_pubkey()` before nonce
- [ ] `Enc<Mxe, T>` has `.plaintext_u128(nonce)` before account/ciphertext
- [ ] Nonce values match what was used during encryption
- [ ] Account being read is the correct account (check pubkey)
- [ ] Account data has been initialized before reading
