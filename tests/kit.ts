import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  address,
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  lamports,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { initVoteTokenAccount, openMarket, randomComputationOffset } from "../js/src";
import { createTestEnvironment } from "./utils/environment";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { getArciumEnv, deserializeLE } from "@arcium-hq/client";
import { OpportunityMarket } from "../target/types/opportunity_market";
import * as fs from "fs";
import * as os from "os";
import { randomBytes } from "crypto";
import { expect } from "chai";

// Environment setup
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
// WebSocket port is RPC port + 1 (8899 -> 8900)
const WS_URL = RPC_URL.replace("http", "ws").replace(":8899", ":8900");

describe("OpportunityMarket (Kit)", () => {
  // Anchor setup (still needed for buildFinalizeCompDefTx)
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.OpportunityMarket as Program<OpportunityMarket>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const programId = address(program.programId.toBase58());

  // RPC clients for Kit
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  before(async () => {
    // Load owner secret key
    const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
    const secretKey = new Uint8Array(JSON.parse(file.toString()));

    // Initialize all computation definitions
    await initializeAllCompDefs(rpc, sendAndConfirmTransaction, secretKey, programId);
  });

  describe("Basic Operations", () => {

    it("can initialize a vote token account using Kit bindings", async () => {
      console.log("\n=== Kit Test: Initialize Vote Token Account ===\n");

      // Get Arcium environment
      const arciumEnv = getArciumEnv();

      // Generate a new keypair
      const buyer = await generateKeyPairSigner();
      console.log("   Generated buyer:", buyer.address);

      // Airdrop SOL for transaction fees
      const airdropAmount = lamports(2_000_000_000n);
      console.log("   Airdropping 2 SOL...");
      await airdrop({
        recipientAddress: buyer.address,
        lamports: airdropAmount,
        commitment: "confirmed",
      });

      // Generate computation offset and nonce
      const computationOffset = randomComputationOffset();
      const nonce = deserializeLE(randomBytes(16));

      // Generate a mock x25519 public key (32 bytes)
      const userPubkey = Array.from(randomBytes(32));

      console.log("   Computation offset:", computationOffset.toString());

      // Build the instruction using the simplified helper
      // All Arcium accounts are derived automatically
      const initVoteTokenAccountIx = await initVoteTokenAccount({
        signer: buyer,
        userPubkey,
        nonce,
        },
         {
          clusterOffset: arciumEnv.arciumClusterOffset,
          computationOffset,
        },
      );

      console.log("   Built initVoteTokenAccount instruction");

      // Send transaction using helper
      const { signature } = await sendTransaction(
        rpc,
        sendAndConfirmTransaction,
        buyer,
        [initVoteTokenAccountIx],
        { label: "initVoteTokenAccount" }
      );

      console.log("   Transaction signature:", signature);
      console.log("\n   Vote token account initialization PASSED!");
    });
  });

  describe("Test Environment", () => {
    it("can create a test environment, fund the market, and open it", async () => {
      console.log("\n=== Kit Test: Create Test Environment, Fund & Open Market ===\n");

      // Convert program ID to Kit Address type
      const programIdAddress = address(program.programId.toBase58());

      // Market funding amount (1 SOL) - must match rewardLamports in createTestEnvironment
      const marketFundingLamports = 1_000_000_000n;

      // Airdrop enough SOL to cover funding + fees (2 SOL for creator)
      const env = await createTestEnvironment(provider, programIdAddress, {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        numParticipants: 5,
        airdropLamports: 2_000_000_000n, // 2 SOL for creator
        marketConfig: {
          rewardLamports: marketFundingLamports,
          timeToStake: 120n,
          timeToReveal: 60n,
        },
      });

      // Verify the environment was created correctly
      expect(env.participants).to.have.lengthOf(5);
      expect(env.market).to.exist;
      expect(env.market.address).to.exist;
      expect(env.market.creatorAccount).to.exist;
      expect(env.rpc).to.exist;
      expect(env.rpcSubscriptions).to.exist;
      console.log("   Test environment created!");

      // ========== Fund the market by transferring SOL from creator ==========
      console.log("\n   Funding market with", Number(marketFundingLamports) / 1_000_000_000, "SOL...");

      const fundingIx = getTransferSolInstruction({
        amount: lamports(marketFundingLamports),
        destination: env.market.address,
        source: env.market.creatorAccount.keypair,
      });

      await sendTransaction(
        rpc,
        sendAndConfirmTransaction,
        env.market.creatorAccount.keypair,
        [fundingIx],
        { label: "Fund market" }
      );

      // ========== Open the market ==========
      console.log("\n   Opening market...");

      // Set open timestamp to now (current unix timestamp)
      const openTimestamp = BigInt(Math.floor(Date.now() / 1000));

      const openMarketIx = openMarket({
        creator: env.market.creatorAccount.keypair,
        market: env.market.address,
        openTimestamp,
      });

      await sendTransaction(
        rpc,
        sendAndConfirmTransaction,
        env.market.creatorAccount.keypair,
        [openMarketIx],
        { label: "Open market" }
      );

      console.log("\n   Test environment creation, funding & opening PASSED!");
    });
  });
});
