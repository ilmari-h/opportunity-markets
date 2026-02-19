import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getRevealSharesInstructionAsync,
  type RevealSharesInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type BaseInstructionParams } from "./instructionParams";

export interface RevealSharesParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  userEta: Address;
  shareAccountId: number;
}

export async function revealShares(
  input: RevealSharesParams,
  config: ArciumConfig
): Promise<RevealSharesInstruction<string>> {
  const { programAddress, signer, owner, market, userEta, shareAccountId } = input;

  return getRevealSharesInstructionAsync(
    {
      ...getComputeAccounts("reveal_shares", config),
      signer,
      owner,
      market,
      userEta,
      shareAccountId,
    },
    programAddress ? { programAddress } : undefined
  );
}
