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
import {
  awaitComputationFinalization,
  initVoteTokenAccount,
  openMarket,
  randomComputationOffset,
  mintVoteTokens,
  addMarketOption,
  initShareAccount,
  buyMarketShares,
  selectOption,
  fetchOpportunityMarket,
  revealShares,
  incrementOptionTally,
  closeShareAccount,
  fetchShareAccount,
  getShareAccountAddress,
  fetchOpportunityMarketOption,
  getOpportunityMarketOptionAddress,
  awaitBatchComputationFinalization,
} from "../js/src";
import { createTestEnvironment } from "./utils/environment";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { getArciumEnv, deserializeLE } from "@arcium-hq/client";
import { OpportunityMarket } from "../target/types/opportunity_market";
import * as fs from "fs";
import * as os from "os";
import { randomBytes } from "crypto";
import { generateX25519Keypair, createCipher } from "../js/src/x25519/keypair";
import { expect } from "chai";
import { sleepUntilOnChainTimestamp } from "./utils/sleep";

const ONCHAIN_TIMESTAMP_BUFFER_SECONDS = 6;
const ESTIMATED_MAX_ACCOUNT_RENT = BigInt(3_000_000)

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
    const numParticipants = 4;

    // Airdrop enough SOL to cover funding + fees (2 SOL for creator)
    const env = await createTestEnvironment(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants,
      airdropLamports: 2_000_000_000n, // 2 SOL
      marketConfig: {
        rewardLamports: marketFundingLamports,
        timeToStake: 120n,
        timeToReveal: 15n, // Reasonable reliability for tests
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

    // Initialize vote token accounts for ALL participants in parallel
    const initVtaData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const offset = randomComputationOffset();
        const nonce = deserializeLE(randomBytes(16));
        const ix = await initVoteTokenAccount(
          {
            signer: participant.keypair,
            userPubkey: participant.x25519Keypair.publicKey,
            nonce,
          },
          {
            clusterOffset: arciumEnv.arciumClusterOffset,
            computationOffset: offset,
          }
        );
        return { participant, ix, offset, idx };
      })
    );

    // For some reason my transaction logic is broken when ran in parallel - doing these in sequence
    for(const {participant, ix, idx} of initVtaData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Init VTA ${idx}`
      })
    }

    // Wait for all VTA computations to finalize in parallel
    await awaitBatchComputationFinalization(rpc, initVtaData.map(({offset}) => offset))

    // Mint vote tokens for all participants + add market options in parallel
    const mintAmount = 100_000_000n;
    const mintData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const offset = randomComputationOffset();
        const ix = await mintVoteTokens(
          {
            signer: participant.keypair,
            userPubkey: participant.x25519Keypair.publicKey,
            amount: mintAmount,
          },
          {
            clusterOffset: arciumEnv.arciumClusterOffset,
            computationOffset: offset,
          }
        );
        return { participant, ix, offset, idx };
      })
    );

    const addOptionAIx = await addMarketOption({
      creator: env.market.creatorAccount.keypair,
      market: env.market.address,
      optionIndex: 1,
      name: "Option A",
    });

    const addOptionBIx = await addMarketOption({
      creator: env.market.creatorAccount.keypair,
      market: env.market.address,
      optionIndex: 2,
      name: "Option B",
    });

    for(const {participant, ix, idx} of mintData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Mint vote tokens ${idx}`
      })
    }

    // Options must be crearted in sequence
    await sendTransaction(rpc, sendAndConfirmTransaction, env.market.creatorAccount.keypair, [addOptionAIx], {
      label: "Add Option A",
    })
    await sendTransaction(rpc, sendAndConfirmTransaction, env.market.creatorAccount.keypair, [addOptionBIx], {
      label: "Add Option B",
    })

    await awaitBatchComputationFinalization(rpc, mintData.map(({ offset }) => offset))

    // Wait for market to be open
    await sleepUntilOnChainTimestamp(openTimestamp + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Initialize share accounts for all participants
    const initShareData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const nonce = deserializeLE(randomBytes(16));
        const ix = await initShareAccount({
          signer: participant.keypair,
          market: env.market.address,
          stateNonce: nonce,
        });
        return { participant, ix, idx };
      })
    );

    console.log("Initializing share accounts")
    for (const { participant, ix, idx } of initShareData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Init share account [${idx}]`,
      });
    }

    console.log("Share accounts initialized")

    // Define voting: half vote for Option A (winning), half for Option B (losing)
    const winningOptionIndex = 1; // Option A
    const buySharesAmounts = [50n, 75n, 100n, 60n]; // Varying amounts per participant

    // Buy shares for all participants in parallel
    const buySharesData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const cipher = createCipher(participant.x25519Keypair.secretKey, env.mxePublicKey);
        const amount = buySharesAmounts[idx];
        const selectedOption = idx < numParticipants / 2 ? 1n : 2n; // First half vote A, second half vote B
        const inputNonce = randomBytes(16);
        const ciphertexts = cipher.encrypt([amount, selectedOption], inputNonce);
        const computationOffset = randomComputationOffset();
        const disclosureNonce = deserializeLE(randomBytes(16));

        const ix = await buyMarketShares(
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
            computationOffset,
          }
        );
        return { participant, ix, computationOffset, idx, amount, selectedOption };
      })
    );

    console.log("Buyin shares")

    for (const { participant, ix, idx } of buySharesData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Buy shares [${idx}]`,
      });
    }
    console.log("Shares bought")

    // Wait for all buy shares computations
    await awaitBatchComputationFinalization(rpc, buySharesData.map(({computationOffset}) => computationOffset))

    // Market creator selects winning option (Option A)
    const selectOptionIx = selectOption({
      authority: env.market.creatorAccount.keypair,
      market: env.market.address,
      optionIndex: winningOptionIndex,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, env.market.creatorAccount.keypair, [selectOptionIx], {
      label: "Select winning option",
    });
    const resolvedMarket = await fetchOpportunityMarket(rpc, env.market.address);
    expect(resolvedMarket.data.selectedOption).to.deep.equal(some(winningOptionIndex));

    // Only winners (participants 0-2) reveal shares in parallel
    const winners = env.participants.slice(0, numParticipants / 2);
    const winnerSharesData = buySharesData.slice(0, numParticipants / 2);

    const revealData = await Promise.all(
      winners.map(async (participant, idx) => {
        const computationOffset = randomComputationOffset();
        const ix = await revealShares(
          {
            signer: participant.keypair,
            owner: participant.keypair.address,
            market: env.market.address,
            userPubkey: participant.x25519Keypair.publicKey,
          },
          {
            clusterOffset: arciumEnv.arciumClusterOffset,
            computationOffset,
          }
        );
        return { participant, ix, computationOffset, idx };
      })
    );

    console.log("Revealing shares")

    // Send all reveal transactions sequentially
    for (const { participant, ix, idx } of revealData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Reveal shares [${idx}]`,
      });
    }

    console.log("Awaiting reveal computation")
    // Wait for all reveal computations to finalize in parallel
    await awaitBatchComputationFinalization(rpc, revealData.map(({computationOffset}) => computationOffset))

    console.log("Shares revealed")

    // Verify revealed shares for winners
    for (let i = 0; i < winners.length; i++) {
      const participant = winners[i];
      const expectedAmount = winnerSharesData[i].amount;
      const [shareAccountAddress] = await getShareAccountAddress(participant.keypair.address, env.market.address);
      const revealedShareAccount = await fetchShareAccount(rpc, shareAccountAddress);

      expect(revealedShareAccount.data.revealedAmount).to.deep.equal(some(expectedAmount));
      expect(revealedShareAccount.data.revealedOption).to.deep.equal(some(winningOptionIndex));
    }

    // All winners increment option tally
    const incrementTallyData = await Promise.all(
      winners.map(async (participant, idx) => {
        const ix = await incrementOptionTally({
          signer: participant.keypair,
          owner: participant.keypair.address,
          market: env.market.address,
          optionIndex: winningOptionIndex,
        });
        return { participant, ix, idx };
      })
    );

    for (const { participant, ix, idx } of incrementTallyData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Increment tally [${idx}]`,
      });
    }

    // Verify option tally was updated with total winning shares
    const totalWinningShares = buySharesAmounts.slice(0, numParticipants / 2).reduce((a, b) => a + b, 0n);
    const [optionAddress] = await getOpportunityMarketOptionAddress(env.market.address, winningOptionIndex);
    const optionAccount = await fetchOpportunityMarketOption(rpc, optionAddress);
    expect(optionAccount.data.totalShares).to.deep.equal(some(totalWinningShares));

    // Wait for reveal period to end
    const timeToReveal = Number(env.market.timeToReveal);
    await sleepUntilOnChainTimestamp((new Date().getTime() / 1000) + timeToReveal);

    // Get balances before closing for all winners
    const balancesBefore = await Promise.all(
      winners.map(async (participant) => ({
        participant,
        balance: await rpc.getBalance(participant.keypair.address).send(),
      }))
    );
    const marketBalanceBefore = await rpc.getBalance(env.market.address).send();

    // All winners close share accounts and claim rewards
    const closeShareData = await Promise.all(
      winners.map(async (participant, idx) => {
        const ix = await closeShareAccount({
          owner: participant.keypair,
          market: env.market.address,
          optionIndex: winningOptionIndex,
        });
        return { participant, ix, idx };
      })
    );

    for (const { participant, ix, idx } of closeShareData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Close share account [${idx}]`,
      });
    }

    // Verify share accounts were closed for all winners
    for (const participant of winners) {
      const [shareAccountAddress] = await getShareAccountAddress(participant.keypair.address, env.market.address);
      const shareAccountAfterClose = await rpc.getAccountInfo(shareAccountAddress).send();
      expect(shareAccountAfterClose.value).to.be.null;
    }

    // Get balances after closing
    const balancesAfter = await Promise.all(
      winners.map(async (participant) => ({
        participant,
        balance: await rpc.getBalance(participant.keypair.address).send(),
      }))
    );
    const marketBalanceAfter = await rpc.getBalance(env.market.address).send();

    // Calculate gains for each winner
    const gains: { participant: typeof winners[0]; gain: bigint; shares: bigint }[] = [];
    for (let i = 0; i < winners.length; i++) {
      const gain = balancesAfter[i].balance.value - balancesBefore[i].balance.value;
      gains.push({
        participant: winners[i],
        gain,
        shares: winnerSharesData[i].amount,
      });
    }

    // All winners should have gained funds
    for (const { gain } of gains) {
      expect(gain > 0n).to.be.true;
    }

    // Total market loss should equal the full reward amount, tolerance of 1 lamport for rounding error.
    const marketLoss = marketBalanceBefore.value - marketBalanceAfter.value;
    expect(marketLoss >= marketFundingLamports - 1n && marketLoss <= marketFundingLamports + 1n).to.be.true;

    // Verify proportional reward distribution (with tolerance for staking time variance and rent)
    // Reward is based on: (participant_shares / total_shares) * reward_amount
    // Plus rent refund from closing share account
    // Allow 5% tolerance due to staking time differences affecting the calculation
    const REWARD_TOLERANCE_PERCENT = 5n;

    for (const { gain, shares } of gains) {
      // Expected reward = (shares / totalShares) * marketFundingLamports
      const expectedReward = (shares * marketFundingLamports) / totalWinningShares;

      // Account for rent refund (estimate ~2.5M lamports per share account)
      const minExpected = expectedReward - (expectedReward * REWARD_TOLERANCE_PERCENT) / 100n;
      const maxExpected = expectedReward + ESTIMATED_MAX_ACCOUNT_RENT + (expectedReward * REWARD_TOLERANCE_PERCENT) / 100n;

      expect(gain >= minExpected && gain <= maxExpected).to.be.true;
    }

    // Verify total gains approximately equal reward + rent refunds
    const totalGains = gains.reduce((sum, { gain }) => sum + gain, 0n);
    const expectedTotalGains = marketFundingLamports + ESTIMATED_MAX_ACCOUNT_RENT * BigInt(winners.length);
    expect(totalGains >= marketFundingLamports).to.be.true;
    expect(totalGains <= expectedTotalGains).to.be.true;
  });
});
