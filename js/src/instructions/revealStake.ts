import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getRevealStakeInstructionAsync,
  type RevealStakeInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type BaseInstructionParams } from "./instructionParams";

export interface RevealStakeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  stakeAccountId: number;
}

export async function revealStake(
  input: RevealStakeParams,
  config: ArciumConfig
): Promise<RevealStakeInstruction<string>> {
  const { programAddress, signer, owner, market, stakeAccountId } = input;

  return getRevealStakeInstructionAsync(
    {
      ...getComputeAccounts("reveal_stake", config),
      signer,
      owner,
      market,
      stakeAccountId,
    },
    programAddress ? { programAddress } : undefined
  );
}
