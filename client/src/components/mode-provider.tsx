import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PlayMode } from "@20down/shared";

interface ModeContextValue {
  mode: PlayMode;
  setMode: (mode: PlayMode) => void;
  hydrated: boolean;
}

const ModeContext = createContext<ModeContextValue | null>(null);
const KEY = "20down.mode.v1";

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<PlayMode>("free");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "wager") setModeState("wager");
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  const setMode = useCallback((next: PlayMode) => {
    setModeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode, hydrated }), [mode, setMode, hydrated]);
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const context = useContext(ModeContext);
  if (!context) throw new Error("useMode must be used inside ModeProvider");
  return context;
}
