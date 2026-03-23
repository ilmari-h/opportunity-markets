import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const SPONSOR_SEED = "sponsor";

export async function getOpportunityMarketSponsorAddress(
  sponsor: Address,
  market: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  const addressEncoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      SPONSOR_SEED,
      addressEncoder.encode(sponsor),
      addressEncoder.encode(market),
    ],
  });
}
