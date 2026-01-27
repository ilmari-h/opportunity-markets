"use server";

import { db } from "@/db/client";
import { markets, type NewMarket } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
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
