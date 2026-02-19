import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCloseShareAccountInstructionAsync,
  type CloseShareAccountInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface CloseShareAccountParams extends BaseInstructionParams {
  owner: TransactionSigner;
  market: Address;
  tokenMint: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  optionIndex: number;
  shareAccountId: number;
}

export async function closeShareAccount(
  input: CloseShareAccountParams
): Promise<CloseShareAccountInstruction<string>> {
  const { programAddress, ...params } = input;
  return getCloseShareAccountInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
