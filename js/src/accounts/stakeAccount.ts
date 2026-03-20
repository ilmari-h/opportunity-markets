import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const STAKE_ACCOUNT_SEED = "stake_account";

export async function getStakeAccountAddress(
  owner: Address,
  market: Address,
  stakeAccountId: number,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  const addressEncoder = getAddressEncoder();
  const idBytes = new Uint8Array(4);
  new DataView(idBytes.buffer).setUint32(0, stakeAccountId, true);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      STAKE_ACCOUNT_SEED,
      addressEncoder.encode(owner),
      addressEncoder.encode(market),
      idBytes,
    ],
  });
}
