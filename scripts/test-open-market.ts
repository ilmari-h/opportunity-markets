import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { OpportunityMarket } from "../target/types/opportunity_market";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getMXEAccAddress,
  getMXEPublicKey,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  deserializeLE,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

// Configuration
const DEVNET_PROGRAM_ID = new PublicKey("bnchXx34qGANGyEL6MxTYdG8iXmUmSPyQFAGhxj1VKn");
if(!process.env.RPC_URL) {
  throw new Error("No RPC_URL provided")
}
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
if(!process.env.KEYPAIR_PATH) {
  throw new Error("No KEYPAIR_PATH provided")
}
const KEYPAIR_PATH = process.env.KEYPAIR_PATH;

// Market configuration
const MARKET_CONFIG = {
  maxShares: new anchor.BN(1000),
  fundingLamports: new anchor.BN(0.001 * LAMPORTS_PER_SOL), // 0.001 SOL
  timeToStake: new anchor.BN(120), // 120 seconds
  timeToReveal: new anchor.BN(10), // 10 seconds
};

const OPTION_NAMES = ["Option A", "Option B", "Option C"];

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}

async function sendWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelayMs: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isBlockhashError =
        error?.message?.includes("Blockhash not found") ||
        error?.message?.includes("block height exceeded");

      if (isBlockhashError && attempt < maxRetries) {
        console.log(`   Blockhash expired, retrying... (attempt ${attempt}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable");
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

function deriveMarketPDA(
  programId: PublicKey,
  creator: PublicKey,
  index: anchor.BN
): PublicKey {
  const [marketPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("opportunity_market"),
      creator.toBuffer(),
      index.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return marketPDA;
}

function deriveOptionPDA(
  programId: PublicKey,
  marketPDA: PublicKey,
  optionIndex: number
): PublicKey {
  const optionIndexBN = new anchor.BN(optionIndex);
  const [optionPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("option"),
      marketPDA.toBuffer(),
      optionIndexBN.toArrayLike(Buffer, "le", 2), // u16 = 2 bytes
    ],
    programId
  );
  return optionPDA;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Opportunity Markets - Test Open Market on Devnet");
  console.log("=".repeat(60));
  console.log(`\nProgram ID: ${DEVNET_PROGRAM_ID.toBase58()}`);
  console.log(`RPC URL: ${RPC_URL}`);

  // Load keypair
  const keypairPath = KEYPAIR_PATH;
  console.log(`\nLoading keypair from: ${keypairPath}`);

  let creator: anchor.web3.Keypair;
  try {
    creator = readKpJson(keypairPath);
    console.log(`Creator: ${creator.publicKey.toBase58()}`);
  } catch (error) {
    console.error(`Failed to load keypair from ${keypairPath}`);
    console.error("Please set KEYPAIR_PATH environment variable or ensure ~/.config/solana/id.json exists");
    process.exit(1);
  }

  // Setup connection and provider
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(creator);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Check balance
  const balance = await connection.getBalance(creator.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error("\n⚠️  Warning: Low balance! You need at least 0.1 SOL.");
    console.log("Request an airdrop with: solana airdrop 1 -u devnet");
    process.exit(1);
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
  ) as Program<OpportunityMarket>;

  // Get MXE public key
  console.log("\nFetching MXE public key...");
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
  console.log("MXE x25519 pubkey fetched successfully");

  // Get Arcium environment
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);
  console.log(`Arcium Cluster Offset: ${arciumEnv.arciumClusterOffset}`);

  console.log("\n" + "=".repeat(60));
  console.log("Creating Opportunity Market");
  console.log("=".repeat(60));

  // Generate random market index to avoid collisions
  const marketIndex = new anchor.BN(Math.floor(Math.random() * 1000000));
  const marketPDA = deriveMarketPDA(program.programId, creator.publicKey, marketIndex);

  console.log(`\nMarket Index: ${marketIndex.toString()}`);
  console.log(`Market PDA: ${marketPDA.toBase58()}`);

  // Step 1: Create market with encrypted state
  console.log("\nStep 1: Creating market with encrypted state...");
  const marketNonce = randomBytes(16);
  const marketComputationOffset = new anchor.BN(randomBytes(8), "hex");

  try {
    const createMarketSig = await sendWithRetry(() =>
      program.methods
        .createMarket(
          marketIndex,
          marketComputationOffset,
          MARKET_CONFIG.maxShares,
          MARKET_CONFIG.fundingLamports,
          MARKET_CONFIG.timeToStake,
          MARKET_CONFIG.timeToReveal,
          new anchor.BN(deserializeLE(marketNonce).toString()),
          null // No select authority, creator can select
        )
        .accountsPartial({
          creator: creator.publicKey,
          market: marketPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            marketComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_market_shares")).readUInt32LE()
          ),
        })
        .signers([creator])
        .rpc({ skipPreflight: true, commitment: "confirmed" })
    );

    console.log(`  Create market tx: ${createMarketSig}`);
    console.log("  Waiting for MPC computation to finalize...");

    await awaitComputationFinalization(
      provider,
      marketComputationOffset,
      program.programId,
      "confirmed"
    );

    console.log("  ✓ Market encrypted state initialized!");
  } catch (error: any) {
    console.error("\n✗ Failed to create market:", error.message);
    throw error;
  }

  // Step 2: Add market options
  console.log("\nStep 2: Adding market options...");
  for (let i = 0; i < OPTION_NAMES.length; i++) {
    const optionIndex = i + 1; // Options start from 1
    const optionName = OPTION_NAMES[i];
    const optionPDA = deriveOptionPDA(program.programId, marketPDA, optionIndex);

    try {
      const addOptionSig = await sendWithRetry(() =>
        program.methods
          .addMarketOption(optionIndex, optionName)
          .accountsPartial({
            creator: creator.publicKey,
            market: marketPDA,
            option: optionPDA,
          })
          .signers([creator])
          .rpc({ commitment: "confirmed" })
      );

      console.log(`  ✓ Added option ${optionIndex}: "${optionName}"`);
      console.log(`    PDA: ${optionPDA.toBase58()}`);
      console.log(`    Tx: ${addOptionSig.slice(0, 20)}...`);
    } catch (error: any) {
      console.error(`\n✗ Failed to add option ${optionIndex}:`, error.message);
      throw error;
    }
  }

  // Step 3: Fund the market
  console.log("\nStep 3: Funding market...");
  const fundingAmount = MARKET_CONFIG.fundingLamports.toNumber();

  try {
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: marketPDA,
        lamports: fundingAmount,
      })
    );
    fundTx.feePayer = creator.publicKey;
    fundTx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    fundTx.sign(creator);

    const fundSig = await connection.sendRawTransaction(
      fundTx.serialize(),
      { skipPreflight: true }
    );
    await connection.confirmTransaction(fundSig, "confirmed");

    console.log(`  ✓ Market funded with ${fundingAmount / LAMPORTS_PER_SOL} SOL`);
    console.log(`    Tx: ${fundSig.slice(0, 20)}...`);
  } catch (error: any) {
    console.error("\n✗ Failed to fund market:", error.message);
    throw error;
  }

  // Step 4: Open the market
  console.log("\nStep 4: Opening market...");
  const currentSlot = await connection.getSlot();
  const currentTimestamp = await connection.getBlockTime(currentSlot);
  const openTimestamp = new anchor.BN(currentTimestamp! + 10); // Open in 10 seconds

  try {
    const openMarketSig = await program.methods
      .openMarket(openTimestamp)
      .accountsPartial({
        creator: creator.publicKey,
        market: marketPDA,
      })
      .signers([creator])
      .rpc({ commitment: "confirmed" });

    console.log(`  ✓ Market opened at timestamp: ${openTimestamp.toNumber()}`);
    console.log(`    Tx: ${openMarketSig.slice(0, 20)}...`);
  } catch (error: any) {
    console.error("\n✗ Failed to open market:", error.message);
    throw error;
  }

  // Step 5: Verify market state
  console.log("\nStep 5: Verifying market state...");
  try {
    const marketAccount = await program.account.opportunityMarket.fetch(marketPDA);

    console.log("\n  Market Details:");
    console.log(`    Creator: ${marketAccount.creator.toBase58()}`);
    console.log(`    Market Index: ${marketAccount.index.toString()}`);
    console.log(`    Max Shares: ${marketAccount.maxShares.toString()}`);
    console.log(`    Open Timestamp: ${marketAccount.openTimestamp.toNumber()}`);
    console.log(`    Time to Stake: ${marketAccount.timeToStake.toNumber()} seconds`);
    console.log(`    Time to Reveal: ${marketAccount.timeToReveal.toNumber()} seconds`);
    console.log(`    Selected Option: ${marketAccount.selectedOption ?? "None"}`);

    const marketBalance = await connection.getBalance(marketPDA);
    console.log(`    Market Balance: ${marketBalance / LAMPORTS_PER_SOL} SOL`);
  } catch (error: any) {
    console.error("\n✗ Failed to fetch market account:", error.message);
    throw error;
  }

  console.log("\n" + "=".repeat(60));
  console.log("✓ Market created and opened successfully!");
  console.log("=".repeat(60));
  console.log(`\nMarket PDA: ${marketPDA.toBase58()}`);
  console.log(`Market Index: ${marketIndex.toString()}`);
  console.log(`\nYou can now interact with this market using the PDA.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFatal error:", error);
    process.exit(1);
  });
