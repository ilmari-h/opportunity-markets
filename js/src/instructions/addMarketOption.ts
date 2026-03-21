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
  stakeAccount: Address;
  optionIndex: number;
  stakeAccountId: number;
  name: string;
  tokenMint: Address;
  creatorTokenAccount: Address;
  marketTokenAta: Address;
  tokenVault: Address;
  tokenVaultAta: Address;
  tokenProgram: Address;
  amount: bigint;
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
  userPubkey: ByteArray;
}

export async function addMarketOption(
  input: AddMarketOptionParams,
  config: ArciumConfig,
): Promise<AddMarketOptionInstruction<string>> {
  const {
    programAddress,
    creator,
    market,
    stakeAccount,
    optionIndex,
    stakeAccountId,
    name,
    tokenMint,
    creatorTokenAccount,
    marketTokenAta,
    tokenVault,
    tokenVaultAta,
    tokenProgram,
    amount,
    selectedOptionCiphertext,
    inputNonce,
    authorizedReaderNonce,
    userPubkey,
  } = input;

  return getAddMarketOptionInstructionAsync(
    {
      ...getComputeAccounts("add_option_stake", config),
      creator,
      market,
      stakeAccount,
      optionIndex,
      stakeAccountId,
      name,
      tokenMint,
      creatorTokenAccount,
      marketTokenAta,
      tokenVault,
      tokenVaultAta,
      tokenProgram,
      amount,
      selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
      inputNonce,
      authorizedReaderNonce,
      userPubkey: toNumberArray(userPubkey),
    },
    programAddress ? { programAddress } : undefined
  );
}
