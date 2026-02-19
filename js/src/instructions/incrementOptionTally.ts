import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getIncrementOptionTallyInstructionAsync,
  type IncrementOptionTallyInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface IncrementOptionTallyParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  optionIndex: number;
  shareAccountId: number;
}

export async function incrementOptionTally(
  input: IncrementOptionTallyParams
): Promise<IncrementOptionTallyInstruction<string>> {
  const { programAddress, ...params } = input;
  return getIncrementOptionTallyInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
