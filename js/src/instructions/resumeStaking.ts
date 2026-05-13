import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getResumeStakingInstruction,
  type ResumeStakingInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ResumeStakingParams extends BaseInstructionParams {
  marketAuthority: TransactionSigner;
  market: Address;
}

export function resumeStaking(
  input: ResumeStakingParams,
): ResumeStakingInstruction<string> {
  const { programAddress, ...params } = input;
  return getResumeStakingInstruction(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
