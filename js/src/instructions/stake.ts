import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getStakeInstructionAsync,
  type StakeInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";

export interface StakeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  userEta: Address;
  stakeAccountId: number;
  amountCiphertext: ByteArray;
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
}

export async function stake(
  input: StakeParams,
  config: ArciumConfig
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    signer,
    market,
    userEta,
    stakeAccountId,
    amountCiphertext,
    selectedOptionCiphertext,
    inputNonce,
    authorizedReaderNonce,
  } = input;

  return getStakeInstructionAsync(
    {
      ...getComputeAccounts("stake", config),
      signer,
      market,
      userEta,
      stakeAccountId,
      amountCiphertext: toNumberArray(amountCiphertext),
      selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
      inputNonce,
      authorizedReaderNonce,
    },
    programAddress ? { programAddress } : undefined
  );
}
