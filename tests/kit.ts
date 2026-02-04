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
  some
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { awaitComputationFinalization, initVoteTokenAccount, openMarket, randomComputationOffset, mintVoteTokens, addMarketOption, fetchVoteTokenAccount, getVoteTokenAccountAddress, initShareAccount, buyMarketShares, selectOption, fetchOpportunityMarket } from "../js/src";
import { createTestEnvironment } from "./utils/environment";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { nonceToBytes } from "./utils/nonce";
import { getArciumEnv, deserializeLE } from "@arcium-hq/client";
import { OpportunityMarket } from "../target/types/opportunity_market";
import * as fs from "fs";
import * as os from "os";
import { randomBytes } from "crypto";
import { generateX25519Keypair, createCipher } from "../js/src/x25519/keypair";
import { expect } from "chai";
import { sleepUntilOnChainTimestamp } from "./utils/sleep";

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
  const arciumEnv = getArciumEnv();

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

      // Generate a new keypair
      const buyer = await generateKeyPairSigner();

      // Airdrop SOL for transaction fees
      const airdropAmount = lamports(2_000_000_000n);
      await airdrop({
        recipientAddress: buyer.address,
        lamports: airdropAmount,
        commitment: "confirmed",
      });

      // Generate computation offset and nonce
      const computationOffset = randomComputationOffset();
      const nonce = deserializeLE(randomBytes(16));

      // Generate real x25519 keypair for encryption
      const keypair = generateX25519Keypair();

      const initVoteTokenAccountIx = await initVoteTokenAccount({
        signer: buyer,
        userPubkey: keypair.publicKey,
        nonce,
        },
         {
          clusterOffset: arciumEnv.arciumClusterOffset,
          computationOffset,
        },
      );

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

    // Fund the market by transferring SOL from creator
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
    const openTimestamp = Math.floor(Date.now() / 1000) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS;

    const openMarketIx = openMarket({
      creator: env.market.creatorAccount.keypair,
      market: env.market.address,
      openTimestamp: BigInt(openTimestamp),
    });

    await sendTransaction(
      rpc,
      sendAndConfirmTransaction,
      env.market.creatorAccount.keypair,
      [openMarketIx],
      { label: "Open market" }
    );

    const participant = env.participants[0];

    // Initialize vote token account for participant
    const initVtaOffset = randomComputationOffset();
    const initVtaNonce = deserializeLE(randomBytes(16));

    const initVtaIx = await initVoteTokenAccount(
      {
        signer: participant.keypair,
        userPubkey: participant.x25519Keypair.publicKey,
        nonce: initVtaNonce,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: initVtaOffset,
      }
    );

    await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [initVtaIx], {
      label: "Init VTA",
    });

    await awaitComputationFinalization(rpc, initVtaOffset);

    // In parallel: mint vote tokens + add market options
    const mintComputationOffset = randomComputationOffset();
    const mintAmount = 100_000_000n;

    const mintIx = await mintVoteTokens(
      {
        signer: participant.keypair,
        userPubkey: participant.x25519Keypair.publicKey,
        amount: mintAmount,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: mintComputationOffset,
      }
    );

    const addOptionAIx = await addMarketOption({
      creator: env.market.creatorAccount.keypair,
      market: env.market.address,
      optionIndex: 1,
      name: "Option A",
    });

    // Send both in parallel
    await Promise.all([
      (async () => {
        await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [mintIx], {
          label: "Mint vote tokens",
        });
        await awaitComputationFinalization(rpc, mintComputationOffset);
      })(),
      sendTransaction(rpc, sendAndConfirmTransaction, env.market.creatorAccount.keypair, [addOptionAIx], {
        label: "Add market option A",
      }),
    ]);

    // Fetch and verify vote token balance
    const [vtaAddress] = await getVoteTokenAccountAddress(participant.keypair.address)
    const vta = await fetchVoteTokenAccount(rpc, vtaAddress);
    const cipher = createCipher(participant.x25519Keypair.secretKey, env.mxePublicKey);
    const decryptedBalance = cipher.decrypt(
      vta.data.encryptedState,
      nonceToBytes(vta.data.stateNonce)
    );
    expect(decryptedBalance[0]).to.equal(mintAmount);

    // Add more options as participant
    const addOptionBIx = await addMarketOption({
      creator: participant.keypair,
      market: env.market.address,
      optionIndex: 2,
      name: "Option B",
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [addOptionBIx], {
      label: "Add market option B",
    })

    const addOptionCIx = await addMarketOption({
      creator: participant.keypair,
      market: env.market.address,
      optionIndex: 3,
      name: "Option C",
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [addOptionCIx], {
      label: "Add market option C"
    })

    // Wait for market to be open
    await sleepUntilOnChainTimestamp(openTimestamp + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Initialize share account for participant
    const shareAccountNonce = deserializeLE(randomBytes(16));
    const initShareAccountIx = await initShareAccount({
      signer: participant.keypair,
      market: env.market.address,
      stateNonce: shareAccountNonce,
    });

    await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [initShareAccountIx], {
      label: "Init share account",
    });

    // Buy market shares with encrypted inputs
    const buySharesAmount = 50n;
    const selectedOption = 1n; // Option A

    // Encrypt the inputs
    const inputNonce = randomBytes(16);
    const ciphertexts = cipher.encrypt([buySharesAmount, selectedOption], inputNonce);

    const buySharesComputationOffset = randomComputationOffset();
    const disclosureNonce = deserializeLE(randomBytes(16));
    const buySharesIx = await buyMarketShares(
      {
        signer: participant.keypair,
        market: env.market.address,
        amountCiphertext: ciphertexts[0],
        selectedOptionCiphertext: ciphertexts[1],
        userPubkey: participant.x25519Keypair.publicKey,
        inputNonce: deserializeLE(inputNonce),
        authorizedReaderPubkey: participant.x25519Keypair.publicKey,
        authorizedReaderNonce: disclosureNonce,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: buySharesComputationOffset,
      }
    );
    await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [buySharesIx], {
      label: "Buy market shares",
    });

    await awaitComputationFinalization(rpc, buySharesComputationOffset);

    //  Market creator selects winning option
    const winningOptionIndex = 1; // Option A (same as participant chose)
    const selectOptionIx = selectOption({
      authority: env.market.creatorAccount.keypair,
      market: env.market.address,
      optionIndex: winningOptionIndex,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, env.market.creatorAccount.keypair, [selectOptionIx], {
      label: "Select winning option",
    });
    const resolvedMarket = await fetchOpportunityMarket(rpc, env.market.address);
    expect(resolvedMarket.data.selectedOption).to.deep.equal(some(winningOptionIndex))
  });
});
