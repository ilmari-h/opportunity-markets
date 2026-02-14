import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { OpportunityMarket } from "../target/types/opportunity_market";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getMXEAccAddress,
  getArciumEnv,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

// Configuration
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const CLUSTER_OFFSET = 456;
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

type CompDefs =
  | "buy_vote_tokens"
  | "claim_vote_tokens"
  | "buy_opportunity_market_shares"
  | "reveal_shares"
  | "unstake_early"
  | "add_option_stake";

const COMP_DEFS: CompDefs[] = [
  "buy_vote_tokens",
  "claim_vote_tokens",
  "buy_opportunity_market_shares",
  "reveal_shares",
  "unstake_early",
  "add_option_stake",
];

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}

async function initCompDef(
  program: Program<OpportunityMarket>,
  provider: anchor.AnchorProvider,
  owner: anchor.web3.Keypair,
  circuitName: CompDefs
): Promise<void> {
  console.log(`\nInitializing ${circuitName}...`);

  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset(circuitName);

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];

  // Check if comp def account already exists
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (accountInfo !== null) {
    console.log(`  ✓ ${circuitName} already initialized, skipping...`);
    return;
   }
   const mxeAccount = getMXEAccAddress(program.programId)
   console.log("MXE", mxeAccount.toBase58())
   console.log("pid", program.programId.toBase58())

  let sig: string;
  try {
    // Initialize the computation definition account
    console.log(`  Creating comp def account...`);
    switch (circuitName) {
      case "buy_vote_tokens":
        sig = await program.methods
          .buyVoteTokensCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "claim_vote_tokens":
        sig = await program.methods
          .claimVoteTokensCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "buy_opportunity_market_shares":
        sig = await program.methods
          .buyOpportunityMarketSharesCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "reveal_shares":
        sig = await program.methods
          .revealSharesCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "unstake_early":
        sig = await program.methods
          .unstakeEarlyCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "add_option_stake":
        sig = await program.methods
          .addOptionStakeCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      default:
        throw new Error(`Unknown circuit: ${circuitName}`);
    }

    console.log(`  Init tx: ${sig}`);

    // Wait for init transaction to be fully confirmed
    console.log(`  Waiting for confirmation...`);
    await provider.connection.confirmTransaction(sig);

    console.log(`  ✓ ${circuitName} initialized successfully!`);
  } catch (error: any) {
    console.error(`  ✗ Failed to initialize ${circuitName}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Opportunity Markets - Compute Definition Initialization");
  console.log("=".repeat(60));
  console.log(`\nProgram ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`Cluster Offset: ${CLUSTER_OFFSET}`);
  console.log(`RPC URL: ${RPC_URL}`);

  // Verify Arcium environment
  const arciumEnv = getArciumEnv();
  console.log(`Arcium Env Cluster Offset: ${arciumEnv.arciumClusterOffset}`);

  // Load keypair
  const keypairPath = process.env.KEYPAIR_PATH || `${os.homedir()}/.config/solana/id.json`;
  console.log(`\nLoading keypair from: ${keypairPath}`);

  let owner: anchor.web3.Keypair;
  try {
    owner = readKpJson(keypairPath);
    console.log(`Payer: ${owner.publicKey.toBase58()}`);
  } catch (error) {
    console.error(`Failed to load keypair from ${keypairPath}`);
    console.error("Please set KEYPAIR_PATH environment variable or ensure ~/.config/solana/id.json exists");
    process.exit(1);
  }

  // Setup connection and provider
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.5 * anchor.web3.LAMPORTS_PER_SOL) {
    console.error("\n⚠️  Warning: Low balance! You need at least 0.5 SOL to upload large circuits.");
    console.log("Request an airdrop with: solana airdrop 2 -u devnet");
  }

  // Load program IDL
  console.log("\nLoading program IDL...");
  let idl: anchor.Idl;
  try {
    const idlPath = `${__dirname}/../target/idl/opportunity_market.json`;
    idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  } catch (error) {
    console.error("Failed to load IDL from target/idl/opportunity_market.json");
    console.error("Make sure you've built the project with: arcium build");
    process.exit(1);
  }

  const program = new Program(
    idl,
    provider
  ) as unknown as Program<OpportunityMarket>;

  console.log("\n" + "=".repeat(60));
  console.log("Initializing Computation Definitions");
  console.log("=".repeat(60));

  // Step 1: Initialize all compute definitions
  for (const compDef of COMP_DEFS) {
    try {
      await initCompDef(program, provider, owner, compDef);
    } catch (error) {
      console.error(`\nFailed to initialize ${compDef}, stopping...`);
      process.exit(1);
    }
  }

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFatal error:", error);
    process.exit(1);
  });
