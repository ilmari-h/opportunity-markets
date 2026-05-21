use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::{emit_ts, UpdateAuthorityChangedEvent};
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct SetUpdateAuthority<'info> {
    pub update_authority: Signer<'info>,

    #[account(
        mut,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// CHECK: Address-only; becomes the new update authority.
    pub new_authority: UncheckedAccount<'info>,
}

pub fn set_update_authority(ctx: Context<SetUpdateAuthority>) -> Result<()> {
    let old_value = ctx.accounts.platform_config.update_authority;
    let new_value = ctx.accounts.new_authority.key();
    ctx.accounts.platform_config.update_authority = new_value;

    emit_ts!(UpdateAuthorityChangedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        old_value: old_value,
        new_value: new_value,
    });

    Ok(())
}
