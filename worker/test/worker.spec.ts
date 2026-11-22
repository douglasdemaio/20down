import { exports } from "cloudflare:workers";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { RoomView } from "@20down/shared/protocol";
import {
  connectLobby,
  isChat,
  isError,
  isRoom,
  isRoomWhere,
  sleep,
  testEnv,
  TestSocket,
} from "./helpers.js";

const workerModule = () => exports as unknown as { default: { fetch: (request: Request) => Promise<Response> } };
const workerFetch = (request: Request) => workerModule().default.fetch(request);
const sockets: TestSocket[] = [];

afterEach(async () => {
  await Promise.all(sockets.map((socket) => socket.close()));
  sockets.length = 0;
  await reset();
});

async function connect(name: string): Promise<TestSocket> {
  const socket = await connectLobby(name);
  sockets.push(socket);
  return socket;
}

function tableStub(roomId: string) {
  return testEnv.TABLE_DO.getByName(roomId);
}

async function expectRpcError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (cause) {
    error = cause;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(pattern);
}

async function driveGame(socket: TestSocket, roomId: string, limit = 2_000): Promise<RoomView> {
  const stub = tableStub(roomId);
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const ran = await runDurableObjectAlarm(stub);
    if (socket.latestRoom?.state === "resolved") return socket.latestRoom;
    if (!ran) {
      const lobby = await stub.getLobby();
      if (lobby.state === "resolved") break;
      await sleep(0);
    }
  }
  if (socket.latestRoom?.state === "resolved") return socket.latestRoom;
  throw new Error(`Game ${roomId} did not resolve within ${limit} alarms`);
}

describe("20 Down Worker HTTP surface", () => {
  it("serves health and config with allowlisted CORS", async () => {
    const request = new Request("https://worker.example/health");
    request.headers.set("Origin", "http://localhost:5173");
    const health = await workerFetch(request);
    expect(health.status).toBe(200);
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(health.headers.get("Vary")).toBe("Origin");
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      service: "20down-backend",
      chainEnabled: false,
      cluster: "mainnet-beta",
    });

    const blocked = new Request("https://worker.example/health");
    blocked.headers.set("Origin", "https://evil.example");
    const blockedResponse = await workerFetch(blocked);
    expect(blockedResponse.status).toBe(200);
    expect(blockedResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const config = await workerFetch(new Request("https://worker.example/api/config"));
    const body = (await config.json()) as { stakePresets: string[]; feePerPlayer: string; maxStake: string };
    expect(body.stakePresets).toEqual(["100000", "250000", "500000", "1000000"]);
    expect(body.feePerPlayer).toBe("20000");
    expect(body.maxStake).toBe("1000000");
  });

  it("handles preflight and rejects unknown routes", async () => {
    const preflight = new Request("https://worker.example/api/tx", { method: "OPTIONS" });
    preflight.headers.set("Origin", "https://douglasdemaio.github.io");
    const response = await workerFetch(preflight);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://douglasdemaio.github.io");

    expect((await workerFetch(new Request("https://worker.example/nope"))).status).toBe(404);
  });

  it("blocks configured regions", async () => {
    const request = new Request("https://worker.example/health", {
      cf: { country: "IR" },
    } as RequestInit);
    const response = await workerFetch(request);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("region") });
  });

  it("rejects disallowed WebSocket origins and paused wager transactions", async () => {
    const request = new Request("https://worker.example/ws");
    request.headers.set("Upgrade", "websocket");
    request.headers.set("Origin", "https://evil.example");
    const wsResponse = await workerFetch(request);
    expect(wsResponse.status).toBe(403);

    const tx = await workerFetch(
      new Request("https://worker.example/api/tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "join", tablePda: "x", player: "y" }),
      }),
    );
    expect(tx.status).toBe(503);
    await expect(tx.json()).resolves.toMatchObject({ error: expect.stringContaining("paused") });
  });
});

