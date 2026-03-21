import {
  type Address,
  getAddressEncoder,
  getU64Encoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const OPPORTUNITY_MARKET_OPTION_SEED = "option";

export async function getOpportunityMarketOptionAddress(
  market: Address,
  optionId: number | bigint,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      OPPORTUNITY_MARKET_OPTION_SEED,
      getAddressEncoder().encode(market),
      getU64Encoder().encode(optionId),
    ],
  });
}
