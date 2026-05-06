import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitTokenVaultInstructionAsync,
  type InitTokenVaultInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitTokenVaultParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
}

export async function initTokenVault(
  input: InitTokenVaultParams
): Promise<InitTokenVaultInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitTokenVaultInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
