"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TokenSwap } from "@/components/token-swap";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Coins,
  ExternalLink,
  Info,
  User,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Loader2,
  Clock,
  Trophy,
} from "lucide-react";
import type { MergedMarket, MarketStatus } from "@/lib/types";
import { useSolBalance } from "@/hooks/use-sol-balance";
import { useOpenMarket } from "@/hooks/use-open-market";
import { useToast } from "@/hooks/use-toast";
import { useUserShare } from "@/hooks/use-user-share";
import { useVoteTokensBalance } from "@/hooks/use-vote-tokens-balance";
import { AddOptionDialog } from "@/components/add-option-dialog";
import { VoteDialog } from "@/components/vote-dialog";
import { CloseMarketDialog } from "@/components/close-market-dialog";
import { useRevealShares } from "@/hooks/use-reveal-shares";
import { PublicKey } from "@solana/web3.js";

interface MarketDetailProps {
  market: MergedMarket;
}

const STATUS_CONFIG: Record<
  MarketStatus,
  { label: string; className: string }
> = {
  not_funded: {
    label: "Not Funded",
    className: "border-muted-foreground/50 text-muted-foreground bg-muted/30",
  },
  open: {
    label: "Open for Voting",
    className: "border-accent/50 text-accent bg-accent/10",
  },
  revealing: {
    label: "Revealing",
    className: "border-amber-500/50 text-amber-500 bg-amber-500/10",
  },
  resolved: {
    label: "Resolved",
    className: "border-blue-500/50 text-blue-500 bg-blue-500/10",
  },
};

const OPTIONS_PER_PAGE = 5;

