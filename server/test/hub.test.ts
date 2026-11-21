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

  it("starts another round in place when a free dice table is resolved", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const { socket, waitFor, ready, messages } = connect(port);
    await ready;
    const welcome = await waitFor((m) => m.type === "welcome");
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
    const created = await waitFor((m) => m.type === "room");
    if (created.type !== "room") throw new Error("unreachable");

    // Put the room into the state a finished round leaves it in, then use the
    // same websocket action the table UI sends.
    const room = running!.hub.rooms.get(created.room.id);
    if (!room) throw new Error("room missing");
    room.state = "resolved";
    room.phase = "resolved";

    socket.send(JSON.stringify({ type: "rematch" }));
    const restarted = await waitFor(
      (m) => m.type === "room" && m.room.state === "in-progress",
      10_000,
    );
    if (restarted.type !== "room") throw new Error("unreachable");
    expect(restarted.room.round).toBe(created.room.round + 1);
    expect(restarted.room.phase).toBe("play");
    expect(messages.some((m) => m.type === "error")).toBe(false);
    socket.close();
  }, 20_000);

  it("switches from a waiting table into a new game and releases the old seat", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const { socket, waitFor, ready, messages } = connect(port);
    await ready;
    const welcome = await waitFor((m) => m.type === "welcome");
    const playerId = welcome.type === "welcome" ? welcome.playerId : "";

    socket.send(JSON.stringify({ type: "hello", name: "Ada", playerId }));
    socket.send(
      JSON.stringify({
        type: "create",
        game: "ship-captain-crew",
        mode: "free",
        name: "Ada",
        vsBots: false,
      }),
    );
    const first = await waitFor((m) => m.type === "room");
    if (first.type !== "room") throw new Error("unreachable");

    socket.send(
      JSON.stringify({
        type: "create",
        game: "horses",
        mode: "free",
        name: "Ada",
        vsBots: true,
      }),
    );
    const second = await waitFor(
      (m) => m.type === "room" && m.room.game === "horses",
      10_000,
    );
    if (second.type !== "room") throw new Error("unreachable");
    expect(second.room.id).not.toBe(first.room.id);
    expect(second.room.yourSeat).not.toBeNull();
    expect(messages.some((m) => m.type === "error")).toBe(false);

    const lobby = await fetch(`http://127.0.0.1:${port}/api/lobby`).then((r) => r.json());
    expect(lobby.tables.map((table: { id: string }) => table.id)).not.toContain(first.room.id);
    socket.close();
  }, 20_000);

  it("joins another waiting table without asking the player to leave first", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);

    const host = connect(port);
    await host.ready;
    const hostWelcome = await host.waitFor((m) => m.type === "welcome");
    const hostId = hostWelcome.type === "welcome" ? hostWelcome.playerId : "";
    host.socket.send(JSON.stringify({ type: "hello", name: "Host", playerId: hostId }));
    host.socket.send(
      JSON.stringify({
        type: "create",
        game: "ship-captain-crew",
        mode: "free",
        name: "Host",
        vsBots: false,
      }),
    );
    const hosted = await host.waitFor((m) => m.type === "room");
    if (hosted.type !== "room") throw new Error("unreachable");

    const guest = connect(port);
    await guest.ready;
    const guestWelcome = await guest.waitFor((m) => m.type === "welcome");
    const guestId = guestWelcome.type === "welcome" ? guestWelcome.playerId : "";
    guest.socket.send(JSON.stringify({ type: "hello", name: "Guest", playerId: guestId }));
    guest.socket.send(
      JSON.stringify({
        type: "create",
        game: "horses",
        mode: "free",
        name: "Guest",
        vsBots: false,
      }),
    );
    const other = await guest.waitFor((m) => m.type === "room");
    if (other.type !== "room") throw new Error("unreachable");

    guest.socket.send(
      JSON.stringify({ type: "join", tableId: hosted.room.id, name: "Guest" }),
    );
    const joined = await guest.waitFor(
      (m) => m.type === "room" && m.room.id === hosted.room.id,
      10_000,
    );
    if (joined.type !== "room") throw new Error("unreachable");
    expect(joined.room.yourSeat).not.toBeNull();
    expect(joined.room.seats).toHaveLength(2);
    expect(guest.messages.some((m) => m.type === "error")).toBe(false);

    const lobby = await fetch(`http://127.0.0.1:${port}/api/lobby`).then((r) => r.json());
    expect(lobby.tables.map((table: { id: string }) => table.id)).not.toContain(other.room.id);

    host.socket.close();
    guest.socket.close();
  }, 20_000);

  it("switches away from an in-progress game and only re-seats on an explicit room hint", async () => {
    running = createHubServer(testConfig(), null);
    const port = await listen(running);
    const first = connect(port);
    await first.ready;
    const welcome = await first.waitFor((m) => m.type === "welcome");
    const playerId = welcome.type === "welcome" ? welcome.playerId : "";

    first.socket.send(JSON.stringify({ type: "hello", name: "Ada", playerId }));
    first.socket.send(
      JSON.stringify({
        type: "create",
        game: "ship-captain-crew",
        mode: "free",
        name: "Ada",
        vsBots: true,
      }),
    );
    const room = await first.waitFor((m) => m.type === "room");
    if (room.type !== "room") throw new Error("unreachable");
    const oldRoomId = room.room.id;

    first.socket.send(JSON.stringify({ type: "ready", ready: true }));
    await first.waitFor(
      (m) => m.type === "room" && m.room.state !== "waiting",
      10_000,
    );

    // Open another game while the first table is still live.
    first.socket.send(
      JSON.stringify({
        type: "create",
        game: "horses",
        mode: "free",
        name: "Ada",
        vsBots: true,
      }),
    );
    const next = await first.waitFor(
      (m) => m.type === "room" && m.room.game === "horses",
      10_000,
    );
    if (next.type !== "room") throw new Error("unreachable");
    expect(next.room.id).not.toBe(oldRoomId);
    expect(first.messages.some((m) => m.type === "error")).toBe(false);

    // Returning to a seat held mid-game is allowed (it is not a new join).
    first.socket.send(JSON.stringify({ type: "join", tableId: oldRoomId }));
    const returned = await first.waitFor(
      (m) => m.type === "room" && m.room.id === oldRoomId,
      10_000,
    );
    if (returned.type !== "room") throw new Error("unreachable");
    expect(returned.room.yourSeat).not.toBeNull();

    // A reconnect that only knows the player id must not drag the player back
    // into the abandoned table.
    first.socket.close();
    const second = connect(port);
    await second.ready;
    await second.waitFor((m) => m.type === "welcome");
    second.socket.send(JSON.stringify({ type: "hello", playerId }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(second.messages.some((m) => m.type === "room")).toBe(false);

    // The browser's explicit room hint still restores the live seat.
    second.socket.send(JSON.stringify({ type: "hello", playerId, roomId: oldRoomId }));
    const adopted = await second.waitFor((m) => m.type === "room");
    if (adopted.type !== "room") throw new Error("unreachable");
    expect(adopted.room.id).toBe(oldRoomId);
    second.socket.close();
  }, 30_000);

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
