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
import { PublicKey } from "@solana/web3.js";
import { useAddMarketOption } from "@/hooks/use-add-market-option";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";

interface AddOptionDialogProps {
  marketAddress: string;
  totalOptions: number;
  onSubmit: () => void
}

export function AddOptionDialog({ marketAddress, totalOptions, onSubmit }: AddOptionDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { addOption, isPending } = useAddMarketOption();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Invalid input",
        description: "Please provide an option name",
        variant: "destructive",
      });
      return;
    }

    // Option index is 1-based and sequential
    const optionIndex = totalOptions + 1;

    addOption(
      {
        market: new PublicKey(marketAddress),
        optionIndex,
        name: name.trim(),
        description: description.trim(),
      },
      {
        onSuccess: () => {
          toast({
            title: "Option added!",
            description: `Option "${name.trim()}" created successfully`,
          });
          setOpen(false);
          onSubmit()
        },
        onError: (error) => {
          toast({
            title: "Failed to add option",
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
        <Button variant="outline" size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Add Option
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Voting Option</DialogTitle>
          <DialogDescription>
            Create a new option for voters to choose from.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="option-name">Option Name</Label>
            <Input
              id="option-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Pizza"
              required
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              A short, clear name for this voting option.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="option-description">Description</Label>
            <Textarea
              id="option-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this option..."
              maxLength={1000}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Optional details about this choice.
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
                "Create Option"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
