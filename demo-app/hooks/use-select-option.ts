"use client";

import { useMutation } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { selectOption } from "@bench.games/conviction-markets";
import type { PublicKey } from "@solana/web3.js";

interface SelectOptionParams {
  /** Market PDA address */
  market: PublicKey;
  /** Index of the winning option */
  optionIndex: number;
}

interface SelectOptionResult {
  /** Signature of the transaction */
  signature: string;
  /** PDA of the selected option */
  optionPda: PublicKey;
}

/**
 * Hook to select the winning option and close a conviction market
 *
 * This hook handles the transaction to select an option:
 * 1. Builds the select option transaction
 * 2. Sends and confirms the transaction
 *
 * Can only be called by the market creator or designated select_authority.
 * Automatically closes the staking period if still open.
 *
 * @returns Tanstack Query mutation with selectOption function
 */
export function useSelectOption() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const mutation = useMutation({
    mutationFn: async (params: SelectOptionParams): Promise<SelectOptionResult> => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error("Wallet not connected");
      }

      // STEP 1: Build the transaction
      console.log("Building select option transaction...");
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: "confirmed" }
      );

      const { transaction, optionPda } = await selectOption(provider, {
        authority: wallet.publicKey,
        market: params.market,
        optionIndex: params.optionIndex,
      });

      // STEP 2: Send and confirm the transaction
      const signature = await wallet.sendTransaction(transaction, connection);
      console.log("Select option transaction sent:", signature);

      await connection.confirmTransaction(signature, "confirmed");
      console.log("Option selected successfully");

      return { signature, optionPda };
    },
  });

  return {
    selectOption: mutation.mutate,
    selectOptionAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
}
