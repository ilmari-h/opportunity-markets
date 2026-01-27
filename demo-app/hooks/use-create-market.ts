"use client";

import { useMutation } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { createMarket, deriveMarketPda } from "@bench.games/conviction-markets";
import { getUserMarketsCount, insertMarket } from "@/app/actions/markets";

interface CreateMarketParams {
  /** Market name */
  name: string;
  /** Market description */
  description: string;
  /** Maximum number of options allowed */
  maxOptions: number;
  /** Maximum shares available for purchase */
  maxShares: number;
  /** Reward pool in lamports for winners */
  rewardLamports: number;
  /** Duration of staking period in seconds */
  timeToStake: number;
  /** Duration of reveal period in seconds */
  timeToReveal: number;
}

interface CreateMarketResult {
  /** Signature of create market transaction */
  signature: string;
  /** Market index that was used */
  marketIndex: number;
  /** Market PDA address */
  marketPda: string;
}

/**
 * Hook to create a new conviction market
 *
 * This hook handles the transaction to create a market:
 * 1. Fetches existing markets for the user to determine the next index
 * 2. Creates the market on-chain with the correct index
 * 3. Uses default program ID and no select authority
 *
 * @returns Tanstack Query mutation with createMarket function
 */
export function useCreateMarket() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const mutation = useMutation({
    mutationFn: async (params: CreateMarketParams): Promise<CreateMarketResult> => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error("Wallet not connected");
      }

      // STEP 1: Get user's market count to determine next index
      console.log("Fetching existing markets count...");
      const { count, error: countError } = await getUserMarketsCount(
        wallet.publicKey.toBase58()
      );

      if (countError) {
        throw new Error(`Failed to fetch markets count: ${countError}`);
      }

      const marketIndex = count;
      console.log(`Found ${count} existing market(s). Creating market with index ${marketIndex}...`);

      // STEP 2: Derive the market PDA
      const [marketPda] = deriveMarketPda(wallet.publicKey, marketIndex);
      console.log("Derived market PDA:", marketPda.toBase58());

      // STEP 3: Create the market on-chain
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const { transaction } = await createMarket(provider, {
        creator: wallet.publicKey,
        marketIndex,
        maxOptions: params.maxOptions,
        maxShares: params.maxShares,
        rewardLamports: params.rewardLamports,
        timeToStake: params.timeToStake,
        timeToReveal: params.timeToReveal,
        selectAuthority: undefined,
      });

      const signature = await wallet.sendTransaction(transaction, connection);
      console.log("Create market transaction sent:", signature);

      await connection.confirmTransaction(signature, "confirmed");
      console.log("Market created on-chain successfully");

      // STEP 4: Insert market into database
      console.log("Saving market to database...");
      const { success, error: insertError } = await insertMarket({
        address: marketPda.toBase58(),
        name: params.name,
        description: params.description,
        creatorPubkey: wallet.publicKey.toBase58(),
        rewardSol: (params.rewardLamports / LAMPORTS_PER_SOL).toString(),
        marketIndex,
        signature,
      });

      if (!success) {
        console.error("Warning: Market created on-chain but database insert failed:", insertError);
        // Still return success since blockchain tx succeeded
      } else {
        console.log("Market saved to database successfully");
      }

      return {
        signature,
        marketIndex,
        marketPda: marketPda.toBase58(),
      };
    },
  });

  return {
    createMarket: mutation.mutate,
    createMarketAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
}
