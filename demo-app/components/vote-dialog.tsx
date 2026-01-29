"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Loader2 } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useBuyShares } from "@/hooks/use-buy-shares";
import { useToast } from "@/hooks/use-toast";

interface VoteDialogProps {
  optionAddress: string;
  optionName: string;
  optionIndex: number;
  marketAddress: string;
  maxBalance: bigint;
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function VoteDialog({
  optionAddress,
  optionName,
  optionIndex,
  marketAddress,
  maxBalance,
  onSuccess,
  children,
}: VoteDialogProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const { buyShares, isPending } = useBuyShares();
  const { toast } = useToast();

  const maxBalanceNumber = Number(maxBalance);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Only allow whole numbers
    if (value === "" || /^\d+$/.test(value)) {
      const numValue = Number(value);
      if (value === "" || numValue <= maxBalanceNumber) {
        setAmount(value);
      }
    }
  };

  const handleMaxClick = () => {
    setAmount(maxBalanceNumber.toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid number of shares",
        variant: "destructive",
      });
      return;
    }

    if (numAmount > maxBalanceNumber) {
      toast({
        title: "Insufficient balance",
        description: `You can only purchase up to ${maxBalanceNumber} shares`,
        variant: "destructive",
      });
      return;
    }

    buyShares(
      {
        market: new PublicKey(marketAddress),
        optionAddress,
        optionIndex,
        amount: numAmount,
      },
      {
        onSuccess: () => {
          toast({
            title: "Vote successful!",
            description: `You purchased ${numAmount} shares for "${optionName}"`,
          });
          setOpen(false);
          setAmount("");
          onSuccess?.();
        },
        onError: (error) => {
          toast({
            title: "Failed to vote",
            description:
              error instanceof Error ? error.message : "Unknown error occurred",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Vote for {optionName}</DialogTitle>
          <DialogDescription>
            Stake VOTE to vote for this option.<br/>
            Your vote is confidential until the market resolves.<br/>
            You can withdraw all your stake when the market resolves.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="share-amount">Number of Shares</Label>
              <span className="text-xs text-muted-foreground">
                Balance: {maxBalanceNumber} VOTE
              </span>
            </div>
            <div className="relative">
              <Input
                id="share-amount"
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0"
                className="pr-20"
                disabled={isPending}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleMaxClick}
                  disabled={isPending}
                >
                  MAX
                </Button>
              </div>
            </div>
            <div className="flex gap-3 p-3 rounded-lg border border-accent/30 bg-accent/5">
              <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                More stake = stronger conviction.
                If the market creator chooses this option, you gain yield proportional to your stake and how long you were staked.
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="accent"
              className="flex-1"
              disabled={isPending || !amount || Number(amount) <= 0}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Voting...
                </>
              ) : (
                "Vote"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
