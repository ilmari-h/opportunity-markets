import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getWithdrawStakeDelegateInstructionAsync,
  type WithdrawStakeDelegateInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface WithdrawStakeDelegateParams extends BaseInstructionParams {
  owner: TransactionSigner;
  stakeAccount: Address;
  mint: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
}

export async function withdrawStakeDelegate(
  input: WithdrawStakeDelegateParams
): Promise<WithdrawStakeDelegateInstruction<string>> {
  const { programAddress, ...params } = input;
  return getWithdrawStakeDelegateInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
