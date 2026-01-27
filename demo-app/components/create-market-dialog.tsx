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
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { useCreateMarket } from "@/hooks/use-create-market";
import { useToast } from "@/hooks/use-toast";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

// Use fixed high values
const MAX_SHARES = Number.MAX_SAFE_INTEGER;
const MAX_OPTIONS = 60_000;

export function CreateMarketDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rewardSol, setRewardSol] = useState("10");
  const [timeToStakeDays, setTimeToStakeDays] = useState("7");
  const [timeToRevealDays, setTimeToRevealDays] = useState("3");

  const { createMarket, isPending } = useCreateMarket();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const rewardSolNum = parseFloat(rewardSol);
    const timeToStakeDaysNum = parseFloat(timeToStakeDays);
    const timeToRevealDaysNum = parseFloat(timeToRevealDays);

    // Validation
    if (!name.trim() || !description.trim()) {
      toast({
        title: "Invalid input",
        description: "Please provide market name and description",
        variant: "destructive",
      });
      return;
    }

    if (
      rewardSolNum <= 0 ||
      timeToStakeDaysNum <= 0 ||
      timeToRevealDaysNum <= 0
    ) {
      toast({
        title: "Invalid input",
        description: "Please check your input values",
        variant: "destructive",
      });
      return;
    }

    createMarket(
      {
        name: name.trim(),
        description: description.trim(),
        maxOptions: MAX_OPTIONS,
        maxShares: MAX_SHARES,
        rewardLamports: Math.floor(rewardSolNum * LAMPORTS_PER_SOL),
        timeToStake: Math.floor(timeToStakeDaysNum * 24 * 60 * 60), // Convert days to seconds
        timeToReveal: Math.floor(timeToRevealDaysNum * 24 * 60 * 60), // Convert days to seconds
      },
      {
        onSuccess: (data) => {
          toast({
            title: "Market created!",
            description: `Market #${data.marketIndex} created successfully`,
          });
          setOpen(false);
          // Reset form
          setName("");
          setDescription("");
          setRewardSol("10");
          setTimeToStakeDays("7");
          setTimeToRevealDays("3");
        },
        onError: (error) => {
          toast({
            title: "Failed to create market",
            description: error instanceof Error ? error.message : "Unknown error occurred",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="w-4 h-4 mr-2" />
          Create New Market
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Conviction Market</DialogTitle>
          <DialogDescription>
            Set up a new conviction market.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Market Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What kind of decision does this market solve?"
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="More context..."
              maxLength={1000}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Any further context on what the decision is about.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rewardSol">Reward Pool (SOL)</Label>
            <Input
              id="rewardSol"
              type="number"
              min="0"
              step="0.01"
              value={rewardSol}
              onChange={(e) => setRewardSol(e.target.value)}
              placeholder="Reward for winners (e.g., 10)"
              required
            />
            <p className="text-xs text-muted-foreground">
              SOL amount that will be distributed among winners.<br/>
              You must deposit this amount to open the market for staking.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeToStake">Staking Period (days)</Label>
            <Input
              id="timeToStake"
              type="number"
              min="0.01"
              step="0.01"
              value={timeToStakeDays}
              onChange={(e) => setTimeToStakeDays(e.target.value)}
              placeholder="Duration for staking (e.g., 7)"
              required
            />
            <p className="text-xs text-muted-foreground">
              How long users can buy shares and stake
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeToReveal">Reveal Period (days)</Label>
            <Input
              id="timeToReveal"
              type="number"
              min="0.01"
              step="0.01"
              value={timeToRevealDays}
              onChange={(e) => setTimeToRevealDays(e.target.value)}
              placeholder="Duration for reveal (e.g., 3)"
              required
            />
            <p className="text-xs text-muted-foreground">
              Time window for revealing votes after staking ends
            </p>
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
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Market"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
