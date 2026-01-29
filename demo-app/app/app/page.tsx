export const dynamic = 'force-dynamic';

import { db } from "@/db/client";
import { MarketsDashboard } from "@/components/markets-dashboard";
import { fetchAllMarkets } from "@bench.games/conviction-markets";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { computeMarketStatus } from "@/lib/utils";
import type { MergedMarket } from "@/lib/types";

export default async function AppPage() {
  // Fetch DB markets for name/description
  const dbMarkets = await db.query.markets.findMany({
    orderBy: (markets, { desc }) => [desc(markets.createdAt)],
    with: {
      options: true,
    },
  });

  // Create a lookup map by address
  const dbMarketMap = new Map(
    dbMarkets.map((m) => [m.address, m])
  );

  // Fetch on-chain markets
  const connection = new Connection(process.env.SOLANA_RPC_URL!);
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    { commitment: "confirmed" }
  );
  const onChainMarkets = await fetchAllMarkets(provider);

  // Create a set of on-chain market addresses
  const onChainAddresses = new Set(
    onChainMarkets.map((m) => m.publicKey.toBase58())
  );

  // Find pending markets (in DB but not yet on-chain)
  const pendingMarkets = dbMarkets
    .filter((m) => !onChainAddresses.has(m.address))
    .map((m) => ({
      address: m.address,
      name: m.name,
      description: m.description,
      creatorPubkey: m.creatorPubkey,
      createdAt: m.createdAt,
    }));

  // Merge on-chain data with DB metadata (only markets that exist in both)
  const mergedMarkets: MergedMarket[] = onChainMarkets
    .filter((onChain) => dbMarketMap.has(onChain.publicKey.toBase58()))
    .map((onChain) => {
    const address = onChain.publicKey.toBase58();
    const dbData = dbMarketMap.get(address)!;

    const openTimestamp = onChain.account.openTimestamp?.toString() ?? null;
    const timeToStake = onChain.account.timeToStake.toString();
    const timeToReveal = onChain.account.timeToReveal.toString();
    const selectedOption = onChain.account.selectedOption ?? null;

    const status = computeMarketStatus({
      openTimestamp,
      timeToStake,
      timeToReveal,
      selectedOption,
    });

    return {
      address,
      name: dbData.name,
      description: dbData.description,
      creatorPubkey: onChain.account.creator.toBase58(),
      rewardSol: Number(onChain.account.rewardLamports) / LAMPORTS_PER_SOL,
      marketIndex: onChain.account.index.toString(),
      totalOptions: onChain.account.totalOptions,
      maxOptions: onChain.account.maxOptions,
      maxShares: onChain.account.maxShares.toString(),
      openTimestamp,
      timeToStake,
      timeToReveal,
      selectedOption,
      status,
      createdAt: dbData.createdAt,
      options: dbData.options.map((opt) => ({
        address: opt.address,
        name: opt.name,
        description: opt.description,
      })),
    };
  });

  return <MarketsDashboard markets={mergedMarkets} pendingMarkets={pendingMarkets} />;
}
