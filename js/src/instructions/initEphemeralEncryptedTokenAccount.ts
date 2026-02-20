import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitEphemeralEncryptedTokenAccountInstructionAsync,
  type InitEphemeralEncryptedTokenAccountInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitEphemeralEncryptedTokenAccountParams extends BaseInstructionParams {
  /** The signer/payer for the transaction (permissionless - anyone can call) */
  signer: TransactionSigner;
  /** The owner of the ETA (does not need to sign) */
  owner: Address;
  tokenMint: Address;
  /** The index for the ephemeral ETA (must be non-zero) */
  index: bigint;
  /** Random u128 nonce for initial encrypted state */
  stateNonce: bigint;
}

export async function initEphemeralEncryptedTokenAccount(
  input: InitEphemeralEncryptedTokenAccountParams
): Promise<InitEphemeralEncryptedTokenAccountInstruction<string>> {
  const { programAddress, signer, owner, tokenMint, index, stateNonce } = input;

  return getInitEphemeralEncryptedTokenAccountInstructionAsync(
    {
      signer,
      owner,
      tokenMint,
      index,
      stateNonce,
    },
    programAddress ? { programAddress } : undefined
  );
}
