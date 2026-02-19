import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getSelectOptionInstruction,
  type SelectOptionInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface SelectOptionParams extends BaseInstructionParams {
  authority: TransactionSigner;
  market: Address;
  optionIndex: number;
}

export function selectOption(
  input: SelectOptionParams
): SelectOptionInstruction<string> {
  const { programAddress, ...params } = input;
  return getSelectOptionInstruction(
    params,
    programAddress ? { programAddress } : undefined
  );
}
