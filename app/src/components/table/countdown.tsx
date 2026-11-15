"use client";

import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";

export function Countdown({
  deadline,
  serverTime,
  totalMs = 60_000,
  label = "Turn clock",
}: {
  deadline: number | null;
  serverTime: number;
  totalMs?: number;
  label?: string;
}) {
  const skew = useMemo(() => serverTime - Date.now(), [serverTime]);
  const [now, setNow] = useState(() => Date.now() + skew);

  useEffect(() => {
    setNow(Date.now() + skew);
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now() + skew), 250);
    return () => clearInterval(timer);
  }, [deadline, skew]);

  if (!deadline) return null;
  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const progress = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  const urgent = remaining <= 10_000;

  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1 font-mono text-xs ${urgent ? "text-coral-400" : "text-parchment-200/60"}`}>
        <Timer className="h-3.5 w-3.5" />
        {seconds}s
      </span>
      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-white/10" aria-label={label}>
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${
            urgent ? "bg-coral-500" : "bg-brass-400/80"
          }`}
          style={{ width: `${progress}%` }}
        />
      </span>
    </div>
  );
}
