"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Plus,
  Info,
  Clock,
  Users,
  Coins,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TokenSwap } from "@/components/token-swap";
import { CreateMarketDialog } from "@/components/create-market-dialog";

// Mock data for conviction markets
const mockMarkets = [
  {
    id: 1,
    title: "Who should win the next Nobel peace prize?",
    options: ["Donald Trump", "Maduro", "Jon Doe"],
    totalStaked: "245,000 SOL",
    participants: 1247,
    endsIn: "12 days",
    status: "staking",
  },
  {
    id: 2,
    title: "Who should anchor Arsenal FC's midfield? ",
    options: ["Declan Rice", "Martin Ødegaard ", "Thomas Partey"],
    totalStaked: "89,500 SOL",
    participants: 583,
    endsIn: "28 days",
    status: "staking",
  },
];

export default function AppPage() {
  const { connected, publicKey, disconnect } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected) {
      router.push("/");
    }
  }, [connected, router]);

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  if (!connected) {
    return null;
  }

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
              <span className="font-mono text-xs bg-secondary px-2 py-1 rounded">
                {truncateAddress(publicKey.toBase58())}
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content - Markets */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-foreground">
                Active Markets
              </h2>
              <CreateMarketDialog />
            </div>

            <div className="space-y-4">
              {mockMarkets.map((market) => (
                <Card
                  key={market.id}
                  className="p-5 bg-card border-border hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Encrypted votes
                        </span>
                      </div>
                      <h3 className="text-foreground font-medium">
                        {market.title}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {market.options.map((option) => (
                          <Badge
                            key={option}
                            variant="secondary"
                            className="bg-secondary text-secondary-foreground"
                          >
                            {option}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-accent/50 text-accent shrink-0"
                    >
                      {market.status}
                    </Badge>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-4 h-4" />
                      <span>{market.totalStaked}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      <span>{market.participants.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{market.endsIn}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Sidebar - Token Swap */}
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-foreground mb-4">
                Your Vote Tokens
              </h2>
              <TokenSwap />
            </div>

            {/* Info card */}
            <Card className="p-4 bg-secondary/30 border-border">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">
                    What are vote tokens?
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Vote tokens are used for staking in Conviction Markets.
                    They enable confidential staking: how much or for which option
                    you staked for is not revealed.
                    Vote tokens can always be swapped back to SOL at a constant price.
                    They are not tradable outside the platform.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
