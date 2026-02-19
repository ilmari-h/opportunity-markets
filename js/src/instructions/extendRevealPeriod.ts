import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getExtendRevealPeriodInstruction,
  type ExtendRevealPeriodInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ExtendRevealPeriodParams extends BaseInstructionParams {
  authority: TransactionSigner;
  market: Address;
  newTimeToReveal: bigint;
}

export function extendRevealPeriod(
  input: ExtendRevealPeriodParams
): ExtendRevealPeriodInstruction<string> {
  const { programAddress, ...params } = input;
  return getExtendRevealPeriodInstruction(
    params,
    programAddress ? { programAddress } : undefined
  );
}
