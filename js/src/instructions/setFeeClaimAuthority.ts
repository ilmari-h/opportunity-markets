import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getSetFeeClaimAuthorityInstruction,
  type SetFeeClaimAuthorityInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface SetFeeClaimAuthorityParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  platformConfig: Address;
  newFeeClaimAuthority: Address;
}

export function setFeeClaimAuthority(
  input: SetFeeClaimAuthorityParams,
): SetFeeClaimAuthorityInstruction<string> {
  const { programAddress, ...params } = input;
  return getSetFeeClaimAuthorityInstruction(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