describe("20 Down lobby", () => {
  it("deals a three-player bot table through to a verified finish", async () => {
    const socket = await connect("Honda Gene");
    socket.send({
      type: "create",
      game: "zwanzig-ab",
      mode: "free",
      vsBots: true,
      maxPlayers: 3,
    });
    const created = (await socket.waitFor(isRoom)).room;
    expect(created.game).toBe("zwanzig-ab");
    expect(created.maxPlayers).toBe(3);
    expect(created.minPlayers).toBe(3);
    expect(created.seats).toHaveLength(3);
    expect(created.seats.filter((seat) => seat.isBot)).toHaveLength(2);
    expect(created.yourSeat).toBe(0);
    expect(created.seedCommitment).toBeNull();

    socket.send({ type: "ready", ready: true });
    await runDurableObjectAlarm(tableStub(created.id));
    const started = await socket.waitFor(isRoomWhere((room) => room.state !== "waiting"));
    expect(started.room.state).toBe("in-progress");
    expect(started.room.seedCommitment).toMatch(/^[0-9a-f]{64}$/);

    const finished = await driveGame(socket, created.id);
    expect(finished.state).toBe("resolved");
    expect(finished.winnerSeat).not.toBeNull();
    expect(finished.revealedSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(finished.lastRound?.rows).toHaveLength(3);
    expect(finished.lastRound?.winners).toEqual([finished.winnerSeat]);

    const record = await workerFetch(
      new Request(`https://worker.example/api/verify?room=${created.id}&round=${finished.round}`),
    );
    expect(record.status).toBe(200);
    const verified = (await record.json()) as { record: { logHash?: string; seed?: string } };
    expect(verified.record.seed).toBe(finished.revealedSeed);
    expect(verified.record.logHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("quick matches an open human table and never creates two-seat tables", async () => {
    const host = await connect("Host");
    host.send({ type: "create", game: "zwanzig-ab", mode: "free", vsBots: false, maxPlayers: 2 });
    const created = (await host.waitFor(isRoom)).room;
    expect(created.maxPlayers).toBe(3);
    expect(created.seats).toHaveLength(1);

    const joiners = [await connect("Joiner 1"), await connect("Joiner 2")];
    for (const [index, joiner] of joiners.entries()) {
      joiner.send({ type: "quickMatch", mode: "free", maxPlayers: 3 });
      const room = (await joiner.waitFor(isRoom)).room;
      expect(room.id).toBe(created.id);
      expect(room.seats).toHaveLength(index + 2);
    }

    const lobby = await workerFetch(new Request("https://worker.example/api/lobby"));
    const body = (await lobby.json()) as {
      tables: Array<{ id: string; seats: number; minPlayers: number; maxPlayers: number }>;
    };
    expect(body.tables.find((table) => table.id === created.id)).toMatchObject({
      seats: 3,
      minPlayers: 3,
      maxPlayers: 3,
    });

    const late = await connect("Late Joiner");
    late.send({ type: "quickMatch", mode: "free", maxPlayers: 3 });
    const newRoom = (await late.waitFor(isRoom)).room;
    expect(newRoom.id).not.toBe(created.id);
    expect(newRoom.maxPlayers).toBe(3);
    expect(newRoom.seats).toHaveLength(3);
    expect(newRoom.seats.filter((seat) => seat.isBot)).toHaveLength(2);
  });

  it("blocks wager tables until launch sign-off", async () => {
    const socket = await connect("Wager Tester");
    socket.send({
      type: "create",
      game: "zwanzig-ab",
      mode: "wager",
      stakeBaseUnits: "100000",
      wallet: "11111111111111111111111111111111",
    });
    const error = await socket.waitFor(isError);
    expect(error.message).toContain("paused");
    expect(socket.has("room")).toBe(false);
  });

  it("broadcasts chat and reattaches a seat by player id and table hint", async () => {
    const playerId = "P-CHAT-TEST";
    const first = await connect("Chatter");
    first.send({ type: "hello", playerId, name: "Chatter" });
    first.send({ type: "create", game: "zwanzig-ab", mode: "free", vsBots: true, maxPlayers: 3 });
    const room = (await first.waitFor(isRoom)).room;

    first.send({ type: "chat", text: "good luck" });
    const chat = await first.waitFor(isChat);
    expect(chat.text).toBe("good luck");
    expect(chat.name).toBe("Chatter");

    await first.close();

    const reconnect = await connect("Chatter");
    reconnect.send({ type: "hello", playerId, name: "Chatter", roomId: room.id });
    const restored = (await reconnect.waitFor(isRoomWhere((view) => view.id === room.id))).room;
    expect(restored.yourSeat).toBe(0);
    expect(restored.seats[0]?.connected).toBe(true);
  });

  it("seats four players and fills free slots with bots", async () => {
    const socket = await connect("Four Seats");
    socket.send({ type: "create", game: "zwanzig-ab", mode: "free", vsBots: true, maxPlayers: 4 });
    const room = (await socket.waitFor(isRoom)).room;
    expect(room.minPlayers).toBe(3);
    expect(room.maxPlayers).toBe(4);
    expect(room.seats).toHaveLength(4);
    expect(room.seats.filter((seat) => seat.isBot)).toHaveLength(3);
    expect(room.seats.every((seat) => seat.connected)).toBe(true);

    const lobby = await workerFetch(new Request("https://worker.example/api/lobby"));
    const body = (await lobby.json()) as { tables: Array<{ id: string; maxPlayers: number }> };
    expect(body.tables.find((table) => table.id === room.id)?.maxPlayers).toBe(4);
  });

  it("broadcasts only the viewer's hand and auto-plays a timed-out turn", async () => {
    const host = await connect("North");
    const east = await connect("East");
    const players = [host, east, await connect("South")];
    host.send({ type: "create", game: "zwanzig-ab", mode: "free", vsBots: false, maxPlayers: 3 });
    const created = (await host.waitFor(isRoom)).room;
    for (const player of players.slice(1)) {
      player.send({ type: "join", tableId: created.id });
      await player.waitFor(isRoomWhere((room) => room.id === created.id));
    }
    for (const player of players) player.send({ type: "ready", ready: true });

    await runDurableObjectAlarm(tableStub(created.id));
    const hostRoom = (await host.waitFor(isRoomWhere((room) => room.state === "in-progress"))).room;
    const eastRoom = (await east.waitFor(isRoomWhere((room) => room.state === "in-progress"))).room;
    expect(hostRoom.yourSeat).toBe(0);
    expect(eastRoom.yourSeat).toBe(1);
    expect(hostRoom.zwanzig?.hand).toHaveLength(2);
    expect(eastRoom.zwanzig?.hand).toHaveLength(2);
    expect(hostRoom.zwanzig?.hand).not.toEqual(eastRoom.zwanzig?.hand);
    expect(hostRoom.seats).toHaveLength(3);
    expect(hostRoom.turnDeadline).not.toBeNull();
    expect(hostRoom.zwanzig?.phase).toBe("trump");

    await runDurableObjectAlarm(tableStub(created.id));
    const afterTimeout = (await host.waitFor(isRoomWhere((room) => room.zwanzig?.phase === "exchange")))
      .room;
    expect(afterTimeout.zwanzig?.trump).not.toBeNull();
    expect(afterTimeout.yourSeat).toBe(0);
    expect(afterTimeout.seats).toHaveLength(3);
  });

  it("guards wager escrow and rejects actions from unseated players", async () => {
    const id = "T-ESCROW-TEST";
    const stub = tableStub(id);
    const wallet = "11111111111111111111111111111111";
    const created = await stub.create({
      id,
      mode: "wager",
      stakeBaseUnits: 100_000n,
      maxPlayers: 3,
      hostPlayerId: "P-ESCROW-HOST",
      hostName: "Host",
      hostWallet: wallet,
      vsBots: false,
      publicTable: true,
      turnTimeoutMs: 60_000,
      anteTimeoutMs: 60_000,
      cluster: "mainnet-beta",
      wageringEnabled: true,
    });
    expect(created.view.stake).toBe("100000");
    expect(created.view.fee).toBe("60000");
    await expectRpcError(stub.join("P-ESCROW-GUEST", "Guest"), /wallet/i);
    await stub.join("P-ESCROW-GUEST", "Guest", "22222222222222222222222222222222");
    await expectRpcError(
      stub.handleMessage("P-ESCROW-GUEST", { type: "deposited", signature: "" }),
      /signature/i,
    );
    await stub.handleMessage("P-ESCROW-GUEST", { type: "deposited", signature: "test-signature" });

    const guard = await stub.canLeave("P-ESCROW-GUEST");
    expect(guard.ok).toBe(false);
    expect(guard.reason).toContain("escrow");
    await expectRpcError(stub.leave("P-ESCROW-GUEST"), /escrow/i);
    await expectRpcError(stub.handleMessage("P-STRANGER", { type: "chat", text: "hello" }), /not seated/i);
  });
});
