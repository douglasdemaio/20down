export interface RuntimeConfig {
  apiBaseUrl: string;
  wsUrl: string;
  mock: boolean;
  cluster: string;
  rpcUrl: string;
  programId: string;
  usdcMint: string;
  wageringEnabled: boolean;
  explorerClusterSuffix: string;
}

declare global {
  interface Window {
    __20DOWN_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const defaults: RuntimeConfig = {
  apiBaseUrl: "http://localhost:8787",
  wsUrl: "",
  mock: true,
  cluster: "mainnet-beta",
  rpcUrl: "https://api.mainnet-beta.solana.com",
  programId: "",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  wageringEnabled: false,
  explorerClusterSuffix: "",
};

const runtime = typeof window === "undefined" ? {} : (window.__20DOWN_CONFIG__ ?? {});

export const config: RuntimeConfig = {
  ...defaults,
  ...runtime,
  apiBaseUrl: (runtime.apiBaseUrl ?? defaults.apiBaseUrl).replace(/\/$/, ""),
};

export const API_BASE_URL = config.apiBaseUrl;

export const WS_URL = (() => {
  if (config.wsUrl) return config.wsUrl;
  const base = config.apiBaseUrl.replace(/^http/, "ws");
  return `${base}/ws`;
})();

export const RPC_ENDPOINT = config.rpcUrl || defaults.rpcUrl;

export function explorerTxUrl(signature: string): string {
  const suffix = config.explorerClusterSuffix;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(address: string): string {
  const suffix = config.explorerClusterSuffix;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
