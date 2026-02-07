import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const SHARE_ACCOUNT_SEED = "share_account";

export async function getShareAccountAddress(
  owner: Address,
  market: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  const addressEncoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      SHARE_ACCOUNT_SEED,
      addressEncoder.encode(owner),
      addressEncoder.encode(market),
    ],
  });
}
