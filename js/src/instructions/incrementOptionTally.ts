import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getIncrementOptionTallyInstructionAsync,
  type IncrementOptionTallyInstruction,
} from "../generated";

export interface IncrementOptionTallyParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  optionIndex: number;
}

export async function incrementOptionTally(
  input: IncrementOptionTallyParams
): Promise<IncrementOptionTallyInstruction> {
  return getIncrementOptionTallyInstructionAsync(input);
}
