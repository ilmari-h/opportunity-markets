import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitShareAccountInstructionAsync,
  type InitShareAccountInstruction,
} from "../generated";

export interface InitShareAccountParams {
  signer: TransactionSigner;
  market: Address;
  stateNonce: bigint;
}

export async function initShareAccount(
  input: InitShareAccountParams
): Promise<InitShareAccountInstruction> {
  return getInitShareAccountInstructionAsync(input);
}
