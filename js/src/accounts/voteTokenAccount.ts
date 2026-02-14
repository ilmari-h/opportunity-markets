import {
  type Address,
  getAddressEncoder,
  getU64Encoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const VOTE_TOKEN_ACCOUNT_SEED = "vote_token_account";

/**
 * Get the address for a regular VoteTokenAccount (index = 0).
 * Regular VTAs are created via init_vote_token_account.
 */
export async function getVoteTokenAccountAddress(
  tokenMint: Address,
  owner: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getVoteTokenAccountAddressWithIndex(tokenMint, owner, 0n, programId);
}

/**
 * Get the address for a VoteTokenAccount with a specific index.
 * Index 0 is the regular VTA, non-zero indices are ephemeral VTAs.
 */
export async function getVoteTokenAccountAddressWithIndex(
  tokenMint: Address,
  owner: Address,
  index: bigint,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      VOTE_TOKEN_ACCOUNT_SEED,
      getAddressEncoder().encode(tokenMint),
      getAddressEncoder().encode(owner),
      getU64Encoder().encode(index),
    ],
  });
}

/**
 * Get the address for an ephemeral VoteTokenAccount.
 * Ephemeral VTAs use a non-zero index and are created via init_ephemeral_vote_token_account.
 */
export async function getEphemeralVoteTokenAccountAddress(
  tokenMint: Address,
  owner: Address,
  index: bigint,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getVoteTokenAccountAddressWithIndex(tokenMint, owner, index, programId);
}
