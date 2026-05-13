use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, RewardClaimedEvent};
use crate::constants::{OPPORTUNITY_MARKET_SEED, OPTION_SEED, STAKE_ACCOUNT_SEED};
use crate::state::{OpportunityMarket, OpportunityMarketOption, StakeAccount};

#[derive(Accounts)]
#[instruction(option_id: u64, stake_account_id: u32)]
pub struct CloseStakeAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [OPPORTUNITY_MARKET_SEED, market.creator.as_ref(), &market.index.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, OpportunityMarket>,

    #[account(
        mut,
        seeds = [STAKE_ACCOUNT_SEED, owner.key().as_ref(), market.key().as_ref(), &stake_account_id.to_le_bytes()],
        bump = stake_account.bump,
        close = owner,
        // Staked tokens must have been returned before closing
        constraint = stake_account.stake_reclaimed
            || stake_account.unstaked_at_timestamp.is_some()
            @ ErrorCode::InvalidAccountState,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        seeds = [OPTION_SEED, market.key().as_ref(), &option_id.to_le_bytes()],
        bump = option.bump,
    )]
    pub option: Account<'info, OpportunityMarketOption>,

    #[account(address = market.mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Market-owned ATA holding all program-held tokens for this market
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub market_token_ata: InterfaceAccount<'info, TokenAccount>,

    /// Owner's token account to receive rewards
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn close_stake_account(ctx: Context<CloseStakeAccount>, option_id: u64, _stake_account_id: u32) -> Result<()> {
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    let open_timestamp = ctx.accounts.market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;
    let stake_end = open_timestamp
        .checked_add(ctx.accounts.market.time_to_stake)
        .ok_or(ErrorCode::Overflow)?;
    let reveal_end = stake_end
        .checked_add(ctx.accounts.market.time_to_reveal)
        .ok_or(ErrorCode::Overflow)?;
    let select_deadline = stake_end
        .checked_add(ctx.accounts.market.market_resolution_deadline_seconds)
        .ok_or(ErrorCode::Overflow)?;

    let resolved = ctx.accounts.market.resolved;
    let expired = !resolved && current_time >= select_deadline;
    require!(resolved || expired, ErrorCode::MarketNotResolved);

    let payout: u64 = if resolved {
        // Market resolved — reveal period must be over.
        require!(current_time >= reveal_end, ErrorCode::MarketNotResolved);

        let revealed_option = ctx
            .accounts
            .stake_account
            .revealed_option
            .ok_or(ErrorCode::NotRevealed)?;
        require!(revealed_option == option_id, ErrorCode::InvalidOptionId);

        compute_user_reward(
            &ctx.accounts.stake_account,
            &ctx.accounts.market,
            &ctx.accounts.option,
        )?
    } else {
        // Market expired: refund reward_pool_fee + creator_fee.
        let reward_pool_fee = ctx.accounts.stake_account.reward_pool_fee;
        let creator_fee = ctx.accounts.stake_account.creator_fee;
        let market = &mut ctx.accounts.market;
        market.reward_amount = market
            .reward_amount
            .checked_sub(reward_pool_fee)
            .ok_or(ErrorCode::Overflow)?;
        market.collected_creator_fees = market
            .collected_creator_fees
            .checked_sub(creator_fee)
            .ok_or(ErrorCode::Overflow)?;
        reward_pool_fee
            .checked_add(creator_fee)
            .ok_or(ErrorCode::Overflow)?
    };

    if payout > 0 {
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
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                market_seeds,
            ),
            payout,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    let stake_account = &ctx.accounts.stake_account;
    let staked_at_timestamp = stake_account.staked_at_timestamp.unwrap_or(stake_end);
    let unstaked_at_timestamp = stake_account.unstaked_at_timestamp.unwrap_or(stake_end);
    let score = stake_account.score.unwrap_or(0);
    emit_ts!(RewardClaimedEvent {
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        stake_account: stake_account.key(),
        stake_account_id: stake_account.id,
        option_id: option_id,
        stake_amount: stake_account.amount,
        reward_amount: if resolved { payout } else { 0 },
        staked_at_timestamp: staked_at_timestamp,
        unstaked_at_timestamp: unstaked_at_timestamp,
        score: score,
    });

    Ok(())
}

fn compute_user_reward(
    stake_account: &Account<StakeAccount>,
    market: &Account<OpportunityMarket>,
    option: &Account<OpportunityMarketOption>,
) -> Result<u64> {
    if !option.selected {
        return Ok(0);
    }

    if !stake_account.total_incremented {
        return Ok(0);
    }

    let user_score = stake_account.score.ok_or(ErrorCode::NotRevealed)?;
    let total_score = option.total_score;

    let reward = (user_score as u128)
        .checked_mul(market.reward_amount as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_mul(option.reward_percentage as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(
            (total_score as u128)
                .checked_mul(100)
                .ok_or(ErrorCode::Overflow)?,
        )
        .ok_or(ErrorCode::Overflow)? as u64;

    Ok(reward)
}
