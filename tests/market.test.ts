import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { address, some, isSome, createSolanaRpc, createSolanaRpcSubscriptions, sendAndConfirmTransactionFactory  } from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { expect } from "chai";

import { OpportunityMarket } from "../target/types/opportunity_market";
import { TestRunner } from "./utils/test-runner";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sleepUntilOnChainTimestamp } from "./utils/sleep";
import { generateX25519Keypair } from "../js/src/x25519/keypair";

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

    // Initialize ETAs and wrap encrypted tokens for all participants
    const wrapAmount = 100_000_000n;
    for (const userId of runner.participants) {
      await runner.initEncryptedTokenAccount(userId);
      await runner.wrapEncryptedTokens(userId, wrapAmount);
    }

    // Add two options
    const { optionIndex: optionA } = await runner.addOptionAsCreator("Option A");
    const { optionIndex: optionB } = await runner.addOptionAsCreator("Option B");

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Define voting: first half vote Option A (winning), second half vote Option B
    const winningOptionIndex = optionA;
    const buySharesAmounts = [50n, 75n, 100n, 60n];

    // Create an observer keypair that can read stakes.
    const observer = generateX25519Keypair();

    // Buy shares for all participants, with observer as authorized reader
    const purchases = runner.participants.map((userId, idx) => ({
      userId,
      amount: buySharesAmounts[idx],
      optionIndex: idx < numParticipants / 2 ? optionA : optionB,
    }));
    const shareAccountIds = await runner.stakeOnOptionBatch(purchases, observer.publicKey);

    // Verify user can decrypt their own stake
    purchases.forEach((purchase, i) => {
      const decrypted = runner.decryptStakeAmount(purchase.userId, shareAccountIds[i]);
      expect(decrypted.amount).to.equal(purchase.amount);
      expect(decrypted.optionIndex).to.equal(BigInt(purchase.optionIndex));
    });

    // Verify observer can decrypt disclosed stakes
    purchases.forEach((purchase, i) => {
      const disclosed = runner.decryptDisclosedStakeAmount(purchase.userId, shareAccountIds[i], observer);
      expect(disclosed.amount).to.equal(purchase.amount);
      expect(disclosed.optionIndex).to.equal(BigInt(purchase.optionIndex));
    });

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

    // Verify revealed shares for winners
    for (let i = 0; i < winners.length; i++) {
      const sa = winnerShareAccounts[i];
      const shareAccount = await runner.fetchShareAccountData(winners[i], sa.id);
      expect(shareAccount.data.revealedAmount).to.deep.equal(some(sa.amount));
      expect(shareAccount.data.revealedOption).to.deep.equal(some(winningOptionIndex));
    }

    // Increment option tally for winners
    await runner.incrementOptionTallyBatch(
      winners.map((userId, i) => ({
        userId,
        optionIndex: winningOptionIndex,
        shareAccountId: winnerShareAccounts[i].id,
      }))
    );

    // Verify option tally
    const totalWinningShares = winnerShareAccounts.reduce((sum, sa) => sum + sa.amount, 0n);
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
    const marketBalanceBefore = (await fetchToken(rpc, marketAta)).data.amount;

    // Close share accounts for winners
    await runner.closeShareAccountBatch(
      winners.map((userId, i) => ({
        userId,
        optionIndex: winningOptionIndex,
        shareAccountId: winnerShareAccounts[i].id,
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
    const marketBalanceAfter = (await fetchToken(rpc, marketAta)).data.amount;

    // Calculate gains
    const gains = winners.map((userId, i) => ({
      userId,
      gain: balancesAfter[i].balance - balancesBefore[i].balance,
      shares: winnerShareAccounts[i].amount,
    }));

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
    const totalGains = gains.reduce((sum, { gain }) => sum + gain, 0n);
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
        timeToStake: 120n,
        timeToReveal: 20n,
      },
    });

    // Fund and open market
    await runner.fundMarket();
    const openTimestamp = await runner.openMarket();

    // Get the single participant
    const user = runner.participants[0];

    // Initialize ETA and wrap encrypted tokens for user
    const wrapAmount = 100_000_000n;
    await runner.initEncryptedTokenAccount(user);
    await runner.wrapEncryptedTokens(user, wrapAmount);

    // Calculate stake amounts: 1/4 of wrapped tokens for each action
    const quarterAmount = wrapAmount / 4n; // 25_000_000n

    // Wait for market staking period to be active
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);

    // Create an observer keypair that can read stakes
    const observer = generateX25519Keypair();

    // User adds 2 options, staking 1/4 of wrapped tokens for each
    // This creates share accounts 0 and 1
    const { optionIndex: optionA, shareAccountId: sa0 } = await runner.addMarketOption(user, "Option A", quarterAmount, observer.publicKey);
    const { optionIndex: optionB, shareAccountId: sa1 } = await runner.addMarketOption(user, "Option B", quarterAmount, observer.publicKey);

    // User explicitly stakes more shares for both options (1/4 each)
    // This creates share accounts 2 and 3
    const [sa2, sa3] = await runner.stakeOnOptionBatch([
      { userId: user, amount: quarterAmount, optionIndex: optionA },
      { userId: user, amount: quarterAmount, optionIndex: optionB },
    ], observer.publicKey);

    // User now has 4 share accounts, with all wrapped tokens staked
    const userShareAccounts = runner.getUserShareAccounts(user);
    expect(userShareAccounts.length).to.equal(4);

    // Verify user can decrypt all share accounts
    const expectedStakes = [
      { id: sa0, amount: quarterAmount, optionIndex: optionA },
      { id: sa1, amount: quarterAmount, optionIndex: optionB },
      { id: sa2, amount: quarterAmount, optionIndex: optionA },
      { id: sa3, amount: quarterAmount, optionIndex: optionB },
    ];
    expectedStakes.forEach(({ id, amount, optionIndex }) => {
      const decrypted = runner.decryptStakeAmount(user, id);
      expect(decrypted.amount).to.equal(amount);
      expect(decrypted.optionIndex).to.equal(BigInt(optionIndex));
    });

    // Verify observer can decrypt all disclosed stakes
    expectedStakes.forEach(({ id, amount, optionIndex }) => {
      const disclosed = runner.decryptDisclosedStakeAmount(user, id, observer);
      expect(disclosed.amount).to.equal(amount);
      expect(disclosed.optionIndex).to.equal(BigInt(optionIndex));
    });

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
  });

  it("allows early unstaking with delay", async () => {
    const marketFundingAmount = 1_000_000_000n;
    const unstakeDelaySeconds = 10n;
    const timeToStake = 30n;

    const runner = await TestRunner.initialize(provider, programId, {
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      numParticipants: 2,
      airdropLamports: 2_000_000_000n,
      initialTokenAmount: 2_000_000_000n,
      marketConfig: {
        rewardAmount: marketFundingAmount,
        timeToStake,
        timeToReveal: 20n,
        unstakeDelaySeconds,
      },
    });

    // Fund and open market
    await runner.fundMarket();
    const openTimestamp = await runner.openMarket();

    const [staker, executor] = runner.participants;

    // Initialize ETAs and wrap tokens
    await runner.initEncryptedTokenAccount(staker);
    await runner.initEncryptedTokenAccount(executor);
    const wrapAmount = 100_000_000n;
    await runner.wrapEncryptedTokens(staker, wrapAmount);

    // Add options
    const { optionIndex: optionA } = await runner.addOptionAsCreator("Option A");
    await runner.addOptionAsCreator("Option B");

    // Wait for staking period and stake
    await sleepUntilOnChainTimestamp(Number(openTimestamp) + ONCHAIN_TIMESTAMP_BUFFER_SECONDS);
    const stakeAmount = 50_000_000n;
    const shareAccountId = await runner.stakeOnOption(staker, stakeAmount, optionA);

    // Verify ETA balance decreased after staking
    const balanceAfterStake = await runner.decryptEtaBalance(staker);
    expect(balanceAfterStake).to.equal(wrapAmount - stakeAmount);

    // Verify initial state
    let shareAccount = await runner.fetchShareAccountData(staker, shareAccountId);
    expect(isSome(shareAccount.data.unstakeableAtTimestamp)).to.be.false;
    expect(isSome(shareAccount.data.unstakedAtTimestamp)).to.be.false;

    // Initiate early unstake (sets unstakeableAtTimestamp)
    await runner.unstakeEarly(staker, shareAccountId);

    shareAccount = await runner.fetchShareAccountData(staker, shareAccountId);
    expect(isSome(shareAccount.data.unstakeableAtTimestamp)).to.be.true;
    expect(isSome(shareAccount.data.unstakedAtTimestamp)).to.be.false;

    // Execute unstake too early, should throw
    try {
      await runner.doUnstakeEarly(executor, staker, shareAccountId);
      expect(false, "Should trhow");
    } catch { }

    // Wait for unstake delay to pass
    if (!isSome(shareAccount.data.unstakeableAtTimestamp)) throw new Error()
    const unstakeableAt = shareAccount.data.unstakeableAtTimestamp.value;
    await sleepUntilOnChainTimestamp(Number(unstakeableAt) + 1);

    // Execute unstake (permissionless - different user can call)
    await runner.doUnstakeEarly(executor, staker, shareAccountId);

    shareAccount = await runner.fetchShareAccountData(staker, shareAccountId);
    expect(isSome(shareAccount.data.unstakedAtTimestamp)).to.be.true;

    // Verify ETA balance was refunded
    const balanceAfterUnstake = await runner.decryptEtaBalance(staker);
    expect(balanceAfterUnstake).to.equal(wrapAmount);

    // Select winner and wait for stake period to end
    await runner.selectOption(optionA);
    const stakeEndTimestamp = Number(openTimestamp) + Number(timeToStake);
    await sleepUntilOnChainTimestamp(stakeEndTimestamp + 1);

    // Reveal shares.
    await runner.revealShares(staker, shareAccountId);
    shareAccount = await runner.fetchShareAccountData(staker, shareAccountId);
    expect(shareAccount.data.revealedAmount).to.deep.equal(some(stakeAmount));
    expect(shareAccount.data.revealedOption).to.deep.equal(some(optionA));
  });

});
