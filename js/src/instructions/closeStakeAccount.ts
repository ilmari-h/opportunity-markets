import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCloseStakeAccountInstructionAsync,
  type CloseStakeAccountInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface CloseStakeAccountParams extends BaseInstructionParams {
  owner: TransactionSigner;
  market: Address;
  tokenMint: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  optionIndex: number;
  stakeAccountId: number;
}

export async function closeStakeAccount(
  input: CloseStakeAccountParams
): Promise<CloseStakeAccountInstruction<string>> {
  const { programAddress, ...params } = input;
  return getCloseStakeAccountInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
