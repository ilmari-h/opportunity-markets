import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitShareAccountInstructionAsync,
  type InitShareAccountInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitShareAccountParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  stateNonce: bigint;
  shareAccountId: number;
}

export async function initShareAccount(
  input: InitShareAccountParams
): Promise<InitShareAccountInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitShareAccountInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
