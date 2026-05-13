use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, FeesClaimedEvent};
use crate::constants::OPPORTUNITY_MARKET_SEED;
use crate::state::{OpportunityMarket, PlatformConfig};

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [OPPORTUNITY_MARKET_SEED, market.creator.as_ref(), &market.index.to_le_bytes()],
        bump = market.bump,
        constraint = market.collected_platform_fees > 0 @ ErrorCode::NoFeesToClaim,
        constraint = market.platform == platform_config.key() @ ErrorCode::Unauthorized,
    )]
    pub market: Box<Account<'info, OpportunityMarket>>,

    #[account(
        constraint = platform_config.fee_claim_authority == signer.key() @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Box<Account<'info, PlatformConfig>>,

    #[account(address = market.mint)]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program,
    )]
    pub destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
    let fees = ctx.accounts.market.collected_platform_fees;

    let creator = ctx.accounts.market.creator;
    let index_bytes = ctx.accounts.market.index.to_le_bytes();
    let market_bump = ctx.accounts.market.bump;
    let market_seeds: &[&[&[u8]]] = &[&[
        OPPORTUNITY_MARKET_SEED,
        creator.as_ref(),
        &index_bytes,
        &[market_bump],
    ]];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.market_token_ata.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            market_seeds,
        ),
        fees,
        ctx.accounts.token_mint.decimals,
    )?;

    ctx.accounts.market.collected_platform_fees = 0;

    emit_ts!(FeesClaimedEvent {
        market: ctx.accounts.market.key(),
        platform: ctx.accounts.platform_config.key(),
        mint: ctx.accounts.token_mint.key(),
        destination: ctx.accounts.destination_token_account.key(),
        amount: fees,
    });

    Ok(())
}
