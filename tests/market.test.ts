import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { address, some, isNone, isSome, unwrapOption, createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory } from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { expect } from "chai";
import {
  OPPORTUNITY_MARKET_ERROR__CLOSING_EARLY_NOT_ALLOWED,
  OPPORTUNITY_MARKET_ERROR__STAKE_WINDOW_MISMATCH,
  OPPORTUNITY_MARKET_ERROR__UNSTAKE_DELAY_NOT_MET,
  OPPORTUNITY_MARKET_ERROR__UNAUTHORIZED,
  OPPORTUNITY_MARKET_ERROR__MARKET_PAUSED,
  OPPORTUNITY_MARKET_ERROR__STAKE_BELOW_MINIMUM,
  OPPORTUNITY_MARKET_ERROR__MARKET_NOT_RESOLVED,
  OPPORTUNITY_MARKET_ERROR__INVALID_PARAMETERS,
} from "../js/src";

import { OpportunityMarket } from "../target/types/opportunity_market";
import { Platform } from "./utils/platform";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sleepUntilOnChainTimestamp } from "./utils/sleep";
import { generateX25519Keypair, X25519Keypair } from "../js/src/x25519/keypair";
import { shouldThrowCustomError } from "./utils/errors";
import * as fs from "fs";
import * as os from "os";

const ONCHAIN_TIMESTAMP_BUFFER_SECONDS = 6;

// Environment setup
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const WS_URL = RPC_URL.replace("http", "ws").replace(":8899", ":8900");

function loadObserverKeypair(): X25519Keypair {
  const keyfilePath = process.env.TEST_OBSERVER_KEYPAIR;
  if (keyfilePath) {
    const data = JSON.parse(fs.readFileSync(keyfilePath, "utf-8"));
    return {
      secretKey: new Uint8Array(data.secretKey),
      publicKey: new Uint8Array(data.publicKey),
    };
  }
  return generateX25519Keypair();
}

