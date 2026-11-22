"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import type { GameId, PlayMode, Suit } from "@20down/shared";
import type {
  ClientMessage,
  LobbyTable,
  RoomView,
  ServerMessage,
} from "@20down/shared/protocol";
import { WS_URL } from "@/lib/config";
import { loadName, saveName } from "@/lib/compliance";

export type SocketStatus = "connecting" | "online" | "offline";

export interface ChatEntry {
  seat: number;
  name: string;
  text: string;
  at: number;
}

interface CreateOptions {
  game: GameId;
  mode: PlayMode;
  stakeBaseUnits?: string;
  maxPlayers?: number;
  vsBots?: boolean;
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
  leaveTable: () => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  reroll: (mask: number) => void;
  stand: () => void;
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
const ID_KEY = "ww.player.v1";

export function GameSocketProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const pathname = usePathname();

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
  const pendingCreateRef = useRef<((tableId: string) => void) | null>(null);
  const pathRef = useRef(pathname);
  const mountedRef = useRef(true);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  /**
   * The table the browser is actually looking at. After a reload `roomRef` is
   * empty, so fall back to the /table/<id> URL before asking the server to
   * re-seat us.
   */
  const viewingRoomId = useCallback((): string | undefined => {
    if (roomRef.current?.id) return roomRef.current.id;
    const match = /^\/table\/([^/?#]+)/.exec(pathRef.current ?? "");
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

  const sendJoin = useCallback(
    (tableId: string) => {
      send({
        type: "join",
        tableId,
        name: nameRef.current,
        wallet: walletRef.current ?? undefined,
      });
    },
    [send],
  );

  const sendCreate = useCallback(
    (options: CreateOptions): boolean =>
      send({
        type: "create",
        game: options.game,
        mode: options.mode,
        stakeBaseUnits: options.stakeBaseUnits,
        maxPlayers: options.maxPlayers,
        vsBots: options.vsBots,
        name: nameRef.current,
        wallet: walletRef.current ?? undefined,
      }),
    [send],
  );

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
        const onCreated = pendingCreateRef.current;
        pendingCreateRef.current = null;
        onCreated?.(message.room.id);
        break;
      }
      case "left": {
        roomRef.current = null;
        setRoom(null);
        setChat([]);
        break;
      }
      case "error":
        pendingCreateRef.current = null;
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
      const socket = new WebSocket(WS_URL);
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
        if (!mountedRef.current) return;
        setStatus("offline");
        socketRef.current = null;
        const attempt = Math.min(5, attemptRef.current + 1);
        attemptRef.current = attempt;
        const delay = Math.min(5000, 400 * attempt);
        reconnectRef.current = setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        // `close` handles the retry.
      });
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
      pendingCreateRef.current = onCreated ?? null;
      // The server releases the previous seat for us (or asks for a refund
      // first when USDC is still escrowed).
      if (!sendCreate(options)) pendingCreateRef.current = null;
    },
    [sendCreate],
  );

  const joinTable = useCallback(
    (tableId: string) => {
      if (roomRef.current?.id === tableId) return;
      setError(null);
      setChat([]);
      sendJoin(tableId);
    },
    [sendJoin],
  );

  const leaveTable = useCallback(() => {
    send({ type: "leave" });
  }, [send]);

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
      leaveTable,
      setReady: (ready) => {
        send({ type: "ready", ready });
      },
      startGame: () => send({ type: "start" }),
      reroll: (mask) => send({ type: "reroll", mask }),
      stand: () => send({ type: "stand" }),
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
      leaveTable,
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
