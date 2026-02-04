import { type TransactionSigner } from "@solana/kit";
import {
  getInitVoteTokenAccountInstructionAsync,
  type InitVoteTokenAccountInstruction,
} from "../generated";
import { ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface InitVoteTokenAccountParams {
  /** The signer/payer for the transaction */
  signer: TransactionSigner;
  /** User's x25519 public key (32 bytes) for encryption */
  userPubkey: ByteArray;
  /** Nonce for encryption (16 bytes as bigint) */
  nonce: bigint;
}

export async function initVoteTokenAccount(
  input: InitVoteTokenAccountParams,
  config: ArciumConfig
): Promise<InitVoteTokenAccountInstruction> {
  const { signer, userPubkey, nonce } = input;

  return getInitVoteTokenAccountInstructionAsync({
    signer,
    ...getComputeAccounts("init_vote_token_account", config),
    userPubkey: toNumberArray(userPubkey),
    nonce,
  });
}
