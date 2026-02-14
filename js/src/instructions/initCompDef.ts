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
  getWrapEncryptedTokensCompDefInstruction,
  getUnwrapEncryptedTokensCompDefInstruction,
  getBuyOpportunityMarketSharesCompDefInstruction,
  getRevealSharesCompDefInstruction,
  getUnstakeEarlyCompDefInstruction,
  getAddOptionStakeCompDefInstruction,
  getCloseEphemeralEncryptedTokenAccountCompDefInstruction,
  OPPORTUNITY_MARKET_PROGRAM_ADDRESS,
  fetchMXEAccount,
} from "../generated";
import { BN } from "bn.js";

export type CompDefCircuitName =
  | "wrap_encrypted_tokens"
  | "unwrap_encrypted_tokens"
  | "buy_opportunity_market_shares"
  | "reveal_shares"
  | "unstake_early"
  | "add_option_stake"
  | "close_ephemeral_encrypted_token_account";

export const ALL_COMP_DEF_CIRCUITS: CompDefCircuitName[] = [
  "wrap_encrypted_tokens",
  "unwrap_encrypted_tokens",
  "buy_opportunity_market_shares",
  "reveal_shares",
  "unstake_early",
  "add_option_stake",
  "close_ephemeral_encrypted_token_account",
];


function toAddress(pubkey: { toBase58(): string }): Address {
  return address(pubkey.toBase58());
}

export interface InitCompDefConfig {
  programId?: Address;
}

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
  const programId = config.programId ?? OPPORTUNITY_MARKET_PROGRAM_ADDRESS;
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
    case "wrap_encrypted_tokens":
      return getWrapEncryptedTokensCompDefInstruction(baseInput, { programAddress: programId });

    case "unwrap_encrypted_tokens":
      return getUnwrapEncryptedTokensCompDefInstruction(baseInput, { programAddress: programId });

    case "buy_opportunity_market_shares":
      return getBuyOpportunityMarketSharesCompDefInstruction(baseInput, { programAddress: programId });

    case "reveal_shares":
      return getRevealSharesCompDefInstruction(baseInput, { programAddress: programId });

    case "unstake_early":
      return getUnstakeEarlyCompDefInstruction(baseInput, { programAddress: programId });

    case "add_option_stake":
      return getAddOptionStakeCompDefInstruction(baseInput, { programAddress: programId });

    case "close_ephemeral_encrypted_token_account":
      return getCloseEphemeralEncryptedTokenAccountCompDefInstruction(baseInput, { programAddress: programId });

    default:
      throw new Error(`Unknown circuit: ${circuitName}`);
  }
}
