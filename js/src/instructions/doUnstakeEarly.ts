import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getDoUnstakeEarlyInstructionAsync,
  type DoUnstakeEarlyInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";

export interface DoUnstakeEarlyParams {
  signer: TransactionSigner;
  market: Address;
  userEta: Address;
  shareAccountId: number;
  shareAccountOwner: Address;
}

export async function doUnstakeEarly(
  input: DoUnstakeEarlyParams,
  config: ArciumConfig
): Promise<DoUnstakeEarlyInstruction> {
  const { signer, market, userEta, shareAccountId, shareAccountOwner } = input;

  return getDoUnstakeEarlyInstructionAsync({
    ...getComputeAccounts("unstake_early", config),
    signer,
    market,
    userEta,
    shareAccountId,
    shareAccountOwner,
  });
}
