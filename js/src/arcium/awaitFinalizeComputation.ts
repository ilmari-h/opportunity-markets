// Adapted from:
// https://github.com/quiknode-labs/arcium-election/blob/main/tests/arcium-solana-kit/helpers.ts

import { type Address, getAddressEncoder, type Rpc, type SolanaRpcApi} from "@solana/kit";
import { ARCIUM_PROGRAM_ID } from "./constants";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";


/**
 * Event discriminator for FinalizeComputationEvent from Arcium IDL.
 * Computed as first 8 bytes of SHA256("event:FinalizeComputationEvent")
 */
const FINALIZE_COMPUTATION_EVENT_DISCRIMINATOR = new Uint8Array([27, 75, 117, 221, 191, 213, 253, 249]);

/**
 * Serializes a bigint to a little-endian byte array of specified length.
 */
function serializeLE(val: bigint, lengthInBytes: number): Uint8Array {
  const result = new Uint8Array(lengthInBytes);
  let tempVal = val;
  for (let i = 0; i < lengthInBytes; i++) {
    result[i] = Number(tempVal & BigInt(255));
    tempVal >>= BigInt(8);
  }
  return result;
}

function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}


/**
 * Waits for a computation to be finalized on the Arcium network.
 *
 */
export const awaitComputationFinalization = async (
  rpc: Rpc<SolanaRpcApi>,
  computationOffset: bigint,
  options?: {
    commitment?: "processed" | "confirmed" | "finalized"
    mxeProgramId?: Address,
    signaturesToCheck?: number,
    pollInterval: number,
    maxAttempts: number
  }
): Promise<string> => {
  const mxeProgramId = options?.mxeProgramId ?? OPPORTUNITY_MARKET_PROGRAM_ADDRESS;
  const commitment = options?.commitment ?? "confirmed";
  const offsetBytes = serializeLE(computationOffset, 8);
  const mxeProgramIdBytes = getAddressEncoder().encode(mxeProgramId);

  const signaturesToCheck = options?.signaturesToCheck ?? 50;
  const pollInterval = options?.pollInterval ?? 1000;
  const maxAttempts = options?.maxAttempts ?? 120;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const signatures = await rpc.getSignaturesForAddress(
        ARCIUM_PROGRAM_ID,
        { limit: signaturesToCheck }
      ).send();

      for (const sigInfo of signatures) {
        const tx = await rpc.getTransaction(sigInfo.signature, {
          commitment,
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        }).send();

        if (!tx) {
          continue;
        };

        const logs = tx.meta?.logMessages || [];

        for (const log of logs) {
          if (log.includes('Program data:')) {
            const base64Data = log.split('Program data: ')[1];
            if (!base64Data) continue;

            try {
              const eventData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

              // Check minimum length: discriminator (8) + offset (8) + pubkey (32) = 48 bytes
              if (eventData.length >= 48 &&
                  bytesEqual(eventData.subarray(0, 8), FINALIZE_COMPUTATION_EVENT_DISCRIMINATOR)) {

                const eventOffsetBytes = eventData.subarray(8, 16);
                const eventMxeProgramId = eventData.subarray(16, 48);

                if (bytesEqual(eventOffsetBytes, offsetBytes) &&
                    bytesEqual(eventMxeProgramId, mxeProgramIdBytes)) {
                  return sigInfo.signature;
                }
              }
            } catch {
              continue;
            }
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error(
    `Computation finalization timed out after ${maxAttempts} attempts for offset ${computationOffset}`
  );
};
