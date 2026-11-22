import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useGameSocket, type ChatEntry } from "@/components/game-socket-provider";

export function ChatPanel({ chat }: { chat: ChatEntry[] }) {
  const { sendChat } = useGameSocket();
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
    <div className="flex h-full min-h-[18rem] flex-col">
      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4 sm:px-6">
        {chat.length === 0 ? (
          <p className="pt-8 text-center text-sm text-parchment-200/35">
            Table chat is quiet. Say hello.
          </p>
        ) : (
          chat.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="text-xs leading-relaxed">
              <span className="font-semibold text-brass-300">{entry.name}</span>
              <span className="ml-1 text-parchment-200/30">
                {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <p className="mt-0.5 break-words text-parchment-200/70">{entry.text}</p>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5"
      >
        <input
          className="input !py-2 text-xs"
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say something…"
          aria-label="Chat message"
        />
        <button type="submit" className="btn-ghost !px-3 !py-2" disabled={!text.trim()}>
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
