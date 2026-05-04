import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitStakeDelegateInstructionAsync,
  type InitStakeDelegateInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitStakeDelegateParams extends BaseInstructionParams {
  owner: TransactionSigner;
  stakeAccount: Address;
  market: Address;
  mint: Address;
  tokenProgram: Address;
  /** Defaults to the stake_account owner when null. */
  authority: Address | null;
}

export async function initStakeDelegate(
  input: InitStakeDelegateParams
): Promise<InitStakeDelegateInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitStakeDelegateInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
