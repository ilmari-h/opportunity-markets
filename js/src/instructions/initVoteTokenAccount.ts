import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitVoteTokenAccountInstructionAsync,
  type InitVoteTokenAccountInstruction,
} from "../generated";
import { type ByteArray, toNumberArray } from "../utils";

export interface InitVoteTokenAccountParams {
  /** The signer/payer for the transaction */
  signer: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
  /** User's x25519 public key (32 bytes) for encryption */
  userPubkey: ByteArray;
}

export async function initVoteTokenAccount(
  input: InitVoteTokenAccountParams
): Promise<InitVoteTokenAccountInstruction> {
  const { signer, tokenMint, tokenProgram, userPubkey } = input;

  return getInitVoteTokenAccountInstructionAsync({
    signer,
    tokenMint,
    tokenProgram,
    userPubkey: toNumberArray(userPubkey),
  });
}
