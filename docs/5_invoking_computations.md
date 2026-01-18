# Overview

Before reading this, we recommend having read the [Computation Lifecycle](/developers/computation-lifecycle) section, the [Arcis inputs/outputs](/developers/arcis/input-output) section, and the [Callback Type Generation](/developers/program/callback-type-generation) guide to understand how output types like `AddTogetherOutput` are automatically generated from encrypted instructions.

## The Basics

Let's say we have the following encrypted instruction and want to invoke it from our MXE.

```rust  theme={null}
#[encrypted]
mod circuits {
    use arcis::*;

    pub struct InputValues {
        v1: u8,
        v2: u8,
    }

    #[instruction]
    pub fn add_together(input_ctxt: Enc<Shared, InputValues>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.v1 as u16 + input.v2 as u16;
        input_ctxt.owner.from_arcis(sum)
    }
}
```

To do this, we first need to receive the encrypted parameter of type `InputValues` which contains two encrypted `u8`s, then build the computation arguments using `ArgBuilder`, and finally queue the computation for execution. Additionally, we need to define a callback instruction that will be invoked when the computation is complete. Callback instructions have a few requirements:

1. They must be defined with the `#[arcium_callback(encrypted_ix = "encrypted_ix_name")]` macro.
2. They must have exactly two arguments: `ctx: Context<...>` and `output: SignedComputationOutputs<T>` where `T` is named as `{encrypted_ix_name}Output`.

For passing encrypted arguments, we use the `ArgBuilder` API. If the corresponding argument is `Enc<Shared, T>`, then we need to pass the `x25519_pubkey(pub_key)` and `plaintext_u128(nonce)`, before the ciphertext. If the corresponding argument is `Enc<Mxe, T>`, then we only need to pass the nonce as `plaintext_u128(nonce)` and the ciphertext. Ciphertexts are passed using methods like `encrypted_u8`, `encrypted_u16`, `encrypted_u32`, `encrypted_u64`, `encrypted_u128`, or `encrypted_bool`.

```rust  theme={null}
pub fn add_together(
    ctx: Context<AddTogether>,
    computation_offset: u64,
    ciphertext_0: [u8; 32],
    ciphertext_1: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
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
        // Use callback_ix() helper to generate the callback instruction
        vec![AddTogetherCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[]  // Empty array = no custom accounts
        )?],
        1, // Number of transactions needed for callback (1 for simple computations)
        0, // cu_price_micro: priority fee in microlamports (0 = no priority fee)
    )?;
    Ok(())
}

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

    Ok(())
}

```

Let's also have a look at the `Accounts` structs for each of these instructions:

```rust  theme={null}
/// Accounts required to invoke the `add_together` encrypted instruction.
/// `add_together` must be the name of the encrypted instruction we're invoking.

#[queue_computation_accounts("add_together", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AddTogether<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_TOGETHER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}
```

That's a lot of accounts to remember! Here's what each one does:

**Core MXE Accounts:**

* `mxe_account`: Your MXE's metadata and configuration
* `mempool_account`: Queue where computations wait to be processed
* `executing_pool`: Tracks computations currently being executed
* `computation_account`: Stores individual computation data and results
* `comp_def_account`: Definition of your encrypted instruction (circuit)

**Arcium Network Accounts:**

* `cluster_account`: The MPC cluster that will process your computation
* `pool_account`: Arcium's fee collection account
* `clock_account`: Network timing information

**System Accounts:**

* `payer`: Pays transaction fees and rent
* `sign_pda_account`: PDA signer for the computation
* `system_program`: Solana's system program for account creation
* `arcium_program`: Arcium's core program that orchestrates MPC

The good news is these can be copy-pasted for any confidential instruction. You only need to change:

1. `COMP_DEF_OFFSET_ADD_TOGETHER` to match your instruction name
2. The instruction name in the `queue_computation_accounts` macro

How about the accounts for the callback instruction?

```rust  theme={null}
#[callback_accounts("add_together")]
#[derive(Accounts)]
pub struct AddTogetherCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    /// COMP_DEF_OFFSET_ADD_TOGETHER is an encrypted instruction specific u32
    /// offset which can be calculated with `comp_def_offset("add_together")`, where
    /// comp_def_offset is a function provided by the Arcium SDK and `add_together`
    /// is the name of the encrypted instruction we're invoking.
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
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}
```

Here it's a lot fewer accounts fortunately! Like with the `AddTogether` struct, we need to change the parameter for the `derive_comp_def_pda` macro and in the `callback_accounts` macro depending on the encrypted instruction we're invoking.

The `callback_ix()` method is a convenient helper generated by the `#[callback_accounts]` macro that automatically creates the proper callback instruction with all required accounts.

But what if we don't just want to return a raw value and need some additional accounts? Check out [input/outputs](/developers/arcis/input-output) for how to handle encrypted data and [callback accounts](/developers/program/callback-accs) for returning additional accounts in the callback.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
