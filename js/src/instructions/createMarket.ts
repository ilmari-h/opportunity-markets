import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCreateMarketInstructionAsync,
  type CreateMarketInstruction,
} from "../generated";
import { ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";

export interface CreateMarketParams {
  creator: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
  marketIndex: bigint;
  maxShares: bigint;
  rewardAmount: bigint;
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
    tokenMint,
    tokenProgram,
    marketIndex,
    maxShares,
    rewardAmount,
    timeToReveal,
    timeToStake,
    marketAuthority,
  } = input;

  return getCreateMarketInstructionAsync({
    ...getComputeAccounts("init_market_shares", config),
    creator,
    tokenMint,
    tokenProgram,
    marketIndex,
    maxShares,
    rewardAmount,
    timeToStake,
    timeToReveal,
    nonce,
    marketAuthority,
  });
}
