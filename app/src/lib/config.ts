export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

export const SERVER_URL = (
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787"
).replace(/\/$/, "");

export const WS_URL = (() => {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  const http = SERVER_URL.replace(/^http/, "ws");
  return `${http}/ws`;
})();

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");

export const PROGRAM_ID =
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt";

export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ??
  (CLUSTER === "mainnet-beta"
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export function explorerTxUrl(signature: string): string {
  const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(address: string): string {
  const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export function shortKey(value: string | null | undefined, length = 4): string {
  if (!value) return "—";
  return `${value.slice(0, length)}…${value.slice(-length)}`;
}
