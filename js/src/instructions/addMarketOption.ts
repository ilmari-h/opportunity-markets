import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getAddMarketOptionInstructionAsync,
  type AddMarketOptionInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";

export interface AddMarketOptionParams extends BaseInstructionParams {
  creator: TransactionSigner;
  market: Address;
  sourceEta: Address;
  stakeAccount: Address;
  optionIndex: number;
  stakeAccountId: number;
  name: string;
  amountCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
}

export async function addMarketOption(
  input: AddMarketOptionParams,
  config: ArciumConfig,
): Promise<AddMarketOptionInstruction<string>> {
  const {
    programAddress,
    creator,
    market,
    sourceEta,
    stakeAccount,
    optionIndex,
    stakeAccountId,
    name,
    amountCiphertext,
    inputNonce,
    authorizedReaderNonce,
  } = input;

  return getAddMarketOptionInstructionAsync(
    {
      ...getComputeAccounts("add_option_stake", config),
      creator,
      market,
      sourceEta,
      stakeAccount,
      optionIndex,
      stakeAccountId,
      name,
      amountCiphertext: toNumberArray(amountCiphertext),
      inputNonce,
      authorizedReaderNonce,
    },
    programAddress ? { programAddress } : undefined
  );
}
