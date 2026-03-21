import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getAddMarketOptionInstructionAsync,
  type AddMarketOptionInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface AddMarketOptionParams extends BaseInstructionParams {
  creator: TransactionSigner;
  market: Address;
  optionId: number | bigint;
}

export async function addMarketOption(
  input: AddMarketOptionParams
): Promise<AddMarketOptionInstruction<string>> {
  const { programAddress, ...params } = input;
  return getAddMarketOptionInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
