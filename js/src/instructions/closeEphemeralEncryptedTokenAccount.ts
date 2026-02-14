import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCloseEphemeralEncryptedTokenAccountInstructionAsync,
  type CloseEphemeralEncryptedTokenAccountInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";

export interface CloseEphemeralEncryptedTokenAccountParams {
  /** Signer must be the ETA owner */
  signer: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
  /** Index of the ephemeral ETA to close (must be non-zero) */
  index: bigint;
  /** Address that will receive the rent lamports (must match rent_payer stored in the ephemeral ETA) */
  rentRecipient: Address;
}

export async function closeEphemeralEncryptedTokenAccount(
  input: CloseEphemeralEncryptedTokenAccountParams,
  config: ArciumConfig
): Promise<CloseEphemeralEncryptedTokenAccountInstruction> {
  const { signer, tokenMint, tokenProgram, index, rentRecipient } = input;

  return getCloseEphemeralEncryptedTokenAccountInstructionAsync({
    ...getComputeAccounts("close_ephemeral_encrypted_token_account", config),
    signer,
    tokenMint,
    tokenProgram,
    index,
    rentRecipient,
  });
}
