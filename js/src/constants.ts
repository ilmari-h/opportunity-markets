import { PublicKey } from "@solana/web3.js";

/**
 * Program ID for the Conviction Markets program on Solana devnet
 */
export const PROGRAM_ID = new PublicKey(
  "berV8jT2dwpZe4HP4PKej7z8kTXo4ziU3rt6zKSvJ8z"
);

/**
 * Price per vote token in lamports (0.001 SOL)
 */
export const PRICE_PER_VOTE_TOKEN_LAMPORTS = 1_000_000;

/**
 * PDA seed strings for account derivation
 */
export const CONVICTION_MARKET_SEED = "conviction_market";
export const VOTE_TOKEN_ACCOUNT_SEED = "vote_token_account";
export const SHARE_ACCOUNT_SEED = "share_account";
export const OPTION_SEED = "option";

/**
 * Computation definition offsets for MPC circuits
 * These match the offsets defined in the on-chain program
 */
export const COMP_DEF_OFFSETS = {
  INIT_VOTE_TOKEN_ACCOUNT: "init_vote_token_account",
  BUY_VOTE_TOKENS: "buy_vote_tokens",
  CLAIM_VOTE_TOKENS: "claim_vote_tokens",
  BUY_CONVICTION_MARKET_SHARES: "buy_conviction_market_shares",
  INIT_MARKET_SHARES: "init_market_shares",
  REVEAL_SHARES: "reveal_shares",
} as const;
