import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useGameSocket } from "./game-socket-provider";

export function SocketNotice() {
  const { error, clearError, notice } = useGameSocket();

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 8000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  if (!error && !notice) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] w-[min(92vw,28rem)] -translate-x-1/2">
      <div
        className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-xs shadow-card backdrop-blur ${
          error
            ? "border-coral-400/40 bg-coral-500/15 text-coral-400"
            : "border-brass-400/30 bg-brass-500/10 text-brass-300"
        }`}
      >
        {error ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
        <p className="flex-1 leading-relaxed">{error ?? notice}</p>
        {error ? (
          <button type="button" onClick={clearError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
