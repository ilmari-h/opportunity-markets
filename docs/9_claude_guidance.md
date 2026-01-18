# Claude Code Generation Guide for Arcium

This document provides comprehensive guidance for generating correct Arcium code for on-chain encrypted data applications.

---

## Section 1: Quick Reference Card

### File Structure
```
my_project/
├── encrypted-ixs/src/lib.rs    # Circuits (encrypted instructions)
├── programs/my_project/src/lib.rs  # Solana program
└── tests/my_project.ts         # TypeScript tests
```

### Critical Imports by File Type

**encrypted-ixs/src/lib.rs:**
```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;
    // circuits here
}
```

**programs/*/src/lib.rs:**
```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
```

**tests/*.ts:**
```typescript
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
  buildFinalizeCompDefTx,
} from "@arcium-hq/client";
```

### SHARED vs MXE Decision Flowchart
```
Is this data...
├── User input that user needs to verify? → Enc<Shared, T>
├── User-visible output (decryptable by user)? → Enc<Shared, T>
├── Internal state between computations? → Enc<Mxe, T>
├── Protocol-level data users shouldn't access? → Enc<Mxe, T>
└── Cross-computation persistent data? → Enc<Mxe, T>
```

---

## Section 2: Core Concepts

### The `Enc<Owner, T>` Type System

`Enc<Owner, T>` wraps encrypted data where:
- `Owner` = `Shared` or `Mxe` (who can decrypt)
- `T` = the underlying Rust type being encrypted

### Key Operations

| Operation | Syntax | Description |
|-----------|--------|-------------|
| Decrypt | `ctxt.to_arcis()` | Convert encrypted input to secret shares for MPC computation |
| Encrypt | `owner.from_arcis(value)` | Encrypt output using the owner's key |
| Reveal | `value.reveal()` | Publicly reveal a value (returns plaintext) |

### Usage Pattern
```rust
#[instruction]
pub fn process(input_ctxt: Enc<Shared, MyData>) -> Enc<Shared, MyResult> {
    let data = input_ctxt.to_arcis();     // Decrypt to secret shares
    let result = compute(data);            // Perform computation
    input_ctxt.owner.from_arcis(result)   // Encrypt result to same owner
}
```

### Nonce Management Rules
1. Each `Enc<Shared, T>` input requires a unique nonce
2. After decryption, MXE increments nonce by 1 for output encryption
3. New interactions require new nonces
4. Store nonce in account state for stateful applications

---

## Section 3: Encrypted Instructions Template

### Complete `encrypted-ixs/src/lib.rs` Template

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // Define your data structures
    pub struct MyState {
        field1: u64,
        field2: bool,
    }

    pub struct UserInput {
        value: u32,
    }

    // Initialize MXE state (no user input needed)
    #[instruction]
    pub fn init_state(mxe: Mxe) -> Enc<Mxe, MyState> {
        let state = MyState {
            field1: 0,
            field2: false,
        };
        mxe.from_arcis(state)
    }

    // Process user input with existing state
    #[instruction]
    pub fn update_state(
        input_ctxt: Enc<Shared, UserInput>,
        state_ctxt: Enc<Mxe, MyState>,
    ) -> Enc<Mxe, MyState> {
        let input = input_ctxt.to_arcis();
        let mut state = state_ctxt.to_arcis();

        // Update state based on input
        state.field1 += input.value as u64;

        state_ctxt.owner.from_arcis(state)
    }

    // Reveal final result publicly
    #[instruction]
    pub fn reveal_result(state_ctxt: Enc<Mxe, MyState>) -> bool {
        let state = state_ctxt.to_arcis();
        (state.field1 > 100).reveal()
    }
}
```

### Data-Independent Execution Constraints

**NEVER do:**
```rust
// NO: Vec or dynamic types
let items: Vec<u64> = vec![];  // WRONG

// NO: Early returns based on secret data
if secret_value > 10 {
    return early_result;  // WRONG
}

// NO: Missing else branch
if condition {
    x = 1;
}  // WRONG - needs else branch
```

**ALWAYS do:**
```rust
// YES: Fixed-size arrays
let items: [u64; 10] = [0; 10];  // CORRECT

// YES: Both branches, assign to same variable
let result = if condition {
    compute_a()
} else {
    compute_b()
};  // CORRECT

// YES: Use conditional assignment pattern
let mut found = false;
for i in 0..MAX_SIZE {
    let should_update = !found && items[i] == target;
    if should_update {
        items[i] = new_value;
    } else {
        // Keep existing value (both branches execute)
    }
    found = found || should_update;
}
```

---

## Section 4: Ownership Decision Matrix

| Use Case | Ownership | Example Code |
|----------|-----------|--------------|
| User vote/input | `Enc<Shared, T>` | `vote_ctxt: Enc<Shared, UserVote>` |
| User-visible result | `Enc<Shared, T>` | `-> Enc<Shared, GameResult>` |
| Game result to user | `Enc<Shared, T>` | `player_hand: Enc<Shared, Cards>` |
| Internal tallies | `Enc<Mxe, T>` | `vote_stats: Enc<Mxe, VoteStats>` |
| Game state | `Enc<Mxe, T>` | `game_moves: Enc<Mxe, GameMoves>` |
| Shared deck/pool | `Enc<Mxe, T>` | `deck: Enc<Mxe, Deck>` |
| Cross-computation state | `Enc<Mxe, T>` | `order_book: Enc<Mxe, &OrderBook>` |

### Pattern: Mixed Ownership Return

```rust
// Return both user-visible and internal state
#[instruction]
pub fn process(
    input: Enc<Shared, Input>,
    state: Enc<Mxe, State>,
) -> (Enc<Mxe, State>, Enc<Shared, Result>) {
    let i = input.to_arcis();
    let mut s = state.to_arcis();

    // Compute
    let result = compute(&i, &s);
    s.update(&i);

    (state.owner.from_arcis(s), input.owner.from_arcis(result))
}
```

---

## Section 5: Solana Program Template

### Required Imports and Program Declaration

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

// Define computation definition offsets for each circuit
const COMP_DEF_OFFSET_INIT: u32 = comp_def_offset("init_state");
const COMP_DEF_OFFSET_UPDATE: u32 = comp_def_offset("update_state");
const COMP_DEF_OFFSET_REVEAL: u32 = comp_def_offset("reveal_result");

declare_id!("YourProgramIdHere11111111111111111111111111");

#[arcium_program]
pub mod my_program {
    use super::*;
    // Instructions go here
}
```

### Three Components Per Circuit

**1. Initialize Computation Definition:**
```rust
pub fn init_my_circuit_comp_def(ctx: Context<InitMyCircuitCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}

#[init_computation_definition_accounts("my_circuit", payer)]
#[derive(Accounts)]
pub struct InitMyCircuitCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
```

**2. Queue Instruction with ArgBuilder:**
```rust
pub fn queue_my_circuit(
    ctx: Context<QueueMyCircuit>,
    computation_offset: u64,
    ciphertext: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    let args = ArgBuilder::new()
        .x25519_pubkey(pub_key)
        .plaintext_u128(nonce)
        .encrypted_u32(ciphertext)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,  // callback_server_address
        vec![MyCircuitCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[],  // custom callback accounts
        )?],
        1,  // num_callback_txs
        0,  // cu_price_micro (priority fee)
    )?;
    Ok(())
}

#[queue_computation_accounts("my_circuit", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct QueueMyCircuit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed, space = 9, payer = payer,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_CIRCUIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}
```

**3. Callback Instruction:**
```rust
#[arcium_callback(encrypted_ix = "my_circuit")]
pub fn my_circuit_callback(
    ctx: Context<MyCircuitCallback>,
    output: SignedComputationOutputs<MyCircuitOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(MyCircuitOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    // Process output (e.g., emit event, update state)
    emit!(ResultEvent {
        ciphertext: o.ciphertexts[0],
        nonce: o.nonce.to_le_bytes(),
    });

    Ok(())
}

#[callback_accounts("my_circuit")]
#[derive(Accounts)]
pub struct MyCircuitCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MY_CIRCUIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}
```

---

## Section 6: ArgBuilder Reference

### Parameter Order Rule
**ArgBuilder parameters MUST match circuit function parameters in exact order.**

### Method Reference

| Method | When to Use | Example |
|--------|-------------|---------|
| `.x25519_pubkey(key)` | Before `Enc<Shared, T>` | `.x25519_pubkey(pub_key)` |
| `.plaintext_u128(nonce)` | Nonce for encrypted data | `.plaintext_u128(nonce)` |
| `.encrypted_bool(ct)` | `bool` ciphertext | `.encrypted_bool(vote)` |
| `.encrypted_u8(ct)` | `u8` ciphertext | `.encrypted_u8(player_move)` |
| `.encrypted_u16(ct)` | `u16` ciphertext | `.encrypted_u16(amount)` |
| `.encrypted_u32(ct)` | `u32` ciphertext | `.encrypted_u32(value)` |
| `.encrypted_u64(ct)` | `u64` ciphertext | `.encrypted_u64(balance)` |
| `.encrypted_u128(ct)` | `u128` ciphertext | `.encrypted_u128(id)` |
| `.account(key, offset, len)` | Account reference (`&T`) | `.account(acc.key(), 8+1, 64)` |

### Pattern: `Enc<Shared, T>` (User Input)
```rust
// Circuit: fn process(input: Enc<Shared, MyData>) where MyData has 2 u32 fields
let args = ArgBuilder::new()
    .x25519_pubkey(pub_key)       // 1. Public key for shared encryption
    .plaintext_u128(nonce)        // 2. Nonce
    .encrypted_u32(ciphertext_0)  // 3. First field
    .encrypted_u32(ciphertext_1)  // 4. Second field
    .build();
```

### Pattern: `Enc<Mxe, T>` (Internal State)
```rust
// Circuit: fn update(input: Enc<Shared, X>, state: Enc<Mxe, Y>)
let args = ArgBuilder::new()
    // For Enc<Shared, X>:
    .x25519_pubkey(pub_key)
    .plaintext_u128(input_nonce)
    .encrypted_u32(input_ciphertext)
    // For Enc<Mxe, Y>:
    .plaintext_u128(state_nonce)    // Nonce only, no pubkey
    .account(state_acc.key(), 8+1, 64)  // Account reference
    .build();
```

### Pattern: `Enc<Mxe, &T>` (Account Reference)
```rust
// Pass by reference - MPC nodes fetch data from account
.account(
    account.key(),           // Account public key
    8 + 1,                   // Byte offset (8=discriminator, 1=bump)
    32 * field_count,        // Total bytes (32 per encrypted scalar)
)
```

---

## Section 7: TypeScript Test Template

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { MyProgram } from "../target/types/my_program";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
} from "@arcium-hq/client";

describe("MyProgram", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.MyProgram as Program<MyProgram>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // Get cluster account
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("performs encrypted computation", async () => {
    // 1. Get MXE public key for key exchange
    const mxePublicKey = await getMXEPublicKey(provider, program.programId);

    // 2. Generate X25519 keypair
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    // 3. Derive shared secret and create cipher
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // 4. Initialize computation definition (once per circuit)
    await initCompDef(program, provider);

    // 5. Encrypt user input
    const plaintext = [BigInt(42)];  // Array of field values
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    // 6. Queue computation
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    await program.methods
      .queueMyCircuit(
        computationOffset,
        Array.from(ciphertext[0]),            // First ciphertext
        Array.from(publicKey),                 // X25519 public key
        new anchor.BN(deserializeLE(nonce).toString())  // Nonce as BN
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount: clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("my_circuit")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    // 7. Wait for computation finalization
    await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );
  });
});

async function initCompDef(
  program: Program<MyProgram>,
  provider: anchor.AnchorProvider
): Promise<void> {
  const owner = (provider.wallet as anchor.Wallet).payer;
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("my_circuit");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeed, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  // Initialize comp def
  await program.methods
    .initMyCircuitCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc();

  // Finalize comp def
  const finalizeTx = await buildFinalizeCompDefTx(
    provider,
    Buffer.from(offset).readUInt32LE(),
    program.programId
  );
  const latestBlockhash = await provider.connection.getLatestBlockhash();
  finalizeTx.recentBlockhash = latestBlockhash.blockhash;
  finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  finalizeTx.sign(owner);
  await provider.sendAndConfirm(finalizeTx);
}
```

---

## Section 8: Output Type Generation

### Naming Convention
- Circuit function `my_circuit` generates `MyCircuitOutput`
- Function name converted to PascalCase + "Output"

### Output Struct Types

| Return Type | Generated Struct | LEN Calculation |
|-------------|------------------|-----------------|
| `Enc<Shared, T>` | `SharedEncryptedStruct<LEN>` | Count scalar fields in T |
| `Enc<Mxe, T>` | `MXEEncryptedStruct<LEN>` | Count scalar fields in T |
| `bool` (revealed) | `bool` | N/A (plaintext) |
| `u8` (revealed) | `u8` | N/A (plaintext) |
| Tuple `(A, B)` | Nested struct with `field_0`, `field_1` | Per-element |

### LEN Examples

| Return Type | LEN | Why |
|-------------|-----|-----|
| `Enc<Shared, u64>` | 1 | Single scalar |
| `Enc<Shared, (u32, bool)>` | 2 | Two scalars |
| `Enc<Mxe, [u8; 5]>` | 5 | Five array elements |
| `Enc<Mxe, MyStruct>` with `{a: u64, b: u64}` | 2 | Two scalar fields |

### Accessing Output Fields

```rust
// For Enc<Shared, T> with N scalars:
let o: SharedEncryptedStruct<N> = output.field_0;
let first_value = o.ciphertexts[0];   // [u8; 32]
let second_value = o.ciphertexts[1];  // [u8; 32]
let nonce = o.nonce;                   // u128
let pubkey = o.encryption_key;         // [u8; 32]

// For Enc<Mxe, T> with N scalars:
let o: MXEEncryptedStruct<N> = output.field_0;
let value = o.ciphertexts[0];         // [u8; 32]
let nonce = o.nonce;                   // u128
// No encryption_key (MXE-only)

// For revealed plaintext:
let result: bool = output.field_0;
```

---

## Section 9: Common Patterns

### Pattern 1: Initialize MXE State

```rust
// Circuit
#[instruction]
pub fn init_state(mxe: Mxe) -> Enc<Mxe, State> {
    let state = State { counter: 0, active: true };
    mxe.from_arcis(state)
}

// Program - ArgBuilder needs only nonce for Mxe
let args = ArgBuilder::new()
    .plaintext_u128(nonce)
    .build();
```

### Pattern 2: User Input + State Update

```rust
// Circuit
#[instruction]
pub fn update(
    input: Enc<Shared, UserInput>,
    state: Enc<Mxe, State>,
) -> Enc<Mxe, State> {
    let i = input.to_arcis();
    let mut s = state.to_arcis();
    s.counter += i.value;
    state.owner.from_arcis(s)
}

// Program - ArgBuilder
let args = ArgBuilder::new()
    // Enc<Shared, UserInput>
    .x25519_pubkey(pub_key)
    .plaintext_u128(input_nonce)
    .encrypted_u64(input_ciphertext)
    // Enc<Mxe, State>
    .plaintext_u128(state_nonce)
    .account(state_acc.key(), 8 + 1, 32 * 2)
    .build();
```

### Pattern 3: Reveal Result

```rust
// Circuit - returns plaintext
#[instruction]
pub fn reveal(state: Enc<Mxe, State>) -> bool {
    let s = state.to_arcis();
    (s.counter > 100).reveal()
}

// Callback - output is plaintext bool
#[arcium_callback(encrypted_ix = "reveal")]
pub fn reveal_callback(
    ctx: Context<RevealCallback>,
    output: SignedComputationOutputs<RevealOutput>,
) -> Result<()> {
    let result: bool = match output.verify_output(...) {
        Ok(RevealOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };
    emit!(ResultEvent { result });
    Ok(())
}
```

### Pattern 4: Randomness with ArcisRNG

```rust
// Circuit
#[instruction]
pub fn random_choice(input: Enc<Shared, PlayerMove>) -> u8 {
    let player = input.to_arcis();

    // Generate random bits
    let bit1 = ArcisRNG::bool();
    let bit2 = ArcisRNG::bool();

    // Convert to choice (0, 1, or 2)
    let house_choice = if bit1 {
        if bit2 { 0 } else { 2 }
    } else if bit2 {
        1
    } else {
        0
    };

    // Compare and reveal result
    let result = if player.choice == house_choice { 0 }
                 else if wins(player.choice, house_choice) { 1 }
                 else { 2 };
    result.reveal()
}
```

### Pattern 5: Return to Multiple Owners

```rust
// Circuit
#[instruction]
pub fn process(
    input: Enc<Shared, Input>,
    state: Enc<Mxe, State>,
) -> (Enc<Mxe, State>, Enc<Shared, Receipt>) {
    let i = input.to_arcis();
    let mut s = state.to_arcis();

    // Update state
    s.total += i.amount;

    // Create receipt for user
    let receipt = Receipt { confirmed: true, id: s.total };

    (state.owner.from_arcis(s), input.owner.from_arcis(receipt))
}
```

---

## Section 10: Constraints and Pitfalls

### NEVER Use

| Prohibited | Reason | Alternative |
|------------|--------|-------------|
| `Vec<T>` | Dynamic size | `[T; N]` fixed array |
| `String` | Dynamic size | `[u8; N]` fixed bytes |
| `HashMap<K,V>` | Dynamic size | Fixed array with linear search |
| Early `return` | Data-dependent flow | Conditional assignment |
| `break` in loops | Data-dependent flow | Flag-based iteration |
| Missing `else` | Incomplete branches | Always provide both branches |

### ALWAYS Do

| Requirement | Reason | Example |
|-------------|--------|---------|
| Fixed-size arrays | Compile-time size | `[Order; 100]` |
| Both if/else branches | Data-independent | `if x { a } else { b }` |
| Nonce in account state | Output re-encryption | `pub nonce: u128` |
| Use `owner.from_arcis()` | Preserve encryption owner | `ctxt.owner.from_arcis(val)` |
| Initialize all array elements | No undefined data | `[0; N]` or explicit init |

### Performance Hierarchy (Fastest to Slowest)

1. **Additions** - Nearly free (plaintext speed)
2. **Multiplications** - More expensive (requires preprocessing + communication)
3. **Comparisons** - Most expensive (scalar to bits conversion)

### Common Mistakes

```rust
// WRONG: Missing else
if vote { yes += 1; }  // Compile error

// CORRECT: Both branches
if vote { yes += 1; } else { no += 1; }

// WRONG: Early return
if invalid { return error; }  // Compile error

// CORRECT: Conditional assignment
let result = if invalid { error_value } else { success_value };

// WRONG: Dynamic iteration
for item in items.iter() { ... }  // If items is Vec

// CORRECT: Fixed iteration
for i in 0..MAX_ITEMS {
    let should_process = i < actual_count;
    if should_process { ... } else { /* no-op */ }
}
```

---

## Section 11: Account Data Layout

### Byte Offset Calculation

```
Account Layout:
┌─────────────────────────────────────────────────┐
│ Bytes 0-7:   Discriminator (8 bytes)            │
│ Bytes 8-N:   Account fields in declaration order│
└─────────────────────────────────────────────────┘
```

### Field Sizes

| Field Type | Size (bytes) |
|------------|--------------|
| `u8`, `bool` | 1 |
| `u16` | 2 |
| `u32` | 4 |
| `u64` | 8 |
| `u128` | 16 |
| `Pubkey` | 32 |
| `[u8; 32]` (ciphertext) | 32 |
| `[[u8; 32]; N]` | 32 * N |

### Example: Account with Encrypted State

```rust
#[account]
#[derive(InitSpace)]
pub struct GameAccount {
    pub bump: u8,                    // Offset: 8,  Size: 1
    pub encrypted_state: [[u8; 32]; 2], // Offset: 9,  Size: 64
    pub nonce: u128,                 // Offset: 73, Size: 16
    pub authority: Pubkey,           // Offset: 89, Size: 32
}

