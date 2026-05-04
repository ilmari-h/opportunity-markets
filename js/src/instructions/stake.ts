import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getStakeInstructionAsync,
  type StakeInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";
import { type StakeSignature } from "../signing";

interface StakeAccountsAndAmount extends BaseInstructionParams {
  payer: TransactionSigner;
  market: Address;
  /** PDA of the stake_account being staked into. Use `getStakeAccountAddress(owner, market, id)`. */
  stakeAccount: Address;
  stakeAccountId: number;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  /** Gross amount (net + fee). Fee is deducted on-chain and credited to `market.collected_fees`. */
  amount: bigint;
}

/**
 * Inputs for a stake call where the `payer` is also the stake_account.owner.
 */
export interface StakeAsOwnerParams extends StakeAccountsAndAmount {
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
  /** User's x25519 public key (NOT their Solana wallet pubkey). */
  userPubkey: ByteArray;
  /** u128 nonce committed to encrypted-state derivation. */
  stateNonce: bigint;
}

/**
 * Inputs for a stake call where the `payer` is a third party (the stake_delegate authority).
 * The owner has pre-signed the canonical stake message off-chain.
 */
export interface StakeAsDelegateParams extends StakeAccountsAndAmount {
  /** The owner's authorization, produced via `signStakeMessage`. */
  signature: StakeSignature;
}

const ZERO_SIGNATURE: number[] = new Array(64).fill(0);

/**
 * Build a stake instruction where the transaction signer is the stake_account.owner.
 */
export async function stakeAsOwner(
  input: StakeAsOwnerParams,
  config: ArciumConfig,
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
      signatureExpiryTimestamp: 0n,
      ownerSignature: ZERO_SIGNATURE,
    },
    programAddress ? { programAddress } : undefined,
  );
}

/**
 * Build a stake instruction where the transaction signer is the stake_delegate.authority,
 * NOT the stake_account.owner. Requires a {@link StakeSignature} produced by the owner
 * off-chain.
 */
export async function stakeAsDelegate(
  input: StakeAsDelegateParams,
  config: ArciumConfig,
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
    signature,
  } = input;

  const { payload } = signature;

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
      selectedOptionCiphertext: toNumberArray(payload.selectedOptionCiphertext),
      inputNonce: payload.inputNonce,
      authorizedReaderNonce: payload.authorizedReaderNonce,
      userPubkey: toNumberArray(payload.userPubkey),
      stateNonce: payload.stateNonce,
      signatureExpiryTimestamp: payload.signatureExpiryTimestamp,
      ownerSignature: toNumberArray(signature.signature),
    },
    programAddress ? { programAddress } : undefined,
  );
}
