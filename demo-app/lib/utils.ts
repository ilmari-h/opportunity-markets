import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MarketStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function computeMarketStatus(market: {
  openTimestamp: number | null;
  timeToStake: number;
  timeToReveal: number;
  selectedOption: number | null;
}): MarketStatus {
  const now = Math.floor(Date.now() / 1000);

  if (!market.openTimestamp) return "not_funded";

  const openTs = market.openTimestamp;
  const stakeEndTs = openTs + market.timeToStake;
  const revealEndTs = stakeEndTs + market.timeToReveal;

  // If selected option exists, it's resolved
  if (market.selectedOption !== null) return "resolved";

  // If reveal period ended but waiting on market creator to select, keep as revealing
  if ( now >= revealEndTs && market.selectedOption === null) return "revealing"

  // If stake period is over but reveal period is still active
  if (now >= stakeEndTs && now < revealEndTs) return "revealing";

  // If market is open and stake period is active
  if (now >= openTs && now < stakeEndTs) return "open";

  // openTimestamp is in the future or some edge case
  return "not_funded";
}
