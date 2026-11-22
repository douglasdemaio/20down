import { env } from "cloudflare:workers";
import type { ClientMessage, ServerMessage } from "@20down/shared/protocol";
import type { Env } from "../src/types.js";

export const testEnv = env as unknown as Env;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TestSocket {
  readonly messages: ServerMessage[] = [];
  latestRoom: Extract<ServerMessage, { type: "room" }>["room"] | null = null;
  private readonly waiters = new Set<(message: ServerMessage) => void>();

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
      let message: ServerMessage;
      try {
        message = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      this.messages.push(message);
      if (message.type === "room") this.latestRoom = message.room;
      for (const waiter of [...this.waiters]) waiter(message);
    });
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  has(type: ServerMessage["type"]): boolean {
    return this.messages.some((message) => message.type === type);
  }

  messagesOf<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
  }

  async waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    timeoutMs = 5_000,
  ): Promise<T> {
    const existing = this.messages.find(predicate);
    if (existing) return existing as T;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for a message. Saw: ${this.messages.map((m) => m.type).join(", ")}`));
      }, timeoutMs);
      const waiter = (message: ServerMessage) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(message);
      };
      this.waiters.add(waiter);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.addEventListener("close", done, { once: true });
      try {
        this.ws.close(1000, "test complete");
      } catch {
        done();
      }
    });
  }
}

export async function connectLobby(name = "Tester"): Promise<TestSocket> {
  const response = await testEnv.LOBBY_DO.getByName("global").fetch(
    new Request("https://example.com/ws", {
      headers: { Upgrade: "websocket", Connection: "Upgrade" },
    }),
  );
  if (!response.webSocket) throw new Error("Expected a WebSocket upgrade");
  response.webSocket.accept();
  const socket = new TestSocket(response.webSocket);
  socket.send({ type: "hello", name });
  await socket.waitFor(
    (message): message is Extract<ServerMessage, { type: "welcome" }> =>
      message.type === "welcome" && message.name === name,
  );
  return socket;
}

export type RoomMessage = Extract<ServerMessage, { type: "room" }>;

export function isRoom(message: ServerMessage): message is RoomMessage {
  return message.type === "room";
}

export function isRoomWhere(
  predicate: (room: RoomMessage["room"]) => boolean,
): (message: ServerMessage) => message is RoomMessage {
  return (message): message is RoomMessage => isRoom(message) && predicate(message.room);
}

export function isError(message: ServerMessage): message is Extract<ServerMessage, { type: "error" }> {
  return message.type === "error";
}

export function isChat(message: ServerMessage): message is Extract<ServerMessage, { type: "chat" }> {
  return message.type === "chat";
}
