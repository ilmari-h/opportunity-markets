use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::AuctionResolvedEvent;
use crate::state::{Auction, AuctionStatus, AuctionType};
use crate::COMP_DEF_OFFSET_DETERMINE_WINNER_VICKREY;
use crate::{ID, ID_CONST, SignerAccount};

#[queue_computation_accounts("determine_winner_vickrey", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DetermineWinnerVickrey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub auction: Account<'info, Auction>,
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DETERMINE_WINNER_VICKREY))]
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

pub fn determine_winner_vickrey(
    ctx: Context<DetermineWinnerVickrey>,
    computation_offset: u64,
) -> Result<()> {
    let auction = &ctx.accounts.auction;
    require!(
        auction.status == AuctionStatus::Closed,
        ErrorCode::AuctionNotClosed
    );
    require!(
        auction.auction_type == AuctionType::Vickrey,
        ErrorCode::WrongAuctionType
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    const ENCRYPTED_STATE_OFFSET: u32 = 8 + 1 + 32 + 1 + 1 + 8 + 8 + 1 + 16;
    const ENCRYPTED_STATE_SIZE: u32 = 32 * 5;

    let args = ArgBuilder::new()
        .plaintext_u128(auction.state_nonce)
        .account(
            ctx.accounts.auction.key(),
            ENCRYPTED_STATE_OFFSET,
            ENCRYPTED_STATE_SIZE,
        )
        .build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![DetermineWinnerVickreyCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.auction.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    Ok(())
}

#[callback_accounts("determine_winner_vickrey")]
#[derive(Accounts)]
pub struct DetermineWinnerVickreyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DETERMINE_WINNER_VICKREY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
}

pub fn determine_winner_vickrey_callback(
    ctx: Context<DetermineWinnerVickreyCallback>,
    output: SignedComputationOutputs<DetermineWinnerVickreyOutput>,
) -> Result<()> {
    let (winner_lo, winner_hi, payment_amount) = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(DetermineWinnerVickreyOutput {
            field_0:
                DetermineWinnerVickreyOutputStruct0 {
                    field_0: winner_lo,
                    field_1: winner_hi,
                    field_2: payment_amount,
                },
        }) => (winner_lo, winner_hi, payment_amount),
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let mut winner = [0u8; 32];
    winner[..16].copy_from_slice(&winner_lo.to_le_bytes());
    winner[16..].copy_from_slice(&winner_hi.to_le_bytes());

    let auction_key = ctx.accounts.auction.key();
    let auction_type = ctx.accounts.auction.auction_type;
    let auction = &mut ctx.accounts.auction;
    auction.status = AuctionStatus::Resolved;

    emit!(AuctionResolvedEvent {
        auction: auction_key,
        winner,
        payment_amount,
        auction_type,
    });

    Ok(())
}
