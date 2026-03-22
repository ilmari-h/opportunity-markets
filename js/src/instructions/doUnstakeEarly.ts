import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getDoUnstakeEarlyInstructionAsync,
  type DoUnstakeEarlyInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface DoUnstakeEarlyParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  tokenMint: Address;
  marketTokenAta: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  stakeAccountId: number;
  stakeAccountOwner: Address;
}

export async function doUnstakeEarly(
  input: DoUnstakeEarlyParams,
): Promise<DoUnstakeEarlyInstruction<string>> {
  const { programAddress, ...params } = input;

  return getDoUnstakeEarlyInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
