"use server";

import { db } from "@/db/client";
import { markets, options, shares, type NewMarket, type NewOption, type NewShare } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { revalidatePath } from "next/cache";

/**
 * Get count of markets created by a specific user
 * This is called BEFORE market creation to determine the next market index
 */
export async function getUserMarketsCount(
  creatorPubkey: string
): Promise<{ count: number; error?: string }> {
  try {
    // Validate the public key format
    new PublicKey(creatorPubkey);

    const result = await db
      .select({ count: markets.address })
      .from(markets)
      .where(eq(markets.creatorPubkey, creatorPubkey));

    return { count: result.length };
  } catch (error) {
    console.error("Error fetching user markets count:", error);
    return {
      count: 0,
      error: error instanceof Error ? error.message : "Failed to fetch markets count"
    };
  }
}

/**
 * Insert a new market into the database
 * Called AFTER successful blockchain transaction
 */
export async function insertMarket(data: {
  address: string;
  name: string;
  description: string;
  creatorPubkey: string;
  rewardSol: string;
  marketIndex: number;
  signature: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate inputs
    new PublicKey(data.address);
    new PublicKey(data.creatorPubkey);

    if (!data.name.trim()) {
      throw new Error("Market name is required");
    }

    if (!data.description.trim()) {
      throw new Error("Market description is required");
    }

    const newMarket: NewMarket = {
      address: data.address,
      name: data.name.trim(),
      description: data.description.trim(),
      creatorPubkey: data.creatorPubkey,
      rewardSol: data.rewardSol,
      marketIndex: data.marketIndex.toString(),
      signature: data.signature,
    };

    await db.insert(markets).values(newMarket);

    // Revalidate the app page to show the new market
    revalidatePath("/app");

    return { success: true };
  } catch (error) {
    console.error("Error inserting market:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to insert market"
    };
  }
}

/**
 * Get all markets for a specific creator
 * Can be used to display user's markets in the UI
 */
export async function getUserMarkets(
  creatorPubkey: string
): Promise<{ markets: Array<typeof markets.$inferSelect>; error?: string }> {
  try {
    new PublicKey(creatorPubkey);

    const result = await db
      .select()
      .from(markets)
      .where(eq(markets.creatorPubkey, creatorPubkey))
      .orderBy(desc(markets.createdAt));

    return { markets: result };
  } catch (error) {
    console.error("Error fetching user markets:", error);
    return {
      markets: [],
      error: error instanceof Error ? error.message : "Failed to fetch markets"
    };
  }
}

/**
 * Get all markets (for homepage)
 */
export async function getAllMarkets(): Promise<{
  markets: Array<typeof markets.$inferSelect>;
  error?: string;
}> {
  try {
    const result = await db
      .select()
      .from(markets)
      .orderBy(desc(markets.createdAt))
      .limit(50);

    return { markets: result };
  } catch (error) {
    console.error("Error fetching all markets:", error);
    return {
      markets: [],
      error: error instanceof Error ? error.message : "Failed to fetch markets",
    };
  }
}

/**
 * Insert a new option into the database
 * Called AFTER successful blockchain transaction
 */
export async function insertOption(data: {
  address: string;
  marketAddress: string;
  name: string;
  description: string;
  creatorPubkey: string;
  signature: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate inputs
    new PublicKey(data.address);
    new PublicKey(data.marketAddress);
    new PublicKey(data.creatorPubkey);

    if (!data.name.trim()) {
      throw new Error("Option name is required");
    }

    const newOption: NewOption = {
      address: data.address,
      marketAddress: data.marketAddress,
      name: data.name.trim(),
      description: data.description.trim(),
      creatorPubkey: data.creatorPubkey,
      signature: data.signature,
    };

    await db.insert(options).values(newOption);

    // Revalidate the market detail page to show the new option
    revalidatePath(`/app/${data.marketAddress}`);

    return { success: true };
  } catch (error) {
    console.error("Error inserting option:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to insert option",
    };
  }
}

/**
 * Insert a new share into the database
 * Called AFTER successful blockchain transaction
 */
export async function insertShare(data: {
  userPubkey: string;
  marketAddress: string;
  optionAddress: string;
  amount: string;
  signature: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate inputs
    new PublicKey(data.userPubkey);
    new PublicKey(data.marketAddress);
    new PublicKey(data.optionAddress);

    if (!data.amount || Number(data.amount) <= 0) {
      throw new Error("Amount must be greater than 0");
    }

    const newShare: NewShare = {
      id: `${data.userPubkey}-${data.marketAddress}`,
      userPubkey: data.userPubkey,
      marketAddress: data.marketAddress,
      optionAddress: data.optionAddress,
      amount: data.amount,
      signature: data.signature,
    };

    await db.insert(shares).values(newShare);

    // Revalidate the market detail page to show the share
    revalidatePath(`/app/${data.marketAddress}`);

    return { success: true };
  } catch (error) {
    console.error("Error inserting share:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to insert share",
    };
  }
}

/**
 * Get user's share for a specific market
 * Returns null if user hasn't voted in this market
 */
export async function getUserShareForMarket(
  userPubkey: string,
  marketAddress: string
): Promise<{ share: typeof shares.$inferSelect | null; error?: string }> {
  try {
    new PublicKey(userPubkey);
    new PublicKey(marketAddress);

    const result = await db
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.userPubkey, userPubkey),
          eq(shares.marketAddress, marketAddress)
        )
      )
      .limit(1);

    return { share: result[0] ?? null };
  } catch (error) {
    console.error("Error fetching user share:", error);
    return {
      share: null,
      error: error instanceof Error ? error.message : "Failed to fetch share",
    };
  }
}

/**
 * Mark a share as revealed
 * Called AFTER successful reveal transaction
 */
export async function markShareRevealed(data: {
  userPubkey: string;
  marketAddress: string;
  revealedInTime: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    new PublicKey(data.userPubkey);
    new PublicKey(data.marketAddress);

    const shareId = `${data.userPubkey}-${data.marketAddress}`;

    await db
      .update(shares)
      .set({ revealedInTime: data.revealedInTime })
      .where(eq(shares.id, shareId));

    // Revalidate the market detail page
    revalidatePath(`/app/${data.marketAddress}`);

    return { success: true };
  } catch (error) {
    console.error("Error marking share as revealed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to mark share as revealed",
    };
  }
}

/**
 * Mark a share's yield as claimed
 * Called AFTER successful closeShareAccount transaction
 */
export async function markShareYieldClaimed(data: {
  userPubkey: string;
  marketAddress: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    new PublicKey(data.userPubkey);
    new PublicKey(data.marketAddress);

    const shareId = `${data.userPubkey}-${data.marketAddress}`;

    await db
      .update(shares)
      .set({ claimedYield: true })
      .where(eq(shares.id, shareId));

    revalidatePath(`/app/${data.marketAddress}`);

    return { success: true };
  } catch (error) {
    console.error("Error marking share yield as claimed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to mark yield as claimed",
    };
  }
}

/**
 * Set the openTimestamp for a market
 * Called AFTER successful openMarket transaction
 */
export async function setMarketOpenTimestamp(data: {
  marketAddress: string;
  openTimestamp: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    new PublicKey(data.marketAddress);

    await db
      .update(markets)
      .set({ openTimestamp: new Date(data.openTimestamp * 1000) })
      .where(eq(markets.address, data.marketAddress));

    revalidatePath(`/app/${data.marketAddress}`);

    return { success: true };
  } catch (error) {
    console.error("Error setting market open timestamp:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to set open timestamp",
    };
  }
}
