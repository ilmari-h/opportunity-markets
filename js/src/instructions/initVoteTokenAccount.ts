import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitVoteTokenAccountInstructionAsync,
  type InitVoteTokenAccountInstruction,
} from "../generated";
import { ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface InitVoteTokenAccountParams {
  /** The signer/payer for the transaction */
  signer: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
  /** User's x25519 public key (32 bytes) for encryption */
  userPubkey: ByteArray;
  /** Nonce for encryption (16 bytes as bigint) */
  nonce: bigint;
}

export async function initVoteTokenAccount(
  input: InitVoteTokenAccountParams,
  config: ArciumConfig
): Promise<InitVoteTokenAccountInstruction> {
  const { signer, tokenMint, tokenProgram, userPubkey, nonce } = input;

  return getInitVoteTokenAccountInstructionAsync({
    signer,
    tokenMint,
    tokenProgram,
    ...getComputeAccounts("init_vote_token_account", config),
    userPubkey: toNumberArray(userPubkey),
    nonce,
  });
}
