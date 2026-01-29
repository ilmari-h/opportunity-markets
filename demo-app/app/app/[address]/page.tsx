export const dynamic = 'force-dynamic';

import { db } from "@/db/client";
import { MarketDetail } from "@/components/market-detail";
import { MarketInitializing } from "@/components/market-initializing";
import { fetchMarket } from "@bench.games/conviction-markets";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { computeMarketStatus } from "@/lib/utils";
import type { MergedMarket } from "@/lib/types";

interface MarketDetailPageProps {
  params: Promise<{ address: string }>;
}

export default async function MarketDetailPage({ params }: MarketDetailPageProps) {
  const { address } = await params;

  // Fetch DB market for name/description
  const dbMarket = await db.query.markets.findFirst({
    where: (markets, { eq }) => eq(markets.address, address),
    with: {
      options: true,
    },
  });

  // Fetch on-chain market
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
  const onChainMarket = await fetchMarket(provider, new PublicKey(address));

  if (!onChainMarket) {
    return <MarketInitializing marketName={dbMarket?.name} />;
  }

  const openTimestamp = onChainMarket.account.openTimestamp?.toString() ?? null;
  const timeToStake = onChainMarket.account.timeToStake.toString();
  const timeToReveal = onChainMarket.account.timeToReveal.toString();
  const selectedOption = onChainMarket.account.selectedOption ?? null;

  const status = computeMarketStatus({
    openTimestamp,
    timeToStake,
    timeToReveal,
    selectedOption,
  });

  const market: MergedMarket = {
    address,
    createdAt: dbMarket?.createdAt ?? new Date(),
    name: dbMarket?.name ?? `Market #${onChainMarket.account.index.toString()}`,
    description: dbMarket?.description ?? "",
    creatorPubkey: onChainMarket.account.creator.toBase58(),
    rewardSol: Number(onChainMarket.account.rewardLamports) / LAMPORTS_PER_SOL,
    marketIndex: onChainMarket.account.index.toString(),
    totalOptions: dbMarket?.options.length ?? 0,
    maxOptions: onChainMarket.account.maxOptions,
    maxShares: onChainMarket.account.maxShares.toString(),
    openTimestamp,
    timeToStake,
    timeToReveal,
    selectedOption,
    status,
    options: (dbMarket?.options ?? []).map((opt) => ({
      address: opt.address,
      name: opt.name,
      description: opt.description,
    })),
  };

  return <MarketDetail market={market} />;
}
