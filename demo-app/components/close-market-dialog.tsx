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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectOption } from "@/hooks/use-select-option";
import { useToast } from "@/hooks/use-toast";
import { PublicKey } from "@solana/web3.js";
import type { MarketOption } from "@/lib/types";

interface CloseMarketDialogProps {
  marketAddress: string;
  options: MarketOption[];
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function CloseMarketDialog({
  marketAddress,
  options,
  onSuccess,
  children,
}: CloseMarketDialogProps) {
  const [open, setOpen] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);

  const { selectOption, isPending } = useSelectOption();
  const { toast } = useToast();

  const selectedOption = selectedOptionIndex !== null ? options[selectedOptionIndex] : null;

  const handleClose = () => {
    setOpen(false);
    setSelectedOptionIndex(null);
  };

  const handleConfirm = () => {
    if (selectedOptionIndex === null) return;

    selectOption(
      {
        market: new PublicKey(marketAddress),
        // Option index is 1-based on-chain
        optionIndex: selectedOptionIndex + 1,
      },
      {
        onSuccess: () => {
          toast({
            title: "Market closed",
            description: `Selected "${selectedOption?.name}" as the winning option`,
          });
          handleClose();
          onSuccess?.();
        },
        onError: (error) => {
          toast({
            title: "Failed to close market",
            description: error instanceof Error ? error.message : "Unknown error occurred",
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
          <DialogTitle>Close Market</DialogTitle>
          <DialogDescription>
            Choose an option and close the market?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This action is irreversible. Once you select an option and close the market,
              participants who voted for this option will be able to claim their share of the reward.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Select winning option</label>
            <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboboxOpen}
                  className="w-full justify-between"
                  disabled={isPending}
                >
                  {selectedOption ? selectedOption.name : "Search options..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search options..." />
                  <CommandList>
                    <CommandEmpty>No option found.</CommandEmpty>
                    <CommandGroup>
                      {options.map((option, index) => (
                        <CommandItem
                          key={option.address}
                          value={option.name}
                          onSelect={() => {
                            setSelectedOptionIndex(index);
                            setComboboxOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedOptionIndex === index
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          <div className="flex flex-col">
                            <span>{option.name}</span>
                            {option.description && (
                              <span className="text-xs text-muted-foreground">
                                {option.description}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedOption && (
            <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
              <p className="text-sm">
                <span className="text-muted-foreground">Selected: </span>
                <span className="font-medium">{selectedOption.name}</span>
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={selectedOptionIndex === null || isPending}
              onClick={handleConfirm}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Closing...
                </>
              ) : (
                "Close Market"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
