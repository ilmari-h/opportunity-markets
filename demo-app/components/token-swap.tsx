"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownUp, Loader2 } from "lucide-react";
import { useSolBalance } from "@/hooks/use-sol-balance";
import { useBuyVoteTokens } from "@/hooks/use-buy-vote-tokens";
import { useSellVoteTokens } from "@/hooks/use-sell-vote-tokens";
import { useVoteTokensBalance } from "@/hooks/use-vote-tokens-balance";
import { useToast } from "@/hooks/use-toast";
import { PRICE_PER_VOTE_TOKEN_LAMPORTS } from "@/lib/constants";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";

export function TokenSwap() {
  const [swapDirection, setSwapDirection] = useState<"buy" | "sell">("buy");
  const [inputAmount, setInputAmount] = useState("");
  const { balanceInSol } = useSolBalance();
  const { connected } = useWallet();
  const { buyVoteTokens, isPending: isBuyPending } = useBuyVoteTokens();
  const { sellVoteTokens, isPending: isSellPending } = useSellVoteTokens();
  const { balance: voteTokenBalance } = useVoteTokensBalance();
  const { toast } = useToast();

  const isPending = isBuyPending || isSellPending;

  // Convert bigint balance to number for display
  const voteTokenBalanceNumber = voteTokenBalance ? Number(voteTokenBalance) : 0;

  const toggleSwapDirection = () => {
    setSwapDirection((prev) => (prev === "buy" ? "sell" : "buy"));
    setInputAmount("");
  };

  const handleMaxClick = () => {
    if (swapDirection === "buy") {
      setInputAmount(balanceInSol.toFixed(9));
    } else {
      setInputAmount(Math.floor(voteTokenBalanceNumber).toString());
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // If selling VOTE tokens, only allow whole numbers
    if (swapDirection === "sell") {
      // Remove any decimal point and anything after it
      const wholeNumber = value.split('.')[0];
      setInputAmount(wholeNumber);
    } else {
      setInputAmount(value);
    }
  };

  const handleSwap = () => {
    if (!connected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to continue",
        variant: "destructive",
      });
      return;
    }

    if (swapDirection === "buy") {
      // Buy vote tokens with SOL
      const voteTokenAmount = parseFloat(outputAmount);
      if (voteTokenAmount <= 0) {
        toast({
          title: "Invalid amount",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
        return;
      }

      buyVoteTokens(
        { amount: Math.floor(voteTokenAmount) },
        {
          onSuccess: (data) => {
            toast({
              title: "Success!",
              description: `Successfully bought ${data.amount} vote tokens`,
            });
            setInputAmount("");
          },
          onError: (error) => {
            toast({
              title: "Transaction failed",
              description: error instanceof Error ? error.message : "Unknown error occurred",
              variant: "destructive",
            });
          },
        }
      );
    } else {
      // Sell vote tokens for SOL
      const voteTokenAmount = parseFloat(inputAmount);
      if (voteTokenAmount <= 0) {
        toast({
          title: "Invalid amount",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
        return;
      }

      sellVoteTokens(
        { amount: Math.floor(voteTokenAmount) },
        {
          onSuccess: (data) => {
            toast({
              title: "Success!",
              description: `Successfully sold ${data.amount} vote tokens`,
            });
            setInputAmount("");
          },
          onError: (error) => {
            toast({
              title: "Transaction failed",
              description: error instanceof Error ? error.message : "Unknown error occurred",
              variant: "destructive",
            });
          },
        }
      );
    }
  };

  // Calculate price in SOL (lamports to SOL conversion)
  const pricePerVoteTokenInSol =
    Number(PRICE_PER_VOTE_TOKEN_LAMPORTS) / LAMPORTS_PER_SOL;

  // Calculate output amount based on input and direction
  const outputAmount = useMemo(() => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) return "";

    const input = parseFloat(inputAmount);

    if (swapDirection === "buy") {
      // Buying VOTE with SOL: SOL / price = VOTE
      const voteTokens = Math.floor(input / pricePerVoteTokenInSol);
      return voteTokens.toString();
    } else {
      // Selling VOTE for SOL: VOTE * price = SOL
      // Input should already be whole number due to handleInputChange
      const wholeVoteTokens = Math.floor(input);
      const sol = wholeVoteTokens * pricePerVoteTokenInSol;
      return sol.toFixed(9);
    }
  }, [inputAmount, swapDirection, pricePerVoteTokenInSol]);

  const fromToken = swapDirection === "buy" ? "SOL" : "VOTE";
  const toToken = swapDirection === "buy" ? "VOTE" : "SOL";
  const fromBalance =
    swapDirection === "buy" ? balanceInSol : voteTokenBalanceNumber;
  const toBalance = swapDirection === "buy" ? voteTokenBalanceNumber : balanceInSol;

  return (
    <Card className="p-4 bg-card border-border space-y-3 gap-2">
      {/* From Token Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>From</span>
          <span>
            Balance: {fromBalance.toLocaleString(undefined, {
              maximumFractionDigits: fromToken === "SOL" ? 9 : 0
            })}{" "}
            {fromToken}
          </span>
        </div>
        <div className="relative">
          <Input
            type="number"
            placeholder={swapDirection === "sell" ? "0" : "0.0"}
            value={inputAmount}
            onChange={handleInputChange}
            step={swapDirection === "sell" ? "1" : "any"}
            min="0"
            className="pr-24 text-lg font-medium"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMaxClick}
              className="h-6 px-2 text-xs text-accent hover:text-accent/80"
            >
              MAX
            </Button>
            <span className="font-medium text-sm text-foreground">
              {fromToken}
            </span>
          </div>
        </div>
      </div>

      {/* Swap Button */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleSwapDirection}
          className="rounded-full border-border hover:border-accent hover:bg-accent/10 transition-all"
        >
          <ArrowDownUp className="w-4 h-4" />
        </Button>
      </div>

      {/* To Token Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>To</span>
          <span>
            Balance: {toBalance.toLocaleString(undefined, {
              maximumFractionDigits: toToken === "SOL" ? 9 : 0
            })}{" "}
            {toToken}
          </span>
        </div>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.0"
            disabled
            value={outputAmount}
            className="pr-16 text-lg font-medium bg-secondary/30"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <span className="font-medium text-sm text-foreground">
              {toToken}
            </span>
          </div>
        </div>
      </div>

      {/* Price Info */}
      <div className="flex items-center justify-center text-xs text-muted-foreground">
        <span>
          1 VOTE = {pricePerVoteTokenInSol.toFixed(6)} SOL
        </span>
      </div>

      {/* Swap Action Button */}
      <div className="pt-2">
        <Button
          variant="accent"
          className="w-full"
          disabled={!inputAmount || parseFloat(inputAmount) <= 0 || isPending || !connected}
          onClick={handleSwap}
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : !connected ? (
            "Connect Wallet"
          ) : (
            `Swap ${fromToken} → ${toToken}`
          )}
        </Button>
      </div>
    </Card>
  );
}
