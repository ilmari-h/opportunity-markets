use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::constants::STAKE_DELEGATE_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, StakeDelegateClosedEvent};
use crate::state::{StakeAccount, StakeDelegate};

#[derive(Accounts)]
pub struct WithdrawStakeDelegate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        constraint = stake_account.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(address = stake_delegate_ata.mint @ ErrorCode::InvalidMint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        close = owner,
        seeds = [STAKE_DELEGATE_SEED, stake_account.key().as_ref()],
        bump = stake_delegate.bump,
        constraint = stake_delegate.stake_account == stake_account.key() @ ErrorCode::Unauthorized,
    )]
    pub stake_delegate: Box<Account<'info, StakeDelegate>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = stake_delegate,
        associated_token::token_program = token_program,
    )]
    pub stake_delegate_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_stake_delegate(ctx: Context<WithdrawStakeDelegate>) -> Result<()> {
    let stake_account_key = ctx.accounts.stake_account.key();
    let bump = ctx.accounts.stake_delegate.bump;
    let seeds: &[&[&[u8]]] = &[&[
        STAKE_DELEGATE_SEED,
        stake_account_key.as_ref(),
        &[bump],
    ]];

    let amount = ctx.accounts.stake_delegate_ata.amount;

    if amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.stake_delegate_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.stake_delegate.to_account_info(),
                },
                seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
    }

    // Close the ATA, returning its rent to the owner.
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.stake_delegate_ata.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.stake_delegate.to_account_info(),
        },
        seeds,
    ))?;

    emit_ts!(StakeDelegateClosedEvent {
        stake_delegate: ctx.accounts.stake_delegate.key(),
        stake_account: stake_account_key,
        owner: ctx.accounts.owner.key(),
        withdrawn_amount: amount,
    });

    Ok(())
}
