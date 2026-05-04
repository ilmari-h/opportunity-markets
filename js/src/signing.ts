import {
  type Address,
  type MessagePartialSigner,
  createSignableMessage,
  getAddressEncoder,
} from "@solana/kit";

import { type ByteArray, toNumberArray } from "./utils";

/**
 * Inputs the user must commit to off-chain to authorize a delegated `stake()` call.
 *
 * The on-chain canonical message is the byte concatenation:
 * `stake_account || net_amount || state_nonce || input_nonce || authorized_reader_nonce ||
 *  selected_option_ciphertext || signature_expiry_timestamp || user_pubkey`
 *
 * Total: 32 + 8 + 16 + 16 + 16 + 32 + 8 + 32 = 160 bytes. All multi-byte numeric fields are
 * encoded little-endian.
 */
export interface StakeSignaturePayload {
  /** PDA of the stake_account this signature authorizes. */
  stakeAccount: Address;
  /** Net staked amount (after protocol fee) in token base units. */
  netAmount: bigint;
  /** u128 nonce committed to encrypted-state derivation. */
  stateNonce: bigint;
  /** u128 nonce for the encrypted option input. */
  inputNonce: bigint;
  /** u128 nonce for the authorized-reader disclosure context. */
  authorizedReaderNonce: bigint;
  /** 32-byte encrypted option ciphertext. */
  selectedOptionCiphertext: ByteArray;
  /** Unix timestamp (seconds) after which the on-chain verifier rejects this signature. */
  signatureExpiryTimestamp: bigint;
  /** User's x25519 public key */
  userPubkey: ByteArray;
}

const stakeSignatureBrand: unique symbol = Symbol("stakeSignature");

/**
 * A fully-formed authorization for a delegated `stake()` call. Carries the 64-byte ed25519
 * signature alongside the exact payload it commits to.
 *
 * Construct via {@link signStakeMessage}.
 */
export type StakeSignature = {
  readonly [stakeSignatureBrand]: true;
  /** The 64-byte ed25519 signature, fixed length. */
  readonly signature: Uint8Array;
  /** Solana pubkey of the stake_account.owner whose private key signed the message. */
  readonly signer: Address;
  /** The exact payload that was signed — stake() will rebuild from these inputs and verify. */
  readonly payload: StakeSignaturePayload;
};

const SIGNATURE_LENGTH = 64;
const PUBKEY_LENGTH = 32;
const CIPHERTEXT_LENGTH = 32;
const X25519_PUBKEY_LENGTH = 32;
const MESSAGE_LENGTH =
  PUBKEY_LENGTH + 8 + 16 + 16 + 16 + CIPHERTEXT_LENGTH + 8 + X25519_PUBKEY_LENGTH;

function writeU64LE(view: DataView, offset: number, value: bigint): void {
  view.setBigUint64(offset, value, true);
}

function writeU128LE(buf: Uint8Array, offset: number, value: bigint): void {
  const lo = value & 0xffffffffffffffffn;
  const hi = (value >> 64n) & 0xffffffffffffffffn;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(offset, lo, true);
  view.setBigUint64(offset + 8, hi, true);
}

function copyFixed(
  dst: Uint8Array,
  offset: number,
  src: ByteArray,
  expectedLen: number,
  fieldName: string,
): void {
  const arr = toNumberArray(src);
  if (arr.length !== expectedLen) {
    throw new Error(`${fieldName} must be ${expectedLen} bytes, got ${arr.length}`);
  }
  dst.set(arr, offset);
}

/**
 * Build the canonical 160-byte message for stake() authorization
 */
export function buildStakeMessage(payload: StakeSignaturePayload): Uint8Array {
  const buf = new Uint8Array(MESSAGE_LENGTH);
  const view = new DataView(buf.buffer);
  let offset = 0;

  buf.set(getAddressEncoder().encode(payload.stakeAccount), offset);
  offset += PUBKEY_LENGTH;

  writeU64LE(view, offset, payload.netAmount);
  offset += 8;

  writeU128LE(buf, offset, payload.stateNonce);
  offset += 16;

  writeU128LE(buf, offset, payload.inputNonce);
  offset += 16;

  writeU128LE(buf, offset, payload.authorizedReaderNonce);
  offset += 16;

  copyFixed(buf, offset, payload.selectedOptionCiphertext, CIPHERTEXT_LENGTH, "selectedOptionCiphertext");
  offset += CIPHERTEXT_LENGTH;

  writeU64LE(view, offset, payload.signatureExpiryTimestamp);
  offset += 8;

  copyFixed(buf, offset, payload.userPubkey, X25519_PUBKEY_LENGTH, "userPubkey");
  offset += X25519_PUBKEY_LENGTH;

  return buf;
}

/**
 * Sign the canonical stake-authorization message.
 *
 * Accepts any Kit-compatible {@link MessagePartialSigner} — typically a
 * `KeyPairSigner` (server-side or script use) or a wallet-adapter signer
 * (browser). The signer's `address` is used as the signer pubkey on the
 * returned {@link StakeSignature} and must equal the on-chain
 * `stake_account.owner` for the verifier to accept it.
 */
export async function signStakeMessage(
  payload: StakeSignaturePayload,
  signer: MessagePartialSigner,
): Promise<StakeSignature> {
  const message = createSignableMessage(buildStakeMessage(payload));
  const [signatureDictionary] = await signer.signMessages([message]);
  const sigBytes = signatureDictionary[signer.address];
  if (!sigBytes) {
    throw new Error(`Signer ${signer.address} did not return a signature for the stake message`);
  }
  if (sigBytes.length !== SIGNATURE_LENGTH) {
    throw new Error(`Stake signature must be ${SIGNATURE_LENGTH} bytes, got ${sigBytes.length}`);
  }
  return {
    [stakeSignatureBrand]: true,
    signature: new Uint8Array(sigBytes),
    signer: signer.address,
    payload,
  } as StakeSignature;
}
