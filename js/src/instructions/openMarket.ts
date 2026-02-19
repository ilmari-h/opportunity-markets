import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getOpenMarketInstruction,
  type OpenMarketInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface OpenMarketParams extends BaseInstructionParams {
  creator: TransactionSigner;
  market: Address;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  openTimestamp: bigint;
}

export function openMarket(
  input: OpenMarketParams
): OpenMarketInstruction<string> {
  const { programAddress, ...params } = input;
  return getOpenMarketInstruction(
    params,
    programAddress ? { programAddress } : undefined
  );
}
