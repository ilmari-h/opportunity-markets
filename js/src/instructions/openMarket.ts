import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getOpenMarketInstruction,
  type OpenMarketInstruction,
} from "../generated";

export interface OpenMarketParams {
  creator: TransactionSigner;
  market: Address;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  openTimestamp: bigint;
}

export function openMarket(input: OpenMarketParams): OpenMarketInstruction {
  return getOpenMarketInstruction(input);
}
