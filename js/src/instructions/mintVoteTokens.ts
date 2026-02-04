import { type TransactionSigner } from "@solana/kit";
import {
  getMintVoteTokensInstructionAsync,
  type MintVoteTokensInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface MintVoteTokensParams {
  signer: TransactionSigner;
  userPubkey: ByteArray;
  amount: bigint;
}

export async function mintVoteTokens(
  input: MintVoteTokensParams,
  config: ArciumConfig
): Promise<MintVoteTokensInstruction> {
  const { signer, userPubkey, amount } = input;

  return getMintVoteTokensInstructionAsync({
    ...getComputeAccounts("buy_vote_tokens", config),
    signer,
    userPubkey: toNumberArray(userPubkey),
    amount,
  });
}
