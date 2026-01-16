use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::AuctionClosedEvent;
use crate::state::{Auction, AuctionStatus};

#[derive(Accounts)]
pub struct CloseAuction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub auction: Account<'info, Auction>,
}

pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
    let auction = &mut ctx.accounts.auction;
    require!(
        auction.status == AuctionStatus::Open,
        ErrorCode::AuctionNotOpen
    );
    auction.status = AuctionStatus::Closed;

    emit!(AuctionClosedEvent {
        auction: auction.key(),
        bid_count: auction.bid_count,
    });

    Ok(())
}
