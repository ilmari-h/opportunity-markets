import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getPauseStakingInstruction,
  type PauseStakingInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface PauseStakingParams extends BaseInstructionParams {
  marketAuthority: TransactionSigner;
  market: Address;
}

export function pauseStaking(
  input: PauseStakingParams,
): PauseStakingInstruction<string> {
  const { programAddress, ...params } = input;
  return getPauseStakingInstruction(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
