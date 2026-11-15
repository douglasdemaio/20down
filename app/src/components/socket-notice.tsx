"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useGameSocket } from "./game-socket-provider";

/** Small toast for server-side errors (join failures, illegal moves, ...). */
export function SocketNotice() {
  const { error, clearError, notice } = useGameSocket();
  const [visibleError, setVisibleError] = useState<string | null>(null);

  useEffect(() => {
    setVisibleError(error);
    if (!error) return;
    const timer = setTimeout(() => {
      setVisibleError(null);
      clearError();
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  if (!visibleError && !notice) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
      {visibleError ? (
        <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-coral-400/40 bg-ink-900/95 px-4 py-3 text-sm text-parchment-100 shadow-card backdrop-blur">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-coral-400" />
          <p className="flex-1 leading-relaxed">{visibleError}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setVisibleError(null);
              clearError();
            }}
            className="text-parchment-200/50 hover:text-parchment-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="pointer-events-none max-w-md rounded-full border border-white/10 bg-ink-900/90 px-4 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-parchment-200/60 backdrop-blur">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