// ArgBuilder .account() call:
.account(
    game_acc.key(),
    8 + 1,       // Skip discriminator (8) + bump (1)
    32 * 2,      // Read 2 ciphertexts (64 bytes)
)
```

### Complete Offset Calculation Example

```rust
#[account]
pub struct VotingAccount {
    // Discriminator: bytes 0-7 (8 bytes) - automatic
    pub bump: u8,              // byte 8 (1 byte)
    pub vote_counts: [[u8; 32]; 2],  // bytes 9-72 (64 bytes)
    pub nonce: u128,           // bytes 73-88 (16 bytes)
    pub id: u32,               // bytes 89-92 (4 bytes)
    pub authority: Pubkey,     // bytes 93-124 (32 bytes)
}

// To read vote_counts in ArgBuilder:
.account(
    voting_acc.key(),
    8 + 1,      // offset = discriminator + bump = 9
    32 * 2,     // length = 2 encrypted u64s = 64 bytes
)
```

### Tips for Account Layout

1. Place encrypted data early in the struct (after bump)
2. Group ciphertexts together as `[[u8; 32]; N]`
3. Store nonce immediately after ciphertexts for easy reference
4. Use `#[derive(InitSpace)]` for automatic space calculation
5. Account space = 8 (discriminator) + sum of field sizes

---

## Quick Debugging Checklist

- [ ] ArgBuilder parameter order matches circuit function signature exactly
- [ ] `x25519_pubkey` + `plaintext_u128(nonce)` before every `Enc<Shared, T>`
- [ ] `plaintext_u128(nonce)` before every `Enc<Mxe, T>`
- [ ] Account offset includes 8-byte discriminator
- [ ] All if statements have else branches
- [ ] No early returns or breaks in loops
- [ ] Fixed-size arrays instead of Vec/String
- [ ] Circuit name in macros matches function name exactly
- [ ] COMP_DEF_OFFSET const uses correct circuit name string
- [ ] Callback output type uses PascalCase circuit name + "Output"
