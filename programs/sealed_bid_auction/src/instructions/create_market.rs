use anchor_lang::prelude::*;

use crate::state::ConvictionMarket;
use crate::events::MarketCreatedEvent;

#[derive(Accounts)]
#[instruction(market_index: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + ConvictionMarket::INIT_SPACE,
        seeds = [b"conviction_market", creator.key().as_ref(), &market_index.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, ConvictionMarket>,
    pub system_program: Program<'info, System>,
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    market_index: u64,
    max_options: u16,
    reward_amount: u64,
    time_to_stake: u64,
    time_to_reveal: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.bump = ctx.bumps.market;
    market.creator = ctx.accounts.creator.key();
    market.index = market_index;
    market.total_options = 0;
    market.max_options = max_options;
    market.reward_amount = reward_amount;
    market.time_to_stake = time_to_stake;
    market.time_to_reveal = time_to_reveal;
    market.selected_option = None;

    emit!(MarketCreatedEvent {
        market: ctx.accounts.market.key(),
        creator: ctx.accounts.creator.key(),
        reward_amount: reward_amount,
        index: market_index,
    });

    Ok(())
}
