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
  /** PDA of the stake_account being staked into. Use `getStakeAccountAddress(owner, market, id)`. */
  stakeAccount: Address;
  stakeAccountId: number;
  tokenMint: Address;
  signerTokenAccount: Address;
  tokenProgram: Address;
  /** Gross amount (net + fee). Fee is deducted on-chain and routed to the fee vault ATA. */
  amount: bigint;
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
  /** User's x25519 public key (NOT their Solana wallet pubkey). */
  userPubkey: ByteArray;
  /** u128 nonce committed to encrypted-state derivation. */
  stateNonce: bigint;
}

export async function stake(
  input: StakeParams,
  config: ArciumConfig,
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    signer,
    payer,
    market,
    stakeAccount,
    stakeAccountId,
    tokenMint,
    signerTokenAccount,
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
      signer,
      payer,
      market,
      stakeAccount,
      stakeAccountId,
      tokenMint,
      signerTokenAccount,
      tokenProgram,
      amount,
      selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
      inputNonce,
      authorizedReaderNonce,
      userPubkey: toNumberArray(userPubkey),
      stateNonce,
    },
    programAddress ? { programAddress } : undefined,
  );
}
