import {
  type TransactionSigner,
  type Address,
  address,
  type Instruction,
  SolanaRpcApi,
  Rpc,
} from "@solana/kit";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
} from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";
import {
  getStakeCompDefInstruction,
  getRevealStakeCompDefInstruction,
  getAddOptionStakeCompDefInstruction,
  OPPORTUNITY_MARKET_PROGRAM_ADDRESS,
  fetchMXEAccount,
} from "../generated";
import { BN } from "bn.js";
import { type BaseInstructionParams } from "./instructionParams";

export type CompDefCircuitName =
  | "stake"
  | "reveal_stake"
  | "add_option_stake";

export const ALL_COMP_DEF_CIRCUITS: CompDefCircuitName[] = [
  "stake",
  "reveal_stake",
  "add_option_stake",
];


function toAddress(pubkey: { toBase58(): string }): Address {
  return address(pubkey.toBase58());
}

export interface InitCompDefConfig extends BaseInstructionParams {}

export async function getMxeAccount(rpc: Rpc<SolanaRpcApi>, programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS) {
  const programIdLegacy = new PublicKey(programId);
  const mxeAddress = toAddress(getMXEAccAddress(programIdLegacy));
  return fetchMXEAccount(rpc, mxeAddress)
}

export function getCompDefAccount(
  circuitName: CompDefCircuitName,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Address {
  const programIdLegacy = new PublicKey(programId);
  const offset = getCompDefAccOffset(circuitName);
  return toAddress(
    getCompDefAccAddress(programIdLegacy, Buffer.from(offset).readUInt32LE())
  );
}


export function getCompDefOffsetNumber(circuitName: CompDefCircuitName): number {
  const offset = getCompDefAccOffset(circuitName);
  return Buffer.from(offset).readUInt32LE();
}


export async function getInitCompDefInstruction(
  rpc: Rpc<SolanaRpcApi>,
  payer: TransactionSigner,
  circuitName: CompDefCircuitName,
  config: InitCompDefConfig = {}
): Promise<Instruction> {
  const programId = config.programAddress ?? OPPORTUNITY_MARKET_PROGRAM_ADDRESS;
  const mxeAccount = await getMxeAccount(rpc, programId);
  const compDefAccount = getCompDefAccount(circuitName, programId);
  const lutAddress = getLookupTableAddress(
    new PublicKey(programId.toString()),
    new BN(mxeAccount.data.lutOffsetSlot)
  );

  const baseInput = {
    payer,
    mxeAccount: mxeAccount.address,
    compDefAccount,
    addressLookupTable: toAddress(lutAddress),

  };

  switch (circuitName) {
    case "stake":
      return getStakeCompDefInstruction(baseInput, { programAddress: programId });

    case "reveal_stake":
      return getRevealStakeCompDefInstruction(baseInput, { programAddress: programId });

    case "add_option_stake":
      return getAddOptionStakeCompDefInstruction(baseInput, { programAddress: programId });

    default:
      throw new Error(`Unknown circuit: ${circuitName}`);
  }
}
