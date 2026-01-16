use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::BidPlacedEvent;
use crate::state::{Auction, AuctionStatus};
use crate::COMP_DEF_OFFSET_PLACE_BID;
use crate::{ID, ID_CONST, SignerAccount};

#[queue_computation_accounts("place_bid", bidder)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    #[account(
        init_if_needed,
        space = 9,
        payer = bidder,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLACE_BID))]
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

pub fn place_bid(
    ctx: Context<PlaceBid>,
    computation_offset: u64,
    encrypted_bidder_lo: [u8; 32],
    encrypted_bidder_hi: [u8; 32],
    encrypted_amount: [u8; 32],
    bidder_pubkey: [u8; 32],
    nonce: u128,
) -> Result<()> {
    let auction = &ctx.accounts.auction;
    require!(
        auction.status == AuctionStatus::Open,
        ErrorCode::AuctionNotOpen
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Account offset: 8 (discriminator) + 1 + 32 + 1 + 1 + 8 + 8 + 1 + 16 = 76
    const ENCRYPTED_STATE_OFFSET: u32 = 76;
    const ENCRYPTED_STATE_SIZE: u32 = 32 * 5;

    let args = ArgBuilder::new()
        .x25519_pubkey(bidder_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u128(encrypted_bidder_lo)
        .encrypted_u128(encrypted_bidder_hi)
        .encrypted_u64(encrypted_amount)
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
        vec![PlaceBidCallback::callback_ix(
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

#[callback_accounts("place_bid")]
#[derive(Accounts)]
pub struct PlaceBidCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLACE_BID))]
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

pub fn place_bid_callback(
    ctx: Context<PlaceBidCallback>,
    output: SignedComputationOutputs<PlaceBidOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(PlaceBidOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let auction_key = ctx.accounts.auction.key();
    let auction = &mut ctx.accounts.auction;
    auction.encrypted_state = o.ciphertexts;
    auction.state_nonce = o.nonce;
    auction.bid_count += 1;

    emit!(BidPlacedEvent {
        auction: auction_key,
        bid_count: auction.bid_count,
    });

    Ok(())
}
