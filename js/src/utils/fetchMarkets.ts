import { type PublicKey } from "@solana/web3.js";
import { Program, type AnchorProvider } from "@coral-xyz/anchor";
import type { ConvictionMarket } from "../idl/conviction_market";
import IDL from "../idl/conviction_market.json";

/**
 * Fetches all conviction markets created by a specific user
 *
 * Uses memcmp filter to efficiently query only markets created by the given creator.
 *
 * @param provider - Anchor provider for connection
 * @param creator - Public key of the market creator
 * @returns Array of market accounts with their public keys
 */
export async function fetchUserMarkets(
  provider: AnchorProvider,
  creator: PublicKey
) {
  const program = new Program(
    IDL as ConvictionMarket,
    provider
  ) as Program<ConvictionMarket>;

  // Fetch all ConvictionMarket accounts for this creator using memcmp filter
  // Account structure (after discriminator):
  // - 8 bytes: discriminator
  // - 32 bytes: encrypted_available_shares
  // - 1 byte: bump
  // - 32 bytes: creator (offset 41)
  const accounts = await program.account.convictionMarket.all([
    {
      memcmp: {
        offset: 8 + 32 + 1, // Skip discriminator + encrypted_available_shares + bump
        bytes: creator.toBase58(),
      },
    },
  ]);

  return accounts;
}

/**
 * Fetches all conviction markets from the program
 *
 * @param provider - Anchor provider for connection
 * @returns Array of all market accounts with their public keys
 */
export async function fetchAllMarkets(provider: AnchorProvider) {
  const program = new Program(
    IDL as ConvictionMarket,
    provider
  ) as Program<ConvictionMarket>;

  const accounts = await program.account.convictionMarket.all();
  return accounts;
}
