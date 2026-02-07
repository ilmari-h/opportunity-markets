import {
  type Address,
  getAddressEncoder,
  getU16Encoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const OPPORTUNITY_MARKET_OPTION_SEED = "option";

export async function getOpportunityMarketOptionAddress(
  market: Address,
  optionIndex: number,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      OPPORTUNITY_MARKET_OPTION_SEED,
      getAddressEncoder().encode(market),
      getU16Encoder().encode(optionIndex),
    ],
  });
}
