use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::error::ErrorCode;
use crate::events::AuctionCreatedEvent;
use crate::state::{Auction, AuctionStatus, AuctionType};
use crate::COMP_DEF_OFFSET_INIT_AUCTION_STATE;
use crate::{ID, ID_CONST, SignerAccount};

#[queue_computation_accounts("init_auction_state", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Auction::INIT_SPACE,
        seeds = [b"auction", authority.key().as_ref()],
        bump,
    )]
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_AUCTION_STATE))]
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

pub fn create_auction(
    ctx: Context<CreateAuction>,
    computation_offset: u64,
    auction_type: AuctionType,
    min_bid: u64,
    end_time: i64,
    nonce: u128,
) -> Result<()> {
    let auction = &mut ctx.accounts.auction;
    auction.bump = ctx.bumps.auction;
    auction.authority = ctx.accounts.authority.key();
    auction.auction_type = auction_type;
    auction.status = AuctionStatus::Open;
    auction.min_bid = min_bid;
    auction.end_time = end_time;
    auction.bid_count = 0;
    auction.state_nonce = nonce;
    auction.encrypted_state = [[0u8; 32]; 5];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let args = ArgBuilder::new().plaintext_u128(nonce).build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![InitAuctionStateCallback::callback_ix(
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

#[callback_accounts("init_auction_state")]
#[derive(Accounts)]
pub struct InitAuctionStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_AUCTION_STATE))]
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

pub fn init_auction_state_callback(
    ctx: Context<InitAuctionStateCallback>,
    output: SignedComputationOutputs<InitAuctionStateOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(InitAuctionStateOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let auction_key = ctx.accounts.auction.key();
    let authority = ctx.accounts.auction.authority;
    let auction_type = ctx.accounts.auction.auction_type;
    let min_bid = ctx.accounts.auction.min_bid;
    let end_time = ctx.accounts.auction.end_time;

    let auction = &mut ctx.accounts.auction;
    auction.encrypted_state = o.ciphertexts;
    auction.state_nonce = o.nonce;

    emit!(AuctionCreatedEvent {
        auction: auction_key,
        authority,
        auction_type,
        min_bid,
        end_time,
    });

    Ok(())
}
