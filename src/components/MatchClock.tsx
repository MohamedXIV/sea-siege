import { useEffect, useState } from "react";
import type { Match } from "@/module_bindings/types";
import { MATCH_RULES } from "../../spacetimedb/src/sim/match-outcome";

/** Display-only countdown. Actual deadline and winner always come from SpacetimeDB. */
export function MatchClock({ match }: { match: Match }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (match.phase !== "active") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [match.id, match.phase]);

  if (match.phase !== "active") return null;
  const deadlineMs = Number(match.startedAtUs / 1000n) + MATCH_RULES.durationMs;
  const seconds = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  const lowTime = seconds > 0 && seconds <= 60;

  return (
    <div
      role="timer"
      aria-label="Approximate match time remaining"
      title="Approximate match time remaining (Core destruction or time limit)"
      className="hud-panel pointer-events-auto relative flex items-center justify-center px-3.5 py-1.5"
    >
      {/* Corner rivets */}
      <span className="pointer-events-none absolute left-1.5 top-1.5 size-1 rounded-full bg-[#8f7a64]/80" />
      <span className="pointer-events-none absolute right-1.5 top-1.5 size-1 rounded-full bg-[#8f7a64]/80" />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 size-1 rounded-full bg-[#8f7a64]/80" />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 size-1 rounded-full bg-[#8f7a64]/80" />

      <div className="hud-inset flex items-center gap-2 px-3 py-1">
        <span
          className={`hud-digit font-mono text-lg font-extrabold tracking-[0.18em] sm:text-xl ${
            lowTime ? "animate-pulse text-rose-400" : "text-amber-400"
          }`}
        >
          {seconds ? `${minutes}:${remainder}` : "00:00"}
        </span>
      </div>
    </div>
  );
}
