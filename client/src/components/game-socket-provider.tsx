import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Suit } from "@20down/shared";
import type {
  ClientMessage,
  LobbyTable,
  RoomView,
  ServerMessage,
} from "@20down/shared/protocol";
import { WS_URL, config } from "@/lib/config";
import { loadName, saveName } from "@/lib/compliance";
import { MockSocket } from "@/lib/mock-worker";

export type SocketStatus = "connecting" | "online" | "offline";

export interface ChatEntry {
  seat: number;
  name: string;
  text: string;
  at: number;
}

interface CreateOptions {
  game: "zwanzig-ab";
  mode: "free" | "wager";
  stakeBaseUnits?: string;
  maxPlayers?: number;
  vsBots?: boolean;
}

interface QuickMatchOptions {
  mode: "free" | "wager";
  stakeBaseUnits?: string;
  maxPlayers?: number;
}

interface GameSocketValue {
  status: SocketStatus;
  playerId: string | null;
  name: string;
  setName: (name: string) => void;
  wallet: string | null;
  lobby: LobbyTable[];
  room: RoomView | null;
  chat: ChatEntry[];
  error: string | null;
  clearError: () => void;
  notice: string | null;
  createTable: (options: CreateOptions, onCreated?: (tableId: string) => void) => void;
  joinTable: (tableId: string) => void;
  quickMatch: (options: QuickMatchOptions, onMatched?: (tableId: string) => void) => void;
  leaveTable: () => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  chooseTrump: (suit: Suit) => void;
  exchange: (cards: string[]) => void;
  announce: (play: boolean) => void;
  playCard: (card: string) => void;
  nextDeal: () => void;
  rematch: () => void;
  markDeposited: (signature: string) => void;
  sendChat: (text: string) => void;
  refreshLobby: () => void;
}

const GameSocketContext = createContext<GameSocketValue | null>(null);
const ID_KEY = "20down.player.v1";

