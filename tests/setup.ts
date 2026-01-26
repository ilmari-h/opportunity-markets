import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ConvictionMarket } from "../target/types/conviction_market";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  deserializeLE,
  x25519,
  RescueCipher,
} from "@arcium-hq/client";

// ============================================================================
// Type Definitions
// ============================================================================

export type Account = {
  keypair: anchor.web3.Keypair;
  pubkey: PublicKey;
  x25519Keypair: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  };
  cipher: RescueCipher;
  voteTokenAccountPDA: PublicKey;
};

export type MarketOption = {
  index: number;
  name: string;
  pda: PublicKey;
};

export type MarketState = {
  pda: PublicKey;
  index: anchor.BN;
  maxOptions: number;
  maxShares: anchor.BN;
  fundingLamports: anchor.BN;
  timeToStake: anchor.BN;
  timeToReveal: anchor.BN;
  openTimestamp: anchor.BN;
  options: MarketOption[];
};

export type Setup = {
  users: Account[];
  market: MarketState;
  marketCreator: Account;
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  numUsers: 3,
  airdropAmount: new anchor.BN(2 * LAMPORTS_PER_SOL),
  marketConfig: {
    maxOptions: 5,
    maxShares: new anchor.BN(1000),
    fundingLamports: new anchor.BN(1_000_000_000 ), // 0.001 SOL
    timeToStake: new anchor.BN(120),
    timeToReveal: new anchor.BN(10),
  },
  optionNames: ["Option A", "Option B", "Option C"],
};

// ============================================================================
// Utility Functions
// ============================================================================

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

// ============================================================================
// SetupHelper Class
// ============================================================================

export class SetupHelper {
  private program: Program<ConvictionMarket>;
  private provider: anchor.AnchorProvider;
  private arciumEnv: ReturnType<typeof getArciumEnv>;
  private clusterAccount: PublicKey;
  private mxePublicKey: Uint8Array;
  private config: typeof DEFAULT_CONFIG;

