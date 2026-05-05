import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCreateAllowedMintInstructionAsync,
  type CreateAllowedMintInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface CreateAllowedMintParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  tokenMint: Address;
}

export async function createAllowedMint(
  input: CreateAllowedMintParams
): Promise<CreateAllowedMintInstruction<string>> {
  const { programAddress, ...params } = input;
  return getCreateAllowedMintInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
