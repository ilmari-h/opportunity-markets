import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  some,
  isSome,
} from "@solana/kit";
import {
  getTransferInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
} from "@solana-program/token";
import {
  initVoteTokenAccount,
  openMarket,
  randomComputationOffset,
  mintVoteTokens,
  addMarketOption,
  initShareAccount,
  stake,
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
  awaitComputationFinalization,
  getVoteTokenAccountAddress,
} from "../js/src";
import { createTestEnvironment } from "./utils/environment";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { getArciumEnv, deserializeLE, getArciumProgram } from "@arcium-hq/client";
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
  const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);

  const programId = address(program.programId.toBase58());
  const arciumEnv = getArciumEnv();

  // RPC clients for Kit
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  before(async () => {
    // Load owner secret key
    const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
    const secretKey = new Uint8Array(JSON.parse(file.toString()));

    // Initialize all computation definitions
    await initializeAllCompDefs(rpc, sendAndConfirmTransaction, secretKey, programId);
  });

  it("passes full opportunity market flow", async () => {
    // Market funding amount (SPL tokens) - must match rewardAmount in createTestEnvironment
    const marketFundingAmount = 1_000_000_000n;
    const numParticipants = 4;

    const env = await createTestEnvironment(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants,
      airdropLamports: 2_000_000_000n, // 2 SOL
      initialTokenAmount: 2_000_000_000n, // 2 billion tokens per account
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 25n,
      },
    });

    // Fund the market by transferring SPL tokens to market's ATA
    const [marketAta] = await findAssociatedTokenPda({
      mint: env.mint.address,
      owner: env.market.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const fundingIx = getTransferInstruction({
      source: env.market.creatorAccount.tokenAccount,
      destination: marketAta,
      authority: env.market.creatorAccount.keypair,
      amount: marketFundingAmount,
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
      tokenMint: env.mint.address,
      marketTokenAta: marketAta,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
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
            tokenMint: env.mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
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

    // For some reason my transaction sending code is broken when ran in parallel - doing these in sequence
    for(const {participant, ix, idx} of initVtaData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Init VTA ${idx}`
      })
    }

    // Wait for all VTA computations to finalize
    await awaitBatchComputationFinalization(rpc, initVtaData.map(({offset}) => offset))

    // Mint vote tokens for all participants
    const mintAmount = 100_000_000n;
    const mintData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const offset = randomComputationOffset();
        const ix = await mintVoteTokens(
          {
            signer: participant.keypair,
            tokenMint: env.mint.address,
            signerTokenAccount: participant.tokenAccount,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
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

    // Creator also needs a VTA to deposit from when adding options
    const creatorAccount = env.market.creatorAccount;
    const creatorX25519 = creatorAccount.x25519Keypair;
    const creatorInitVtaOffset = randomComputationOffset();
    const creatorInitVtaNonce = deserializeLE(randomBytes(16));
    const creatorInitVtaIx = await initVoteTokenAccount(
      {
        signer: creatorAccount.keypair,
        tokenMint: env.mint.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        userPubkey: creatorX25519.publicKey,
        nonce: creatorInitVtaNonce,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: creatorInitVtaOffset,
      }
    );
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [creatorInitVtaIx], {
      label: "Init creator VTA",
    });
    await awaitComputationFinalization(rpc, creatorInitVtaOffset);

    // Mint vote tokens for creator (enough for option deposits)
    const creatorMintAmount = 100n;
    const creatorMintOffset = randomComputationOffset();
    const creatorMintIx = await mintVoteTokens(
      {
        signer: creatorAccount.keypair,
        tokenMint: env.mint.address,
        signerTokenAccount: creatorAccount.tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        userPubkey: creatorX25519.publicKey,
        amount: creatorMintAmount,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: creatorMintOffset,
      }
    );

    for(const {participant, ix, idx} of mintData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Mint vote tokens ${idx}`
      })
    }
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [creatorMintIx], {
      label: "Mint creator vote tokens",
    });

    await awaitBatchComputationFinalization(rpc, [...mintData.map(({ offset }) => offset), creatorMintOffset]);

    // Wait for market staking period to be active (add_market_option requires active staking)
    await sleepUntilOnChainTimestamp(openTimestamp + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Add options (must be during staking period; each creates a share account for the creator)
    const [creatorVtaAddress] = await getVoteTokenAccountAddress(
      env.mint.address,
      creatorAccount.keypair.address,
    );
    const minDeposit = 1n;
    const creatorCipher = createCipher(creatorX25519.secretKey, env.mxePublicKey);

    // Option A (creator's shareAccountId = 0)
    const optionAOffset = randomComputationOffset();
    const inputNonceA = randomBytes(16);
    const amountCiphertextA = creatorCipher.encrypt([minDeposit], inputNonceA);
    const addOptionAIx = await addMarketOption(
      {
        creator: creatorAccount.keypair,
        market: env.market.address,
        sourceVta: creatorVtaAddress,
        optionIndex: 1,
        shareAccountId: 0,
        name: "Option A",
        amountCiphertext: amountCiphertextA[0],
        userPubkey: creatorX25519.publicKey,
        inputNonce: deserializeLE(inputNonceA),
        authorizedReaderPubkey: creatorX25519.publicKey,
        authorizedReaderNonce: deserializeLE(randomBytes(16)),
        shareAccountNonce: deserializeLE(randomBytes(16)),
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: optionAOffset,
      }
    );
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [addOptionAIx], {
      label: "Add Option A",
    });
    await awaitComputationFinalization(rpc, optionAOffset);

    // Option B (creator's shareAccountId = 1)
    const optionBOffset = randomComputationOffset();
    const inputNonceB = randomBytes(16);
    const amountCiphertextB = creatorCipher.encrypt([minDeposit], inputNonceB);
    const addOptionBIx = await addMarketOption(
      {
        creator: creatorAccount.keypair,
        market: env.market.address,
        sourceVta: creatorVtaAddress,
        optionIndex: 2,
        shareAccountId: 1,
        name: "Option B",
        amountCiphertext: amountCiphertextB[0],
        userPubkey: creatorX25519.publicKey,
        inputNonce: deserializeLE(inputNonceB),
        authorizedReaderPubkey: creatorX25519.publicKey,
        authorizedReaderNonce: deserializeLE(randomBytes(16)),
        shareAccountNonce: deserializeLE(randomBytes(16)),
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: optionBOffset,
      }
    );
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [addOptionBIx], {
      label: "Add Option B",
    });
    await awaitComputationFinalization(rpc, optionBOffset);

    // Initialize share accounts for all participants (shareAccountId = 0 for each)
    const initShareData = await Promise.all(
      env.participants.map(async (participant, idx) => {
        const nonce = deserializeLE(randomBytes(16));
        const ix = await initShareAccount({
          signer: participant.keypair,
          market: env.market.address,
          stateNonce: nonce,
          shareAccountId: 0,
        });
        return { participant, ix, idx };
      })
    );

    for (const { participant, ix, idx } of initShareData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Init share account [${idx}]`,
      });
    }

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

        const [userVta] = await getVoteTokenAccountAddress(
          env.mint.address,
          participant.keypair.address
        );

        const ix = await stake(
          {
            signer: participant.keypair,
            market: env.market.address,
            userVta,
            shareAccountId: 0,
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


    for (const { participant, ix, idx } of buySharesData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Buy shares [${idx}]`,
      });
    }

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

    // Reveal shares for winners (participants who voted option A)
    const winners = env.participants.slice(0, 2);
    const winnerSharesData = buySharesData.slice(0, 2);
    const revealData = await Promise.all(
      winners.map(async (participant, idx) => {
        const computationOffset = randomComputationOffset();
        const [userVta] = await getVoteTokenAccountAddress(
          env.mint.address,
          participant.keypair.address
        );
        const ix = await revealShares(
          {
            signer: participant.keypair,
            owner: participant.keypair.address,
            market: env.market.address,
            userVta,
            userPubkey: participant.x25519Keypair.publicKey,
            shareAccountId: 0,
          },
          {
            clusterOffset: arciumEnv.arciumClusterOffset,
            computationOffset,
          }
        );
        return { participant, ix, computationOffset, idx };
      })
    );
    for (const { participant, ix, idx } of revealData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Reveal shares [${idx}]`,
      });
    }

    // Wait for all reveal computations to finalize in parallel
    await awaitBatchComputationFinalization(rpc, revealData.map(({computationOffset}) => computationOffset))

    // Reveal creator's share accounts (option A: id=0, option B: id=1)
    const creatorRevealData = await Promise.all(
      [0, 1].map(async (shareAccountId) => {
        const computationOffset = randomComputationOffset();
        const ix = await revealShares(
          {
            signer: creatorAccount.keypair,
            owner: creatorAccount.keypair.address,
            market: env.market.address,
            userVta: creatorVtaAddress,
            userPubkey: creatorX25519.publicKey,
            shareAccountId,
          },
          {
            clusterOffset: arciumEnv.arciumClusterOffset,
            computationOffset,
          }
        );
        return { ix, computationOffset, shareAccountId };
      })
    );
    for (const { ix, shareAccountId } of creatorRevealData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [ix], {
        label: `Reveal creator shares [${shareAccountId}]`,
      });
    }
    await awaitBatchComputationFinalization(rpc, creatorRevealData.map(({computationOffset}) => computationOffset));

    // Verify revealed shares for winners
    for (let i = 0; i < winners.length; i++) {
      const participant = winners[i];
      const expectedAmount = winnerSharesData[i].amount;
      const [shareAccountAddress] = await getShareAccountAddress(participant.keypair.address, env.market.address, 0);
      const revealedShareAccount = await fetchShareAccount(rpc, shareAccountAddress);

      expect(revealedShareAccount.data.revealedAmount).to.deep.equal(some(expectedAmount));
      expect(revealedShareAccount.data.revealedOption).to.deep.equal(some(winningOptionIndex));
    }

    // Verify creator's revealed shares
    const [creatorShareA] = await getShareAccountAddress(creatorAccount.keypair.address, env.market.address, 0);
    const creatorShareAAccount = await fetchShareAccount(rpc, creatorShareA);
    expect(creatorShareAAccount.data.revealedAmount).to.deep.equal(some(minDeposit));
    expect(creatorShareAAccount.data.revealedOption).to.deep.equal(some(1));

    const [creatorShareB] = await getShareAccountAddress(creatorAccount.keypair.address, env.market.address, 1);
    const creatorShareBAccount = await fetchShareAccount(rpc, creatorShareB);
    expect(creatorShareBAccount.data.revealedAmount).to.deep.equal(some(minDeposit));
    expect(creatorShareBAccount.data.revealedOption).to.deep.equal(some(2));

    // Increment option tally for all winners
    const incrementTallyData = await Promise.all(
      winners.map(async (participant, idx) => {
        const ix = await incrementOptionTally({
          signer: participant.keypair,
          owner: participant.keypair.address,
          market: env.market.address,
          optionIndex: winningOptionIndex,
          shareAccountId: 0,
        });
        return { participant, ix, idx };
      })
    );

    for (const { participant, ix, idx } of incrementTallyData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Increment tally [${idx}]`,
      });
    }

    // Increment tally for creator's share accounts
    const creatorIncrementAIx = await incrementOptionTally({
      signer: creatorAccount.keypair,
      owner: creatorAccount.keypair.address,
      market: env.market.address,
      optionIndex: 1,
      shareAccountId: 0,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [creatorIncrementAIx], {
      label: "Increment tally creator option A",
    });

    const creatorIncrementBIx = await incrementOptionTally({
      signer: creatorAccount.keypair,
      owner: creatorAccount.keypair.address,
      market: env.market.address,
      optionIndex: 2,
      shareAccountId: 1,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [creatorIncrementBIx], {
      label: "Increment tally creator option B",
    });

    // Verify option tally was updated with total winning shares (includes creator's minDeposit)
    const totalWinningShares = buySharesAmounts.slice(0, numParticipants / 2).reduce((a, b) => a + b, 0n) + minDeposit;
    const [optionAddress] = await getOpportunityMarketOptionAddress(env.market.address, winningOptionIndex);
    const optionAccount = await fetchOpportunityMarketOption(rpc, optionAddress);
    expect(optionAccount.data.totalShares).to.deep.equal(some(totalWinningShares));

    // Refetch market to get updated state (open_timestamp may have changed due to select_option)
    const updatedMarket = await fetchOpportunityMarket(rpc, env.market.address);
    const marketCloseTimestamp = BigInt(updatedMarket.data.openTimestamp.__option === 'Some' ? updatedMarket.data.openTimestamp.value : 0n) + updatedMarket.data.timeToStake;

    const winnerTimestamps = await Promise.all(
      winners.map(async (participant) => {
        const [shareAccountAddress] = await getShareAccountAddress(participant.keypair.address, env.market.address, 0);
        const shareAccount = await fetchShareAccount(rpc, shareAccountAddress);
        const ts = shareAccount.data.stakedAtTimestamp;
        if (!isSome(ts)) throw new Error('stakedAtTimestamp is None');
        return ts.value;
      })
    );

    // Wait for reveal period to end
    const timeToReveal = Number(env.market.timeToReveal);
    await sleepUntilOnChainTimestamp((new Date().getTime() / 1000) + timeToReveal);

    // Get token balances before closing for all winners
    const balancesBefore = await Promise.all(
      winners.map(async (participant) => ({
        participant,
        balance: (await fetchToken(rpc, participant.tokenAccount)).data.amount,
      }))
    );
    const creatorBalanceBefore = (await fetchToken(rpc, creatorAccount.tokenAccount)).data.amount;
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // All winners close share accounts and claim rewards
    const closeShareData = await Promise.all(
      winners.map(async (participant, idx) => {
        const ix = await closeShareAccount({
          owner: participant.keypair,
          market: env.market.address,
          tokenMint: env.mint.address,
          ownerTokenAccount: participant.tokenAccount,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          optionIndex: winningOptionIndex,
          shareAccountId: 0,
        });
        return { participant, ix, idx };
      })
    );

    for (const { participant, ix, idx } of closeShareData) {
      await sendTransaction(rpc, sendAndConfirmTransaction, participant.keypair, [ix], {
        label: `Close share account [${idx}]`,
      });
    }

    // Close creator's share accounts
    const closeCreatorAIx = await closeShareAccount({
      owner: creatorAccount.keypair,
      market: env.market.address,
      tokenMint: env.mint.address,
      ownerTokenAccount: creatorAccount.tokenAccount,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      optionIndex: 1,
      shareAccountId: 0,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [closeCreatorAIx], {
      label: "Close creator share account option A",
    });

    const closeCreatorBIx = await closeShareAccount({
      owner: creatorAccount.keypair,
      market: env.market.address,
      tokenMint: env.mint.address,
      ownerTokenAccount: creatorAccount.tokenAccount,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      optionIndex: 2,
      shareAccountId: 1,
    });
    await sendTransaction(rpc, sendAndConfirmTransaction, creatorAccount.keypair, [closeCreatorBIx], {
      label: "Close creator share account option B",
    });

    // Verify share accounts were closed for all winners
    for (const participant of winners) {
      const [shareAccountAddress] = await getShareAccountAddress(participant.keypair.address, env.market.address, 0);
      const shareAccountAfterClose = await rpc.getAccountInfo(shareAccountAddress).send();
      expect(shareAccountAfterClose.value).to.be.null;
    }

    // Get token balances after closing
    const balancesAfter = await Promise.all(
      winners.map(async (participant) => ({
        participant,
        balance: (await fetchToken(rpc, participant.tokenAccount)).data.amount,
      }))
    );
    const creatorBalanceAfter = (await fetchToken(rpc, creatorAccount.tokenAccount)).data.amount;
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains for each winner
    const gains: { participant: typeof winners[0]; gain: bigint; shares: bigint }[] = [];
    for (let i = 0; i < winners.length; i++) {
      const gain = balancesAfter[i].balance - balancesBefore[i].balance;
      gains.push({
        participant: winners[i],
        gain,
        shares: winnerSharesData[i].amount,
      });
    }
    const creatorGain = creatorBalanceAfter - creatorBalanceBefore;

    // All winners should have gained funds
    for (const { gain } of gains) {
      expect(gain > 0n).to.be.true;
    }

    // Total market loss should equal the full reward amount, tolerance of 2 for rounding errors
    const marketLoss = marketBalanceBefore - marketBalanceAfter;
    expect(marketLoss >= marketFundingAmount - 2n && marketLoss <= marketFundingAmount).to.be.true;

    // Verify proportional reward distribution among participant winners:
    // gainA / gainB ~= scoreA / scoreB (where score = shares * timeInMarket)
    // Cross-multiply to avoid division: gainA * scoreB ~= gainB * scoreA
    const winnerScores = gains.map(({ gain, shares }, i) => ({
      gain,
      score: shares * (marketCloseTimestamp - winnerTimestamps[i]),
    }));

    winnerScores.forEach((a, i) =>
      winnerScores.slice(i + 1).forEach((b, j) => {
        const lhs = a.gain * b.score;
        const rhs = b.gain * a.score;
        const tolerance = (lhs > rhs ? lhs : rhs) / 100n; // 1%
        expect(
          Math.abs(Number(lhs - rhs)) <= tolerance,
          `Reward ratio mismatch between winner ${i} and ${i + j + 1}: ${lhs} - ${rhs}`
        ).to.be.true;
      })
    );

    // Verify total gains (participants + creator) equal the reward amount
    const totalGains = gains.reduce((sum, { gain }) => sum + gain, 0n) + creatorGain;
    expect(totalGains >= marketFundingAmount - 2n).to.be.true; // Allow for floor() rounding with 3 winners
    expect(totalGains <= marketFundingAmount).to.be.true;
  });
});
