import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getBuyMarketSharesInstructionAsync,
  type BuyMarketSharesInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "./arciumConfig";

export interface BuyMarketSharesParams {
  signer: TransactionSigner;
  market: Address;
  amountCiphertext: number[];
  selectedOptionCiphertext: number[];
  userPubkey: number[];
  inputNonce: bigint;
  authorizedReaderPubkey: number[];
  authorizedReaderNonce: bigint;
}

export async function buyMarketShares(
  input: BuyMarketSharesParams,
  config: ArciumConfig
): Promise<BuyMarketSharesInstruction> {
  const {
    signer,
    market,
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
    amountCiphertext,
    selectedOptionCiphertext,
    userPubkey,
    inputNonce,
    authorizedReaderPubkey,
    authorizedReaderNonce,
  });
}
