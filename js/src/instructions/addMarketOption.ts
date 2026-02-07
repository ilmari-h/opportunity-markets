import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getAddMarketOptionInstructionAsync,
  type AddMarketOptionInstruction,
} from "../generated";

export interface AddMarketOptionParams {
  creator: TransactionSigner;
  market: Address;
  optionIndex: number;
  name: string;
}

export async function addMarketOption(
  input: AddMarketOptionParams
): Promise<AddMarketOptionInstruction> {
  return getAddMarketOptionInstructionAsync(input);
}
