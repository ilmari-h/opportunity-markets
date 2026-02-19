import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getUnwrapEncryptedTokensInstructionAsync,
  type UnwrapEncryptedTokensInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type BaseInstructionParams } from "./instructionParams";

export interface UnwrapEncryptedTokensParams extends BaseInstructionParams {
  signer: TransactionSigner;
  tokenMint: Address;
  /** The EncryptedTokenAccount to unwrap tokens from */
  encryptedTokenAccount: Address;
  userTokenAccount: Address;
  tokenProgram: Address;
  amount: bigint;
}

export async function unwrapEncryptedTokens(
  input: UnwrapEncryptedTokensParams,
  config: ArciumConfig
): Promise<UnwrapEncryptedTokensInstruction<string>> {
  const { programAddress, signer, tokenMint, encryptedTokenAccount, userTokenAccount, tokenProgram, amount } = input;

  return getUnwrapEncryptedTokensInstructionAsync(
    {
      ...getComputeAccounts("unwrap_encrypted_tokens", config),
      signer,
      tokenMint,
      encryptedTokenAccount,
      userTokenAccount,
      tokenProgram,
      amount,
    },
    programAddress ? { programAddress } : undefined
  );
}
