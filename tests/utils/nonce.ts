import BN from "bn.js";

export function nonceToBytes(nonce: bigint): Uint8Array {
  return Uint8Array.from(new BN(nonce.toString()).toArray("le", 16));
}
