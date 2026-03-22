import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getReclaimStakeInstructionAsync,
  type ReclaimStakeInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ReclaimStakeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  tokenMint: Address;
  marketTokenAta: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  stakeAccountId: number;
}

export async function reclaimStake(
  input: ReclaimStakeParams,
): Promise<ReclaimStakeInstruction<string>> {
  const { programAddress, ...params } = input;

  return getReclaimStakeInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
