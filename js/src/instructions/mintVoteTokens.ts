import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getMintVoteTokensInstructionAsync,
  type MintVoteTokensInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";

export interface MintVoteTokensParams {
  signer: TransactionSigner;
  tokenMint: Address;
  /** The VoteTokenAccount to mint tokens into */
  voteTokenAccount: Address;
  signerTokenAccount: Address;
  tokenProgram: Address;
  amount: bigint;
}

export async function mintVoteTokens(
  input: MintVoteTokensParams,
  config: ArciumConfig
): Promise<MintVoteTokensInstruction> {
  const { signer, tokenMint, voteTokenAccount, signerTokenAccount, tokenProgram, amount } = input;

  return getMintVoteTokensInstructionAsync({
    ...getComputeAccounts("buy_vote_tokens", config),
    signer,
    tokenMint,
    voteTokenAccount,
    signerTokenAccount,
    tokenProgram,
    amount,
  });
}
