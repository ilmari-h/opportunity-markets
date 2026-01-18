# Computation Definition Accounts

## Why Computation Definitions Exist

When you write an encrypted instruction using Arcis, it gets compiled into an MPC circuit - essentially a program that the MPC nodes can execute securely on encrypted data. But here's the challenge: how do the MPC nodes know what circuit to run when your Solana program calls for a computation?

That's where Computation Definition Accounts come in. They serve as the bridge between your Solana program and the MPC network, storing both the circuit itself and metadata about how to execute it. Think of it as uploading your encrypted instruction to the blockchain so the MPC nodes can access it when needed.

## Computation Definition Accounts

When we define an encrypted instruction using [Arcis](/developers/arcis), we need the MPC cluster that will execute this confidential instruction to have access to the confidential instruction itself, its interface, and some more metadata. This is done by defining a `ComputationDefinitionAccount` struct, which consists of two parts:

1. The confidential instruction metadata and interface.
2. The raw MPC bytecode.

The interface provides data around what input and output types are expected, what accounts are required, and a few other pieces of metadata. It's data is stored in an account with the seeds`b"ComputationDefinitionAccount", mxe_program_id, comp_def_offset`. The first is exported as a constant by the Arcium Anchor SDK, the second is just the program id of our MXE program, and the third is a confidential-instruction-specific offset. It is computed with `comp_def_offset = sha256(<confidential_instruction_name>).slice(0,4)` and then interpreted as a little-endian u32. Theoretically, you shouldn't need to know this, but it's good to know what's going on under the hood. We abstract this with `derive_comp_def_pda` macro which takes in the `comp_def_offset` as a parameter, and computes the `ComputationDefinitionAccount` address for you.

The MPC bytecode is stored inside account(s) with the seeds `b"ComputationDefinitionRaw", comp_def_acc, i`. Like above, the first is exported as a constant by the Arcium Anchor SDK, the second is the computation definition account we defined above, and the third is an index starting from 0 up to however many accounts we need to store the full MPC bytecode.

## Usage

When working locally, you theoretically don't need to care about the MPC bytecode accounts, as the Arcium CLI will handle the creation and management of these accounts for you. You do however need to create the interface ComputationDefinitionAccount, which can easily be done with the Arcium Anchor tooling. Let's say we want to deploy a confidential instruction called `add_together`:

```rust  theme={null}
pub fn init_add_together_comp_def(ctx: Context<InitAddTogetherCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    Ok(())
}

#[init_computation_definition_accounts("add_together", payer)]
#[derive(Accounts)]
pub struct InitAddTogetherCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    // The computation definition account that will be created. We can't
    // specify the seeds and account type directly here, as it gets
    // initialized via CPI so these constraints would fail in our non-CPI
    // instruction. This is ok, as the Arcium program will create the
    // account with the correct seeds and account type for us.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
```

And that's all, we just have to make sure to call this instruction once at the beginning before we can use the confidential instruction.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
