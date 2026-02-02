import {
  RescueCipher,
  x25519,
  getArciumEnv,
  getMXEPublicKey,
  deserializeLE,
} from "@arcium-hq/client";
import {
  KeyPairSigner,
  Address,
  generateKeyPairSigner,
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  OpportunityMarket,
  OpportunityMarketOption,
  createMarket,
  fetchOpportunityMarket,
  randomComputationOffset,
} from "../js/src";
import { randomBytes } from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface Account {
  keypair: KeyPairSigner;
  x25519Keypair: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  };
  cipher: RescueCipher;
  initialAirdroppedLamports: bigint;
}

export interface AccountWithVTA extends Account {
  voteTokenAccount: Address;
}

export type WithAddress<T> = T & {
  address: Address;
};

export interface TestEnvironment {
  market: WithAddress<OpportunityMarket> & {
    creatorAccount: Account;
    options: WithAddress<OpportunityMarketOption>[];
  };
  participants: Account[];
  rpc: ReturnType<typeof createSolanaRpc>;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
}

export interface CreateTestEnvironmentConfig {
  rpcUrl?: string;
  wsUrl?: string;
  numParticipants?: number;
  airdropLamports?: bigint;
  marketConfig?: {
    maxShares?: bigint;
    rewardLamports?: bigint;
    timeToStake?: bigint;
    timeToReveal?: bigint;
  };
}

const DEFAULT_CONFIG: Required<CreateTestEnvironmentConfig> = {
  rpcUrl: "http://127.0.0.1:8899",
  wsUrl: "ws://127.0.0.1:8900",
  numParticipants: 5,
  airdropLamports: 2_000_000_000n, // 2 SOL
  marketConfig: {
    maxShares: 1000n,
    rewardLamports: 1_000_000_000n, // 1 SOL
    timeToStake: 120n, // 2 minutes
    timeToReveal: 60n, // 1 minute
  },
};

/**
 * Fetches the MXE public key from the chain with retry logic.
 */
async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: anchor.web3.PublicKey,
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
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

/**
 * Creates a test account with x25519 keypair and cipher for encryption.
 */
async function createAccount(mxePublicKey: Uint8Array): Promise<Omit<Account, "initialAirdroppedLamports">> {
  const keypair = await generateKeyPairSigner();

  // Generate x25519 keypair for encryption
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const x25519Keypair = { privateKey, publicKey };

  // Derive shared secret with MXE and create cipher
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  return { keypair, x25519Keypair, cipher };
}

/**
 * Creates a test environment with participant accounts, airdrops, and a market.
 *
 * This function:
 * 1. Creates the specified number of participant accounts (default: 5)
 * 2. Creates a market creator account
 * 3. Airdrops SOL to all accounts in parallel
 * 4. Creates a market using the createMarket instruction
 *
 * Note: This does NOT initialize vote token accounts or open the market.
 * Those operations require MPC computation and should be done separately.
 */
export async function createTestEnvironment(
  provider: anchor.AnchorProvider,
  programId: Address,
  config: CreateTestEnvironmentConfig = {}
): Promise<TestEnvironment> {
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    marketConfig: { ...DEFAULT_CONFIG.marketConfig, ...config.marketConfig },
  };

  const { rpcUrl, wsUrl, numParticipants, airdropLamports, marketConfig } = mergedConfig;

  console.log("\n=== Creating Test Environment ===\n");

  // Initialize RPC clients
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Fetch MXE public key (requires web3.js PublicKey for @arcium-hq/client)
  console.log("Fetching MXE public key...");
  const programIdLegacy = new PublicKey(programId);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programIdLegacy);
  console.log("  MXE public key fetched successfully");

  // Create all accounts (participants + market creator)
  console.log(`\nCreating ${numParticipants + 1} accounts...`);
  const accountPromises = Array.from({ length: numParticipants + 1 }, () =>
    createAccount(mxePublicKey)
  );
  const accounts = await Promise.all(accountPromises);

  // Split into participants and creator
  const participantAccounts = accounts.slice(0, numParticipants);
  const creatorAccountBase = accounts[numParticipants];

  console.log(`  Created ${numParticipants} participant accounts`);
  console.log(`  Created market creator account: ${creatorAccountBase.keypair.address}`);

  // Airdrop to all accounts in parallel
  console.log(`\nAirdropping ${Number(airdropLamports) / 1_000_000_000} SOL to all accounts...`);
  const airdropPromises = accounts.map((account) =>
    airdrop({
      recipientAddress: account.keypair.address,
      lamports: lamports(airdropLamports),
      commitment: "confirmed",
    })
  );
  await Promise.all(airdropPromises);
  console.log("  Airdrops complete");

  // Build the final account objects with airdrop amounts
  const participants: Account[] = participantAccounts.map((account) => ({
    ...account,
    initialAirdroppedLamports: airdropLamports,
  }));

  const creatorAccount: Account = {
    ...creatorAccountBase,
    initialAirdroppedLamports: airdropLamports,
  };

  // Create the market
  console.log("\nCreating market...");
  const arciumEnv = getArciumEnv();
  const marketIndex = BigInt(Math.floor(Math.random() * 1000000));
  const nonce = deserializeLE(randomBytes(16));
  const computationOffset = randomComputationOffset();

  const createMarketIx = await createMarket(
    {
      creator: creatorAccount.keypair,
      marketIndex,
      maxShares: marketConfig.maxShares,
      rewardLamports: marketConfig.rewardLamports,
      timeToStake: marketConfig.timeToStake,
      timeToReveal: marketConfig.timeToReveal,
      marketAuthority: null,
      nonce,
    },
    {
      clusterOffset: arciumEnv.arciumClusterOffset,
      computationOffset,
      programId,
    }
  );

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

  // Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(creatorAccount.keypair.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions([createMarketIx], msg)
  );

  // Sign the transaction
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

  // Simulate first to see any errors
  console.log("  Simulating createMarket transaction...");
  const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
  const simResult = await rpc.simulateTransaction(base64Tx, {
    commitment: "confirmed",
    encoding: "base64",
  }).send();

  console.log("  Simulation result:");
  console.log("    Error:", simResult.value.err);
  console.log("    Logs:");
  simResult.value.logs?.forEach((log) => console.log("      ", log));

  if (simResult.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simResult.value.err)}`);
  }

  // Send and confirm transaction using Kit RPC
  console.log("  Sending createMarket transaction...");
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  const signature = getSignatureFromTransaction(signedTransaction);
  console.log("  Market created! Signature:", signature.slice(0, 20) + "...");

  // Get market address from the instruction accounts and fetch from chain
  const marketAddress = createMarketIx.accounts[1].address as Address;
  const marketAccount = await fetchOpportunityMarket(rpc, marketAddress, { commitment: "confirmed" });

  console.log("\n=== Test Environment Ready ===\n");
  console.log(`  Market address: ${marketAddress}`);
  console.log(`  Market creator: ${creatorAccount.keypair.address}`);
  console.log(`  Participants: ${participants.length}`);

  // Return environment with fetched market data
  return {
    market: {
      ...marketAccount.data,
      address: marketAddress,
      creatorAccount,
      options: [], // Options need to be added separately via addMarketOption
    },
    participants,
    rpc,
    rpcSubscriptions,
  };
}