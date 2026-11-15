import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { SERVER_URL } from "./config";
import type { TxResponse } from "@wagerwake/shared/protocol";

export type WagerTxKind = "join" | "ante" | "leave";

export interface WagerTxInput {
  kind: WagerTxKind;
  tablePda: string;
  player: string;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
}

export interface WagerTxResult {
  signature: string;
  message?: string;
}

/**
 * Build the instruction on the server (which owns the program config), sign it
 * with the player's wallet, then let the server submit and confirm it. The
 * browser never sees the oracle key or builds program accounts by hand.
 */
export async function submitWagerTransaction(input: WagerTxInput): Promise<WagerTxResult> {
  const built = await fetch(`${SERVER_URL}/api/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: input.kind,
      tablePda: input.tablePda,
      player: input.player,
    }),
  });
  const payload = (await built.json()) as TxResponse & { error?: string };
  if (!built.ok || !payload.transaction) {
    throw new Error(payload.error ?? "Could not build the transaction");
  }

  const transaction = Transaction.from(Buffer.from(payload.transaction, "base64"));
  const signed = await input.signTransaction(transaction);
  const encoded = Buffer.from(signed.serialize()).toString("base64");

  const submitted = await fetch(`${SERVER_URL}/api/tx/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transaction: encoded,
      tablePda: input.tablePda,
      player: input.player,
    }),
  });
  const result = (await submitted.json()) as { signature?: string; error?: string };
  if (!submitted.ok || !result.signature) {
    throw new Error(result.error ?? "The transaction was rejected");
  }
  return { signature: result.signature, message: payload.message };
}
