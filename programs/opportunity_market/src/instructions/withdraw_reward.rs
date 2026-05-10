use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, RewardWithdrawnEvent};
use crate::constants::{SPONSOR_SEED, TOKEN_VAULT_SEED};
use crate::state::{OpportunityMarket, OpportunityMarketSponsor, TokenVault};

#[derive(Accounts)]
pub struct WithdrawReward<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, OpportunityMarket>,

    #[account(
        mut,
        seeds = [SPONSOR_SEED, sponsor.key().as_ref(), market.key().as_ref()],
        bump = sponsor_account.bump,
        close = sponsor,
    )]
    pub sponsor_account: Account<'info, OpportunityMarketSponsor>,

    #[account(address = market.mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub token_vault: Account<'info, TokenVault>,

    /// Token vault ATA holding all program-held tokens for this mint.
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault,
        associated_token::token_program = token_program,
    )]
    pub token_vault_ata: InterfaceAccount<'info, TokenAccount>,

    /// Sponsor's destination for refunded reward tokens
    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program,
    )]
    pub refund_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_reward(ctx: Context<WithdrawReward>) -> Result<()> {
    let sponsor_account = &ctx.accounts.sponsor_account;

    // Locked sponsors cannot withdraw
    require!(!sponsor_account.reward_locked, ErrorCode::Unauthorized);

    let market = &ctx.accounts.market;

    // Allow anytime before staking ends
    if let Some(open_timestamp) = market.open_timestamp {
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp as u64;
        let stake_end = open_timestamp
            .checked_add(market.time_to_stake)
            .ok_or(ErrorCode::Overflow)?;
        require!(current_timestamp < stake_end, ErrorCode::StakeWindowMismatch);
    }

    let reward_amount = sponsor_account.reward_deposited;

    if reward_amount > 0 {
        let vault_bump = ctx.accounts.token_vault.bump;
        let mint_key = ctx.accounts.token_mint.key();
        let vault_seeds: &[&[&[u8]]] = &[&[
            TOKEN_VAULT_SEED,
            mint_key.as_ref(),
            &[vault_bump],
        ]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault_ata.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.refund_token_account.to_account_info(),
                    authority: ctx.accounts.token_vault.to_account_info(),
                },
                vault_seeds,
            ),
            reward_amount,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    let market = &mut ctx.accounts.market;
    market.reward_amount = market
        .reward_amount
        .checked_sub(reward_amount)
        .ok_or(ErrorCode::Overflow)?;

    emit_ts!(RewardWithdrawnEvent {
        market: market.key(),
        sponsor: ctx.accounts.sponsor.key(),
        reward_amount: reward_amount,
        refund_token_account: ctx.accounts.refund_token_account.key(),
    });

    Ok(())
}
