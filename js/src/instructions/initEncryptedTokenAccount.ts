import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitEncryptedTokenAccountInstructionAsync,
  type InitEncryptedTokenAccountInstruction,
} from "../generated";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitEncryptedTokenAccountParams extends BaseInstructionParams {
  /** The signer/payer for the transaction */
  signer: TransactionSigner;
  tokenMint: Address;
  /** User's x25519 public key (32 bytes) for encryption */
  userPubkey: ByteArray;
  /** Random u128 nonce for initial encrypted state */
  stateNonce: bigint;
}

export async function initEncryptedTokenAccount(
  input: InitEncryptedTokenAccountParams
): Promise<InitEncryptedTokenAccountInstruction<string>> {
  const { programAddress, signer, tokenMint, userPubkey, stateNonce } = input;

  return getInitEncryptedTokenAccountInstructionAsync(
    {
      signer,
      tokenMint,
      userPubkey: toNumberArray(userPubkey),
      stateNonce,
    },
    programAddress ? { programAddress } : undefined
  );
}
