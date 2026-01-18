import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { SealedBidAuction } from "../target/types/sealed_bid_auction";
import { randomBytes } from "crypto";
import { createMint } from "@solana/spl-token";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  buildFinalizeCompDefTx,
  getMXEAccAddress,
  getMXEPublicKey,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  RescueCipher,
  deserializeLE,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

function getClusterAccount(): PublicKey {
  const arciumEnv = getArciumEnv();
  return getClusterAccAddress(arciumEnv.arciumClusterOffset);
}

describe("ConvictionMarket", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .SealedBidAuction as Program<SealedBidAuction>;
  const provider = anchor.getProvider();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccount();

  let owner: anchor.web3.Keypair;
  let mxePublicKey: Uint8Array;
  let compDefsInitialized = false;

  before(async () => {
    owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Get MXE public key for encryption
    mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("MXE x25519 pubkey is", mxePublicKey);

    // Initialize computation definitions
    if (!compDefsInitialized) {
      console.log("\n=== Initializing Computation Definitions ===\n");

      await initCompDef(program, owner, "init_market_state");
      await initCompDef(program, owner, "init_vote_token_account");
      await initCompDef(program, owner, "calculate_vote_token_balance");

      compDefsInitialized = true;
    }
  });

  describe("Market Creation", () => {
    it("creates a conviction market successfully", async () => {
      console.log("\n=== ConvictionMarket Creation Test ===\n");

      // Create a token mint for rewards
      console.log("Step 1: Creating reward token mint...");
      const rewardMint = await createMint(
        provider.connection,
        owner,
        owner.publicKey,
        null,
        6 // 6 decimals
      );
      console.log("   Reward mint:", rewardMint.toBase58());

      const marketIndex = new anchor.BN(1);
      const rewardTokenAmount = new anchor.BN(1_000_000); // 1 token with 6 decimals

      // Derive market PDA
      const [marketPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("conviction_market"),
          owner.publicKey.toBuffer(),
          marketIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Listen for the event
      const marketCreatedPromise = awaitEvent("marketCreatedEvent");

      // Create market
      console.log("\nStep 2: Creating conviction market...");
      const createMarketSig = await program.methods
        .createMarket(marketIndex, rewardTokenAmount)
        .accountsPartial({
          creator: owner.publicKey,
          market: marketPDA,
          rewardTokenMint: rewardMint,
        })
        .rpc({ commitment: "confirmed" });

      console.log("   Create market tx:", createMarketSig);

      // Verify event
      const marketCreatedEvent = await marketCreatedPromise;
      console.log("\n=== Market Created Event ===");
      console.log("   Market:", marketCreatedEvent.market.toBase58());
      console.log("   Creator:", marketCreatedEvent.creator.toBase58());
      console.log("   Index:", marketCreatedEvent.index.toNumber());

      // Assertions
      expect(marketCreatedEvent.market.toBase58()).to.equal(
        marketPDA.toBase58()
      );
      expect(marketCreatedEvent.creator.toBase58()).to.equal(
        owner.publicKey.toBase58()
      );
      expect(marketCreatedEvent.index.toNumber()).to.equal(1);

      // Fetch and verify on-chain account
      const marketAccount = await program.account.convictionMarket.fetch(
        marketPDA
      );
      expect(marketAccount.creator.toBase58()).to.equal(
        owner.publicKey.toBase58()
      );
      expect(marketAccount.index.toNumber()).to.equal(1);
      expect(marketAccount.rewardTokenMint.toBase58()).to.equal(
        rewardMint.toBase58()
      );
      expect(marketAccount.rewardTokenAmount.toNumber()).to.equal(1_000_000);

      console.log("\n   ConvictionMarket creation test PASSED!");
    });

    it("creates multiple markets with different indices", async () => {
      console.log("\n=== Multiple Markets Test ===\n");

      // Create a token mint for rewards
      const rewardMint = await createMint(
        provider.connection,
        owner,
        owner.publicKey,
        null,
        6
      );

      // Create market with index 2
      const marketIndex2 = new anchor.BN(2);
      const [marketPDA2] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("conviction_market"),
          owner.publicKey.toBuffer(),
          marketIndex2.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createMarket(marketIndex2, new anchor.BN(500_000))
        .accountsPartial({
          creator: owner.publicKey,
          market: marketPDA2,
          rewardTokenMint: rewardMint,
        })
        .rpc({ commitment: "confirmed" });

      // Create market with index 3
      const marketIndex3 = new anchor.BN(3);
      const [marketPDA3] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("conviction_market"),
          owner.publicKey.toBuffer(),
          marketIndex3.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createMarket(marketIndex3, new anchor.BN(2_000_000))
        .accountsPartial({
          creator: owner.publicKey,
          market: marketPDA3,
          rewardTokenMint: rewardMint,
        })
        .rpc({ commitment: "confirmed" });

      // Verify both markets exist with correct data
      const market2 = await program.account.convictionMarket.fetch(marketPDA2);
      const market3 = await program.account.convictionMarket.fetch(marketPDA3);

      expect(market2.index.toNumber()).to.equal(2);
      expect(market2.rewardTokenAmount.toNumber()).to.equal(500_000);

      expect(market3.index.toNumber()).to.equal(3);
      expect(market3.rewardTokenAmount.toNumber()).to.equal(2_000_000);

      console.log("   Multiple markets test PASSED!");
    });
  });

  describe("Vote Token Buy/Sell", () => {
    const PRICE_PER_VOTE_TOKEN_LAMPORTS = 1_000_000; // Must match Rust constant

    it("allows a user to buy and sell vote tokens", async () => {
      console.log("\n=== Vote Token Buy/Sell Test ===\n");

      // Create a new buyer keypair
      const buyer = anchor.web3.Keypair.generate();

      // Airdrop SOL to buyer
      console.log("Step 1: Airdropping SOL to buyer...");
      const airdropSig = await provider.connection.requestAirdrop(
        buyer.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig, "confirmed");
      console.log("   Buyer:", buyer.publicKey.toBase58());
      console.log("   Airdrop complete: 2 SOL");

      // Derive PDAs
      const [voteTokenAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote_token_account"), buyer.publicKey.toBuffer()],
        program.programId
      );

      // ========== STEP 2: Initialize vote token account ==========
      const nonce = randomBytes(16);
      const computationOffset = new anchor.BN(randomBytes(8), "hex");

      console.log("\nStep 2: Initializing vote token account...");
      const initSig = await program.methods
        .initVoteTokenAccount(
          computationOffset,
          new anchor.BN(deserializeLE(nonce).toString())
        )
        .accountsPartial({
          signer: buyer.publicKey,
          owner: buyer.publicKey,
          voteTokenAccount: voteTokenAccountPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_vote_token_account")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("   Init tx:", initSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        computationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Vote token account initialized!");

      // ========== STEP 3: Buy vote tokens ==========
      const buyAmount = 100; // Buy 100 vote tokens
      const buyLamports = buyAmount * PRICE_PER_VOTE_TOKEN_LAMPORTS;

      // Get balances before buy
      const buyerBalanceBefore = await provider.connection.getBalance(buyer.publicKey);
      const vtaBalanceBefore = await provider.connection.getBalance(voteTokenAccountPDA);

      console.log("\nStep 3: Buying", buyAmount, "vote tokens...");
      console.log("   Buyer SOL before:", buyerBalanceBefore / anchor.web3.LAMPORTS_PER_SOL);
      console.log("   VTA SOL before:", vtaBalanceBefore / anchor.web3.LAMPORTS_PER_SOL);

      const computationOffsetBuy = new anchor.BN(randomBytes(8), "hex");
      const buySig = await program.methods
        .mintVoteTokens(
          computationOffsetBuy,
          new anchor.BN(buyAmount),
          true // buy = true
        )
        .accounts({
          signer: buyer.publicKey,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffsetBuy
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("calculate_vote_token_balance")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("   Buy tx:", buySig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        computationOffsetBuy,
        program.programId,
        "confirmed"
      );

      // Get balances after buy
      const buyerBalanceAfterBuy = await provider.connection.getBalance(buyer.publicKey);
      const vtaBalanceAfterBuy = await provider.connection.getBalance(voteTokenAccountPDA);

      console.log("   Buyer SOL after buy:", buyerBalanceAfterBuy / anchor.web3.LAMPORTS_PER_SOL);
      console.log("   VTA SOL after buy:", vtaBalanceAfterBuy / anchor.web3.LAMPORTS_PER_SOL);

      // Verify SOL was transferred to VTA
      expect(vtaBalanceAfterBuy).to.be.greaterThan(vtaBalanceBefore);
      console.log("   Buy successful! SOL transferred to VTA.");

      // ========== STEP 4: Sell vote tokens ==========
      const sellAmount = 50; // Sell 50 vote tokens (should succeed)
      const sellLamports = sellAmount * PRICE_PER_VOTE_TOKEN_LAMPORTS;

      console.log("\nStep 4: Selling", sellAmount, "vote tokens...");

      const computationOffsetSell = new anchor.BN(randomBytes(8), "hex");
      const sellSig = await program.methods
        .mintVoteTokens(
          computationOffsetSell,
          new anchor.BN(sellAmount),
          false // buy = false (sell)
        )
        .accounts({
          signer: buyer.publicKey,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffsetSell
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("calculate_vote_token_balance")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("   Sell tx:", sellSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        computationOffsetSell,
        program.programId,
        "confirmed"
      );

      // Get balances after sell
      const buyerBalanceAfterSell = await provider.connection.getBalance(buyer.publicKey);
      const vtaBalanceAfterSell = await provider.connection.getBalance(voteTokenAccountPDA);

      console.log("   Buyer SOL after sell:", buyerBalanceAfterSell / anchor.web3.LAMPORTS_PER_SOL);
      console.log("   VTA SOL after sell:", vtaBalanceAfterSell / anchor.web3.LAMPORTS_PER_SOL);

      // Verify SOL was transferred back to buyer
      expect(buyerBalanceAfterSell).to.be.greaterThan(buyerBalanceAfterBuy);
      expect(vtaBalanceAfterSell).to.be.lessThan(vtaBalanceAfterBuy);
      console.log("   Sell successful! SOL transferred back to buyer.");

      // ========== STEP 5: Try to sell more than balance (should fail gracefully) ==========
      const oversellAmount = 1000; // Try to sell 1000 tokens (only have 50 left)

      // TODO: this hangs
      // console.log("\nStep 5: Attempting to oversell", oversellAmount, "vote tokens (should fail)...");

      // const vtaBalanceBeforeOversell = await provider.connection.getBalance(voteTokenAccountPDA);
      // const buyerBalanceBeforeOversell = await provider.connection.getBalance(buyer.publicKey);

      // const computationOffsetOversell = new anchor.BN(randomBytes(8), "hex");
      // const oversellSig = await program.methods
      //   .mintVoteTokens(
      //     computationOffsetOversell,
      //     new anchor.BN(oversellAmount),
      //     false // buy = false (sell)
      //   )
      //   .accounts({
      //     signer: buyer.publicKey,
      //     computationAccount: getComputationAccAddress(
      //       arciumEnv.arciumClusterOffset,
      //       computationOffsetOversell
      //     ),
      //     clusterAccount,
      //     mxeAccount: getMXEAccAddress(program.programId),
      //     mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
      //     executingPool: getExecutingPoolAccAddress(
      //       arciumEnv.arciumClusterOffset
      //     ),
      //     compDefAccount: getCompDefAccAddress(
      //       program.programId,
      //       Buffer.from(getCompDefAccOffset("calculate_vote_token_balance")).readUInt32LE()
      //     ),
      //   })
      //   .signers([buyer])
      //   .rpc({ skipPreflight: true, commitment: "confirmed" });

      // console.log("   Oversell tx:", oversellSig);

      // console.log("   Waiting for MPC computation to finalize...");
      // await awaitComputationFinalization(
      //   provider as anchor.AnchorProvider,
      //   computationOffsetOversell,
      //   program.programId,
      //   "confirmed"
      // );

      // // Get balances after oversell attempt
      // const buyerBalanceAfterOversell = await provider.connection.getBalance(buyer.publicKey);
      // const vtaBalanceAfterOversell = await provider.connection.getBalance(voteTokenAccountPDA);

      // console.log("   VTA SOL after oversell attempt:", vtaBalanceAfterOversell / anchor.web3.LAMPORTS_PER_SOL);

      // // VTA balance should be unchanged (no transfer because error=true)
      // // Note: There might be small differences due to rent, but no large transfer should occur
      // const vtaBalanceDiff = Math.abs(vtaBalanceAfterOversell - vtaBalanceBeforeOversell);
      // expect(vtaBalanceDiff).to.be.lessThan(oversellAmount * PRICE_PER_VOTE_TOKEN_LAMPORTS);
      // console.log("   Oversell correctly rejected! No SOL transferred.");

      console.log("\n   Vote token buy/sell test PASSED!");
    });
  });

  type CompDefs = "init_market_state" | "init_vote_token_account" | "calculate_vote_token_balance"

  async function initCompDef(
    program: Program<SealedBidAuction>,
    owner: anchor.web3.Keypair,
    circuitName: CompDefs
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset(circuitName);

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Check if comp def account already exists (from genesis or previous run)
    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
    if (accountInfo !== null) {
      console.log(`   Comp def ${circuitName} already initialized, skipping...`);
      return "already_initialized";
    }

    let sig: string;
    switch (circuitName) {
      case "init_market_state":
        sig = await program.methods
          .initMarketStateCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "init_vote_token_account":
        sig = await program.methods
          .initVoteTokenAccountCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "calculate_vote_token_balance":
        sig = await program.methods
          .calculateVoteTokenBalanceCompDef()
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

    // Finalize computation definition
    const finalizeTx = await buildFinalizeCompDefTx(
      provider as anchor.AnchorProvider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);

    return sig;
  }
});

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

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
