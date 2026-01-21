// TODO: this is stupid, the SOL lamports should go to a common global vault account

use std::ops::Mul;

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::constants::PRICE_PER_VOTE_TOKEN_LAMPORTS;
use crate::state::VoteTokenAccount;
use crate::COMP_DEF_OFFSET_CALCULATE_VOTE_TOKEN_BALANCE;
use crate::{ID, ID_CONST, ArciumSignerAccount};

pub const VOTE_TOKEN_ACCOUNT_SEED: &[u8] = b"vote_token_account";

#[queue_computation_accounts("calculate_vote_token_balance", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct MintVoteTokens<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [VOTE_TOKEN_ACCOUNT_SEED, signer.key().as_ref()],
        bump = vote_token_account.bump,
    )]
    pub vote_token_account: Account<'info, VoteTokenAccount>,

    // Arcium accounts
    #[account(
        init_if_needed,
        space = 9,
        payer = signer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_VOTE_TOKEN_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn mint_vote_tokens(
    ctx: Context<MintVoteTokens>,
    computation_offset: u64,
    trade_amount: u64,
    buy: bool,
) -> Result<()> {
    let vta = &mut ctx.accounts.vote_token_account;
    let vta_pubkey = vta.key();
    let signer = &ctx.accounts.signer;

    let lamports_amount = trade_amount
        .checked_mul(PRICE_PER_VOTE_TOKEN_LAMPORTS)
        .ok_or(ErrorCode::InsufficientBalance)?;

    // Selling: actual transfer happens in callback if successful
    if buy {
        // Buying: transfer SOL from user to vote_token_account PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: signer.to_account_info(),
                    to: vta.to_account_info(),
                },
            ),
            lamports_amount,
        )?;
    }

    // Build args for encrypted computation
    // Circuit signature: calculate_vote_token_balance(balance_ctx, amount, sell)
    // sell = !buy (true means selling, false means buying)
    let args = ArgBuilder::new()
        .plaintext_u128(vta.state_nonce)
        .account(vta_pubkey, 8, 32 * 1)
        .plaintext_u64(trade_amount)
        .plaintext_bool(!buy) // sell = !buy
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Queue computation with callback
    // Pass both vote_token_account and user account for callback
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![CalculateVoteTokenBalanceCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: vta_pubkey,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: signer.key(),
                    is_writable: true,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("calculate_vote_token_balance")]
#[derive(Accounts)]
pub struct CalculateVoteTokenBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CALCULATE_VOTE_TOKEN_BALANCE))]
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

    // Callback accounts
    #[account(mut)]
    pub vote_token_account: Account<'info, VoteTokenAccount>,

    /// CHECK: User account to receive SOL on sell, validated against vote_token_account.owner
    #[account(mut, address = vote_token_account.owner)]
    pub user: AccountInfo<'info>,
}

pub fn calculate_vote_token_balance_callback(
    ctx: Context<CalculateVoteTokenBalanceCallback>,
    output: SignedComputationOutputs<CalculateVoteTokenBalanceOutput>,
) -> Result<()> {
    // Output is (bool, u64, Enc<Mxe, VoteTokenBalance>)
    // field_0 = error boolean (true = insufficient balance for sell)
    // field_1 = how many vote tokens were sold
    // field_2 = updated encrypted balance
    let res = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(CalculateVoteTokenBalanceOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let vta = &mut ctx.accounts.vote_token_account;
    let error = res.field_0;
    let amount_sold = res.field_1;
    let encrypted_balance = res.field_2;

    if error {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    // If this was a sell operation and it succeeded, transfer SOL to user
    if amount_sold > 0 {
        // Transfer SOL from vote_token_account PDA to user
        let vta_lamports = vta.to_account_info().lamports();
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(vta.to_account_info().data_len());

        // Ensure we don't go below rent-exempt minimum
        let available = vta_lamports.saturating_sub(min_rent);
        let amount_sold_lamports = amount_sold.mul(PRICE_PER_VOTE_TOKEN_LAMPORTS);
        let transfer_amount = amount_sold_lamports.min(available);

        if transfer_amount > 0 {
            **vta.to_account_info().try_borrow_mut_lamports()? -= transfer_amount;
            **ctx.accounts.user.try_borrow_mut_lamports()? += transfer_amount;
        }
    }

    // Update encrypted state
    vta.state_nonce = encrypted_balance.nonce;
    vta.encrypted_state = encrypted_balance.ciphertexts;

    Ok(())
}
