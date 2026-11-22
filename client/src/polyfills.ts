import { Buffer } from "buffer";

// @solana/web3.js expects a global Buffer when the transaction is rebuilt in
// the browser. Import this module before any wallet or web3 imports.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
