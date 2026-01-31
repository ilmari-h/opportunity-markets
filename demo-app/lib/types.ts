export type MarketStatus = "not_funded" | "open" | "revealing" | "resolved";

export interface MarketOption {
  address: string;
  name: string;
  description: string;
}

export interface MergedMarket {
  address: string;
  name: string;
  description: string;
  creatorPubkey: string;
  rewardSol: number;
  marketIndex: string;
  totalOptions: number;
  maxOptions: number;
  maxShares: string;
  openTimestamp: number | null;
  timeToStake: number;
  timeToReveal: number;
  selectedOption: number | null;
  status: MarketStatus;
  createdAt: Date;
  options: MarketOption[];
}

export interface UserShare {
  optionAddress: string;
  amount: string;
  revealedInTime: boolean | null;
  claimedYield: boolean | null;
}
