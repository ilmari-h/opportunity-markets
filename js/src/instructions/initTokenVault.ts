import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitTokenVaultInstructionAsync,
  type InitTokenVaultInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitTokenVaultParams extends BaseInstructionParams {
  payer: TransactionSigner;
  tokenMint: Address;
}

export async function initTokenVault(
  input: InitTokenVaultParams
): Promise<InitTokenVaultInstruction<string>> {
  const { programAddress, payer, tokenMint } = input;

  return getInitTokenVaultInstructionAsync(
    {
      payer,
      tokenMint,
    },
    programAddress ? { programAddress } : undefined
  );
}
