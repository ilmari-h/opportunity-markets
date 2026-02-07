export async function sleepUntilOnChainTimestamp(targetTimestamp: number) {
    const currentTimestampSeconds = Math.floor(Date.now() / 1000);

    if (currentTimestampSeconds < targetTimestamp) {
      const sleepMs = Number(targetTimestamp - currentTimestampSeconds) * 1000;
      console.log(`   Sleeping ${sleepMs}ms to sync with onchain state...`);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
}