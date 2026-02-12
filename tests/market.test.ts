import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { address, some, isSome, createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory  } from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { expect } from "chai";

import { OpportunityMarket } from "../target/types/opportunity_market";
import { TestRunner } from "./utils/test-runner";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sleepUntilOnChainTimestamp } from "./utils/sleep";

import * as fs from "fs";
import * as os from "os";

const ONCHAIN_TIMESTAMP_BUFFER_SECONDS = 6;

// Environment setup
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const WS_URL = RPC_URL.replace("http", "ws").replace(":8899", ":8900");

describe("OpportunityMarket", () => {
  // Anchor setup (still needed for buildFinalizeCompDefTx)
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.OpportunityMarket as Program<OpportunityMarket>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const programId = address(program.programId.toBase58());

  before(async () => {
    // Load owner secret key
    const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
    const secretKey = new Uint8Array(JSON.parse(file.toString()));

    // Initialize all computation definitions
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    await initializeAllCompDefs(rpc, sendAndConfirmTransaction, secretKey, programId);
  });

  it("passes full opportunity market flow", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const numParticipants = 4;
    const minDeposit = 1n;

    // Initialize TestRunner with all accounts and market
    const runner = await TestRunner.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake: 120n,
        timeToReveal: 20n,
      },
    });

    // Fund and open market
    await runner.fundMarket();
    const openTimestamp = await runner.openMarket();

    // Initialize VTAs and mint vote tokens for all participants
    const mintAmount = 100_000_000n;
    for (const userId of runner.participants) {
      await runner.initVoteTokenAccount(userId);
      await runner.mintVoteTokens(userId, mintAmount);
    }

    // Creator also needs VTA to add options
    await runner.initVoteTokenAccount(runner.creator);
    await runner.mintVoteTokens(runner.creator, 100n);

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Add two options (creator deposits minDeposit for each)
    const { optionIndex: optionA } = await runner.addMarketOption(runner.creator, "Option A", minDeposit);
    const { optionIndex: optionB } = await runner.addMarketOption(runner.creator, "Option B", minDeposit);

    // Define voting: first half vote Option A (winning), second half vote Option B
    const winningOptionIndex = optionA;
    const buySharesAmounts = [50n, 75n, 100n, 60n];

    // Buy shares for all participants
    const purchases = runner.participants.map((userId, idx) => ({
      userId,
      amount: buySharesAmounts[idx],
      optionIndex: idx < numParticipants / 2 ? optionA : optionB,
    }));
    await runner.stakeOnOptionBatch(purchases);

    // Market creator selects winning option
    await runner.selectOption(winningOptionIndex);

    // Verify selected option
    const resolvedMarket = await runner.fetchMarket();
    expect(resolvedMarket.data.selectedOption).to.deep.equal(some(winningOptionIndex));

    // Get winners (participants who voted for winning option) using stored share account info
    const winners = runner.participants.filter(
      (userId) => runner.getUserShareAccountsForOption(userId, winningOptionIndex).length > 0
    );
    const winnerShareAccounts = winners.map(
      (userId) => runner.getUserShareAccountsForOption(userId, winningOptionIndex)[0]
    );

    // Reveal shares for winners
    await runner.revealSharesBatch(
      winners.map((userId, i) => ({ userId, shareAccountId: winnerShareAccounts[i].id }))
    );

    // Reveal creator's share accounts
    const creatorShareAccounts = runner.getUserShareAccounts(runner.creator);
    await runner.revealSharesBatch(
      creatorShareAccounts.map((sa) => ({ userId: runner.creator, shareAccountId: sa.id }))
    );

    // Verify revealed shares for winners
    for (let i = 0; i < winners.length; i++) {
      const sa = winnerShareAccounts[i];
      const shareAccount = await runner.fetchShareAccountData(winners[i], sa.id);
      expect(shareAccount.data.revealedAmount).to.deep.equal(some(sa.amount));
      expect(shareAccount.data.revealedOption).to.deep.equal(some(winningOptionIndex));
    }

    // Verify creator's revealed shares
    for (const sa of creatorShareAccounts) {
      const shareAccount = await runner.fetchShareAccountData(runner.creator, sa.id);
      expect(shareAccount.data.revealedAmount).to.deep.equal(some(sa.amount));
      expect(shareAccount.data.revealedOption).to.deep.equal(some(sa.optionIndex));
    }

    // Increment option tally for winners
    await runner.incrementOptionTallyBatch(
      winners.map((userId, i) => ({
        userId,
        optionIndex: winningOptionIndex,
        shareAccountId: winnerShareAccounts[i].id,
      }))
    );

    // Increment tally for creator's share accounts
    await runner.incrementOptionTallyBatch(
      creatorShareAccounts.map((sa) => ({
        userId: runner.creator,
        optionIndex: sa.optionIndex,
        shareAccountId: sa.id,
      }))
    );

    // Verify option tally
    const totalWinningShares = winnerShareAccounts.reduce((sum, sa) => sum + sa.amount, 0n) + minDeposit;
    const optionAccount = await runner.fetchOptionData(winningOptionIndex);
    expect(optionAccount.data.totalShares).to.deep.equal(some(totalWinningShares));

    // Get timestamps for reward calculation
    const updatedMarket = await runner.fetchMarket();
    const marketCloseTimestamp =
      BigInt(
        updatedMarket.data.openTimestamp.__option === "Some"
          ? updatedMarket.data.openTimestamp.value
          : 0n
      ) + updatedMarket.data.timeToStake;

    const winnerTimestamps = await Promise.all(
      winners.map(async (userId, i) => {
        const shareAccount = await runner.fetchShareAccountData(userId, winnerShareAccounts[i].id);
        const ts = shareAccount.data.stakedAtTimestamp;
        if (!isSome(ts)) throw new Error("stakedAtTimestamp is None");
        return ts.value;
      })
    );

    // Wait for reveal period to end
    const timeToReveal = Number(runner.getTimeToReveal());
    await sleepUntilOnChainTimestamp(new Date().getTime() / 1000 + timeToReveal);

    // Get token balances before closing
    const rpc = runner.getRpc();
    const marketAta = await runner.getMarketAta();

    const balancesBefore = await Promise.all(
      winners.map(async (userId) => ({
        userId,
        balance: (await fetchToken(rpc, runner.getUserTokenAccount(userId))).data.amount,
      }))
    );
    const creatorBalanceBefore = (await fetchToken(rpc, runner.getUserTokenAccount(runner.creator)))
      .data.amount;
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // Close share accounts for winners
    await runner.closeShareAccountBatch(
      winners.map((userId, i) => ({
        userId,
        optionIndex: winningOptionIndex,
        shareAccountId: winnerShareAccounts[i].id,
      }))
    );

    // Close creator's share accounts
    await runner.closeShareAccountBatch(
      creatorShareAccounts.map((sa) => ({
        userId: runner.creator,
        optionIndex: sa.optionIndex,
        shareAccountId: sa.id,
      }))
    );

    // Verify share accounts were closed
    for (let i = 0; i < winners.length; i++) {
      const addr = await runner.getShareAccountAddress(winners[i], winnerShareAccounts[i].id);
      const exists = await runner.accountExists(addr);
      expect(exists).to.be.false;
    }

    // Get token balances after closing
    const balancesAfter = await Promise.all(
      winners.map(async (userId) => ({
        userId,
        balance: (await fetchToken(rpc, runner.getUserTokenAccount(userId))).data.amount,
      }))
    );
    const creatorBalanceAfter = (await fetchToken(rpc, runner.getUserTokenAccount(runner.creator)))
      .data.amount;
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains
    const gains = winners.map((userId, i) => ({
      userId,
      gain: balancesAfter[i].balance - balancesBefore[i].balance,
      shares: winnerShareAccounts[i].amount,
    }));
    const creatorGain = creatorBalanceAfter - creatorBalanceBefore;

    // All winners should have gained funds
    for (const { gain } of gains) {
      expect(gain > 0n).to.be.true;
    }

    // Total market loss should equal the full reward amount (tolerance of 2 for rounding)
    const marketLoss = marketBalanceBefore - marketBalanceAfter;
    expect(marketLoss >= marketFundingAmount - 2n && marketLoss <= marketFundingAmount).to.be.true;

    // Verify proportional reward distribution
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

    // Verify total gains equal reward amount
    const totalGains = gains.reduce((sum, { gain }) => sum + gain, 0n) + creatorGain;
    expect(totalGains >= marketFundingAmount - 2n).to.be.true;
    expect(totalGains <= marketFundingAmount).to.be.true;
  });

  it("allows users to vote for multiple options", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const numParticipants = 1;

    // Initialize TestRunner with 1 participant
    const runner = await TestRunner.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        maxShares: 100_000_000n, // Must accommodate stake amounts (quarterAmount = 25M each)
        timeToStake: 120n,
        timeToReveal: 20n,
      },
    });

    // Fund and open market
    await runner.fundMarket();
    const openTimestamp = await runner.openMarket();

    // Get the single participant
    const user = runner.participants[0];

    // Initialize VTA and mint vote tokens for user
    const voteTokenMintAmount = 100_000_000n;
    await runner.initVoteTokenAccount(user);
    await runner.mintVoteTokens(user, voteTokenMintAmount);

    // Calculate stake amounts: 1/4 of vote tokens for each action
    const quarterAmount = voteTokenMintAmount / 4n; // 25_000_000n

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // User adds 2 options, staking 1/4 of vote tokens for each
    // This creates share accounts 0 and 1
    const { optionIndex: optionA } = await runner.addMarketOption(user, "Option A", quarterAmount);
    const { optionIndex: optionB } = await runner.addMarketOption(user, "Option B", quarterAmount);

    // User explicitly stakes more shares for both options (1/4 each)
    // This creates share accounts 2 and 3
    await runner.stakeOnOptionBatch([
      { userId: user, amount: quarterAmount, optionIndex: optionA },
      { userId: user, amount: quarterAmount, optionIndex: optionB },
    ]);

    // User now has 4 share accounts, with all vote tokens staked
    const userShareAccounts = runner.getUserShareAccounts(user);
    expect(userShareAccounts.length).to.equal(4);

    // Market creator selects winning option (Option A)
    const winningOptionIndex = optionA;
    await runner.selectOption(winningOptionIndex);

    // Reveal ALL share accounts sequentially (one at a time to avoid concurrent MPC issues)
    for (const sa of userShareAccounts) {
      await runner.revealShares(user, sa.id);
    }

    // Verify all shares are revealed
    for (const sa of userShareAccounts) {
      const shareAccount = await runner.fetchShareAccountData(user, sa.id);
      expect(shareAccount.data.revealedAmount).to.deep.equal(some(sa.amount));
      expect(shareAccount.data.revealedOption).to.deep.equal(some(sa.optionIndex));
    }

    // Increment tally for winning option share accounts
    const winningShareAccounts = runner.getUserShareAccountsForOption(user, winningOptionIndex);
    await runner.incrementOptionTallyBatch(
      winningShareAccounts.map((sa) => ({
        userId: user,
        optionIndex: winningOptionIndex,
        shareAccountId: sa.id,
      }))
    );

    // Wait for reveal period to end
    const timeToReveal = Number(runner.getTimeToReveal());
    await sleepUntilOnChainTimestamp(new Date().getTime() / 1000 + timeToReveal);

    // Get balances before closing
    const rpc = runner.getRpc();
    const userBalanceBefore = (await fetchToken(rpc, runner.getUserTokenAccount(user))).data.amount;
    const marketAta = await runner.getMarketAta();
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // Close ALL share accounts (both winning and losing)
    await runner.closeShareAccountBatch(
      userShareAccounts.map((sa) => ({
        userId: user,
        optionIndex: sa.optionIndex,
        shareAccountId: sa.id,
      }))
    );

    // Verify all share accounts were closed
    for (const sa of userShareAccounts) {
      const addr = await runner.getShareAccountAddress(user, sa.id);
      const exists = await runner.accountExists(addr);
      expect(exists).to.be.false;
    }

    // Get balances after closing
    const userBalanceAfter = (await fetchToken(rpc, runner.getUserTokenAccount(user))).data.amount;
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains and losses
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

    // Market ATA should be empty (or nearly empty due to rounding)
    expect(marketBalanceAfter <= 1n, `Market ATA should be empty, has ${marketBalanceAfter}`).to.be.true;
  })
});
