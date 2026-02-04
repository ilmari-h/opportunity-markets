import { type TransactionSigner } from "@solana/kit";
import {
  getClaimVoteTokensInstructionAsync,
  type ClaimVoteTokensInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface ClaimVoteTokensParams {
  signer: TransactionSigner;
  userPubkey: ByteArray;
  amount: bigint;
}

export async function claimVoteTokens(
  input: ClaimVoteTokensParams,
  config: ArciumConfig
): Promise<ClaimVoteTokensInstruction> {
  const { signer, userPubkey, amount } = input;

  return getClaimVoteTokensInstructionAsync({
    ...getComputeAccounts("claim_vote_tokens", config),
    signer,
    userPubkey: toNumberArray(userPubkey),
    amount,
  });
}
