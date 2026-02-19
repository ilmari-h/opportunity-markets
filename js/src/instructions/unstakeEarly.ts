import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getUnstakeEarlyInstructionAsync,
  type UnstakeEarlyInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface UnstakeEarlyParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  shareAccountId: number;
}

export async function unstakeEarly(
  input: UnstakeEarlyParams
): Promise<UnstakeEarlyInstruction<string>> {
  const { programAddress, ...params } = input;
  return getUnstakeEarlyInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
