import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const VOTE_TOKEN_ACCOUNT_SEED = "vote_token_account";

export async function getVoteTokenAccountAddress(
  tokenMint: Address,
  owner: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      VOTE_TOKEN_ACCOUNT_SEED,
      getAddressEncoder().encode(tokenMint),
      getAddressEncoder().encode(owner),
    ],
  });
}
