import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const STAKE_DELEGATE_SEED = "stake_delegate";

export async function getStakeDelegateAddress(
  stakeAccount: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [STAKE_DELEGATE_SEED, getAddressEncoder().encode(stakeAccount)],
  });
}
