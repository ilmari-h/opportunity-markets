"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { deriveX25519KeypairFromSignature } from "@bench.games/conviction-markets";
import type { X25519Keypair } from "@bench.games/conviction-markets";

const STORAGE_KEY_PREFIX = "x25519_keypair_";
const SIGN_MESSAGE =
  "Sign this message to generate an encryption keypair for secure voting";

interface X25519ContextValue {
  keypair: X25519Keypair | null;
  loading: boolean;
  error: string | null;
  isReady: boolean;
}

const X25519Context = createContext<X25519ContextValue | null>(null);

export function X25519Provider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage } = useWallet();
  const [keypair, setKeypair] = useState<X25519Keypair | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDerivingRef = useRef(false);

  useEffect(() => {
    if (!publicKey) {
      setKeypair(null);
      setError(null);
      isDerivingRef.current = false;
      return;
    }

    if (isDerivingRef.current) return;

    const storageKey = `${STORAGE_KEY_PREFIX}${publicKey.toBase58()}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setKeypair({
          publicKey: new Uint8Array(parsed.publicKey),
          secretKey: new Uint8Array(parsed.secretKey),
        });
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    const deriveKeypair = async () => {
      if (!signMessage) {
        setError("Wallet does not support message signing");
        return;
      }

      isDerivingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const message = new TextEncoder().encode(SIGN_MESSAGE);
        const signature = await signMessage(message);
        const derivedKeypair = deriveX25519KeypairFromSignature(signature);

        localStorage.setItem(
          storageKey,
          JSON.stringify({
            publicKey: Array.from(derivedKeypair.publicKey),
            secretKey: Array.from(derivedKeypair.secretKey),
          })
        );

        setKeypair(derivedKeypair);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign message");
      } finally {
        setLoading(false);
        isDerivingRef.current = false;
      }
    };

    deriveKeypair();
  }, [publicKey, signMessage]);

  return (
    <X25519Context.Provider
      value={{ keypair, loading, error, isReady: !loading && !!keypair }}
    >
      {children}
    </X25519Context.Provider>
  );
}

export function useX25519Context() {
  const context = useContext(X25519Context);
  if (!context) {
    throw new Error("useX25519Context must be used within X25519Provider");
  }
  return context;
}
