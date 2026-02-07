import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getBuyMarketSharesInstructionAsync,
  type BuyMarketSharesInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";

export interface BuyMarketSharesParams {
  signer: TransactionSigner;
  market: Address;
  userVta: Address;
  amountCiphertext: ByteArray;
  selectedOptionCiphertext: ByteArray;
  userPubkey: ByteArray;
  inputNonce: bigint;
  authorizedReaderPubkey: ByteArray;
  authorizedReaderNonce: bigint;
}

export async function buyMarketShares(
  input: BuyMarketSharesParams,
  config: ArciumConfig
): Promise<BuyMarketSharesInstruction> {
  const {
    signer,
    market,
    userVta,
    amountCiphertext,
    selectedOptionCiphertext,
    userPubkey,
    inputNonce,
    authorizedReaderPubkey,
    authorizedReaderNonce,
  } = input;

  return getBuyMarketSharesInstructionAsync({
    ...getComputeAccounts("buy_opportunity_market_shares", config),
    signer,
    market,
    userVta,
    amountCiphertext: toNumberArray(amountCiphertext),
    selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
    userPubkey: toNumberArray(userPubkey),
    inputNonce,
    authorizedReaderPubkey: toNumberArray(authorizedReaderPubkey),
    authorizedReaderNonce,
  });
}
