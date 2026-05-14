import { type Rpc, type SolanaRpcApi } from "@solana/kit";

// TODO: remove buffer now with better algo??
// also reduce sleep times if more accurate now
export async function sleepUntilOnChainTimestamp(
  targetTimestamp: number,
  rpc?: Rpc<SolanaRpcApi>,
) {
    const currentTimestampSeconds = Math.floor(Date.now() / 1000);

    if (currentTimestampSeconds < targetTimestamp) {
      const sleepMs = (targetTimestamp - currentTimestampSeconds) * 1000;
      console.log(`   Sleeping ${sleepMs}ms to sync with onchain state...`);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    if (!rpc) return;

    const pollIntervalMs = 500;
    const maxWaitMs = 30_000;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
      const blockTime = await rpc.getBlockTime(slot).send();
      if (blockTime !== null && Number(blockTime) >= targetTimestamp) return;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `Timed out after ${maxWaitMs}ms waiting for on-chain block time to reach ${targetTimestamp}`,
    );
}
