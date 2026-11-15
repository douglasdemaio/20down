import { afterEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WebSocket } from "ws";
import {
  ANTE_TIMEOUT_MS,
  PLATFORM_TREASURY,
  TURN_TIMEOUT_MS,
} from "@wagerwake/shared";
import { usdcMintForCluster } from "@wagerwake/shared/chain";
import type { ServerConfig } from "../src/config.js";
import { createHubServer, type RunningServer } from "../src/index.js";
import type { ServerMessage } from "@wagerwake/shared/protocol";

function testConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    rpcUrl: "http://127.0.0.1:8899",
    cluster: "devnet",
    programId: PublicKey.default,
    usdcMint: usdcMintForCluster("devnet"),
    treasury: new PublicKey(PLATFORM_TREASURY),
    oracle: Keypair.generate(),
    chainEnabled: false,
    allowConfigInit: false,
    feePerPlayer: 20_000n,
    turnTimeoutMs: TURN_TIMEOUT_MS,
    anteTimeoutMs: ANTE_TIMEOUT_MS,
    corsOrigin: "*",
  };
}

let running: RunningServer | null = null;

afterEach(async () => {
  if (running) await running.close();
  running = null;
});

function listen(server: RunningServer): Promise<number> {
  return new Promise((resolve) => {
    server.http.listen(0, "127.0.0.1", () => {
      const address = server.http.address();
      if (typeof address === "object" && address) resolve(address.port);
      else resolve(0);
    });
  });
}

interface TestSocket {
  socket: WebSocket;
  messages: ServerMessage[];
  waitFor: (predicate: (m: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
  ready: Promise<void>;
}

function connect(port: number): TestSocket {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  const listeners: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    messages.push(message);
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      const listener = listeners[index]!;
      if (listener.predicate(message)) {
        listeners.splice(index, 1);
        listener.resolve(message);
      }
    }
  });
  const waitFor = (predicate: (m: ServerMessage) => boolean, timeoutMs = 8000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), timeoutMs);
      listeners.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, messages, waitFor, ready };
}

describe("Hub HTTP + WebSocket", () => {
  it("serves health and config", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    expect(health.ok).toBe(true);
    expect(health.chainEnabled).toBe(false);
    const config = await fetch(`http://127.0.0.1:${port}/api/config`).then((r) => r.json());
    expect(config.minStake).toBe("10000");
    expect(config.maxStake).toBe("1000000");
    expect(config.feePerPlayer).toBe("20000");
    expect(config.wsPath).toBe("/ws");
    const lobby = await fetch(`http://127.0.0.1:${port}/api/lobby`).then((r) => r.json());
    expect(lobby.tables).toEqual([]);
  });

  it("creates a free table with bots over the websocket", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const { socket, waitFor, ready } = connect(port);
    await ready;
    const welcome = await waitFor((m) => m.type === "welcome");
    expect(welcome.type).toBe("welcome");
    const playerId = welcome.type === "welcome" ? welcome.playerId : "";

    socket.send(JSON.stringify({ type: "hello", name: "Ada", playerId }));
    socket.send(
      JSON.stringify({
        type: "create",
        game: "ship-captain-crew",
        mode: "free",
        name: "Ada",
        vsBots: true,
      }),
    );
    const room = await waitFor((m) => m.type === "room");
    expect(room.type).toBe("room");
    if (room.type !== "room") throw new Error("unreachable");
    expect(room.room.mode).toBe("free");
    expect(room.room.seats.length).toBe(3);
    expect(room.room.seats.some((seat) => seat.isBot)).toBe(true);
    expect(room.room.yourSeat).toBe(0);

    const lobby = await fetch(`http://127.0.0.1:${port}/api/lobby`).then((r) => r.json());
    expect(lobby.tables).toHaveLength(1);
    expect(lobby.tables[0].game).toBe("ship-captain-crew");

    // Ready up; the bots are already ready, so the room auto-starts.
    socket.send(JSON.stringify({ type: "ready", ready: true }));
    const started = await waitFor(
      (m) =>
        m.type === "room" &&
        (m.room.state === "in-progress" || m.room.state === "resolved"),
      10_000,
    );
    if (started.type !== "room") throw new Error("unreachable");
    expect(["in-progress", "resolved"]).toContain(started.room.state);
    socket.close();
  }, 20_000);

  it("rejects wager tables while the chain is disabled", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const { socket, waitFor, ready } = connect(port);
    await ready;
    socket.send(
      JSON.stringify({
        type: "create",
        game: "horses",
        mode: "wager",
        stakeBaseUnits: "10000",
        wallet: "5vWdYSmcNJnoj2PM8LfLRvnviujnQCT1Eu8Csw6Jzfhs",
      }),
    );
    const error = await waitFor((m) => m.type === "error");
    expect(error.type).toBe("error");
    if (error.type === "error") expect(error.message).toMatch(/not enabled/i);
    socket.close();
  }, 20_000);

  it("returns 404 for unknown routes", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const response = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(response.status).toBe(404);
  });
});
