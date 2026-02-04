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
import {  awaitComputationFinalization, initVoteTokenAccount, openMarket, randomComputationOffset } from "../js/src";
import { createTestEnvironment } from "./utils/environment";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { getArciumEnv, deserializeLE, x25519 } from "@arcium-hq/client";
import { OpportunityMarket } from "../target/types/opportunity_market";
import * as fs from "fs";
import * as os from "os";
import { randomBytes } from "crypto";
import { generateX25519Keypair } from "../js/src/x25519/keypair";

const ONCHAIN_TIMESTAMP_BUFFER_SECONDS = 6;

// Environment setup
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
// WebSocket port is RPC port + 1 (8899 -> 8900)
const WS_URL = RPC_URL.replace("http", "ws").replace(":8899", ":8900");

describe("OpportunityMarket", () => {
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

  describe("Full Suite", () => {

    it("can work with vote tokens", async () => {
      // Get Arcium environment
      const arciumEnv = getArciumEnv();

      // Generate a new keypair
      const buyer = await generateKeyPairSigner();

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

      // Generate real x25519 keypair for encryption
      const keypair = generateX25519Keypair()

      const initVoteTokenAccountIx = await initVoteTokenAccount({
        signer: buyer,
        userPubkey: Array.from(keypair.publicKey),
        nonce,
        },
         {
          clusterOffset: arciumEnv.arciumClusterOffset,
          computationOffset,
        },
      );

      console.log("   Built initVoteTokenAccount instruction");

      await sendTransaction(
        rpc,
        sendAndConfirmTransaction,
        buyer,
        [initVoteTokenAccountIx],
        { label: "initVoteTokenAccount" }
      );
      await awaitComputationFinalization(
        rpc,
        computationOffset,
      )
    });
  });

  it("passes full opportunity market flow", async () => {
    // Market funding amount (1 SOL) - must match rewardLamports in createTestEnvironment
    const marketFundingLamports = 1_000_000_000n;

    // Airdrop enough SOL to cover funding + fees (2 SOL for creator)
    const env = await createTestEnvironment(provider, programId, {
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

    // Set open timestamp to now + small buffer
    const openTimestamp = BigInt(Math.floor(Date.now() / 1000) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

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
  });
});
