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

  describe("Vote Token Purchase", () => {
    it("allows a user to purchase vote tokens", async () => {
      console.log("\n=== Vote Token Purchase Test ===\n");

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

      // Create encryption keys for buyer
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      // Amount of tokens to purchase 
      const nonce = randomBytes(16);
      // Derive PDAs
      const [voteTokenAccountPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote_token_account"), buyer.publicKey.toBuffer()],
        program.programId
      );

      const [voteTokenVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vote_token_vault")],
        program.programId
      );

      // Computation offset for Arcium
      const computationOffset = new anchor.BN(randomBytes(8), "hex");

      console.log("\nStep 2: Purchasing vote tokens with encrypted amount...");
      const purchaseSig = await program.methods
        .initVoteTokenAccount(
          computationOffset,
          new anchor.BN(deserializeLE(nonce).toString()) // nonce
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

      console.log("   Init tx:", purchaseSig);

      // Wait for MPC computation to finalize
      console.log("\nStep 3: Waiting for MPC computation to finalize...");
      const finalizeSig = await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        computationOffset,
        program.programId,
        "confirmed"
      );
      console.log("   Finalize tx:", finalizeSig);

      // Verify VoteToken account
      console.log("\n=== Verifying VoteToken Account ===");
      const vta = await program.account.voteToken.fetch(voteTokenAccountPDA);
      expect(vta.owner.toBase58()).to.equal(buyer.publicKey.toBase58());
      console.log("   Owner:", vta.owner.toBase58());
      console.log("   State nonce:", vta.stateNonce.toString());
      console.log(
        "   Encrypted state:",
        Buffer.from(vta.encryptedState[0]).toString("hex").slice(0, 32) +
          "..."
      );

      // Verify nonce was updated by callback (should be different from initial)
      expect(vta.stateNonce.toString()).to.not.equal("0");

      const computationOffsetMint = new anchor.BN(randomBytes(8), "hex");
      const vtMintAmount = 1000
      const mintVoteTokensSig = await program.methods
        .mintVoteTokens(
          computationOffsetMint,
          new anchor.BN(vtMintAmount),
          true
        )
        .accounts({
          signer: buyer.publicKey,
          //voteTokenAccount: voteTokenAccountPDA,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffsetMint
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
        .rpc({commitment: "confirmed"});

      console.log("   Mint tx:", mintVoteTokensSig);

      // Wait for MPC computation to finalize
      console.log("\nStep 4: Waiting for MPC computation to finalize...");
      const finalizeSig2 = await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        computationOffsetMint,
        program.programId,
        "confirmed"
      );
      console.log("   Finalize tx:", finalizeSig2);

      console.log("\n   Vote token purchase test PASSED!");
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
