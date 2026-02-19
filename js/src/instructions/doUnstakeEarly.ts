import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getDoUnstakeEarlyInstructionAsync,
  type DoUnstakeEarlyInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type BaseInstructionParams } from "./instructionParams";

export interface DoUnstakeEarlyParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  userEta: Address;
  shareAccountId: number;
  shareAccountOwner: Address;
}

export async function doUnstakeEarly(
  input: DoUnstakeEarlyParams,
  config: ArciumConfig
): Promise<DoUnstakeEarlyInstruction<string>> {
  const { programAddress, signer, market, userEta, shareAccountId, shareAccountOwner } = input;

  return getDoUnstakeEarlyInstructionAsync(
    {
      ...getComputeAccounts("unstake_early", config),
      signer,
      market,
      userEta,
      shareAccountId,
      shareAccountOwner,
    },
    programAddress ? { programAddress } : undefined
  );
}
