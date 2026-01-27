"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Wallet, ArrowRight, LogOut } from "lucide-react";

export default function LoginPage() {
  const { connected, publicKey, wallet, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const router = useRouter();

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Header with stylized title - slightly off center */}
      <header className="pt-16 pl-8 md:pl-16 lg:pl-24">
        <h1 className="text-2xl md:text-3xl font-light tracking-tight text-foreground">
          <span className="text-muted-foreground">Conviction Markets</span>
          <span className="text-xl"> (devnet)</span>
        </h1>
      </header>

      {/* Main content - centered */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-medium text-foreground">
                Connect your wallet
              </h2>
              <p className="text-muted-foreground text-sm">
                Connect a Solana wallet to continue to the application
              </p>
            </div>

            {/* Connection status */}
            {connected && publicKey && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg px-4 py-3 border border-border">
                <div className="w-2 h-2 rounded-full bg-accent" />
                <span>Connected with</span>
                <span className="font-medium text-foreground">
                  {wallet?.adapter.name}
                </span>
                <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                  {truncateAddress(publicKey.toBase58())}
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              {!connected ? (
                <Button
                  onClick={() => setVisible(true)}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => disconnect()}
                    className="flex-1 border-border text-foreground hover:bg-secondary"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                  <Button
                    onClick={() => router.push("/app")}
                    className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    Go to App
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Subtle footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-muted-foreground">
          <a href={"https://bench.games"}>bench.games</a>
        </p>
      </footer>
    </main>
  );
}
