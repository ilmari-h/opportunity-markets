import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getAddMarketOptionAsCreatorInstructionAsync,
  type AddMarketOptionAsCreatorInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface AddMarketOptionAsCreatorParams extends BaseInstructionParams {
  creator: TransactionSigner;
  market: Address;
  optionIndex: number;
  name: string;
}

export async function addMarketOptionAsCreator(
  input: AddMarketOptionAsCreatorParams
): Promise<AddMarketOptionAsCreatorInstruction<string>> {
  const { programAddress, ...params } = input;
  return getAddMarketOptionAsCreatorInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
