import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCreateMarketInstructionAsync,
  type CreateMarketInstruction,
} from "../generated";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";

export interface CreateMarketParams extends BaseInstructionParams {
  creator: TransactionSigner;
  platformConfig: Address;
  tokenMint: Address;
  tokenProgram: Address;
  marketIndex: bigint;
  timeToStake: bigint;
  timeToReveal: bigint;
  marketAuthority: Address;
  unstakeDelaySeconds: bigint;
  authorizedReaderPubkey: ByteArray;
  allowClosingEarly: boolean;
  revealPeriodAuthority: Address;
  earlinessCutoffSeconds: bigint;
  minStakeAmount: bigint;
  marketFeeClaimer: Address;
}

export async function createMarket(
  input: CreateMarketParams,
): Promise<CreateMarketInstruction<string>> {
  const {
    programAddress,
    authorizedReaderPubkey,
    ...rest
  } = input;

  return getCreateMarketInstructionAsync(
    {
      ...rest,
      authorizedReaderPubkey: toNumberArray(authorizedReaderPubkey),
    },
    programAddress ? { programAddress } : undefined,
  );
}
