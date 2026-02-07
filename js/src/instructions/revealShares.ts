import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getRevealSharesInstructionAsync,
  type RevealSharesInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface RevealSharesParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  userVta: Address;
  userPubkey: ByteArray;
}

export async function revealShares(
  input: RevealSharesParams,
  config: ArciumConfig
): Promise<RevealSharesInstruction> {
  const { signer, owner, market, userVta, userPubkey } = input;

  return getRevealSharesInstructionAsync({
    ...getComputeAccounts("reveal_shares", config),
    signer,
    owner,
    market,
    userVta,
    userPubkey: toNumberArray(userPubkey),
  });
}
