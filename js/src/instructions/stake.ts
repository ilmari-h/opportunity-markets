import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getStakeInstructionAsync,
  type StakeInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";

export interface StakeParams extends BaseInstructionParams {
  payer: TransactionSigner;
  market: Address;
  stakeAccount: Address;
  stakeAccountId: number;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  amount: bigint;
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
  userPubkey: ByteArray;
  stateNonce: bigint;
}

export async function stake(
  input: StakeParams,
  config: ArciumConfig
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    payer,
    market,
    stakeAccount,
    stakeAccountId,
    tokenMint,
    marketTokenAta,
    tokenProgram,
    amount,
    selectedOptionCiphertext,
    inputNonce,
    authorizedReaderNonce,
    userPubkey,
    stateNonce,
  } = input;

  return getStakeInstructionAsync(
    {
      ...getComputeAccounts("stake", config),
      payer,
      market,
      stakeAccount,
      stakeAccountId,
      tokenMint,
      marketTokenAta,
      tokenProgram,
      amount,
      selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
      inputNonce,
      authorizedReaderNonce,
      userPubkey: toNumberArray(userPubkey),
      stateNonce,
    },
    programAddress ? { programAddress } : undefined
  );
}
