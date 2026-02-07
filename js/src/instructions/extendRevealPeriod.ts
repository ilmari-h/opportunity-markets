import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getExtendRevealPeriodInstruction,
  type ExtendRevealPeriodInstruction,
} from "../generated";

export interface ExtendRevealPeriodParams {
  authority: TransactionSigner;
  market: Address;
  newTimeToReveal: bigint;
}

export function extendRevealPeriod(
  input: ExtendRevealPeriodParams
): ExtendRevealPeriodInstruction {
  return getExtendRevealPeriodInstruction(input);
}
