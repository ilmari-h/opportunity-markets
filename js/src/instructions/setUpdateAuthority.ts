import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getSetUpdateAuthorityInstruction,
  type SetUpdateAuthorityInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface SetUpdateAuthorityParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  platformConfig: Address;
  newAuthority: Address;
}

export function setUpdateAuthority(
  input: SetUpdateAuthorityParams,
): SetUpdateAuthorityInstruction<string> {
  const { programAddress, ...params } = input;
  return getSetUpdateAuthorityInstruction(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
