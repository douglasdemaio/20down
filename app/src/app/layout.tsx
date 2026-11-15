import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ModeProvider } from "@/components/mode-provider";
import { ComplianceProvider } from "@/components/compliance-provider";
import { WalletProviders } from "@/components/wallet-providers";
import { GameSocketProvider } from "@/components/game-socket-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SocketNotice } from "@/components/socket-notice";

export const metadata: Metadata = {
  title: {
    default: "Dice & Cards — Free & USDC dice and card games",
    template: "%s · Dice & Cards",
  },
  description:
    "Play Ship, Captain & Crew, Horses and Zwanzig ab with friends for free, or open a USDC wager table on Solana with on-chain escrow and verifiable dice.",
  applicationName: "Dice & Cards",
  openGraph: {
    title: "Dice & Cards",
    description:
      "Free multiplayer dice and card games with optional USDC wager tables on Solana.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <ModeProvider>
          <ComplianceProvider>
            <WalletProviders>
              <GameSocketProvider>
                <div className="flex min-h-screen flex-col">
                  <SiteHeader />
                  <main className="flex-1">{children}</main>
                  <SiteFooter />
                </div>
                <SocketNotice />
              </GameSocketProvider>
            </WalletProviders>
          </ComplianceProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
