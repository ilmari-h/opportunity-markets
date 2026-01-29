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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { useCreateMarket } from "@/hooks/use-create-market";
import { useToast } from "@/hooks/use-toast";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const DURATION_OPTIONS = [
  { label: "5 minutes", value: 5 * 60 },
  { label: "10 minutes", value: 10 * 60 },
  { label: "1 hour", value: 60 * 60 },
  { label: "1 day", value: 24 * 60 * 60 },
  { label: "1 week", value: 7 * 24 * 60 * 60 },
] as const;

// Use fixed high values
const MAX_SHARES = Number.MAX_SAFE_INTEGER;
const MAX_OPTIONS = 60_000;

export function CreateMarketDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rewardSol, setRewardSol] = useState("10");
  const [timeToStake, setTimeToStake] = useState<number>(DURATION_OPTIONS[4].value); // 1 week
  const [timeToReveal, setTimeToReveal] = useState<number>(DURATION_OPTIONS[3].value); // 1 day

  const { createMarket, isPending } = useCreateMarket();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const rewardSolNum = parseFloat(rewardSol);

    // Validation
    if (!name.trim() || !description.trim()) {
      toast({
        title: "Invalid input",
        description: "Please provide market name and description",
        variant: "destructive",
      });
      return;
    }

    if (rewardSolNum <= 0) {
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
        timeToStake,
        timeToReveal,
      },
      {
        onSuccess: (data) => {
          toast({
            title: "Market created!",
            description: `Market created successfully`,
          });
          setOpen(false);
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
        <Button variant="accent">
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
              placeholder="What should I cook for dinner tonight?"
              required
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              What kind of decision will the voters be influencing?
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
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
            <Label htmlFor="timeToStake">Staking Period</Label>
            <Select
              value={timeToStake.toString()}
              onValueChange={(value) => setTimeToStake(Number(value))}
            >
              <SelectTrigger id="timeToStake">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How long users have to choose and place their stake.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeToReveal">Reveal Period</Label>
            <Select
              value={timeToReveal.toString()}
              onValueChange={(value) => setTimeToReveal(Number(value))}
            >
              <SelectTrigger id="timeToReveal">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Time window for revealing votes after staking ends.
              Temporary thing: permissionless operation that we can automate later instead of users having to do it themselves.
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
              variant="accent"
              className="flex-1"
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
