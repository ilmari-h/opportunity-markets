"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface MarketInitializingProps {
  marketName?: string;
}

export function MarketInitializing({ marketName }: MarketInitializingProps) {
  useEffect(() => {
    const interval = setInterval(() => {
      window.location.reload();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-light tracking-tight text-foreground">
            Conviction Markets
          </h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <Card className="p-8 bg-card border-border">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <div className="space-y-2">
              <h2 className="text-lg font-medium text-foreground">
                {marketName ? `"${marketName}"` : "Market"} is being initialized
              </h2>
              <p className="text-sm text-muted-foreground">
                Please wait a few seconds. This page will refresh automatically.
              </p>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
