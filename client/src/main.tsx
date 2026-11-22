import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { App } from "./App";
import { ModeProvider } from "@/components/mode-provider";
import { GameSocketProvider } from "@/components/game-socket-provider";
import { ComplianceProvider } from "@/components/compliance-provider";
import { RPC_ENDPOINT } from "@/lib/config";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ConnectionProvider endpoint={RPC_ENDPOINT} config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <ModeProvider>
              <GameSocketProvider>
                <ComplianceProvider>
                  <App />
                </ComplianceProvider>
              </GameSocketProvider>
            </ModeProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
