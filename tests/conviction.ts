import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ConvictionMarket } from "../target/types/conviction_market";
import { randomBytes } from "crypto";
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
  deserializeLE,
  x25519,
  RescueCipher,
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
    .ConvictionMarket as Program<ConvictionMarket>;
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

      await initCompDef(program, owner, "init_vote_token_account");
      await initCompDef(program, owner, "calculate_vote_token_balance");
      await initCompDef(program, owner, "buy_conviction_market_shares");
      await initCompDef(program, owner, "init_market_shares");

      compDefsInitialized = true;
    }
  });

  describe("Market Creation and Setup", () => {
    it("creates a market, adds options, funds and opens it", async () => {
      console.log("\n=== Market Creation and Setup Test ===\n");

      const PRICE_PER_SHARE_LAMPORTS = 1_000_000; // Must match Rust constant
      const marketIndex = new anchor.BN(1);
      const maxOptions = 5; // u16
      const totalShares = new anchor.BN(1000); // 1000 shares
      const fundingLamports = totalShares.toNumber() * PRICE_PER_SHARE_LAMPORTS; // = 1 SOL
      const timeToStake = new anchor.BN(3600); // 1 hour
      const timeToReveal = new anchor.BN(1800); // 30 minutes

      // Derive market PDA
      const [marketPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("conviction_market"),
          owner.publicKey.toBuffer(),
          marketIndex.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // ========== STEP 1: Create Market ==========
      console.log("Step 1: Creating conviction market...");
      const marketCreatedPromise = awaitEvent("marketCreatedEvent");

      const marketNonce = randomBytes(16);
      const marketComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const createMarketSig = await program.methods
        .createMarket(
          marketIndex,
          marketComputationOffset,
          maxOptions,
          totalShares,
          timeToStake,
          timeToReveal,
          new anchor.BN(deserializeLE(marketNonce).toString()),
          null
        )
        .accountsPartial({
          creator: owner.publicKey,
          market: marketPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            marketComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_market_shares")).readUInt32LE()
          ),
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("   Create market tx:", createMarketSig);

      const marketCreatedEvent = await marketCreatedPromise;
      console.log("   Market created:", marketCreatedEvent.market.toBase58());

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        marketComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Market encrypted state initialized!");

      // Verify market state
      let marketAccount = await program.account.convictionMarket.fetch(marketPDA);
      expect(marketAccount.totalOptions).to.equal(0);
      expect(marketAccount.maxOptions).to.equal(5);
      expect(marketAccount.openTimestamp).to.be.null;
      console.log("   Market initialized with 0 options, max 5");

      // ========== STEP 2: Add 3 Options ==========
      console.log("\nStep 2: Adding 3 market options...");

      const optionNames = ["Option A", "Option B", "Option C"];

      for (let i = 1; i <= 3; i++) {
        const optionIndex = i; // u16
        const optionIndexBN = new anchor.BN(i);
        const [optionPDA] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("option"),
            marketPDA.toBuffer(),
            optionIndexBN.toArrayLike(Buffer, "le", 2), // u16 = 2 bytes
          ],
          program.programId
        );

        const addOptionSig = await program.methods
          .addMarketOption(optionIndex, optionNames[i - 1])
          .accountsPartial({
            creator: owner.publicKey,
            market: marketPDA,
            option: optionPDA,
          })
          .rpc({ commitment: "confirmed" });

        console.log(`   Added option ${i} "${optionNames[i - 1]}": ${addOptionSig.slice(0, 20)}...`);

        // Verify option account
        const optionAccount = await program.account.convictionMarketOption.fetch(optionPDA);
        expect(optionAccount.name).to.equal(optionNames[i - 1]);
        expect(optionAccount.totalShares).to.be.null;
      }

      // Verify market total options updated
      marketAccount = await program.account.convictionMarket.fetch(marketPDA);
      expect(marketAccount.totalOptions).to.equal(3);
      console.log("   Market now has 3 options");

      // ========== STEP 3: Fund and Open Market ==========
      console.log("\nStep 3: Funding and opening market...");
      console.log("   Market PDA:", marketPDA.toBase58());
      console.log("   Total shares:", totalShares.toNumber());
      console.log("   Funding lamports:", fundingLamports);

      // Transfer total_shares * PRICE_PER_SHARE_LAMPORTS to market PDA
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: marketPDA,
          lamports: fundingLamports,
        })
      );
      fundTx.feePayer = owner.publicKey;
      fundTx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      fundTx.sign(owner);

      console.log("   Sending fund transaction...");
      const fundSig = await provider.connection.sendRawTransaction(fundTx.serialize(), {
        skipPreflight: true,
      });
      console.log("   Fund tx sent:", fundSig);
      await provider.connection.confirmTransaction(fundSig, "confirmed");
      console.log("   Funded market with", fundingLamports / LAMPORTS_PER_SOL, "SOL");

      // Open market with timestamp 10 seconds in the future
      const currentSlot = await provider.connection.getSlot();
      const currentTimestamp = await provider.connection.getBlockTime(currentSlot);
      const openTimestamp = new anchor.BN(currentTimestamp + 10);

      const openMarketSig = await program.methods
        .openMarket(openTimestamp)
        .accountsPartial({
          creator: owner.publicKey,
          market: marketPDA,
        })
        .rpc({ commitment: "confirmed" });

      console.log("   Opened market:", openMarketSig.slice(0, 20) + "...");

      // Verify market is now open
      marketAccount = await program.account.convictionMarket.fetch(marketPDA);
      expect(marketAccount.openTimestamp).to.not.be.null;
      expect(marketAccount.openTimestamp!.toNumber()).to.equal(openTimestamp.toNumber());
      console.log("   Market open_timestamp set to:", openTimestamp.toNumber());


      // ========== STEP 4: Create buyer and initialize their vote token account ==========
      console.log("\nStep 4: Setting up buyer...");

      const buyer = anchor.web3.Keypair.generate();

      // Airdrop SOL to buyer
      const airdropSig = await provider.connection.requestAirdrop(
        buyer.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig, "confirmed");
      console.log("   Buyer:", buyer.publicKey.toBase58());
      console.log("   Airdrop complete: 2 SOL");

      // Initialize buyer's vote token account
      const [buyerVoteTokenPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote_token_account"), buyer.publicKey.toBuffer()],
        program.programId
      );

      const buyerVtaNonce = randomBytes(16);
      const buyerVtaComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const initBuyerVtaSig = await program.methods
        .initVoteTokenAccount(
          buyerVtaComputationOffset,
          new anchor.BN(deserializeLE(buyerVtaNonce).toString())
        )
        .accountsPartial({
          signer: buyer.publicKey,
          owner: buyer.publicKey,
          voteTokenAccount: buyerVoteTokenPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            buyerVtaComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_vote_token_account")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      console.log("   Init buyer VTA tx:", initBuyerVtaSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        buyerVtaComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Buyer vote token account initialized!");

      // ========== STEP 5: Buyer mints vote tokens ==========
      console.log("\nStep 5: Buyer minting vote tokens...");

      const mintAmount = 100;
      const mintComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const mintSig = await program.methods
        .mintVoteTokens(mintComputationOffset, new anchor.BN(mintAmount), true)
        .accounts({
          signer: buyer.publicKey,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            mintComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("calculate_vote_token_balance")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      console.log("   Mint tx:", mintSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        mintComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Buyer minted", mintAmount, "vote tokens!");

      // ========== STEP 5b: Initialize buyer's share account ==========
      console.log("\nStep 5b: Initializing buyer's share account...");

      const [buyerShareAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_account"), buyer.publicKey.toBuffer(), marketPDA.toBuffer()],
        program.programId
      );

      const shareAccountNonce = new anchor.BN(deserializeLE(randomBytes(16)).toString());

      const initShareAccountSig = await program.methods
        .initShareAccount(shareAccountNonce)
        .accountsPartial({
          signer: buyer.publicKey,
          market: marketPDA,
          shareAccount: buyerShareAccountPDA,
        })
        .signers([buyer])
        .rpc({ commitment: "confirmed" });

      console.log("   Init share account tx:", initShareAccountSig);
      console.log("   Share account PDA:", buyerShareAccountPDA.toBase58());

      // ========== STEP 6: Buy market shares with encrypted inputs ==========
      console.log("\nStep 6: Buying market shares with encrypted inputs...");

      // Wait for staking period to be active
      const currentSlotBeforeBuy = await provider.connection.getSlot();
      const currentTimestampBeforeBuy = await provider.connection.getBlockTime(currentSlotBeforeBuy);
      const targetTimestamp = openTimestamp.toNumber() + 3; // 3 second safety buffer

      if (currentTimestampBeforeBuy! < targetTimestamp) {
        const sleepMs = (targetTimestamp - currentTimestampBeforeBuy!) * 1000;
        console.log(`   Waiting ${sleepMs}ms for staking period to start...`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }

      // Generate X25519 keypair for encryption
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);

      // Derive shared secret with MXE
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      // Encrypt amount (50 vote tokens) and selected_option (option index 1)
      const buySharesAmount = BigInt(50);
      const selectedOption = BigInt(1);
      const inputNonce = randomBytes(16);

      // Encrypt both fields together as a struct (BuySharesInput { amount: u64, selected_option: u16 })
      const ciphertexts = cipher.encrypt([buySharesAmount, selectedOption], inputNonce);

      const buySharesComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const buySharesSig = await program.methods
        .buyMarketShares(
          buySharesComputationOffset,
          Array.from(ciphertexts[0]),
          Array.from(ciphertexts[1]),
          Array.from(publicKey),
          new anchor.BN(deserializeLE(inputNonce).toString()),

          Array.from(publicKey),
          new anchor.BN(deserializeLE(randomBytes(16)).toString()),
        )
        .accountsPartial({
          signer: buyer.publicKey,
          market: marketPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            buySharesComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("buy_conviction_market_shares")).readUInt32LE()
          ),
        })
        .signers([buyer])
        .rpc({ commitment: "confirmed" });

      console.log("   Buy shares tx:", buySharesSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        buySharesComputationOffset,
        program.programId,
        "confirmed"
      );

      // // Verify user share account was created
      // const userShareAccount = await program.account.convictionMarketShare.fetch(userSharePDA);
      // expect(userShareAccount.owner.toBase58()).to.equal(buyer.publicKey.toBase58());
      // expect(userShareAccount.market.toBase58()).to.equal(marketPDA.toBase58());
      // console.log("   User share account created!");
      // console.log("   Encrypted state stored:", userShareAccount.encryptedState.length, "ciphertexts");

      // console.log("\n   Market creation, setup, and share purchase test PASSED!");
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

  type CompDefs =  "init_vote_token_account" | "calculate_vote_token_balance" | "buy_conviction_market_shares" | "init_market_shares"

  async function initCompDef(
    program: Program<ConvictionMarket>,
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
      case "buy_conviction_market_shares":
        sig = await program.methods
          .buyConvictionMarketSharesCompDef()
          .accounts({
            compDefAccount: compDefPDA,
            payer: owner.publicKey,
            mxeAccount: getMXEAccAddress(program.programId),
          })
          .signers([owner])
          .rpc({ preflightCommitment: "confirmed" });
        break;
      case "init_market_shares":
        sig = await program.methods
          .initMarketSharesCompDef()
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
