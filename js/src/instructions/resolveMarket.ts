import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getResolveMarketInstruction,
  type ResolveMarketInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ResolveMarketParams extends BaseInstructionParams {
  marketAuthority: TransactionSigner;
  market: Address;
}

export function resolveMarket(
  input: ResolveMarketParams,
): ResolveMarketInstruction<string> {
  const { programAddress, ...params } = input;
  return getResolveMarketInstruction(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
