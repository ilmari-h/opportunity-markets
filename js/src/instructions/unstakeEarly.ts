import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getUnstakeEarlyInstructionAsync,
  type UnstakeEarlyInstruction,
} from "../generated";

export interface UnstakeEarlyParams {
  signer: TransactionSigner;
  market: Address;
  shareAccountId: number;
}

export async function unstakeEarly(
  input: UnstakeEarlyParams
): Promise<UnstakeEarlyInstruction> {
  const { signer, market, shareAccountId } = input;

  return getUnstakeEarlyInstructionAsync({
    signer,
    market,
    shareAccountId,
  });
}
