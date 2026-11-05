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
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return (
    <div role="timer" aria-label="Approximate match time remaining"
      className={`flex items-center gap-1.5 rounded-lg border bg-slate-950/85 px-3 py-2 font-mono text-xs backdrop-blur-md ${
        seconds <= 60 ? "border-amber-700/60 text-amber-300" :
          "border-sky-800/60 text-sky-200"
      }`}>
      <span>{seconds ? `~${minutes}:${remainder}` : "Resolving…"}</span>
      <span className="hidden text-[10px] text-slate-400 sm:inline">Core destruction / time limit</span>
    </div>
  );
}
