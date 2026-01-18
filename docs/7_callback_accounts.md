# Callback Accounts

Callback accounts provide a way to define additional accounts to be used in the callback instruction for a computation. This is helpful when you want to use the output of a computation to modify an onchain account.

**Prerequisites**: Before diving into callback accounts, make sure you've read:

* [Basic program invocation guide](/developers/program) - fundamentals of queuing computations and defining callback instructions
* [Callback Type Generation](/developers/program/callback-type-generation) - how output types like `AddTogetherOutput` are automatically generated from encrypted instructions
* [Arcis inputs/outputs](/developers/arcis/input-output) - handling encrypted data types

**When to use callback accounts:**

* Storing computation results in persistent accounts
* Updating game state, user balances, or protocol data
* Writing results that exceed transaction size limits

## Complete Example

Expanding on our [basic example](/developers/program), let's say we want to save the result of our addition in an account for later use. We'll walk through the complete implementation step by step.

### Step 1: Define the Account Structure

First, define an account to store our computation result:

```rust  theme={null}
#[account]
#[derive(InitSpace)]
pub struct SecretAdditionResult {
    pub sum: [u8; 32], // Store the encrypted result as ciphertext
}

pub fn init(ctx: Context<Initialize>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        seeds = [b"AdditionResult"],
        space = 8 + SecretAdditionResult::INIT_SPACE,
        // Note: In a real implementation you should usually save the bump too,
        // but for the sake of simplicity in this example we skip that
        bump
    )]
    pub add_result_account: Account<'info, SecretAdditionResult>,
    pub system_program: Program<'info, System>,
}
```

### Step 2: Modify the Queue Function

There are two ways to specify callback instructions in your `queue_computation` call:

#### Recommended: Using callback\_ix() Helper

The `callback_ix()` helper method is the **preferred approach** because it automatically handles all required standard accounts and is less error-prone.

**What callback\_ix() does automatically:**

* Creates a CallbackInstruction with the proper instruction data
* Automatically includes standard accounts: `arcium_program`, `comp_def_account`, `mxe_account`, `computation_account`, `cluster_account`, `instructions_sysvar`
* Accepts custom accounts through the `&[CallbackAccount]` parameter
* Eliminates boilerplate and prevents errors

```rust  theme={null}
pub fn add_together(
    ctx: Context<AddTogether>,
    computation_offset: u64,
    ciphertext_0: [u8; 32],
    ciphertext_1: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    // Note: Using `create_program_address` with the bump would be more efficient than `find_program_address`.
    // Since this PDA is constant, you could also derive it at compile time and save it as a constant.
    // We use find_program_address here for simplicity.
    let addition_result_pda = Pubkey::find_program_address(&[b"AdditionResult"], ctx.program_id).0;

    // Build the args the confidential instruction expects using ArgBuilder
    let args = ArgBuilder::new()
        .x25519_pubkey(pub_key)
        .plaintext_u128(nonce)
        .encrypted_u8(ciphertext_0)
        .encrypted_u8(ciphertext_1)
        .build();

    // Set the bump for the sign_pda_account
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build & queue our computation (via CPI to the Arcium program)
    queue_computation(
        ctx.accounts,
        // Random offset for the computation
        computation_offset,
        // The one-time inputs our confidential instruction expects
        args,
        // Callback server address
        // None here because the output of the confidential instruction can fit into a solana transaction
        // as its just 1 Ciphertext which is 32 bytes
        None,
        // Using callback_ix() helper - automatically includes the 6 standard accounts
        // (arcium_program, comp_def_account, mxe_account, computation_account, cluster_account, instructions_sysvar) plus our custom account
        vec![AddTogetherCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: addition_result_pda,
                    is_writable: true, // Tells nodes to mark this account as writable in the transaction
                }
            ]
        )?],
        1, // Number of transactions needed for callback (1 for simple computations)
        0, // cu_price_micro: priority fee in microlamports (0 = no priority fee)
    )?;
    Ok(())
}

/* The AddTogether accounts struct stays exactly the same as shown in the basic guide */
```

