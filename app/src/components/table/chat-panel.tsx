"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatEntry } from "@/components/game-socket-provider";
import { useGameSocket } from "@/components/game-socket-provider";

export function ChatPanel({ chat }: { chat: ChatEntry[] }) {
  const { sendChat, room } = useGameSocket();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  return (
    <div className="flex h-full min-h-[16rem] flex-col">
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {chat.length === 0 ? (
          <p className="pt-6 text-center text-xs text-parchment-200/35">
            Table chat is quiet. Say hello.
          </p>
        ) : (
          chat.map((entry, index) => {
            const mine = room?.yourSeat === entry.seat;
            return (
              <div key={`${entry.at}-${index}`} className={mine ? "text-right" : ""}>
                <p className="font-mono text-[9px] uppercase tracking-wider text-parchment-200/35">
                  {entry.name}
                </p>
                <p
                  className={`mt-0.5 inline-block max-w-[90%] break-words rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${
                    mine
                      ? "bg-brass-500/20 text-parchment-100"
                      : "bg-white/5 text-parchment-200/80"
                  }`}
                >
                  {entry.text}
                </p>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 p-2.5">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={200}
          placeholder="Message the table…"
          className="input !py-2 text-xs"
          disabled={!room}
        />
        <button type="submit" className="btn-primary !px-3 !py-2" aria-label="Send message" disabled={!room}>
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
