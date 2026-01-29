"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Coins, ExternalLink, ListChecks, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CreateMarketDialog } from "@/components/create-market-dialog";
import type { MergedMarket, MarketStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  MarketStatus | "initializing",
  { label: string; className: string }
> = {
  initializing: {
    label: "Initializing...",
    className: "border-purple-500/50 text-purple-500",
  },
  not_funded: {
    label: "Not Funded",
    className: "border-muted-foreground/50 text-muted-foreground",
  },
  open: {
    label: "Open",
    className: "border-accent/50 text-accent",
  },
  revealing: {
    label: "Revealing",
    className: "border-amber-500/50 text-amber-500",
  },
  resolved: {
    label: "Resolved",
    className: "border-blue-500/50 text-blue-500",
  },
};

interface PendingMarket {
  address: string;
  name: string;
  description: string;
  creatorPubkey: string;
  createdAt: Date;
}

type DisplayMarket =
  | { type: "active"; data: MergedMarket }
  | { type: "pending"; data: PendingMarket };

interface MarketsDashboardProps {
  markets: MergedMarket[];
  pendingMarkets?: PendingMarket[];
}

export function MarketsDashboard({ markets, pendingMarkets = [] }: MarketsDashboardProps) {
  const { publicKey } = useWallet();
  const router = useRouter();

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Combine and sort all markets by createdAt (newest first)
  const allMarkets = useMemo(() => {
    const active: DisplayMarket[] = markets.map((m) => ({ type: "active", data: m }));
    const pending: DisplayMarket[] = pendingMarkets.map((m) => ({ type: "pending", data: m }));

    return [...active, ...pending].sort((a, b) => {
      const dateA = new Date(a.data.createdAt).getTime();
      const dateB = new Date(b.data.createdAt).getTime();
      return dateB - dateA;
    });
  }, [markets, pendingMarkets]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-light tracking-tight text-foreground">
              <span>Conviction Markets</span>
            </h1>
          </div>
          {publicKey && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span className="text-xs bg-secondary px-2 py-1 rounded">
                {truncateAddress(publicKey.toBase58())}
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-foreground">
              Active Markets
            </h2>
            <CreateMarketDialog />
          </div>

          <div className="space-y-4">
            {allMarkets.map((item) => {
              if (item.type === "pending") {
                const market = item.data;
                const statusConfig = STATUS_CONFIG["initializing"];
                return (
                  <Card
                    key={market.address}
                    className="p-5 bg-card border-border hover:border-accent/50 transition-colors cursor-pointer opacity-75"
                    onClick={() => router.push(`/app/${market.address}`)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://solscan.io/account/${market.creatorPubkey}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-accent flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Created by {truncateAddress(market.creatorPubkey)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <h3 className="text-foreground font-medium">
                          {market.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {market.description}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${statusConfig.className}`}
                      >
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        {statusConfig.label}
                      </Badge>
                    </div>
                  </Card>
                );
              }

              const market = item.data;
              const statusConfig = STATUS_CONFIG[market.status];
              return (
                <Card
                  key={market.address}
                  className="p-5 bg-card border-border hover:border-accent/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/app/${market.address}`)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://solscan.io/account/${market.creatorPubkey}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-accent flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Created by {truncateAddress(market.creatorPubkey)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <h3 className="text-foreground font-medium">
                        {market.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {market.description}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 ${statusConfig.className}`}
                    >
                      {statusConfig.label}
                    </Badge>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <ListChecks className="w-4 h-4" />
                      <span>{market.totalOptions} options</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-4 h-4" />
                      <span>{market.rewardSol.toFixed(2)} SOL reward</span>
                    </div>
                  </div>
                </Card>
              );
            })}

            {allMarkets.length === 0 && (
              <Card className="p-8 bg-card border-border text-center">
                <p className="text-muted-foreground">
                  No active markets yet. Create the first one!
                </p>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
