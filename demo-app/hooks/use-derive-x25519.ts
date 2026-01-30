"use client";

import { useX25519Context } from "@/components/x25519-provider";

/**
 * Hook to access the X25519 keypair from context
 *
 * The keypair is derived from the user's wallet signature and managed
 * by the X25519Provider. This hook provides access to the shared keypair state.
 */
export function useDeriveX25519() {
  return useX25519Context();
}
