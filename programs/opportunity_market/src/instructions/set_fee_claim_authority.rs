use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, FeeClaimAuthorityChangedEvent};
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct SetFeeClaimAuthority<'info> {
    pub update_authority: Signer<'info>,

    #[account(
        mut,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// CHECK: Address-only; becomes the new fee-claim authority.
    pub new_fee_claim_authority: UncheckedAccount<'info>,
}

pub fn set_fee_claim_authority(ctx: Context<SetFeeClaimAuthority>) -> Result<()> {
    let old_value = ctx.accounts.platform_config.fee_claim_authority;
    let new_value = ctx.accounts.new_fee_claim_authority.key();
    ctx.accounts.platform_config.fee_claim_authority = new_value;

    emit_ts!(FeeClaimAuthorityChangedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        old_value: old_value,
        new_value: new_value,
    });

    Ok(())
}
