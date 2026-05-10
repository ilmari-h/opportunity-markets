use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::{emit_ts, RewardClaimedEvent};
use crate::constants::{OPTION_SEED, STAKE_ACCOUNT_SEED, TOKEN_VAULT_SEED};
use crate::state::{OpportunityMarket, OpportunityMarketOption, StakeAccount, TokenVault};

#[derive(Accounts)]
#[instruction(option_id: u64, stake_account_id: u32)]
pub struct CloseStakeAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
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

    #[account(
        seeds = [TOKEN_VAULT_SEED, token_mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == token_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub token_vault: Account<'info, TokenVault>,

    /// Token vault ATA holding all program-held tokens for this mint
    /// (stakes, rewards, fees).
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = token_vault,
        associated_token::token_program = token_program,
    )]
    pub token_vault_ata: InterfaceAccount<'info, TokenAccount>,

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
    let stake_account = &ctx.accounts.stake_account;
    let market = &ctx.accounts.market;
    let option = &ctx.accounts.option;

    // Market must be resolved: winners selected
    require!(
        market.selected_options.is_some(),
        ErrorCode::MarketNotResolved
    );

    // Check that reveal period is over
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp as u64;

    let open_timestamp = market.open_timestamp.ok_or(ErrorCode::MarketNotOpen)?;
    let reveal_end = open_timestamp
        .checked_add(market.time_to_stake)
        .and_then(|t| t.checked_add(market.time_to_reveal))
        .ok_or(ErrorCode::Overflow)?;

    require!(current_time >= reveal_end, ErrorCode::MarketNotResolved);

    // If the stake was revealed and user staked on winning options, pay reward.
    // If reveal never ran, allow close with zero reward so the user can recover the stake_account rent.
    let mut user_reward: u64 = 0;
    if let Some(revealed_option) = stake_account.revealed_option {
        require!(
            revealed_option == option_id,
            ErrorCode::InvalidOptionId
        );

        // Check that this stake was for one of the winning options
        if let Some(winning) = market.selected_options.as_ref().and_then(|opts| opts.iter().find(|w| w.option_id == revealed_option)) {
            if stake_account.total_incremented {
                let user_score = stake_account.score.ok_or(ErrorCode::NotRevealed)?;
                let total_score = option.total_score;

                let reward_amount = market.reward_amount as u128;
                let percentage = winning.reward_percentage as u128;
                user_reward = (user_score as u128)
                    .checked_mul(reward_amount)
                    .ok_or(ErrorCode::Overflow)?
                    .checked_mul(percentage)
                    .ok_or(ErrorCode::Overflow)?
                    .checked_div(
                        (total_score as u128)
                            .checked_mul(100)
                            .ok_or(ErrorCode::Overflow)?
                    )
                    .ok_or(ErrorCode::Overflow)? as u64;
            }
        }
    }

    // If user has a reward, transfer from the token vault ATA.
    if user_reward > 0 {
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
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.token_vault.to_account_info(),
                },
                vault_seeds,
            ),
            user_reward,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    let staked_at_timestamp = stake_account.staked_at_timestamp.ok_or(ErrorCode::NotRevealed)?;
    let unstaked_at_timestamp = stake_account.unstaked_at_timestamp.unwrap_or(
        open_timestamp
            .checked_add(market.time_to_stake)
            .ok_or(ErrorCode::Overflow)?
    );
    let score = stake_account.score.unwrap_or(0);
    emit_ts!(RewardClaimedEvent {
        owner: ctx.accounts.owner.key(),
        market: market.key(),
        stake_account: stake_account.key(),
        stake_account_id: stake_account.id,
        option_id: option_id,
        stake_amount: stake_account.amount,
        reward_amount: user_reward,
        staked_at_timestamp: staked_at_timestamp,
        unstaked_at_timestamp: unstaked_at_timestamp,
        score: score,
    });

    Ok(())
}
