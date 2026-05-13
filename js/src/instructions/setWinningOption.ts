import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getSetWinningOptionInstructionAsync,
  type SetWinningOptionInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface SetWinningOptionParams extends BaseInstructionParams {
  marketAuthority: TransactionSigner;
  market: Address;
  optionId: number | bigint;
  rewardPercentage: number;
}

export async function setWinningOption(
  input: SetWinningOptionParams,
): Promise<SetWinningOptionInstruction<string>> {
  const { programAddress, ...params } = input;
  return getSetWinningOptionInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
