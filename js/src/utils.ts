import { randomBytes } from "crypto";

/**
 * Generates a random computation offset for Arcium computations.
 * Returns a BigInt from 8 random bytes.
 */
export function randomComputationOffset(): bigint {
  return BigInt("0x" + randomBytes(8).toString("hex"));
}

/**
 * Type that accepts either a number[] or Uint8Array for byte array parameters.
 * Use with toNumberArray() to convert before passing to generated instructions.
 */
export type ByteArray = number[] | Uint8Array<ArrayBufferLike>;

/**
 * Converts a ByteArray (number[] or Uint8Array) to number[].
 * Generated Codama instructions expect number[], but Uint8Array is often more convenient.
 */
export function toNumberArray(bytes: ByteArray): number[] {
  if (Array.isArray(bytes)) {
    return bytes;
  }
  return Array.from(bytes);
}
