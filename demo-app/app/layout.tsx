import React from "react"
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono"
});

export const metadata: Metadata = {
  title: "Conviction Markets",
  description:
    "Privacy-focused prediction markets on Solana. Stake capital on your convictions.",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-32x32.png",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <QueryProvider>
          <SolanaWalletProvider>
            {children}
            <Toaster />
          </SolanaWalletProvider>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
