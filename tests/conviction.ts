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
import { SetupHelper, Setup, Account } from "./setup";

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
      await initCompDef(program, owner, "buy_vote_tokens");
      await initCompDef(program, owner, "claim_vote_tokens");
      await initCompDef(program, owner, "buy_conviction_market_shares");
      await initCompDef(program, owner, "init_market_shares");
      await initCompDef(program, owner, "reveal_shares");

      compDefsInitialized = true;
    }
  });

  describe("Market Creation and Setup", () => {
    let setup: Setup;
    let setupHelper: SetupHelper;

    beforeEach(async () => {
      setupHelper = new SetupHelper(program, provider as anchor.AnchorProvider, mxePublicKey);
      setup = await setupHelper.create();
    });

    it("allows user to buy shares and claim yield", async () => {
      console.log("\n=== Testing Buy Shares and Claim Yield ===\n");

      const { users, market } = setup;
      const buyer = users[0];

      // Initialize buyer's share account
      console.log("\nInitializing buyer's share account...");
      const buyerShareAccountPDA = await setupHelper.createShareAccount(buyer, market.pda);

      // Mint vote tokens for buyer
      console.log("\nMinting vote tokens for buyer...");
      const mintAmount = 100;
      await setupHelper.mintVoteTokens(buyer, mintAmount);

      // ========== Buy market shares with encrypted inputs ==========
      console.log("\nBuying market shares with encrypted inputs...");

      // Wait for staking period to be active
      const currentSlotBeforeBuy = await provider.connection.getSlot();
      const currentTimestampBeforeBuy = await provider.connection.getBlockTime(currentSlotBeforeBuy);
      const targetTimestamp = market.openTimestamp.toNumber() + 3; // 3 second safety buffer

      if (currentTimestampBeforeBuy! < targetTimestamp) {
        const sleepMs = (targetTimestamp - currentTimestampBeforeBuy!) * 1000;
        console.log(`   Waiting ${sleepMs}ms for staking period to start...`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }

      // Encrypt amount (50 vote tokens) and selected_option (option index 1)
      const buySharesAmount = BigInt(50);
      const selectedOption = BigInt(1);
      const inputNonce = randomBytes(16);

      // Encrypt both fields together as a struct (BuySharesInput { amount: u64, selected_option: u16 })
      const ciphertexts = buyer.cipher.encrypt([buySharesAmount, selectedOption], inputNonce);

      const buySharesComputationOffset = new anchor.BN(randomBytes(8), "hex");
      const disclosureNonce = new anchor.BN(deserializeLE(randomBytes(16)));

      const buySharesSig = await sendWithRetry(() =>
        program.methods
          .buyMarketShares(
            buySharesComputationOffset,
            Array.from(ciphertexts[0]),
            Array.from(ciphertexts[1]),
            Array.from(buyer.x25519Keypair.publicKey),
            new anchor.BN(deserializeLE(inputNonce).toString()),

            Array.from(buyer.x25519Keypair.publicKey),
            disclosureNonce,
          )
          .accountsPartial({
            signer: buyer.pubkey,
            market: market.pda,
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
          .signers([buyer.keypair])
          .rpc({ commitment: "confirmed" })
      );

      console.log("   Buy shares tx:", buySharesSig);

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        buySharesComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Shares purchased!");

      // ========== Verify share account ==========
      console.log("\nVerifying share account...");

      // Fetch the share account
      const shareAccount = await program.account.shareAccount.fetch(buyerShareAccountPDA);

      // Verify share account properties
      expect(shareAccount.owner.toBase58()).to.equal(buyer.pubkey.toBase58());
      expect(shareAccount.market.toBase58()).to.equal(market.pda.toBase58());

      const decryptedShareValues = buyer.cipher.decrypt(
        shareAccount.encryptedState,
        Uint8Array.from(
          shareAccount.stateNonce.toArray("le", 16)
        )
      );
      expect(decryptedShareValues[0]).to.equal(buySharesAmount);
      expect(decryptedShareValues[1]).to.equal(selectedOption);

      // ========== Market creator selects winning option ==========
      console.log("\nMarket creator selects winning option...");

      // Select option 1 (the same option the buyer chose)
      const selectedOptionIndex = 1;

      const selectOptionSig = await program.methods
        .selectOption(selectedOptionIndex)
        .accountsPartial({
          authority: setup.marketCreator.pubkey,
          market: market.pda,
        })
        .signers([setup.marketCreator.keypair])
        .rpc({ commitment: "confirmed" });

      console.log("   Select option tx:", selectOptionSig.slice(0, 20) + "...");

      // Verify market has selected option set
      let marketAccount = await program.account.convictionMarket.fetch(market.pda);
      expect(marketAccount.selectedOption).to.not.be.null;
      expect(marketAccount.selectedOption).to.equal(selectedOptionIndex);
      console.log("   Market selected option:", marketAccount.selectedOption);

      // ========== User reveals shares ==========
      console.log("\nUser reveals shares...");

      const revealComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const revealSharesSig = await program.methods
        .revealShares(revealComputationOffset, Array.from(buyer.x25519Keypair.publicKey))
        .accountsPartial({
          signer: buyer.pubkey,
          market: market.pda,
          owner: buyer.pubkey,
          shareAccount: buyerShareAccountPDA,
          userVta: buyer.voteTokenAccountPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            revealComputationOffset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("reveal_shares")).readUInt32LE()
          ),
        })
        .signers([buyer.keypair])
        .rpc({ commitment: "confirmed" });

      console.log("   Reveal shares tx:", revealSharesSig.slice(0, 20) + "...");

      console.log("   Waiting for MPC computation to finalize...");
      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        revealComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Shares revealed!");

      // ========== Verify revealed shares ==========
      console.log("\nVerifying revealed shares...");

      const revealedShareAccount = await program.account.shareAccount.fetch(buyerShareAccountPDA);

      expect(revealedShareAccount.revealedAmount).to.not.be.null;
      expect(revealedShareAccount.revealedOption).to.not.be.null;
      expect(revealedShareAccount.revealedAmount!.toString()).to.equal(buySharesAmount.toString());
      expect(revealedShareAccount.revealedOption).to.equal(Number(selectedOption));

      console.log("   Revealed amount:", revealedShareAccount.revealedAmount!.toNumber());
      console.log("   Revealed option:", revealedShareAccount.revealedOption);

      // ========== Increment option tally ==========
      console.log("\nIncrementing option tally...");

      // Get option PDA from market setup
      const optionPDA = market.options[selectedOptionIndex - 1].pda;

      const incrementTallySig = await program.methods
        .incrementOptionTally(selectedOptionIndex)
        .accountsPartial({
          signer: buyer.pubkey,
          owner: buyer.pubkey,
          market: market.pda,
          shareAccount: buyerShareAccountPDA,
          option: optionPDA,
        })
        .signers([buyer.keypair])
        .rpc({ commitment: "confirmed" });

      console.log("   Increment tally tx:", incrementTallySig.slice(0, 20) + "...");

      // Verify option tally was incremented
      const optionAccount = await program.account.convictionMarketOption.fetch(optionPDA);
      expect(optionAccount.totalShares).to.not.be.null;
      expect(optionAccount.totalShares.toString()).to.equal(buySharesAmount.toString());
      console.log("   Option tally total shares:", optionAccount.totalShares.toNumber());
      console.log("   Option tally total score:", optionAccount.totalScore?.toNumber() || 0);

      // ========== Wait for reveal period to end and close share account ==========
      console.log("\nWaiting for reveal period to end, then closing share account...");

      // Wait for reveal period end
      const sleepMs = market.timeToReveal.muln(1000).toNumber()
      console.log(`   Waiting ${sleepMs}ms for reveal period to end...`);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));

      console.log("   Reveal period ended. Closing share account...");

      // Get buyer balance before closing
      const buyerBalanceBeforeClose = await provider.connection.getBalance(buyer.pubkey);
      const marketBalanceBeforeClose = await provider.connection.getBalance(market.pda);

      const closeShareAccountSig = await program.methods
        .closeShareAccount(selectedOptionIndex)
        .accountsPartial({
          owner: buyer.pubkey,
          market: market.pda,
          shareAccount: buyerShareAccountPDA,
          option: optionPDA,
        })
        .signers([buyer.keypair])
        .rpc({ commitment: "confirmed" });

      console.log("   Close share account tx:", closeShareAccountSig.slice(0, 20) + "...");

      // Verify share account was closed and rent refunded
      const shareAccountAfterClose = await provider.connection.getAccountInfo(buyerShareAccountPDA);
      expect(shareAccountAfterClose).to.be.null;
      console.log("   Share account closed successfully!");

      // Verify buyer received rent refund + reward
      const buyerBalanceAfterClose = await provider.connection.getBalance(buyer.pubkey);
      const marketBalanceAfterClose = await provider.connection.getBalance(market.pda);

      const buyerBalanceIncrease = buyerBalanceAfterClose - buyerBalanceBeforeClose;
      const marketBalanceDecrease = marketBalanceBeforeClose - marketBalanceAfterClose;

      expect(buyerBalanceAfterClose).to.be.greaterThan(buyerBalanceBeforeClose);
      console.log("   Buyer balance increased by:",
        buyerBalanceIncrease / LAMPORTS_PER_SOL, "SOL");
      console.log("   Market balance decreased by:",
        marketBalanceDecrease / LAMPORTS_PER_SOL, "SOL");

      // Since the buyer was the only one who bought shares for the winning option,
      // they should receive approximately 100% of the reward
      const expectedReward = market.fundingLamports.toNumber();
      const actualReward = marketBalanceDecrease;

      console.log("   Expected reward:", expectedReward / LAMPORTS_PER_SOL, "SOL");
      console.log("   Actual reward:", actualReward / LAMPORTS_PER_SOL, "SOL");

      // Allow for small rounding errors (within 0.1% of expected)
      const rewardDifference = Math.abs(actualReward - expectedReward);
      const allowedDifference = expectedReward * 0.001; // 0.1% tolerance
      expect(rewardDifference).to.be.lessThan(allowedDifference);
      console.log("   ✓ Buyer received ~100% of reward lamports (within 0.1% tolerance)");

      console.log("\n   Test PASSED! Revealed shares match purchased shares, share account closed successfully, and buyer received full reward!");
    });
  });

  describe("Multi-User Scenarios", () => {
    let setup: Setup;
    let setupHelper: SetupHelper;

    beforeEach(async () => {
      setupHelper = new SetupHelper(program, provider as anchor.AnchorProvider, mxePublicKey);
      setup = await setupHelper.create();
    });

    it("allows three users to vote for different options", async () => {
      console.log("\n=== Testing Three Users Voting for Different Options ===\n");

      const { users, market } = setup;

      // Each user gets 100 vote tokens
      for (const user of users) {
        await setupHelper.mintVoteTokens(user, 100);
      }

      // Each user buys shares for a different option
      const shareAccounts: PublicKey[] = [];
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const selectedOption = BigInt(i + 1); // User 0 → Option 1, User 1 → Option 2, User 2 → Option 3

        // Initialize share account
        const shareAccountPDA = await setupHelper.createShareAccount(user, market.pda);
        shareAccounts.push(shareAccountPDA);

        // Wait for staking period
        const currentSlot = await provider.connection.getSlot();
        const currentTimestamp = await provider.connection.getBlockTime(currentSlot);
        const targetTimestamp = market.openTimestamp.toNumber() + 3;

        if (currentTimestamp! < targetTimestamp) {
          const sleepMs = (targetTimestamp - currentTimestamp!) * 1000;
          console.log(`   Waiting ${sleepMs}ms for staking period to start...`);
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
        }

        // Buy 50 shares for this option
        const buySharesAmount = BigInt(50);
        const inputNonce = randomBytes(16);
        const ciphertexts = user.cipher.encrypt([buySharesAmount, selectedOption], inputNonce);
        const buySharesComputationOffset = new anchor.BN(randomBytes(8), "hex");
        const disclosureNonce = new anchor.BN(deserializeLE(randomBytes(16)));

        await sendWithRetry(() =>
          program.methods
            .buyMarketShares(
              buySharesComputationOffset,
              Array.from(ciphertexts[0]),
              Array.from(ciphertexts[1]),
              Array.from(user.x25519Keypair.publicKey),
              new anchor.BN(deserializeLE(inputNonce).toString()),
              Array.from(user.x25519Keypair.publicKey),
              disclosureNonce,
            )
            .accountsPartial({
              signer: user.pubkey,
              market: market.pda,
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
            .signers([user.keypair])
            .rpc({ commitment: "confirmed" })
        );

        await awaitComputationFinalization(
          provider as anchor.AnchorProvider,
          buySharesComputationOffset,
          program.programId,
          "confirmed"
        );

        console.log(`   User ${i + 1} bought 50 shares for Option ${selectedOption}`);
      }

      // Verify each user's encrypted shares
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const shareAccount = await program.account.shareAccount.fetch(shareAccounts[i]);
        const decryptedValues = user.cipher.decrypt(
          shareAccount.encryptedState,
          Uint8Array.from(shareAccount.stateNonce.toArray("le", 16))
        );
        expect(decryptedValues[0]).to.equal(BigInt(50));
        expect(decryptedValues[1]).to.equal(BigInt(i + 1));
      }

      console.log("\n   Test PASSED! All three users successfully voted for different options.");
    });

    it("distributes rewards proportionally among winners", async () => {
      console.log("\n=== Testing Proportional Reward Distribution ===\n");

      const { users, market } = setup;

      // All 3 users mint vote tokens
      for (const user of users) {
        await setupHelper.mintVoteTokens(user, 100);
      }

      // All 3 users buy different amounts of shares for option 1 (the winner)
      const shareAccounts: PublicKey[] = [];
      const shareAmounts = [BigInt(30), BigInt(40), BigInt(50)]; // Different amounts for each user

      // Wait for staking period
      const currentSlot = await provider.connection.getSlot();
      const currentTimestamp = await provider.connection.getBlockTime(currentSlot);
      const targetTimestamp = market.openTimestamp.toNumber() + 3;

      if (currentTimestamp! < targetTimestamp) {
        const sleepMs = (targetTimestamp - currentTimestamp!) * 1000;
        console.log(`   Waiting ${sleepMs}ms for staking period to start...`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const buySharesAmount = shareAmounts[i];
        const selectedOption = BigInt(1); // All vote for option 1

        // Initialize share account
        const shareAccountPDA = await setupHelper.createShareAccount(user, market.pda);
        shareAccounts.push(shareAccountPDA);

        // Buy shares
        const inputNonce = randomBytes(16);
        const ciphertexts = user.cipher.encrypt([buySharesAmount, selectedOption], inputNonce);
        const buySharesComputationOffset = new anchor.BN(randomBytes(8), "hex");
        const disclosureNonce = new anchor.BN(deserializeLE(randomBytes(16)));

        await sendWithRetry(() =>
          program.methods
            .buyMarketShares(
              buySharesComputationOffset,
              Array.from(ciphertexts[0]),
              Array.from(ciphertexts[1]),
              Array.from(user.x25519Keypair.publicKey),
              new anchor.BN(deserializeLE(inputNonce).toString()),
              Array.from(user.x25519Keypair.publicKey),
              disclosureNonce,
            )
            .accountsPartial({
              signer: user.pubkey,
              market: market.pda,
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
            .signers([user.keypair])
            .rpc({ commitment: "confirmed" })
        );

        await awaitComputationFinalization(
          provider as anchor.AnchorProvider,
          buySharesComputationOffset,
          program.programId,
          "confirmed"
        );

        console.log(`   User ${i + 1} bought ${buySharesAmount} shares for Option 1`);
      }

      // Market creator selects option 1 as winner
      await program.methods
        .selectOption(1)
        .accountsPartial({
          authority: setup.marketCreator.pubkey,
          market: market.pda,
        })
        .signers([setup.marketCreator.keypair])
        .rpc({ commitment: "confirmed" });

      console.log("   Market creator selected Option 1 as winner");

      // Reveal all shares
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const revealComputationOffset = new anchor.BN(randomBytes(8), "hex");

        await program.methods
          .revealShares(revealComputationOffset, Array.from(user.x25519Keypair.publicKey))
          .accountsPartial({
            signer: user.pubkey,
            market: market.pda,
            owner: user.pubkey,
            shareAccount: shareAccounts[i],
            userVta: user.voteTokenAccountPDA,
            computationAccount: getComputationAccAddress(
              arciumEnv.arciumClusterOffset,
              revealComputationOffset
            ),
            clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
            executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(getCompDefAccOffset("reveal_shares")).readUInt32LE()
            ),
          })
          .signers([user.keypair])
          .rpc({ commitment: "confirmed" });

        await awaitComputationFinalization(
          provider as anchor.AnchorProvider,
          revealComputationOffset,
          program.programId,
          "confirmed"
        );

        console.log(`   User ${i + 1} revealed shares`);
      }

      // Increment option tally for all users
      const optionPDA = market.options[0].pda;
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        await program.methods
          .incrementOptionTally(1)
          .accountsPartial({
            signer: user.pubkey,
            owner: user.pubkey,
            market: market.pda,
            shareAccount: shareAccounts[i],
            option: optionPDA,
          })
          .signers([user.keypair])
          .rpc({ commitment: "confirmed" });
      }

      console.log("   All users incremented option tally");

      // Wait for reveal period to end
      await new Promise((resolve) => setTimeout(resolve, market.timeToReveal.muln(1000).toNumber()));

      // Close share accounts and claim rewards
      const rewards: number[] = [];
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const balanceBefore = await provider.connection.getBalance(user.pubkey);

        await program.methods
          .closeShareAccount(1)
          .accountsPartial({
            owner: user.pubkey,
            market: market.pda,
            shareAccount: shareAccounts[i],
            option: optionPDA,
          })
          .signers([user.keypair])
          .rpc({ commitment: "confirmed" });

        const balanceAfter = await provider.connection.getBalance(user.pubkey);
        const reward = balanceAfter - balanceBefore;
        rewards.push(reward);

        console.log(`   User ${i + 1} received reward: ${reward / LAMPORTS_PER_SOL} SOL`);
      }

      // Verify total rewards distributed
      const totalReward = rewards.reduce((a, b) => a + b, 0);
      const marketFunding = market.fundingLamports.toNumber();

      console.log(`   Total rewards distributed: ${totalReward / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Market funding: ${marketFunding / LAMPORTS_PER_SOL} SOL`);

      expect(totalReward).to.be.at.least(marketFunding);
      console.log(`   ✓ Total rewards distributed (${totalReward / LAMPORTS_PER_SOL} SOL) >= market funding (${marketFunding / LAMPORTS_PER_SOL} SOL)`);

      console.log("\n   Test PASSED! Rewards distributed proportionally among all winners.");
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

      // Generate X25519 keypair for encryption
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);

      // Derive shared secret with MXE
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      console.log("\nStep 2: Initializing vote token account...");
      const initSig = await program.methods
        .initVoteTokenAccount(
          computationOffset,
          Array.from(publicKey),
          new anchor.BN(deserializeLE(nonce).toString())
        )
        .accountsPartial({
          signer: buyer.publicKey,
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
          Array.from(publicKey),
          new anchor.BN(buyAmount)
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
            Buffer.from(getCompDefAccOffset("buy_vote_tokens")).readUInt32LE()
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

      // Fetch the vote token account and verify encrypted balance
      const voteTokenAccountAfterBuy = await program.account.voteTokenAccount.fetch(voteTokenAccountPDA);

      // Decrypt the balance
      const decryptedBalanceAfterBuy = cipher.decrypt(
        voteTokenAccountAfterBuy.encryptedState,
        Uint8Array.from(
          voteTokenAccountAfterBuy.stateNonce.toArray("le", 16)
        )
      );

      expect(decryptedBalanceAfterBuy[0]).to.equal(BigInt(buyAmount));
      console.log("   Verified encrypted balance:", Number(decryptedBalanceAfterBuy[0]), "tokens");

      // ========== STEP 4: Sell vote tokens ==========
      const sellAmount = 50; // Sell 50 vote tokens (should succeed)
      const sellLamports = sellAmount * PRICE_PER_VOTE_TOKEN_LAMPORTS;

      console.log("\nStep 4: Selling", sellAmount, "vote tokens...");

      const computationOffsetSell = new anchor.BN(randomBytes(8), "hex");
      const sellSig = await program.methods
        .claimVoteTokens(
          computationOffsetSell,
          Array.from(publicKey),
          new anchor.BN(sellAmount)
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
            Buffer.from(getCompDefAccOffset("claim_vote_tokens")).readUInt32LE()
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

      // Fetch the vote token account and verify encrypted balance after sell
      const voteTokenAccountAfterSell = await program.account.voteTokenAccount.fetch(voteTokenAccountPDA);

      // Decrypt the balance
      const decryptedBalanceAfterSell = cipher.decrypt(
        voteTokenAccountAfterSell.encryptedState,
        Uint8Array.from(
          voteTokenAccountAfterSell.stateNonce.toArray("le", 16)
        )
      );

      const expectedBalanceAfterSell = buyAmount - sellAmount;
      expect(decryptedBalanceAfterSell[0]).to.equal(BigInt(expectedBalanceAfterSell));
      console.log("   Verified encrypted balance after sell:", Number(decryptedBalanceAfterSell[0]), "tokens");

      console.log("\n   Vote token buy/sell test PASSED!");
    });
  });

  type CompDefs =  "init_vote_token_account" | "buy_vote_tokens" | "claim_vote_tokens" | "buy_conviction_market_shares" | "init_market_shares" | "reveal_shares"

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
