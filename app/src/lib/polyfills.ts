import { Buffer } from "buffer";

// @solana/web3.js and the wallet adapters expect a Node-style Buffer in the
// browser. Next.js does not polyfill it, so install it once before any of the
// wallet code runs.
if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export {};
