/**
 * Runtime configuration for the static client.
 *
 * This file ships with the site so the same build can be promoted from staging
 * to production without a rebuild. Edit it in the deployed artifact (or have
 * the deploy step generate it) when the Cloudflare Worker is ready.
 */
window.__20DOWN_CONFIG__ = {
  // Base URL of the Worker. Set to "" to use same-origin API routes.
  apiBaseUrl: "https://20down-backend.douglasdemaio.workers.dev",
  // Explicit WebSocket URL. Leave empty to derive it from apiBaseUrl.
  wsUrl: "",
  // Local, in-browser simulation of the Worker. Flip to false once the Worker
  // is deployed and the URLs above point at it.
  mock: false,
  // Solana mainnet is the only wagering cluster in this build.
  cluster: "mainnet-beta",
  rpcUrl: "",
  programId: "",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // Wagering stays disabled until the independent audit and legal sign-off.
  wageringEnabled: false,
  explorerClusterSuffix: "",
};
