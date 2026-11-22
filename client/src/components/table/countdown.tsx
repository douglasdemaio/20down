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
      <span className={`flex items-center gap-1 font-mono text-xs ${urgent ? "text-coral-400" : "text-parchment-200/45"}`}>
        <Timer className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={`font-mono text-sm ${urgent ? "text-coral-400" : "text-brass-300"}`}>
        {seconds}s
      </span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full ${urgent ? "bg-coral-400" : "bg-brass-400"}`}
          style={{ width: `${progress}%` }}
        />
      </span>
    </div>
  );
}
