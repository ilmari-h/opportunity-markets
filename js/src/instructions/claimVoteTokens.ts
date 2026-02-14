import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getClaimVoteTokensInstructionAsync,
  type ClaimVoteTokensInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";

export interface ClaimVoteTokensParams {
  signer: TransactionSigner;
  tokenMint: Address;
  /** The VoteTokenAccount to claim tokens from */
  voteTokenAccount: Address;
  userTokenAccount: Address;
  tokenProgram: Address;
  amount: bigint;
}

export async function claimVoteTokens(
  input: ClaimVoteTokensParams,
  config: ArciumConfig
): Promise<ClaimVoteTokensInstruction> {
  const { signer, tokenMint, voteTokenAccount, userTokenAccount, tokenProgram, amount } = input;

  return getClaimVoteTokensInstructionAsync({
    ...getComputeAccounts("claim_vote_tokens", config),
    signer,
    tokenMint,
    voteTokenAccount,
    userTokenAccount,
    tokenProgram,
    amount,
  });
}
