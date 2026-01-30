import { WalletGuard } from "@/components/wallet-guard";
import { X25519Provider } from "@/components/x25519-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletGuard>
      <X25519Provider>{children}</X25519Provider>
    </WalletGuard>
  );
}
