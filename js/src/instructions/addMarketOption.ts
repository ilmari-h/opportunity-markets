import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getAddMarketOptionInstructionAsync,
  type AddMarketOptionInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface AddMarketOptionParams {
  creator: TransactionSigner;
  market: Address;
  sourceVta: Address;
  shareAccount: Address;
  optionIndex: number;
  shareAccountId: number;
  name: string;
  amountCiphertext: ByteArray;
  userPubkey: ByteArray;
  inputNonce: bigint;
  authorizedReaderPubkey: ByteArray;
  authorizedReaderNonce: bigint;
}

export async function addMarketOption(
  input: AddMarketOptionParams,
  config: ArciumConfig,
): Promise<AddMarketOptionInstruction> {
  const {
    creator,
    market,
    sourceVta,
    shareAccount,
    optionIndex,
    shareAccountId,
    name,
    amountCiphertext,
    userPubkey,
    inputNonce,
    authorizedReaderPubkey,
    authorizedReaderNonce,
  } = input;

  return getAddMarketOptionInstructionAsync({
    ...getComputeAccounts("add_option_stake", config),
    creator,
    market,
    sourceVta,
    shareAccount,
    optionIndex,
    shareAccountId,
    name,
    amountCiphertext: toNumberArray(amountCiphertext),
    userPubkey: toNumberArray(userPubkey),
    inputNonce,
    authorizedReaderPubkey: toNumberArray(authorizedReaderPubkey),
    authorizedReaderNonce,
  });
}