export function GameSocketProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const location = useLocation();

  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setNameState] = useState("Guest");
  const [lobby, setLobby] = useState<LobbyTable[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const nameRef = useRef("Guest");
  const walletRef = useRef<string | null>(null);
  const playerRef = useRef<string | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const pendingRef = useRef<((tableId: string) => void) | null>(null);
  const pathRef = useRef(location.pathname);
  const mountedRef = useRef(true);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const viewingRoomId = useCallback((): string | undefined => {
    if (roomRef.current?.id) return roomRef.current.id;
    const match = /\/table\/([^/?#]+)/.exec(pathRef.current ?? "");
    return match ? decodeURIComponent(match[1] ?? "") : undefined;
  }, []);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    walletRef.current = wallet;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "hello",
          wallet: wallet ?? undefined,
          roomId: viewingRoomId(),
        }),
      );
    }
  }, [wallet, viewingRoomId]);

  useEffect(() => {
    setNameState(loadName());
    try {
      playerRef.current = localStorage.getItem(ID_KEY);
    } catch {
      // ignore
    }
  }, []);

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "welcome": {
        playerRef.current = message.playerId;
        setPlayerId(message.playerId);
        try {
          localStorage.setItem(ID_KEY, message.playerId);
        } catch {
          // ignore
        }
        break;
      }
      case "lobby":
        setLobby(message.tables);
        break;
      case "room": {
        roomRef.current = message.room;
        setRoom(message.room);
        const pending = pendingRef.current;
        pendingRef.current = null;
        pending?.(message.room.id);
        break;
      }
      case "left": {
        roomRef.current = null;
        setRoom(null);
        setChat([]);
        break;
      }
      case "error":
        pendingRef.current = null;
        setError(message.message);
        break;
      case "notice":
        setNotice(message.message);
        break;
      case "chat":
        setChat((current) => [
          ...current.slice(-119),
          { seat: message.seat, name: message.name, text: message.text, at: message.at },
        ]);
        break;
      case "pong":
        break;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) return;
      setStatus("connecting");
      const socket: WebSocket = config.mock
        ? (new MockSocket() as unknown as WebSocket)
        : new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setStatus("online");
        socket.send(
          JSON.stringify({
            type: "hello",
            playerId: playerRef.current ?? undefined,
            name: nameRef.current,
            wallet: walletRef.current ?? undefined,
            roomId: viewingRoomId(),
          }),
        );
      });

      socket.addEventListener("message", (event) => {
        let parsed: ServerMessage | null = null;
        try {
          parsed = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (parsed) handleMessage(parsed);
      });

      socket.addEventListener("close", () => {
        if (!mountedRef.current || config.mock) return;
        setStatus("offline");
        socketRef.current = null;
        const attempt = Math.min(5, attemptRef.current + 1);
        attemptRef.current = attempt;
        reconnectRef.current = setTimeout(connect, Math.min(5000, 400 * attempt));
      });

      socket.addEventListener("error", () => {
        // `close` handles the retry.
      });

      if (config.mock) {
        // The mock transport is open immediately but still fires an open event.
        queueMicrotask(() => {
          socket.dispatchEvent(new Event("open"));
        });
      }
    };

    connect();

    const heartbeat = setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);

    return () => {
      mountedRef.current = false;
      clearInterval(heartbeat);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [handleMessage, viewingRoomId]);

  const setName = useCallback(
    (next: string) => {
      const clean = next.slice(0, 24);
      setNameState(clean);
      nameRef.current = clean;
      saveName(clean);
      send({ type: "hello", name: clean });
    },
    [send],
  );

  const createTable = useCallback(
    (options: CreateOptions, onCreated?: (tableId: string) => void) => {
      setError(null);
      setChat([]);
      pendingRef.current = onCreated ?? null;
      if (!send({ type: "create", ...options, name: nameRef.current, wallet: walletRef.current ?? undefined })) {
        pendingRef.current = null;
        setError("Connecting to the game server. Please try again in a moment.");
      }
    },
    [send],
  );

  const joinTable = useCallback(
    (tableId: string) => {
      if (roomRef.current?.id === tableId) return;
      setError(null);
      setChat([]);
      if (!send({ type: "join", tableId, name: nameRef.current, wallet: walletRef.current ?? undefined })) {
        setError("Connecting to the game server. Please try again in a moment.");
      }
    },
    [send],
  );

  const quickMatch = useCallback(
    (options: QuickMatchOptions, onMatched?: (tableId: string) => void) => {
      setError(null);
      setChat([]);
      pendingRef.current = onMatched ?? null;
      if (!send({ type: "quickMatch", ...options, name: nameRef.current, wallet: walletRef.current ?? undefined })) {
        pendingRef.current = null;
        setError("Connecting to the game server. Please try again in a moment.");
      }
    },
    [send],
  );

  const value = useMemo<GameSocketValue>(
    () => ({
      status,
      playerId,
      name,
      setName,
      wallet,
      lobby,
      room,
      chat,
      error,
      clearError: () => setError(null),
      notice,
      createTable,
      joinTable,
      quickMatch,
      leaveTable: () => send({ type: "leave" }),
      setReady: (ready) => send({ type: "ready", ready }),
      startGame: () => send({ type: "start" }),
      chooseTrump: (suit) => send({ type: "trump", suit }),
      exchange: (cards) => send({ type: "exchange", cards }),
      announce: (play) => send({ type: "announce", play }),
      playCard: (card) => send({ type: "playCard", card }),
      nextDeal: () => send({ type: "nextDeal" }),
      rematch: () => send({ type: "rematch" }),
      markDeposited: (signature) => send({ type: "deposited", signature }),
      sendChat: (text) => {
        const clean = text.trim().slice(0, 200);
        if (clean) send({ type: "chat", text: clean });
      },
      refreshLobby: () => send({ type: "lobby" }),
    }),
    [
      status,
      playerId,
      name,
      setName,
      wallet,
      lobby,
      room,
      chat,
      error,
      notice,
      createTable,
      joinTable,
      quickMatch,
      send,
    ],
  );

  return <GameSocketContext.Provider value={value}>{children}</GameSocketContext.Provider>;
}

export function useGameSocket(): GameSocketValue {
  const context = useContext(GameSocketContext);
  if (!context) throw new Error("useGameSocket must be used inside GameSocketProvider");
  return context;
}
