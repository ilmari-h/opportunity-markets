import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  address,
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
} from "@solana/kit";
import { initVoteTokenAccount, randomComputationOffset } from "../js/src";
import { createTestEnvironment } from "./utils";
import { initializeAllCompDefs } from "./comp-defs";
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

      // Get latest blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

      // Build transaction message
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayer(buyer.address, msg),
        (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstructions([initVoteTokenAccountIx], msg)
      );

      // Sign the transaction
      const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

      // Simulate first to see any errors
      console.log("   Simulating transaction...");
      const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
      const simResult = await rpc.simulateTransaction(base64Tx, {
        commitment: "confirmed",
        encoding: "base64",
      }).send();

      console.log("   Simulation result:");
      console.log("     Error:", simResult.value.err);
      console.log("     Logs:");
      simResult.value.logs?.forEach((log) => console.log("       ", log));

      if (simResult.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simResult.value.err)}`);
      }

      console.log("   Sending transaction...");

      // Send and confirm using Kit RPC
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      const signature = getSignatureFromTransaction(signedTransaction);

      console.log("   Transaction signature:", signature);
      console.log("\n   Vote token account initialization PASSED!");
    });
  });

  describe("Test Environment", () => {
    it("can create a test environment with participants and market", async () => {
      console.log("\n=== Kit Test: Create Test Environment ===\n");

      // Convert program ID to Kit Address type
      const programId = address(program.programId.toBase58());

      const env = await createTestEnvironment(provider, programId, {
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        numParticipants: 5,
      });

      // Verify the environment was created correctly
      expect(env.participants).to.have.lengthOf(5);
      expect(env.market).to.exist;
      expect(env.market.address).to.exist;
      expect(env.market.creatorAccount).to.exist;
      expect(env.rpc).to.exist;
      expect(env.rpcSubscriptions).to.exist;
      console.log("\n   Test environment creation PASSED!");
    });
  });
});
