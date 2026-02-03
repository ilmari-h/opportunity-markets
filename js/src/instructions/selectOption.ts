import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getSelectOptionInstruction,
  type SelectOptionInstruction,
} from "../generated";

export interface SelectOptionParams {
  authority: TransactionSigner;
  market: Address;
  optionIndex: number;
}

export function selectOption(input: SelectOptionParams): SelectOptionInstruction {
  return getSelectOptionInstruction(input);
}
