import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitEphemeralVoteTokenAccountInstructionAsync,
  type InitEphemeralVoteTokenAccountInstruction,
} from "../generated";

export interface InitEphemeralVoteTokenAccountParams {
  /** The signer/payer for the transaction (permissionless - anyone can call) */
  signer: TransactionSigner;
  /** The owner of the VTA (does not need to sign) */
  owner: Address;
  tokenMint: Address;
  tokenProgram: Address;
  /** The index for the ephemeral VTA (must be non-zero) */
  index: bigint;
}

export async function initEphemeralVoteTokenAccount(
  input: InitEphemeralVoteTokenAccountParams
): Promise<InitEphemeralVoteTokenAccountInstruction> {
  const { signer, owner, tokenMint, tokenProgram, index } = input;

  return getInitEphemeralVoteTokenAccountInstructionAsync({
    signer,
    owner,
    tokenMint,
    tokenProgram,
    index,
  });
}