export function MarketDetail({ market }: MarketDetailProps) {
  const { publicKey } = useWallet();
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(0);

  // Check market account balance (excluding rent)
  const { balanceInSol: marketBalanceInSol, loading: marketBalanceLoading } =
    useSolBalance(market.address, { excludeRent: true });

  const { openMarket, isPending: isOpeningMarket } = useOpenMarket();
  const { toast } = useToast();

  // Fetch user's existing share for this market
  const { share: userShare, refetch: refetchUserShare } = useUserShare(market.address);

  // Fetch user's vote token balance
  const { balance: voteTokenBalance } = useVoteTokensBalance();

  // Reveal shares hook
  const { revealShares, isPending: isRevealing } = useRevealShares();

  // Countdown timer for reveal period
  const [countdown, setCountdown] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (market.status !== "revealing" || !market.openTimestamp) return;

    const revealEndTs =
      parseInt(market.openTimestamp) +
      parseInt(market.timeToStake) +
      parseInt(market.timeToReveal);

    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, revealEndTs - now);

      setCountdown({
        hours: Math.floor(remaining / 3600),
        minutes: Math.floor((remaining % 3600) / 60),
        seconds: remaining % 60,
      });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [market.status, market.openTimestamp, market.timeToStake, market.timeToReveal]);

  const handleRevealVote = () => {
    revealShares(
      { market: new PublicKey(market.address) },
      {
        onSuccess: () => {
          toast({
            title: "Vote revealed!",
            description: "Your stake has been returned to your vote token balance.",
          });
          router.refresh();
          refetchUserShare();
        },
        onError: (error) => {
          toast({
            title: "Failed to reveal vote",
            description: error instanceof Error ? error.message : "Unknown error occurred",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleOpenMarket = () => {
    openMarket(
      { market: new PublicKey(market.address) },
      {
        onSuccess: () => {
          toast({
            title: "Market opened!",
            description: "The market is now open for staking",
          });
          router.refresh();
        },
        onError: (error) => {
          toast({
            title: "Failed to open market",
            description: error instanceof Error ? error.message : "Unknown error occurred",
            variant: "destructive",
          });
        },
      }
    );
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const statusConfig = STATUS_CONFIG[market.status];
  const totalPages = Math.ceil(market.options.length / OPTIONS_PER_PAGE);
  const paginatedOptions = market.options.slice(
    currentPage * OPTIONS_PER_PAGE,
    (currentPage + 1) * OPTIONS_PER_PAGE
  );

  const hasVoted = !!userShare;

  // Check if user is the creator
  const isCreator = publicKey?.toBase58() === market.creatorPubkey;

  // Check if market is funded (has enough SOL)
  const isFunded = marketBalanceInSol >= market.rewardSol;

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
              <span className="text-xs bg-secondary px-2 py-1 rounded">
                {truncateAddress(publicKey.toBase58())}
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content - Market Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Back button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/app")}
              className="text-muted-foreground hover:text-foreground -ml-2"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Markets
            </Button>

            {/* Market header */}
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold text-foreground">
                    {market.name}
                  </h1>
                  {market.description && (
                    <p className="text-muted-foreground">{market.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusConfig.className}>
                    {statusConfig.label}
                  </Badge>
                  {/* Creator can choose option while voting ongoing, closing the market. OR after voting period is over (revealing)*/}
                  {(isCreator &&
                  (market.status === "open" || market.status === "revealing" && market.selectedOption === null ) ) && (
                    <CloseMarketDialog
                      marketAddress={market.address}
                      options={market.options}
                      onSuccess={() => router.refresh()}
                    >
                      {market.status === "open" ?
                      <Button variant={"destructive"} size="sm">
                        Close Market
                      </Button>:
                      <Button variant={"accent"} size="sm">
                        Choose Winning Option
                      </Button>}
                    </CloseMarketDialog>
                  )}
                </div>
              </div>

              {/* Selected/Winning option display */}
              {market.selectedOption !== null && market.options[market.selectedOption - 1] && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-blue-500/50 text-blue-500 bg-blue-500/10 px-3 py-1"
                  >
                    <Trophy className="w-3.5 h-3.5 mr-1.5" />
                    Winner: {market.options[market.selectedOption - 1].name}
                  </Badge>
                </div>
              )}
            </div>

            {/* Market details card */}
            <Card className="p-5 bg-card border-border">
              <h3 className="text-sm font-medium text-foreground mb-4">
                Market Details
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="w-4 h-4" />
                    <span className="text-sm">Creator</span>
                  </div>
                  <a
                    href={`https://solscan.io/account/${market.creatorPubkey}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-foreground hover:text-accent flex items-center gap-1"
                  >
                    {truncateAddress(market.creatorPubkey)}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <ExternalLink className="w-4 h-4" />
                    <span className="text-sm">Market Address</span>
                  </div>
                  <a
                    href={`https://solscan.io/account/${market.address}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-foreground hover:text-accent flex items-center gap-1"
                  >
                    {truncateAddress(market.address)}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Coins className="w-4 h-4" />
                    <span className="text-sm">Reward Pool</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {market.rewardSol.toFixed(2)} SOL
                  </span>
                </div>
              </div>
            </Card>

            {/* Creator action section - only shown if user is creator and market is not funded */}
            {isCreator && market.status === "not_funded" && (
              <Card className="p-5 border-border overflow-hidden">
                {marketBalanceLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Checking market balance...
                    </span>
                  </div>
                ) : !isFunded ? (
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-full bg-amber-500/10 shrink-0">
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="space-y-3 flex-1">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">
                          Market is not funded
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Send{" "}
                          <span className="font-medium text-foreground">
                            {market.rewardSol.toFixed(2)} SOL
                          </span>{" "}
                          to fund the reward pool. Market can be opened after funding.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-border/50">
                        <span className="text-xs text-foreground flex-1 break-all">
                          {market.address}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 h-7 px-2"
                          onClick={() => {
                            navigator.clipboard.writeText(market.address);
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                      {!marketBalanceLoading && (
                        <p className="text-xs text-muted-foreground">
                          Current balance:{" "}
                          <span className="text-foreground">
                            {marketBalanceInSol.toFixed(4)} SOL
                          </span>{" "}
                          / {market.rewardSol.toFixed(2)} SOL required
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-full bg-accent/10 shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-accent" />
                    </div>
                    <div className="space-y-4 flex-1">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">
                          Market has been funded
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          The reward pool has{" "}
                          <span className="font-medium text-foreground">
                            {marketBalanceInSol.toFixed(4)} SOL
                          </span>
                          . You can now open the market for staking.
                        </p>
                      </div>
                      <Button
                        variant="accent"
                        onClick={handleOpenMarket}
                        disabled={isOpeningMarket}
                      >
                        {isOpeningMarket ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Opening...
                          </>
                        ) : (
                          <>
                            <Rocket className="w-4 h-4 mr-2" />
                            Open Market for Staking
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Reveal vote section - shown when market is in revealing phase and user has stake */}
            {market.status === "revealing" && userShare && (
              <Card className="p-5 border-amber-500/50 bg-amber-500/5">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-full bg-amber-500/10 shrink-0">
                    <Clock className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="space-y-3 flex-1">
                    <div>
                      <h3 className="text-sm font-medium text-foreground">
                        Reveal your vote
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        You have{" "}
                        <span className="font-medium text-foreground">
                          {countdown.hours}h {countdown.minutes}m {countdown.seconds}s
                        </span>{" "}
                        to reveal your vote and claim back your stake.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 italic">
                        NOTE: This process is permissionless and will be automated in future iterations of the app.<br/>
                        Users won't have to come to the site to do this manually.<br/>
                        Revealing late dequalifies a user from earning yield, but will still always get their stake back.
                      </p>
                    </div>
                    <Button
                      onClick={handleRevealVote}
                      disabled={isRevealing}
                      className="bg-amber-500 text-white hover:bg-amber-600"
                    >
                      {isRevealing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Revealing...
                        </>
                      ) : (
                        "Reveal your vote"
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Voting options */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-foreground">
                  Voting Options
                </h2>
                <div className="flex items-center gap-3">
                  {totalPages > 1 && (
                    <span className="text-sm text-muted-foreground">
                      Page {currentPage + 1} of {totalPages}
                    </span>
                  )}
                  {(market.status === "not_funded" || market.status === "open") && (
                    <AddOptionDialog marketAddress={market.address} totalOptions={market.totalOptions} onSubmit={router.refresh} />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {paginatedOptions.map((option, index) => {
                  const optionIndex = currentPage * OPTIONS_PER_PAGE + index + 1;
                  const isVotedOption = userShare?.optionAddress === option.address;

                  return (
                    <div
                      key={option.address}
                      className={`p-4 rounded-lg border transition-colors ${
                        isVotedOption
                          ? "bg-accent/10 border-accent/50"
                          : "bg-secondary/20 border-border/50 hover:border-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <h4 className="font-medium text-foreground">
                            {option.name}
                          </h4>
                          {option.description && (
                            <p className="text-sm text-muted-foreground">
                              {option.description}
                            </p>
                          )}
                        </div>
                        {isVotedOption ? (
                          <Badge className="bg-accent/20 text-accent border-accent/30">
                            Staked with {userShare.amount} VOTE
                          </Badge>
                        ) : hasVoted ? (
                          null
                        ) : market.status === "open" ? (
                          <VoteDialog
                            optionAddress={option.address}
                            optionName={option.name}
                            optionIndex={optionIndex}
                            marketAddress={market.address}
                            maxBalance={voteTokenBalance ?? BigInt(0)}
                            onSuccess={() => refetchUserShare()}
                          >
                            <Button
                              variant="accent"
                              size="sm"
                              disabled={!voteTokenBalance || voteTokenBalance <= BigInt(0)}
                            >
                              Vote
                            </Button>
                          </VoteDialog>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div>
                                  <Button
                                    variant="accent"
                                    size="sm"
                                    disabled
                                  >
                                    Vote
                                  </Button>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Voting is only available when the market is open</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>
                  );
                })}

                {market.options.length === 0 && (
                  <Card className="p-6 bg-secondary/10 border-border text-center">
                    <p className="text-muted-foreground">
                      No voting options available yet.
                    </p>
                  </Card>
                )}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                    disabled={currentPage === totalPages - 1}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
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