#### Understanding What Happens: Manual CallbackInstruction

For educational purposes, here's what `callback_ix()` generates under the hood. This manual approach is functionally equivalent but more verbose and error-prone:

```rust  theme={null}
pub fn add_together(
    ctx: Context<AddTogether>,
    computation_offset: u64,
    ciphertext_0: [u8; 32],
    ciphertext_1: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    // Note: Using `create_program_address` with the bump would be more efficient than `find_program_address`.
    // Since this PDA is constant, you could also derive it at compile time and save it as a constant.
    // We use find_program_address here for simplicity.
    let addition_result_pda = Pubkey::find_program_address(&[b"AdditionResult"], ctx.program_id).0;

    // Build the args the confidential instruction expects using ArgBuilder
    let args = ArgBuilder::new()
        .x25519_pubkey(pub_key)
        .plaintext_u128(nonce)
        .encrypted_u8(ciphertext_0)
        .encrypted_u8(ciphertext_1)
        .build();

    // Set the bump for the sign_pda_account
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build & queue our computation (via CPI to the Arcium program)
    queue_computation(
        ctx.accounts,
        // Random offset for the computation
        computation_offset,
        // The one-time inputs our confidential instruction expects
        args,
        // Callback server address
        // None here because the output of the confidential instruction can fit into a solana transaction
        // as its just 1 ciphertext which is 32 bytes
        None,
        // Manual approach: Define which callback instruction to call when the computation is complete.
        // We specify the program ID, instruction discriminator, and all accounts needed
        // for the callback, including our result account which we want to be writable.
        vec![CallbackInstruction {
            program_id: ID_CONST,
            discriminator: instruction::AddTogetherCallback::DISCRIMINATOR.to_vec(),
            accounts: vec![
                // Standard accounts (always required, in this order)
                CallbackAccount {
                    pubkey: ARCIUM_PROGRAM_ID,
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_TOGETHER),
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.mxe_account.key(),
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.computation_account.key(),
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: derive_cluster_pda!(ctx.accounts.mxe_account, ErrorCode::ClusterNotSet),
                    is_writable: false,
                },
                CallbackAccount {
                    pubkey: INSTRUCTIONS_SYSVAR_ID,
                    is_writable: false,
                },
                // Custom accounts (your callback-specific accounts)
                CallbackAccount {
                    pubkey: addition_result_pda,
                    is_writable: true, // Tells nodes to mark this account as writable in the transaction
                }
            ]
        }],
        1, // Number of transactions needed for callback (1 for simple computations)
        0, // cu_price_micro: priority fee in microlamports (0 = no priority fee)
    )?;
    Ok(())
}

/* The AddTogether accounts struct stays exactly the same as shown in the basic guide */
```

**Key Point**: Both approaches are functionally equivalent. The `callback_ix()` method automatically generates the exact same `CallbackInstruction` structure as the manual approach, but with less code and reduced chance for errors.

**Important**: We added the account to the callback (either via `callback_ix()` parameter or `CallbackInstruction.accounts`) but didn't include it in the AddTogether accounts struct because we don't read or write to it during the queue function - only during the callback.

### Step 3: Implement the Callback Function

The callback instruction receives the accounts in the exact order specified in the queue function:

```rust  theme={null}
// Macro provided by the Arcium SDK to define a callback instruction.
#[arcium_callback(encrypted_ix = "add_together")]
pub fn add_together_callback(
    ctx: Context<AddTogetherCallback>,
    output: SignedComputationOutputs<AddTogetherOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(AddTogetherOutput { field_0 }) => field_0,
        Err(e) => {
            msg!("Error: {}", e);
            return Err(ErrorCode::AbortedComputation.into())
        },
    };

    emit!(SumEvent {
        sum: o.ciphertexts[0],
        nonce: o.nonce.to_le_bytes(),
    });

    // Save the result in our callback account too
    ctx.accounts.add_result_account.sum = o.ciphertexts[0];

    Ok(())
}


#[callback_accounts("add_together")]
#[derive(Accounts)]
pub struct AddTogetherCallback<'info> {
    // Standard accounts required for all callbacks
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_TOGETHER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions_sysvar, checked by the account constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom accounts (match remaining accounts in CallbackInstruction.accounts)
    #[account(
        mut,
        seeds = [b"AdditionResult"],
        // Note: In a real implementation you should usually save the bump too,
        // but for the sake of simplicity in this example we skip that
        bump
    )]
    pub add_result_account: Account<'info, SecretAdditionResult>,
}
```

