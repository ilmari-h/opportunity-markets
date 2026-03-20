import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitStakeAccountInstructionAsync,
  type InitStakeAccountInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitStakeAccountParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  stateNonce: bigint;
  stakeAccountId: number;
}

export async function initStakeAccount(
  input: InitStakeAccountParams
): Promise<InitStakeAccountInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitStakeAccountInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