describe("OpportunityMarket", () => {
  // Anchor setup
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.OpportunityMarket as Program<OpportunityMarket>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const programId = address(program.programId.toBase58());

  before(async () => {
    const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
    const secretKey = new Uint8Array(JSON.parse(file.toString()));

    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    await initializeAllCompDefs(rpc, sendAndConfirmTransaction, secretKey, programId);
  });

  it("passes full opportunity market flow", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const numParticipants = 4;
    const platformFeeBp = 100n; // 1%
    const creatorFeeBp = 50n;  // 0.5%

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      platformFeeBp: Number(platformFeeBp),
      creatorFeeBp: Number(creatorFeeBp),
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    // Open market
    const openTimestamp = await platform.openMarket();

    // Add two options
    const { optionId: optionA } = await platform.addOption();
    const { optionId: optionB } = await platform.addOption();

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Define voting: first half vote Option A, second half vote Option B
    const stakeAmounts = [50_000_000n, 75_000_000n, 100_000_000n, 60_000_000n];
    const expectedPlatformFeePerUser = stakeAmounts.map(a => a * platformFeeBp / 10_000n);
    const expectedCreatorFeePerUser = stakeAmounts.map(a => a * creatorFeeBp / 10_000n);
    const expectedNetPerUser = stakeAmounts.map(
      (a, i) => a - expectedPlatformFeePerUser[i] - expectedCreatorFeePerUser[i],
    );

    const purchases = platform.participants.map((userId, idx) => ({
      userId,
      amount: stakeAmounts[idx],
      optionId: idx < numParticipants / 2 ? optionA : optionB,
    }));
    const stakeAccountIds = await platform.stakeOnOptionBatch(purchases);

    // Verify user can decrypt their own encrypted option choice
    purchases.forEach((purchase, i) => {
      const decrypted = platform.decryptStakeOption(purchase.userId, stakeAccountIds[i]);
      expect(decrypted.optionId).to.equal(BigInt(purchase.optionId));
    });

    // Verify observer can decrypt disclosed option choices
    purchases.forEach((purchase, i) => {
      const disclosed = platform.decryptDisclosedStakeOption(purchase.userId, stakeAccountIds[i], observer);
      expect(disclosed.optionId).to.equal(BigInt(purchase.optionId));
    });

    // Negative check: creator fees cannot be claimed before winners are selected
    await shouldThrowCustomError(
      () => platform.claimCreatorFees(),
      OPPORTUNITY_MARKET_ERROR__MARKET_NOT_RESOLVED,
    );

    // Market creator selects winning option
    const winningOptionIndex = optionA;
    await platform.selectSingleWinningOption(winningOptionIndex);

    // Verify market is resolved and the winning option carries 100% allocation.
    const resolvedMarket = await platform.fetchMarket();
    expect(resolvedMarket.data.resolved).to.be.true;
    expect(resolvedMarket.data.winningOptionAllocation).to.equal(100);
    const winningOption = await platform.fetchOptionData(winningOptionIndex);
    expect(winningOption.data.selected).to.be.true;
    expect(winningOption.data.rewardPercentage).to.equal(100);

    // After winners are selected but before winners close their stake accounts,
    // the market creator can claim the accumulated creator fees.
    const totalExpectedCreatorFees = expectedCreatorFeePerUser.reduce((sum, f) => sum + f, 0n);
    const rpcForCreatorFee = platform.getRpc();
    const creatorBalanceBeforeCreatorFee = (
      await fetchToken(rpcForCreatorFee, platform.getUserTokenAccount(platform.creator))
    ).data.amount;
    await platform.claimCreatorFees();
    const creatorBalanceAfterCreatorFee = (
      await fetchToken(rpcForCreatorFee, platform.getUserTokenAccount(platform.creator))
    ).data.amount;
    expect(creatorBalanceAfterCreatorFee - creatorBalanceBeforeCreatorFee).to.equal(
      totalExpectedCreatorFees,
      `Market creator should have received ${totalExpectedCreatorFees} in creator fees`,
    );

    const marketAfterCreatorClaim = await platform.fetchMarket();
    expect(marketAfterCreatorClaim.data.collectedCreatorFees).to.equal(0n);

    // Reveal stakes for winners
    const winners = platform.participants.filter(
      (userId) => platform.getUserStakeAccountsForOption(userId, winningOptionIndex).length > 0
    );
    const winnerStakeAccounts = winners.map(
      (userId) => platform.getUserStakeAccountsForOption(userId, winningOptionIndex)[0]
    );

    await platform.revealStakeBatch(
      winners.map((userId, i) => ({ userId, stakeAccountId: winnerStakeAccounts[i].id }))
    );

    // Verify revealed option for winners
    for (let i = 0; i < winners.length; i++) {
      const sa = winnerStakeAccounts[i];
      const stakeAccount = await platform.fetchStakeAccountData(winners[i], sa.id);
      expect(stakeAccount.data.revealedOption).to.deep.equal(some(BigInt(winningOptionIndex)));
    }

    // Increment option tally for winners
    await platform.incrementOptionTallyBatch(
      winners.map((userId, i) => ({
        userId,
        optionId: winningOptionIndex,
        stakeAccountId: winnerStakeAccounts[i].id,
      }))
    );

    // Verify option tally (amounts are net of fees)
    const totalWinningStaked = winnerStakeAccounts.reduce((sum, sa) => {
      const idx = purchases.findIndex(p => p.userId === winners[winnerStakeAccounts.indexOf(sa)]);
      return sum + expectedNetPerUser[idx];
    }, 0n);
    const optionAccount = await platform.fetchOptionData(winningOptionIndex);
    expect(optionAccount.data.totalStaked).to.equal(totalWinningStaked);

    // Reclaim staked tokens for winners
    await platform.reclaimStakeBatch(
      winners.map((userId, i) => ({
        userId,
        stakeAccountId: winnerStakeAccounts[i].id,
      }))
    );

    // Get timestamps for reward calculation
    const updatedMarket = await platform.fetchMarket();
    const marketCloseTimestamp =
      BigInt(unwrapOption(updatedMarket.data.openTimestamp) ?? 0n) + updatedMarket.data.timeToStake;

    const winnerTimestamps = await Promise.all(
      winners.map(async (userId, i) => {
        const stakeAccount = await platform.fetchStakeAccountData(userId, winnerStakeAccounts[i].id);
        const ts = stakeAccount.data.stakedAtTimestamp;
        if (!isSome(ts)) throw new Error("stakedAtTimestamp is None");
        return ts.value;
      })
    );

    await platform.endRevealPeriod();

    // Get token balances before closing (after reclaim, so only reward transfer remains)
    const rpc = platform.getRpc();
    const marketAta = await platform.getMarketAta();

    const balancesBefore = await Promise.all(
      winners.map(async (userId) => ({
        userId,
        balance: (await fetchToken(rpc, platform.getUserTokenAccount(userId))).data.amount,
      }))
    );
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // Close stake accounts for winners (transfers reward only)
    await platform.closeStakeAccountBatch(
      winners.map((userId, i) => ({
        userId,
        optionId: winningOptionIndex,
        stakeAccountId: winnerStakeAccounts[i].id,
      }))
    );

    // Verify stake accounts were closed
    for (let i = 0; i < winners.length; i++) {
      const addr = await platform.getStakeAccountAddress(winners[i], winnerStakeAccounts[i].id);
      const exists = await platform.accountExists(addr);
      expect(exists).to.be.false;
    }

    // Get token balances after closing
    const balancesAfter = await Promise.all(
      winners.map(async (userId) => ({
        userId,
        balance: (await fetchToken(rpc, platform.getUserTokenAccount(userId))).data.amount,
      }))
    );
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains (reward only, since staked tokens were already reclaimed)
    const gains = winners.map((userId, i) => ({
      userId,
      gain: balancesAfter[i].balance - balancesBefore[i].balance,
      staked: winnerStakeAccounts[i].amount,
    }));

    // All winners should have gained funds (reward)
    for (const { gain } of gains) {
      expect(gain > 0n).to.be.true;
    }

    // Total market loss should equal the full reward amount (tolerance of 2 for rounding)
    const marketLoss = marketBalanceBefore - marketBalanceAfter;
    expect(marketLoss >= marketFundingAmount - 2n && marketLoss <= marketFundingAmount).to.be.true;

    // Verify proportional reward distribution
    const winnerScores = gains.map(({ gain, staked }, i) => ({
      gain,
      score: staked * (marketCloseTimestamp - winnerTimestamps[i]),
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

    // Verify total gains equal reward amount
    const totalGains = gains.reduce((sum, { gain }) => sum + gain, 0n);
    expect(totalGains >= marketFundingAmount - 2n).to.be.true;
    expect(totalGains <= marketFundingAmount).to.be.true;

    // Verify the fee vault has collected platform fees
    const totalExpectedPlatformFees = expectedPlatformFeePerUser.reduce((sum, f) => sum + f, 0n);
    const marketBefore = await platform.fetchMarket();
    expect(marketBefore.data.collectedPlatformFees).to.equal(totalExpectedPlatformFees,
      `Market should have collected ${totalExpectedPlatformFees} in platform fees`);

    // Get fee recipient balance before claiming
    const feeRecipientBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;

    // Claim fees
    await platform.claimFees();

    // Verify fee recipient received the fees
    const feeRecipientBalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.equal(totalExpectedPlatformFees,
      `Fee recipient should have received ${totalExpectedPlatformFees} in fees`);

    const marketAfter = await platform.fetchMarket();
    expect(marketAfter.data.collectedPlatformFees).to.equal(0n, "Market collected platform fees should be 0 after claiming");
  });

  it("distributes rewards across multiple winning options", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const stakeAmount = 1000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 2,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();

    const [user1, user2] = platform.participants;

    // Create 7 options: A-G
    const options: number[] = [];
    for (let i = 0; i < 7; i++) {
      const { optionId } = await platform.addOption();
      options.push(optionId);
    }
    const [optA, optB, optC, _optD, optE, optF, optG] = options;

    // Wait for staking period
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // User 1 stakes on A, B, C
    const u1StakeIds = await platform.stakeOnOptionBatch([
      { userId: user1, amount: stakeAmount, optionId: optA },
      { userId: user1, amount: stakeAmount, optionId: optB },
      { userId: user1, amount: stakeAmount, optionId: optC },
    ]);

    // User 2 stakes on E, F, G
    const u2StakeIds = await platform.stakeOnOptionBatch([
      { userId: user2, amount: stakeAmount, optionId: optE },
      { userId: user2, amount: stakeAmount, optionId: optF },
      { userId: user2, amount: stakeAmount, optionId: optG },
    ]);

    // Creator selects 3 winning options with different percentages: A=50%, B=30%, E=20%
    await platform.selectWinningOptions([
      { optionId: optA, rewardPercentage: 50 },
      { optionId: optB, rewardPercentage: 30 },
      { optionId: optE, rewardPercentage: 20 },
    ]);

    // Verify market is resolved and each winning option carries its percentage.
    const resolvedMarket = await platform.fetchMarket();
    expect(resolvedMarket.data.resolved).to.be.true;
    expect(resolvedMarket.data.winningOptionAllocation).to.equal(100);
    const expectedWinners: Array<{ optionId: number; percentage: number }> = [
      { optionId: optA, percentage: 50 },
      { optionId: optB, percentage: 30 },
      { optionId: optE, percentage: 20 },
    ];
    for (const { optionId, percentage } of expectedWinners) {
      const opt = await platform.fetchOptionData(optionId);
      expect(opt.data.selected).to.be.true;
      expect(opt.data.rewardPercentage).to.equal(percentage);
    }

    // selectWinningOptions with allow_closing_early shortens time_to_stake, so reveal window starts now.
    const updatedMarket = await platform.fetchMarket();
    const updatedOpenTs = Number(unwrapOption(updatedMarket.data.openTimestamp) ?? 0n);
    const revealStart = updatedOpenTs + Number(updatedMarket.data.timeToStake);
    await sleepUntilOnChainTimestamp(revealStart + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Reveal all stake accounts
    await Promise.all([
      platform.revealStakeBatch(u1StakeIds.map(sid => ({ userId: user1, stakeAccountId: sid }))),
      platform.revealStakeBatch(u2StakeIds.map(sid => ({ userId: user2, stakeAccountId: sid }))),
    ]);

    // Increment tally for winning stake accounts only
    // User 1: A (stake 0), B (stake 1) — C is a loser
    // User 2: E (stake 0) — F, G are losers
    await Promise.all([
      platform.incrementOptionTally(user1, optA, u1StakeIds[0]),
      platform.incrementOptionTally(user1, optB, u1StakeIds[1]),
      platform.incrementOptionTally(user2, optE, u2StakeIds[0]),
    ]);

    // Reclaim staked tokens for all accounts
    await platform.reclaimStakeBatch([
      ...u1StakeIds.map(sid => ({ userId: user1, stakeAccountId: sid })),
      ...u2StakeIds.map(sid => ({ userId: user2, stakeAccountId: sid })),
    ]);

    await platform.endRevealPeriod();

    const rpc = platform.getRpc();

    // Get user1 balance before closing
    const u1BalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(user1))).data.amount;

    // Close all user1 stake accounts (A, B winning; C losing)
    await platform.closeStakeAccountBatch([
      { userId: user1, optionId: optA, stakeAccountId: u1StakeIds[0] },
      { userId: user1, optionId: optB, stakeAccountId: u1StakeIds[1] },
      { userId: user1, optionId: optC, stakeAccountId: u1StakeIds[2] },
    ]);

    const u1BalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(user1))).data.amount;
    const u1Gain = u1BalanceAfter - u1BalanceBefore;

    // Get user2 balance before closing
    const u2BalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(user2))).data.amount;

    // Close all user2 stake accounts (E winning; F, G losing)
    await platform.closeStakeAccountBatch([
      { userId: user2, optionId: optE, stakeAccountId: u2StakeIds[0] },
      { userId: user2, optionId: optF, stakeAccountId: u2StakeIds[1] },
      { userId: user2, optionId: optG, stakeAccountId: u2StakeIds[2] },
    ]);

    const u2BalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(user2))).data.amount;
    const u2Gain = u2BalanceAfter - u2BalanceBefore;

    // User 1 should receive rewards from A (50%) and B (30%) = 80% of total
    // User 2 should receive rewards from E (20%) = 20% of total
    const expectedU1Gain = marketFundingAmount * 80n / 100n;
    const expectedU2Gain = marketFundingAmount * 20n / 100n;

    // Allow tolerance of 2 for rounding
    expect(
      u1Gain >= expectedU1Gain - 2n && u1Gain <= expectedU1Gain,
      `User 1 should gain ~${expectedU1Gain} (80%), got ${u1Gain}`
    ).to.be.true;

    expect(
      u2Gain >= expectedU2Gain - 2n && u2Gain <= expectedU2Gain,
      `User 2 should gain ~${expectedU2Gain} (20%), got ${u2Gain}`
    ).to.be.true;

    // Total paid out should equal the full reward amount
    const totalGains = u1Gain + u2Gain;
    expect(
      totalGains >= marketFundingAmount - 3n && totalGains <= marketFundingAmount,
      `Total gains should be ~${marketFundingAmount}, got ${totalGains}`
    ).to.be.true;

    // All stake accounts should be closed
    for (const [userId, stakeIds] of [[user1, u1StakeIds], [user2, u2StakeIds]] as const) {
      for (const sid of stakeIds) {
        const addr = await platform.getStakeAccountAddress(userId, sid);
        expect(await platform.accountExists(addr)).to.be.false;
      }
    }
  });

  it("allows users to vote for multiple options", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const stakeAmount = 50_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    // Open market
    const openTimestamp = await platform.openMarket();

    // Get the single participant
    const user = platform.participants[0];

    // Create 2 options
    const { optionId: optionA } = await platform.addOption();
    const { optionId: optionB } = await platform.addOption();

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // User stakes on both options twice (4 stake accounts total)
    const stakeAccountIds = await platform.stakeOnOptionBatch([
      { userId: user, amount: stakeAmount, optionId: optionA },
      { userId: user, amount: stakeAmount, optionId: optionB },
      { userId: user, amount: stakeAmount, optionId: optionA },
      { userId: user, amount: stakeAmount, optionId: optionB },
    ]);
    const [sa0, sa1, sa2, sa3] = stakeAccountIds;

    // User now has 4 stake accounts
    const userStakeAccounts = platform.getUserStakeAccounts(user);
    expect(userStakeAccounts.length).to.equal(4);

    // Verify user can decrypt all stake accounts
    const expectedStakes = [
      { id: sa0, optionId: optionA },
      { id: sa1, optionId: optionB },
      { id: sa2, optionId: optionA },
      { id: sa3, optionId: optionB },
    ];
    expectedStakes.forEach(({ id, optionId }) => {
      const decrypted = platform.decryptStakeOption(user, id);
      expect(decrypted.optionId).to.equal(BigInt(optionId));
    });

    // Verify observer can decrypt all disclosed stakes
    expectedStakes.forEach(({ id, optionId }) => {
      const disclosed = platform.decryptDisclosedStakeOption(user, id, observer);
      expect(disclosed.optionId).to.equal(BigInt(optionId));
    });

    // Market creator selects winning option (Option A)
    const winningOptionId = optionA;
    await platform.selectSingleWinningOption(winningOptionId);

    // Wait for reveal window to start (selectSingleWinningOption truncates time_to_stake)
    const updatedMarket = await platform.fetchMarket();
    const marketOpenTs = Number(unwrapOption(updatedMarket.data.openTimestamp) ?? 0n);
    const revealStart = marketOpenTs + Number(updatedMarket.data.timeToStake);
    await sleepUntilOnChainTimestamp(revealStart + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Reveal ALL stake accounts sequentially
    for (const sa of userStakeAccounts) {
      await platform.revealStake(user, sa.id);
    }

    // Verify all stakes are revealed
    for (const sa of userStakeAccounts) {
      const stakeAccount = await platform.fetchStakeAccountData(user, sa.id);
      expect(stakeAccount.data.revealedOption).to.deep.equal(some(BigInt(sa.optionId)));
    }

    // Increment tally for winning option stake accounts
    const winningStakeAccounts = platform.getUserStakeAccountsForOption(user, winningOptionId);
    await platform.incrementOptionTallyBatch(
      winningStakeAccounts.map((sa) => ({
        userId: user,
        optionId: winningOptionId,
        stakeAccountId: sa.id,
      }))
    );

    // Reclaim staked tokens for all accounts
    await platform.reclaimStakeBatch(
      userStakeAccounts.map((sa) => ({ userId: user, stakeAccountId: sa.id }))
    );

    await platform.endRevealPeriod();

    // Get balances before closing
    const rpc = platform.getRpc();
    const userBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    const marketAta = await platform.getMarketAta();
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // Close ALL stake accounts (both winning and losing)
    await platform.closeStakeAccountBatch(
      userStakeAccounts.map((sa) => ({
        userId: user,
        optionId: sa.optionId,
        stakeAccountId: sa.id,
      }))
    );

    // Verify all stake accounts were closed
    for (const sa of userStakeAccounts) {
      const addr = await platform.getStakeAccountAddress(user, sa.id);
      const exists = await platform.accountExists(addr);
      expect(exists).to.be.false;
    }

    // Get balances after closing
    const userBalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains
    const userGained = userBalanceAfter - userBalanceBefore;
    const marketPaidOut = marketBalanceBefore - marketBalanceAfter;

    // User is the only participant, so they should receive the entire market reward
    expect(
      userGained >= marketFundingAmount - 1n && userGained <= marketFundingAmount,
      `User should gain ~${marketFundingAmount}, got ${userGained}`
    ).to.be.true;

    // Market should have paid out the full reward amount
    expect(
      marketPaidOut >= marketFundingAmount - 1n && marketPaidOut <= marketFundingAmount,
      `Market should pay out ~${marketFundingAmount}, paid ${marketPaidOut}`
    ).to.be.true;

    const marketStateAfter = await platform.fetchMarket();
    const collectedFees = marketStateAfter.data.collectedPlatformFees;
    expect(
      marketBalanceAfter <= collectedFees + 1n,
      `Market ATA should hold only collected platform fees (~${collectedFees}), has ${marketBalanceAfter}`
    ).to.be.true;
  });

  it("rejects resolve_market when winning option allocation does not sum to 100", async () => {
    const marketFundingAmount = 1_000_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 60n,
        authorizedReaderPubkey: observer.publicKey,
        allowClosingEarly: true,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId: optionA } = await platform.addOption();
    const { optionId: optionB } = await platform.addOption();

    // resolve_market requires current_time >= open_timestamp; otherwise it errors
    // with the same InvalidParameters code as the allocation check.
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Under (50 + 30 = 80): resolve must reject.
    await platform.setWinningOption(optionA, 50);
    await platform.setWinningOption(optionB, 30);

    let market = await platform.fetchMarket();
    expect(market.data.winningOptionAllocation).to.equal(80);

    await shouldThrowCustomError(
      () => platform.resolveMarket(),
      OPPORTUNITY_MARKET_ERROR__INVALID_PARAMETERS,
    );

    market = await platform.fetchMarket();
    expect(market.data.resolved).to.be.false;

    // Over (80 + 30 = 110): set must reject before allocation moves.
    await shouldThrowCustomError(
      () => platform.setWinningOption(optionA, 80),
      OPPORTUNITY_MARKET_ERROR__INVALID_PARAMETERS,
    );

    market = await platform.fetchMarket();
    expect(market.data.winningOptionAllocation).to.equal(80);

    // Correcting optionA up to exactly 70 brings the total to 100 and resolve succeeds.
    await platform.setWinningOption(optionA, 70);
    await platform.resolveMarket();

    market = await platform.fetchMarket();
    expect(market.data.resolved).to.be.true;
    expect(market.data.winningOptionAllocation).to.equal(100);
  });

  it("prevents closing market early when not allowed", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const timeToStake = 10n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
        allowClosingEarly: false,
      },
    });

    // Open market
    const openTimestamp = await platform.openMarket();

    // Add options as creator
    const { optionId: optionA } = await platform.addOption();
    await platform.addOption();

    // Wait for staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Try to select option before stake period ends - should fail
    await shouldThrowCustomError(
      () => platform.selectSingleWinningOption(optionA),
      OPPORTUNITY_MARKET_ERROR__CLOSING_EARLY_NOT_ALLOWED
    );

    // Verify market is still unresolved
    let market = await platform.fetchMarket();
    expect(market.data.resolved).to.be.false;

    // Wait for stake period to end
    const stakeEndTimestamp = Number(openTimestamp) + Number(timeToStake);
    await sleepUntilOnChainTimestamp(stakeEndTimestamp + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Now selecting option should succeed
    await platform.selectSingleWinningOption(optionA);

    // Verify option was selected and market resolved
    market = await platform.fetchMarket();
    expect(market.data.resolved).to.be.true;
    expect(market.data.winningOptionAllocation).to.equal(100);
    const optionAAccount = await platform.fetchOptionData(optionA);
    expect(optionAAccount.data.selected).to.be.true;
    expect(optionAAccount.data.rewardPercentage).to.equal(100);
  });

  it("allows adding more reward during staking", async () => {
    const initialReward = 1_000_000_000n;
    const additionalReward = 1_000_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 5_000_000_000n,
      marketConfig: {
        rewardAmount: initialReward,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();

    // Add an option so staking can happen
    await platform.addOption();

    // Wait for staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Verify initial reward amount
    let market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(initialReward);

    // Add more reward from creator
    await platform.addReward(platform.creator, additionalReward);

    // Verify updated reward amount
    market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(initialReward + additionalReward);
  });

  it("allows unlocked sponsor to withdraw reward before winners selected", async () => {
    const marketFundingAmount = 1_000_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: 0n,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    // Add reward unlocked (lock=false)
    await platform.addReward(platform.creator, marketFundingAmount, false);

    const openTimestamp = await platform.openMarket();

    // Add options
    await platform.addOption();
    await platform.addOption();

    // Wait for staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Verify reward amount
    let market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(marketFundingAmount);

    // Get creator balance before withdrawal
    const rpc = platform.getRpc();
    const creatorBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;

    // Withdraw reward (unlocked sponsor can withdraw)
    await platform.withdrawReward();

    // Verify creator received the reward tokens back
    const creatorBalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    expect(creatorBalanceAfter - creatorBalanceBefore).to.equal(marketFundingAmount);

    // Verify market state
    market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(0n);
    expect(market.data.resolved).to.be.false;
  });

  it("rejects staking before staking period is active", async () => {
    const marketFundingAmount = 1_000_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    // Open market with a timestamp far in the future so staking is not yet active
    const futureTimestamp = BigInt(Math.floor(Date.now() / 1000) + 600);
    await platform.openMarket(futureTimestamp);

    const user = platform.participants[0];

    // Add options
    const { optionId: optionA } = await platform.addOption();
    await platform.addOption();

    // Try to stake before staking period starts — should fail
    await shouldThrowCustomError(
      () => platform.stakeOnOption(user, 50_000_000n, optionA),
      OPPORTUNITY_MARKET_ERROR__STAKE_WINDOW_MISMATCH
    );
  });

  it("allows early unstaking with delay", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const unstakeDelaySeconds = 10n;
    const timeToStake = 30n;
    const stakeAmount = 50_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 2,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake,
        timeToReveal: 120n,
        unstakeDelaySeconds,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    // Open market
    const openTimestamp = await platform.openMarket();

    const [staker, executor] = platform.participants;

    // Add options
    const { optionId: optionA } = await platform.addOption();
    await platform.addOption();

    // Wait for staking period and stake
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const rpc = platform.getRpc();
    const balanceBeforeStake = (await fetchToken(rpc, platform.getUserTokenAccount(staker))).data.amount;

    const stakeAccountId = await platform.stakeOnOption(staker, stakeAmount, optionA);

    // Verify token balance decreased after staking
    const balanceAfterStake = (await fetchToken(rpc, platform.getUserTokenAccount(staker))).data.amount;
    expect(balanceBeforeStake - balanceAfterStake).to.equal(stakeAmount);

    // Verify initial state
    let stakeAccount = await platform.fetchStakeAccountData(staker, stakeAccountId);
    expect(isNone(stakeAccount.data.unstakeableAtTimestamp)).to.be.true;
    expect(isNone(stakeAccount.data.unstakedAtTimestamp)).to.be.true;

    // Initiate early unstake (sets unstakeableAtTimestamp)
    await platform.unstakeEarly(staker, stakeAccountId);

    stakeAccount = await platform.fetchStakeAccountData(staker, stakeAccountId);
    expect(isSome(stakeAccount.data.unstakeableAtTimestamp)).to.be.true;
    expect(isNone(stakeAccount.data.unstakedAtTimestamp)).to.be.true;

    // Execute unstake too early — should fail
    await shouldThrowCustomError(
      () => platform.doUnstakeEarly(executor, staker, stakeAccountId),
      OPPORTUNITY_MARKET_ERROR__UNSTAKE_DELAY_NOT_MET
    );

    // Wait for unstake delay to pass
    const unstakeableAt = unwrapOption(stakeAccount.data.unstakeableAtTimestamp);
    if (!unstakeableAt) throw new Error("unstakeableAtTimestamp is None");
    await sleepUntilOnChainTimestamp(
      Number(unstakeableAt) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS,
      rpc,
    );

    // Execute unstake (permissionless — different user can call)
    const balanceBeforeUnstake = (await fetchToken(rpc, platform.getUserTokenAccount(staker))).data.amount;
    await platform.doUnstakeEarly(executor, staker, stakeAccountId);

    stakeAccount = await platform.fetchStakeAccountData(staker, stakeAccountId);
    expect(isSome(stakeAccount.data.unstakedAtTimestamp)).to.be.true;

    // Verify staker received tokens back (net of 1% protocol fee)
    const balanceAfterUnstake = (await fetchToken(rpc, platform.getUserTokenAccount(staker))).data.amount;
    const protocolFeeBp = 100n;
    const expectedNet = stakeAmount - (stakeAmount * protocolFeeBp / 10_000n);
    expect(balanceAfterUnstake - balanceBeforeUnstake).to.equal(expectedNet);

    // Select winner and wait for stake period to end
    await platform.selectSingleWinningOption(optionA);
    const stakeEndTimestamp = Number(openTimestamp) + Number(timeToStake);
    await sleepUntilOnChainTimestamp(stakeEndTimestamp + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Reveal stake
    await platform.revealStake(staker, stakeAccountId);
    stakeAccount = await platform.fetchStakeAccountData(staker, stakeAccountId);
    expect(stakeAccount.data.revealedOption).to.deep.equal(some(BigInt(optionA)));
  });

  it("locked sponsor cannot withdraw but unlocked sponsor can", async () => {
    const lockedAmount = 500_000_000n;
    const unlockedAmount = 300_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 2,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: 0n,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const [lockedSponsor, unlockedSponsor] = platform.participants;
    const rpc = platform.getRpc();

    // Record balances before sponsoring
    const lockedBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(lockedSponsor))).data.amount;
    const unlockedBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(unlockedSponsor))).data.amount;

    // Locked sponsor adds reward with lock=true
    await platform.addReward(lockedSponsor, lockedAmount, true);

    // Unlocked sponsor adds reward with lock=false
    await platform.addReward(unlockedSponsor, unlockedAmount, false);

    // Verify market reward amount is the sum of both
    let market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(lockedAmount + unlockedAmount);

    // Verify token balances decreased
    const lockedBalanceAfterAdd = (await fetchToken(rpc, platform.getUserTokenAccount(lockedSponsor))).data.amount;
    expect(lockedBalanceBefore - lockedBalanceAfterAdd).to.equal(lockedAmount);

    const unlockedBalanceAfterAdd = (await fetchToken(rpc, platform.getUserTokenAccount(unlockedSponsor))).data.amount;
    expect(unlockedBalanceBefore - unlockedBalanceAfterAdd).to.equal(unlockedAmount);

    // Verify market ATA holds total reward
    const marketAta = await platform.getMarketAta();
    const marketAtaBalance = (await fetchToken(rpc, marketAta)).data.amount;
    expect(marketAtaBalance).to.equal(lockedAmount + unlockedAmount);

    // Locked sponsor cannot withdraw
    await shouldThrowCustomError(
      () => platform.withdrawReward(lockedSponsor),
      OPPORTUNITY_MARKET_ERROR__UNAUTHORIZED
    );

    // Unlocked sponsor can withdraw
    await platform.withdrawReward(unlockedSponsor);

    // Verify unlocked sponsor received tokens back
    const unlockedBalanceAfterWithdraw = (await fetchToken(rpc, platform.getUserTokenAccount(unlockedSponsor))).data.amount;
    expect(unlockedBalanceAfterWithdraw).to.equal(unlockedBalanceBefore);

    // Verify market reward decreased by unlocked amount
    market = await platform.fetchMarket();
    expect(market.data.rewardAmount).to.equal(lockedAmount);

    // Verify market ATA balance decreased accordingly
    const marketAtaBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;
    expect(marketAtaBalanceAfter).to.equal(lockedAmount);
  });

  it("can close a stuck stake account and refund", async () => {
    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: 1_000_000_000n,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId } = await platform.addOption();

    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const [user] = platform.participants;
    const rpc = platform.getRpc();
    const stakeAmount = 100_000_000n;

    // Record balances before
    const userBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    const tokenVaultAta = await platform.getMarketAta();
    const vaultAtaBalanceBefore = (await fetchToken(rpc, tokenVaultAta)).data.amount;
    const vaultBefore = await platform.fetchMarket();

    // Stake and immediately close stuck in the same transaction
    const stakeAccountId = await platform.stakeAndCloseStuck(user, stakeAmount, optionId);

    // Verify stake account PDA no longer exists
    const stakeAccountAddress = await platform.getStakeAccountAddress(user, stakeAccountId);
    const exists = await platform.accountExists(stakeAccountAddress);
    expect(exists).to.be.false;

    // Verify user token balance is restored (full amount refunded)
    const userBalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    expect(userBalanceAfter).to.equal(userBalanceBefore,
      "User balance should be fully restored after close_stuck");

    // Verify token vault ATA balance unchanged (full amount went in and came back out)
    const vaultAtaBalanceAfter = (await fetchToken(rpc, tokenVaultAta)).data.amount;
    expect(vaultAtaBalanceAfter).to.equal(vaultAtaBalanceBefore,
      "Token vault ATA balance should be unchanged");

    const vaultAfter = await platform.fetchMarket();
    expect(vaultAfter.data.collectedPlatformFees).to.equal(vaultBefore.data.collectedPlatformFees,
      "Market collected_platform_fees should not have changed");
  });

  it("pausing blocks staking, resuming allows it again", async () => {
    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: 1_000_000_000n,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId } = await platform.addOption();

    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const user = platform.participants[0];

    // Pause staking
    await platform.pauseStaking();

    // Staking should fail while paused
    await shouldThrowCustomError(
      () => platform.stakeOnOption(user, 50_000_000n, optionId),
      OPPORTUNITY_MARKET_ERROR__MARKET_PAUSED
    );

    // Resume staking
    await platform.resumeStaking();

    // Staking should succeed after resume
    const stakeAccountId = await platform.stakeOnOption(user, 50_000_000n, optionId);
    const stakeAccount = await platform.fetchStakeAccountData(user, stakeAccountId);
    expect(stakeAccount.data.amount > 0n).to.be.true;
  });

  it("collects fee components correctly", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const stakeAmount = 100_000_000n;
    const platformFeeBp = 100n;     // 1%
    const rewardPoolFeeBp = 200n;   // 2%
    const creatorFeeBp = 150n;      // 1.5%

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      platformFeeBp: Number(platformFeeBp),
      rewardPoolFeeBp: Number(rewardPoolFeeBp),
      creatorFeeBp: Number(creatorFeeBp),
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId } = await platform.addOption();
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const user = platform.participants[0];
    const rpc = platform.getRpc();

    const expectedPlatformFee = stakeAmount * platformFeeBp / 10_000n;
    const expectedRewardPoolFee = stakeAmount * rewardPoolFeeBp / 10_000n;
    const expectedCreatorFee = stakeAmount * creatorFeeBp / 10_000n;
    const expectedNetStake =
      stakeAmount - expectedPlatformFee - expectedRewardPoolFee - expectedCreatorFee;

    const stakeAccountId = await platform.stakeOnOption(user, stakeAmount, optionId);

    // Stake account records each fee component plus the net stake.
    const stakeAccount = await platform.fetchStakeAccountData(user, stakeAccountId);
    expect(stakeAccount.data.amount).to.equal(expectedNetStake);
    expect(stakeAccount.data.platformFee).to.equal(expectedPlatformFee);
    expect(stakeAccount.data.rewardPoolFee).to.equal(expectedRewardPoolFee);
    expect(stakeAccount.data.creatorFee).to.equal(expectedCreatorFee);

    // Market accumulators credit each fee bucket appropriately.
    let market = await platform.fetchMarket();
    expect(market.data.collectedPlatformFees).to.equal(expectedPlatformFee);
    expect(market.data.collectedCreatorFees).to.equal(expectedCreatorFee);
    expect(market.data.rewardAmount).to.equal(marketFundingAmount + expectedRewardPoolFee);

    // Resolve the market and run through reveal/reclaim.
    await platform.selectSingleWinningOption(optionId);
    const resolved = await platform.fetchMarket();
    const stakeEnd =
      Number(unwrapOption(resolved.data.openTimestamp) ?? 0n) + Number(resolved.data.timeToStake);
    await sleepUntilOnChainTimestamp(stakeEnd + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    await platform.revealStake(user, stakeAccountId);
    await platform.incrementOptionTally(user, optionId, stakeAccountId);
    await platform.reclaimStake(user, stakeAccountId);
    await platform.endRevealPeriod();

    // Platform fee → fee_claim_authority (= creator in default Platform setup).
    const feeAuthBefore = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    await platform.claimFees();
    const feeAuthAfter = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    expect(feeAuthAfter - feeAuthBefore).to.equal(expectedPlatformFee);

    // Creator fee → market_fee_claimer (= creator in default Platform setup).
    const creatorFeeBefore = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    await platform.claimCreatorFees();
    const creatorFeeAfter = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    expect(creatorFeeAfter - creatorFeeBefore).to.equal(expectedCreatorFee);

    // Reward pool fee → winner reward. The sole staker takes the full reward,
    // which now includes their own reward_pool_fee contribution.
    const userBalanceBeforeClose = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    await platform.closeStakeAccount(user, optionId, stakeAccountId);
    const userBalanceAfterClose = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    const expectedReward = marketFundingAmount + expectedRewardPoolFee;
    const userGain = userBalanceAfterClose - userBalanceBeforeClose;
    expect(
      userGain >= expectedReward - 1n && userGain <= expectedReward,
      `User should receive ~${expectedReward} as reward, got ${userGain}`,
    ).to.be.true;

    // All fee accumulators drained, only dust may remain in the market ATA.
    market = await platform.fetchMarket();
    expect(market.data.collectedPlatformFees).to.equal(0n);
    expect(market.data.collectedCreatorFees).to.equal(0n);
  });

  it("expired market refunds reward_pool and creator fees", async () => {
    const stakeAmount = 100_000_000n;
    const platformFeeBp = 100n;
    const rewardPoolFeeBp = 200n;
    const creatorFeeBp = 150n;
    const marketResolutionDeadlineSeconds = 10n;
    const timeToStake = 10n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      platformFeeBp: Number(platformFeeBp),
      rewardPoolFeeBp: Number(rewardPoolFeeBp),
      creatorFeeBp: Number(creatorFeeBp),
      marketResolutionDeadlineSeconds,
      marketConfig: {
        rewardAmount: 0n,
        timeToStake,
        timeToReveal: 60n,
        authorizedReaderPubkey: observer.publicKey,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId } = await platform.addOption();
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const user = platform.participants[0];
    const rpc = platform.getRpc();

    const expectedPlatformFee = stakeAmount * platformFeeBp / 10_000n;
    const expectedRewardPoolFee = stakeAmount * rewardPoolFeeBp / 10_000n;
    const expectedCreatorFee = stakeAmount * creatorFeeBp / 10_000n;
    const expectedNetStake =
      stakeAmount - expectedPlatformFee - expectedRewardPoolFee - expectedCreatorFee;

    const userBalanceBefore = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    const stakeAccountId = await platform.stakeOnOption(user, stakeAmount, optionId);

    const stakeAccount = await platform.fetchStakeAccountData(user, stakeAccountId);
    expect(stakeAccount.data.platformFee).to.equal(expectedPlatformFee);
    expect(stakeAccount.data.rewardPoolFee).to.equal(expectedRewardPoolFee);
    expect(stakeAccount.data.creatorFee).to.equal(expectedCreatorFee);
    expect(stakeAccount.data.amount).to.equal(expectedNetStake);

    // Wait past stake_end + market_resolution_deadline without selecting winners.
    const stakeEnd = Number(openTimestamp) + Number(timeToStake);
    const selectDeadline = stakeEnd + Number(marketResolutionDeadlineSeconds);
    await sleepUntilOnChainTimestamp(selectDeadline + ONCHAIN_TIMESTAMP_BUFFER_SECONDS, rpc);

    // Stake reclaim returns the net staked amount.
    await platform.reclaimStake(user, stakeAccountId);

    // Closing on the expired path refunds reward_pool_fee + creator_fee.
    await platform.closeStakeAccount(user, optionId, stakeAccountId);

    const userBalanceAfter = (await fetchToken(rpc, platform.getUserTokenAccount(user))).data.amount;
    // Net loss equals the platform fee only — reward pool and creator fees were refunded.
    expect(userBalanceBefore - userBalanceAfter).to.equal(expectedPlatformFee);

    let market = await platform.fetchMarket();
    expect(market.data.collectedPlatformFees).to.equal(expectedPlatformFee);
    expect(market.data.collectedCreatorFees).to.equal(0n);
    expect(market.data.rewardAmount).to.equal(0n);

    // The platform fee remains claimable by the fee_claim_authority.
    const feeAuthBefore = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    await platform.claimFees();
    const feeAuthAfter = (await fetchToken(rpc, platform.getUserTokenAccount(platform.creator))).data.amount;
    expect(feeAuthAfter - feeAuthBefore).to.equal(expectedPlatformFee);

    market = await platform.fetchMarket();
    expect(market.data.collectedPlatformFees).to.equal(0n);
  });

  it("rejects staking below the minimum stake amount", async () => {
    const minStakeAmount = 100_000_000n;

    const observer = loadObserverKeypair();

    const platform = await Platform.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 1,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: 1_000_000_000n,
        timeToStake: 120n,
        timeToReveal: 120n,
        authorizedReaderPubkey: observer.publicKey,
        minStakeAmount,
      },
    });

    const openTimestamp = await platform.openMarket();
    const { optionId } = await platform.addOption();

    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    const user = platform.participants[0];

    // Stake just below the minimum should fail
    await shouldThrowCustomError(
      () => platform.stakeOnOption(user, minStakeAmount - 1n, optionId),
      OPPORTUNITY_MARKET_ERROR__STAKE_BELOW_MINIMUM
    );

    // Stake at exactly the minimum should succeed
    const stakeAccountId = await platform.stakeOnOption(user, minStakeAmount, optionId);
    const stakeAccount = await platform.fetchStakeAccountData(user, stakeAccountId);
    expect(stakeAccount.data.amount > 0n).to.be.true;
  });
});
