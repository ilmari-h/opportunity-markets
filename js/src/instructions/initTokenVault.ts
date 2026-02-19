import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitTokenVaultInstructionAsync,
  type InitTokenVaultInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitTokenVaultParams extends BaseInstructionParams {
  /** The signer/payer for the transaction */
  payer: TransactionSigner;
  /** Address that can withdraw tokens from the vault */
  fundManager: Address;
}

export async function initTokenVault(
  input: InitTokenVaultParams
): Promise<InitTokenVaultInstruction<string>> {
  const { programAddress, payer, fundManager } = input;

  return getInitTokenVaultInstructionAsync(
    {
      payer,
      fundManager,
    },
    programAddress ? { programAddress } : undefined
  );
}
