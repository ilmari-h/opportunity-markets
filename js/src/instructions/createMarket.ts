import { type TransactionSigner, Address } from "@solana/kit";
import {
  getCreateMarketInstructionAsync,
  type CreateMarketInstruction,
} from "../generated";
import { ArciumConfig, getComputeAccounts } from "./arciumConfig";

export interface CreateMarketParams {
  creator: TransactionSigner;
  marketIndex: bigint;
  maxShares: bigint;
  rewardLamports: bigint;
  timeToStake: bigint;
  timeToReveal: bigint;
  marketAuthority: Address | null;
  /** Nonce for encryption (16 bytes as bigint) */
  nonce: bigint;
}

export async function createMarket(
  input: CreateMarketParams,
  config: ArciumConfig
): Promise<CreateMarketInstruction> {
  const {
    nonce,
    creator,
    marketIndex,
    maxShares,
    rewardLamports,
    timeToReveal,
    timeToStake,
    marketAuthority,
  } = input;

  return getCreateMarketInstructionAsync({
    ...getComputeAccounts("init_market_shares", config),
    creator,
    marketIndex,
    maxShares,
    rewardLamports,
    timeToStake,
    timeToReveal,
    nonce,
    marketAuthority,
  });
}
