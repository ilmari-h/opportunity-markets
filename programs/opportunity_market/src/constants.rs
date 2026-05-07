use anchor_lang::prelude::Pubkey;
use anchor_lang::pubkey;

pub const MAX_PROTOCOL_FEE_BP: u16 = 500;

/// Must match the keypair used to deploy the program. Update before mainnet deploy.
pub const DEPLOYER_AUTHORITY: Pubkey = pubkey!("GrSg7Cw3vDKCyqFXy3djdADAuZpiK37rmHh7LY3dN3Gq");

/// Fixed timelock delay: 48 hours
pub const TIMELOCK_DELAY_SECONDS: i64 = 48 * 60 * 60;

/// PDA seeds
pub const CENTRAL_STATE_SEED: &[u8] = b"central_state";
pub const OPPORTUNITY_MARKET_SEED: &[u8] = b"opportunity_market";
pub const OPTION_SEED: &[u8] = b"option";
pub const STAKE_ACCOUNT_SEED: &[u8] = b"stake_account";
pub const SPONSOR_SEED: &[u8] = b"sponsor";
pub const TIMELOCKED_CHANGE_SEED: &[u8] = b"timelocked_change";
pub const UPDATE_AUTHORITY_SEED: &[u8] = b"update_authority";
pub const FEE_CLAIMER_SEED: &[u8] = b"fee_claimer";
pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";