## Key Requirements & Constraints

### Account Ordering

The accounts in your callback struct **must match exactly** the order in `CallbackInstruction.accounts`:

1. Standard accounts are always required first: `arcium_program`, `comp_def_account`, `mxe_account`, `computation_account`, `cluster_account`, `instructions_sysvar`
2. Custom accounts follow in the exact sequence you specified

### Account Creation Rules

* **Can create** accounts in the queue computation function (user pays rent)
* **Cannot create** accounts during callback execution (would require nodes to pay)
* Accounts must exist before the callback executes
* Account size cannot change during callback

### Writability Requirements

* Set `is_writable: true` in CallbackAccount to tell nodes to mark the account as writable
* The account must have `#[account(mut)]` in the callback struct
* Without proper writability flags, mutations will fail

## Troubleshooting

**Account not found**: Ensure the account exists before callback execution. Initialize it in the queue function or a separate instruction.

**Order mismatch errors**: Double-check that your callback struct accounts are in the exact same order as the CallbackInstruction.accounts vector.

**Cannot modify account**: Verify both `is_writable: true` in CallbackAccount and `#[account(mut)]` in the callback struct are set.

**Size errors**: Callback accounts cannot be resized. Allocate sufficient space when creating the account.

## Understanding callback\_ix() in Detail

The `callback_ix()` method you see throughout these examples is a convenient helper that's automatically generated by the `#[callback_accounts]` macro.

### How callback\_ix() Works

When you define a callback struct with `#[callback_accounts("instruction_name")]`, the macro automatically generates a `callback_ix()` method that:

1. **Takes required parameters**: `computation_offset` and `&mxe_account` for proper context
2. **Creates a CallbackInstruction** with the proper instruction data
3. **Automatically includes standard accounts** that every callback needs:
   * `arcium_program`: The Arcium program that will invoke your callback
   * `comp_def_account`: The computation definition account for your encrypted instruction
   * `mxe_account`: Your MXE's metadata and configuration
   * `computation_account`: The computation being processed
   * `cluster_account`: The MPC cluster processing the computation
   * `instructions_sysvar`: Solana's instructions sysvar for transaction validation
4. **Accepts custom accounts** through the `&[CallbackAccount]` parameter

### Usage Patterns

**Basic usage (no custom accounts):**

```rust  theme={null}
vec![AddTogetherCallback::callback_ix(
    computation_offset,
    &ctx.accounts.mxe_account,
    &[]
)?]
```

The empty array indicates no custom accounts needed beyond the standard ones.

**Advanced usage (with custom accounts):**

```rust  theme={null}
vec![AddTogetherCallback::callback_ix(
    computation_offset,
    &ctx.accounts.mxe_account,
    &[
        CallbackAccount {
            pubkey: my_account.key(),
            is_writable: true,
        },
        // ... more custom accounts
    ]
)?]
```

### Why Use callback\_ix()?

The `callback_ix()` helper is the **recommended approach** because it:

* **Eliminates boilerplate**: No need to manually construct CallbackInstruction
* **Prevents errors**: Automatically includes all required standard accounts
* **Maintains consistency**: Ensures your callback instructions follow the correct format
* **Simplifies maintenance**: Changes to callback requirements are handled by the macro

## Going Further

This guide covered the advanced patterns for working with callback accounts. To understand the fundamentals of callback instructions, see our [basic program invocation guide](/developers/program).

For handling different types of encrypted data inputs and outputs, see [Arcis inputs/outputs](/developers/arcis/input-output).


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
