import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCreateMarketInstructionAsync,
  type CreateMarketInstruction,
} from "../generated";

export interface CreateMarketParams {
  creator: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
  marketIndex: bigint;
  rewardAmount: bigint;
  timeToStake: bigint;
  timeToReveal: bigint;
  marketAuthority: Address | null;
  unstakeDelaySeconds: bigint;
}

export async function createMarket(
  input: CreateMarketParams
): Promise<CreateMarketInstruction> {
  const {
    creator,
    tokenMint,
    tokenProgram,
    marketIndex,
    rewardAmount,
    timeToReveal,
    timeToStake,
    marketAuthority,
    unstakeDelaySeconds,
  } = input;

  return getCreateMarketInstructionAsync({
    creator,
    tokenMint,
    tokenProgram,
    marketIndex,
    rewardAmount,
    timeToStake,
    timeToReveal,
    marketAuthority,
    unstakeDelaySeconds,
  });
}
