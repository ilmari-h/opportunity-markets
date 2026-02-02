import {
  type TransactionSigner,
  type Address,
  address,
  type Instruction,
} from "@solana/kit";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";
import {
  getInitVoteTokenAccountCompDefInstruction,
  getBuyVoteTokensCompDefInstruction,
  getClaimVoteTokensCompDefInstruction,
  getBuyOpportunityMarketSharesCompDefInstruction,
  getInitMarketSharesCompDefInstruction,
  getRevealSharesCompDefInstruction,
  OPPORTUNITY_MARKET_PROGRAM_ADDRESS,
} from "../generated";

export type CompDefCircuitName =
  | "init_vote_token_account"
  | "buy_vote_tokens"
  | "claim_vote_tokens"
  | "buy_opportunity_market_shares"
  | "init_market_shares"
  | "reveal_shares";

export const ALL_COMP_DEF_CIRCUITS: CompDefCircuitName[] = [
  "init_vote_token_account",
  "buy_vote_tokens",
  "claim_vote_tokens",
  "buy_opportunity_market_shares",
  "init_market_shares",
  "reveal_shares",
];


function toAddress(pubkey: { toBase58(): string }): Address {
  return address(pubkey.toBase58());
}

export interface InitCompDefConfig {
  programId?: Address;
}

export function getMxeAccount(programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS): Address {
  const programIdLegacy = new PublicKey(programId);
  return toAddress(getMXEAccAddress(programIdLegacy));
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


export function getInitCompDefInstruction(
  payer: TransactionSigner,
  circuitName: CompDefCircuitName,
  config: InitCompDefConfig = {}
): Instruction {
  const programId = config.programId ?? OPPORTUNITY_MARKET_PROGRAM_ADDRESS;
  const mxeAccount = getMxeAccount(programId);
  const compDefAccount = getCompDefAccount(circuitName, programId);

  const baseInput = {
    payer,
    mxeAccount,
    compDefAccount,
  };

  switch (circuitName) {
    case "init_vote_token_account":
      return getInitVoteTokenAccountCompDefInstruction(baseInput, { programAddress: programId });

    case "buy_vote_tokens":
      return getBuyVoteTokensCompDefInstruction(baseInput, { programAddress: programId });

    case "claim_vote_tokens":
      return getClaimVoteTokensCompDefInstruction(baseInput, { programAddress: programId });

    case "buy_opportunity_market_shares":
      return getBuyOpportunityMarketSharesCompDefInstruction(baseInput, { programAddress: programId });

    case "init_market_shares":
      return getInitMarketSharesCompDefInstruction(baseInput, { programAddress: programId });

    case "reveal_shares":
      return getRevealSharesCompDefInstruction(baseInput, { programAddress: programId });

    default:
      throw new Error(`Unknown circuit: ${circuitName}`);
  }
}
