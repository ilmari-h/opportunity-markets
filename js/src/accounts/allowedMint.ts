import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const ALLOWED_MINT_SEED = "allowed_mint";

export async function getAllowedMintAddress(
  tokenMint: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [ALLOWED_MINT_SEED, getAddressEncoder().encode(tokenMint)],
  });
}
