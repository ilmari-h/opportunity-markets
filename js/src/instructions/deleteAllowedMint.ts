import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getDeleteAllowedMintInstructionAsync,
  type DeleteAllowedMintInstruction,
} from "../generated";
import { getAllowedMintAddress } from "../accounts/allowedMint";
import { type BaseInstructionParams } from "./instructionParams";

export interface DeleteAllowedMintParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  tokenMint: Address;
}

export async function deleteAllowedMint(
  input: DeleteAllowedMintParams
): Promise<DeleteAllowedMintInstruction<string>> {
  const { programAddress, updateAuthority, tokenMint } = input;
  const [allowedMint] = await getAllowedMintAddress(tokenMint, programAddress);
  return getDeleteAllowedMintInstructionAsync(
    { updateAuthority, allowedMint },
    programAddress ? { programAddress } : undefined
  );
}
