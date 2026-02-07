import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCloseShareAccountInstructionAsync,
  type CloseShareAccountInstruction,
} from "../generated";

export interface CloseShareAccountParams {
  owner: TransactionSigner;
  market: Address;
  tokenMint: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  optionIndex: number;
}

export async function closeShareAccount(
  input: CloseShareAccountParams
): Promise<CloseShareAccountInstruction> {
  return getCloseShareAccountInstructionAsync(input);
}
