use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

use crate::ID;


#[init_computation_definition_accounts("init_vote_token_account", payer)]
#[derive(Accounts)]
pub struct InitVoteTokenAccountCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_vote_token_account_comp_def(ctx: Context<InitVoteTokenAccountCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/init_vote_token_account.arcis".to_string(),
                hash: circuit_hash!("init_vote_token_account"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}

#[init_computation_definition_accounts("buy_vote_tokens", payer)]
#[derive(Accounts)]
pub struct BuyVoteTokensCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn buy_vote_tokens_comp_def(ctx: Context<BuyVoteTokensCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/buy_vote_tokens.arcis".to_string(),
                hash: circuit_hash!("buy_vote_tokens"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}

#[init_computation_definition_accounts("claim_vote_tokens", payer)]
#[derive(Accounts)]
pub struct ClaimVoteTokensCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn claim_vote_tokens_comp_def(ctx: Context<ClaimVoteTokensCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/claim_vote_tokens.arcis".to_string(),
                hash: circuit_hash!("claim_vote_tokens"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}

#[init_computation_definition_accounts("buy_opportunity_market_shares", payer)]
#[derive(Accounts)]
pub struct BuyOpportunityMarketSharesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn buy_opportunity_market_shares_comp_def(ctx: Context<BuyOpportunityMarketSharesCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/buy_opportunity_market_shares.arcis".to_string(),
                hash: circuit_hash!("buy_opportunity_market_shares"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}

#[init_computation_definition_accounts("init_market_shares", payer)]
#[derive(Accounts)]
pub struct InitMarketSharesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_market_shares_comp_def(ctx: Context<InitMarketSharesCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/init_market_shares.arcis".to_string(),
                hash: circuit_hash!("init_market_shares"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}

#[init_computation_definition_accounts("reveal_shares", payer)]
#[derive(Accounts)]
pub struct RevealSharesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: address_lookup_table, checked by arcium program.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: lut_program is the Address Lookup Table program.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn reveal_shares_comp_def(ctx: Context<RevealSharesCompDef>) -> Result<()> {
    #[cfg(feature = "hosted-compdefs")]
    {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev/reveal_shares.arcis".to_string(),
                hash: circuit_hash!("reveal_shares"),
            })),
            None,
        )?;
    }
    #[cfg(not(feature = "hosted-compdefs"))]
    {
        init_comp_def(ctx.accounts, None, None)?;
    }
    Ok(())
}
