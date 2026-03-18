import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getIncreaseRewardPoolInstruction,
  type IncreaseRewardPoolInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface IncreaseRewardPoolParams extends BaseInstructionParams {
  authority: TransactionSigner;
  market: Address;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  newRewardAmount: bigint;
}

export function increaseRewardPool(
  input: IncreaseRewardPoolParams
): IncreaseRewardPoolInstruction<string> {
  const { programAddress, ...params } = input;
  return getIncreaseRewardPoolInstruction(
    params,
    programAddress ? { programAddress } : undefined
  );
}
