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
      {/* Header with stylized title and GitHub link */}
      <header className="pt-16 px-8 md:px-16 lg:px-24 flex items-center justify-between">
        <img src="/logo-text.png" alt="Bench" className="h-10" />
        <a
          href="https://github.com/ilmari-h/solana-conviction-markets"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </header>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {/* Wallet connect section */}
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
                <span className="text-xs bg-muted px-2 py-1 rounded">
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
                    variant="accent"
                    className="flex-1"
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

      {/* Devnet disclaimer */}
      <div className="px-4 pb-4">
        <div className="max-w-xl mx-auto border border-orange-500 bg-orange-500/10 rounded-lg px-4 py-3 text-xs text-center space-y-1">
          <p className="text-primary">To interact with this demo application, please switch your wallet to "Devnet".</p>
          <p className="text-primary">
            You also need some devnet SOL. You can claim it via this faucet:{" "}
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-800 underline"
            >
              faucet.solana.com
            </a>
          </p>
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