  constructor(
    program: Program<ConvictionMarket>,
    provider: anchor.AnchorProvider,
    mxePublicKey: Uint8Array,
    config?: Partial<typeof DEFAULT_CONFIG>
  ) {
    this.program = program;
    this.provider = provider;
    this.mxePublicKey = mxePublicKey;
    this.arciumEnv = getArciumEnv();
    this.clusterAccount = getClusterAccAddress(this.arciumEnv.arciumClusterOffset);

    // Merge config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      marketConfig: {
        ...DEFAULT_CONFIG.marketConfig,
        ...(config?.marketConfig || {}),
      },
    };
  }

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  async create(): Promise<Setup> {
    console.log("\n=== Creating Test Setup ===\n");

    // Create market creator
    const marketCreator = await this.createUser("Market Creator");

    // Create market (with options, funding, opening)
    const market = await this.createMarket(marketCreator);

    // Create users in parallel
    const users = await this.createUsers(this.config.numUsers);

    console.log("\n=== Setup Complete ===\n");

    return { users, market, marketCreator };
  }

  // ============================================================================
  // Private Setup Methods
  // ============================================================================

  private async createUser(name?: string): Promise<Account> {
    const displayName = name || "User";
    console.log(`Creating ${displayName}...`);

    // Generate keypair
    const keypair = anchor.web3.Keypair.generate();
    const pubkey = keypair.publicKey;

    // Airdrop SOL
    const airdropSig = await this.provider.connection.requestAirdrop(
      pubkey,
      this.config.airdropAmount.toNumber()
    );
    await this.provider.connection.confirmTransaction(airdropSig, "confirmed");
    console.log(`  ${displayName}:`, pubkey.toBase58());
    console.log(
      `  Airdropped ${this.config.airdropAmount.toNumber() / LAMPORTS_PER_SOL} SOL`
    );

    // Generate x25519 keypair for encryption
    const privateKey = x25519.utils.randomPrivateKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const x25519Keypair = { privateKey, publicKey };

    // Derive shared secret with MXE
    const sharedSecret = x25519.getSharedSecret(privateKey, this.mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Derive VTA PDA
    const voteTokenAccountPDA = this.deriveVoteTokenAccountPDA(pubkey);

    // Initialize VTA
    await this.initializeUserVTA({
      keypair,
      pubkey,
      x25519Keypair,
      cipher,
      voteTokenAccountPDA,
    });

    return { keypair, pubkey, x25519Keypair, cipher, voteTokenAccountPDA };
  }

  private async createUsers(count: number): Promise<Account[]> {
    console.log(`\nCreating ${count} users...`);

    // Create users sequentially to avoid MPC computation conflicts
    const users: Account[] = [];
    for (let i = 0; i < count; i++) {
      const user = await this.createUser(`User ${i + 1}`);
      users.push(user);
    }

    return users;
  }

  private async initializeUserVTA(user: Account): Promise<void> {
    const nonce = randomBytes(16);
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const initSig = await this.program.methods
      .initVoteTokenAccount(
        computationOffset,
        Array.from(user.x25519Keypair.publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        signer: user.pubkey,
        voteTokenAccount: user.voteTokenAccountPDA,
        computationAccount: getComputationAccAddress(
          this.arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount: this.clusterAccount,
        mxeAccount: getMXEAccAddress(this.program.programId),
        mempoolAccount: getMempoolAccAddress(this.arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          this.arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          this.program.programId,
          Buffer.from(getCompDefAccOffset("init_vote_token_account")).readUInt32LE()
        ),
      })
      .signers([user.keypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log("  VTA init tx:", initSig.slice(0, 20) + "...");

    await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.program.programId,
      "confirmed"
    );

    console.log("  VTA initialized!");
  }

  private async createMarket(creator: Account): Promise<MarketState> {
    console.log("\nCreating conviction market...");

    // Generate random market index to avoid collisions between tests
    const marketIndex = new anchor.BN(Math.floor(Math.random() * 1000000));
    const marketPDA = this.deriveMarketPDA(creator.pubkey, marketIndex);

    // Create market with encrypted state
    const marketNonce = randomBytes(16);
    const marketComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const createMarketSig = await sendWithRetry(() =>
      this.program.methods
        .createMarket(
          marketIndex,
          marketComputationOffset,
          this.config.marketConfig.maxOptions,
          this.config.marketConfig.maxShares,
          this.config.marketConfig.fundingLamports,
          this.config.marketConfig.timeToStake,
          this.config.marketConfig.timeToReveal,
          new anchor.BN(deserializeLE(marketNonce).toString()),
          null
        )
        .accountsPartial({
          creator: creator.pubkey,
          market: marketPDA,
          computationAccount: getComputationAccAddress(
            this.arciumEnv.arciumClusterOffset,
            marketComputationOffset
          ),
          clusterAccount: this.clusterAccount,
          mxeAccount: getMXEAccAddress(this.program.programId),
          mempoolAccount: getMempoolAccAddress(this.arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            this.arciumEnv.arciumClusterOffset
          ),
          compDefAccount: getCompDefAccAddress(
            this.program.programId,
            Buffer.from(getCompDefAccOffset("init_market_shares")).readUInt32LE()
          ),
        })
        .signers([creator.keypair])
        .rpc({ skipPreflight: true, commitment: "confirmed" })
    );

    console.log("  Create market tx:", createMarketSig.slice(0, 20) + "...");

    await awaitComputationFinalization(
      this.provider,
      marketComputationOffset,
      this.program.programId,
      "confirmed"
    );

    console.log("  Market encrypted state initialized!");

    // Add options
    const options = await this.addMarketOptions(marketPDA, creator);

    // Fund and open market
    const openTimestamp = await this.fundAndOpenMarket(marketPDA, creator);

    return {
      pda: marketPDA,
      index: marketIndex,
      maxOptions: this.config.marketConfig.maxOptions,
      maxShares: this.config.marketConfig.maxShares,
      fundingLamports: this.config.marketConfig.fundingLamports,
      timeToStake: this.config.marketConfig.timeToStake,
      timeToReveal: this.config.marketConfig.timeToReveal,
      openTimestamp,
      options,
    };
  }

  private async addMarketOptions(
    marketPDA: PublicKey,
    creator: Account
  ): Promise<MarketOption[]> {
    console.log("\nAdding market options...");

    const options: MarketOption[] = [];

    for (let i = 0; i < this.config.optionNames.length; i++) {
      const optionIndex = i + 1; // Options start from 1
      const optionName = this.config.optionNames[i];
      const optionPDA = this.deriveOptionPDA(marketPDA, optionIndex);

      await sendWithRetry(() =>
        this.program.methods
          .addMarketOption(optionIndex, optionName)
          .accountsPartial({
            creator: creator.pubkey,
            market: marketPDA,
            option: optionPDA,
          })
          .signers([creator.keypair])
          .rpc({ commitment: "confirmed" })
      );

      console.log(`  Added option ${optionIndex} "${optionName}"`);

      options.push({
        index: optionIndex,
        name: optionName,
        pda: optionPDA,
      });
    }

    return options;
  }

  private async fundAndOpenMarket(
    marketPDA: PublicKey,
    creator: Account
  ): Promise<anchor.BN> {
    console.log("\nFunding and opening market...");

    // Transfer funding amount
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.pubkey,
        toPubkey: marketPDA,
        lamports: this.config.marketConfig.fundingLamports.toNumber(),
      })
    );
    fundTx.feePayer = creator.pubkey;
    fundTx.recentBlockhash = (
      await this.provider.connection.getLatestBlockhash()
    ).blockhash;
    fundTx.sign(creator.keypair);

    const fundSig = await this.provider.connection.sendRawTransaction(
      fundTx.serialize(),
      { skipPreflight: true }
    );
    await this.provider.connection.confirmTransaction(fundSig, "confirmed");
    console.log(
      "  Market funded with",
      this.config.marketConfig.fundingLamports.toNumber() / LAMPORTS_PER_SOL,
      "SOL"
    );

    // Open market with timestamp 10 seconds in the future
    const currentSlot = await this.provider.connection.getSlot();
    const currentTimestamp = await this.provider.connection.getBlockTime(
      currentSlot
    );
    const openTimestamp = new anchor.BN(currentTimestamp! + 10);

    const openMarketSig = await this.program.methods
      .openMarket(openTimestamp)
      .accountsPartial({
        creator: creator.pubkey,
        market: marketPDA,
      })
      .signers([creator.keypair])
      .rpc({ commitment: "confirmed" });

    console.log("  Market opened at timestamp:", openTimestamp.toNumber());

    return openTimestamp;
  }

  // ============================================================================
  // PDA Derivation Utilities
  // ============================================================================

  private deriveMarketPDA(creator: PublicKey, index: anchor.BN): PublicKey {
    const [marketPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("conviction_market"),
        creator.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
    return marketPDA;
  }

  private deriveOptionPDA(marketPDA: PublicKey, optionIndex: number): PublicKey {
    const optionIndexBN = new anchor.BN(optionIndex);
    const [optionPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("option"),
        marketPDA.toBuffer(),
        optionIndexBN.toArrayLike(Buffer, "le", 2), // u16 = 2 bytes
      ],
      this.program.programId
    );
    return optionPDA;
  }

  private deriveVoteTokenAccountPDA(userPubkey: PublicKey): PublicKey {
    const [voteTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vote_token_account"), userPubkey.toBuffer()],
      this.program.programId
    );
    return voteTokenAccountPDA;
  }

  deriveShareAccountPDA(userPubkey: PublicKey, marketPDA: PublicKey): PublicKey {
    const [shareAccountPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("share_account"),
        userPubkey.toBuffer(),
        marketPDA.toBuffer(),
      ],
      this.program.programId
    );
    return shareAccountPDA;
  }

  // ============================================================================
  // Public Helper Methods for Tests
  // ============================================================================

  async createShareAccount(
    user: Account,
    marketPDA: PublicKey
  ): Promise<PublicKey> {
    const shareAccountPDA = this.deriveShareAccountPDA(user.pubkey, marketPDA);
    const nonce = new anchor.BN(deserializeLE(randomBytes(16)).toString());

    const initSig = await this.program.methods
      .initShareAccount(nonce)
      .accountsPartial({
        signer: user.pubkey,
        market: marketPDA,
        shareAccount: shareAccountPDA,
      })
      .signers([user.keypair])
      .rpc({ commitment: "confirmed" });

    console.log("  Share account initialized:", shareAccountPDA.toBase58());
    return shareAccountPDA;
  }

  async mintVoteTokens(user: Account, amount: number): Promise<void> {
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const mintSig = await this.program.methods
      .mintVoteTokens(
        computationOffset,
        Array.from(user.x25519Keypair.publicKey),
        new anchor.BN(amount)
      )
      .accounts({
        signer: user.pubkey,
        computationAccount: getComputationAccAddress(
          this.arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount: this.clusterAccount,
        mxeAccount: getMXEAccAddress(this.program.programId),
        mempoolAccount: getMempoolAccAddress(this.arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          this.arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          this.program.programId,
          Buffer.from(getCompDefAccOffset("buy_vote_tokens")).readUInt32LE()
        ),
      })
      .signers([user.keypair])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.program.programId,
      "confirmed"
    );

    console.log(`  Minted ${amount} vote tokens`);
  }
}
