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
  payer: TransactionSigner;
  market: Address;
  stakeAccountId: number;
  tokenMint: Address;
  signerTokenAccount: Address;
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

export async function stake(
  input: StakeParams,
  config: ArciumConfig
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    signer,
    payer,
    market,
    stakeAccountId,
    tokenMint,
    signerTokenAccount,
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

  return getStakeInstructionAsync(
    {
      ...getComputeAccounts("stake", config),
      signer,
      payer,
      market,
      stakeAccountId,
      tokenMint,
      signerTokenAccount,
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
