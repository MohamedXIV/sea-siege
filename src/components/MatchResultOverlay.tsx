import { useState } from "react";
import { Anchor, RotateCcw, Trophy, XCircle, Scale, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import { matchResultForSlot } from "../../spacetimedb/src/sim/final-standings";

/** Exact fifth-point presentation: 1 score unit = 0.2 displayed points. */
function formatScore(score5: bigint): string {
  return `${score5 / 5n}.${(score5 % 5n) * 2n}`;
}

const outcomeDescriptions: Record<string, string> = {
  domination: "The last surviving Command Core decides the battle.",
  mutual_destruction: "Every Command Core fell. No faction survives.",
  time_limit: "The 12-minute limit was reached. Dominance score decided the winner.",
};

export function MatchResultOverlay({
  state, onDeployment,
}: {
  state: SpacetimeClientState;
  onDeployment: () => void;
}) {
  const match = state.activeMatch;
  const [pending, setPending] = useState<"ai" | "lobby" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!match) return null;

  const finished = match.phase === "finished";
  const mySlot = state.myMembership?.slot ?? null;
  const outcome = matchResultForSlot(match.phase, match.winnerSlot, mySlot);
  const stillEliminated = !finished && state.myFaction?.eliminated === true;
  const isVictory = outcome === "victory";
  const isDraw = outcome === "draw";
  const headline = !finished && stillEliminated ? "ELIMINATED" :
    outcome === "victory" ? "VICTORY" :
    outcome === "defeat" ? "DEFEAT" :
    outcome === "draw" ? "DRAW" : "BATTLE ENDED";
  const accent = isVictory ? "text-emerald-300" :
    isDraw ? "text-amber-300" : "text-rose-300";
  const standings = [...state.finalStandings].sort((a, b) =>
    a.slot === match.winnerSlot ? -1 :
    b.slot === match.winnerSlot ? 1 :
    a.score5 === b.score5 ? a.slot - b.slot : a.score5 > b.score5 ? -1 : 1
  );
  const botDuel = finished && match.maxSlots === 2 &&
    standings.length === 2 && standings.some(row => row.controller === "bot");
  const durationMs = match.endedAtUs > match.startedAtUs
    ? Number((match.endedAtUs - match.startedAtUs) / 1000n) : 0;
  const mm = Math.floor(durationMs / 60000);
  const ss = Math.floor((durationMs % 60000) / 1000);
  const connected = state.status === "connected" && state.subscriptionStatus === "applied";

  const act = async (mode: "ai" | "lobby") => {
    if (pending !== null) return;
    setPending(mode);
    setError(null);
    try {
      if (mode === "ai") {
        // Reuses the existing server-owned Quick Play setup. Fresh match,
        // new map seed, fresh economy and a real bot; never reset old rows.
        await spacetimeClient.quickPlay();
      } else {
        // Human opponents must voluntarily join the NEW lobby using its ID.
        // Never automatically move somebody else's identity between matches.
        await spacetimeClient.createMatch(match.maxSlots);
        onDeployment();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the new match");
    } finally {
      setPending(null);
    }
  };

  return (
    <div data-game-ui="true"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[#030912]/85 p-3 text-slate-100 backdrop-blur-sm sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="match-result-heading"
        className="pointer-events-auto my-auto w-full max-w-3xl space-y-4 rounded-xl border border-sky-800/60 bg-slate-950/95 p-4 shadow-2xl sm:p-6">
        <header className="space-y-2 border-b border-slate-800 pb-4 text-center">
          <div className="flex justify-center">
            {isVictory ? <Trophy className="size-9 text-emerald-300" /> :
              isDraw ? <Scale className="size-9 text-amber-300" /> :
              <XCircle className="size-9 text-rose-300" />}
          </div>
          <h1 id="match-result-heading"
            className={`font-mono text-3xl font-black tracking-[0.2em] sm:text-5xl ${accent}`}>
            {headline}
          </h1>
          <p className="font-mono text-xs uppercase tracking-wider text-slate-300">
            Match #{match.id.toString()}
            {finished ? ` · ${mm}:${String(ss).padStart(2, "0")} elapsed` : " · Battle continues"}
          </p>
          <p className="text-xs text-slate-400">
            {finished
              ? outcomeDescriptions[match.victoryReason] ?? "The server resolved the match."
              : "Your Command Core has been destroyed. Other factions are still fighting."}
          </p>
        </header>

        {finished && (
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <Anchor className="size-4" /> Final fleet standings
            </h2>
            {standings.length === 0 ? (
              <p className="rounded border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-400">
                The server recorded the winner, but detailed statistics are unavailable
                for this older match.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-slate-700">
                <table className="w-full min-w-[540px] text-left text-xs">
                  <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="p-2">Faction</th><th className="p-2 text-right">Core HP</th>
                      <th className="p-2 text-right">Ships</th><th className="p-2 text-right">Buildings</th>
                      <th className="p-2 text-right">Iron gathered</th>
                      <th className="p-2 text-right">Rare gathered</th>
                      <th className="p-2 text-right">Dominance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map(row => (
                      <tr key={row.slot} className={`border-t border-slate-800 ${
                        row.slot === mySlot ? "bg-sky-950/35" : "bg-slate-950"
                      }`}>
                        <th className="whitespace-nowrap p-2 font-semibold text-slate-200">
                          {row.slot === match.winnerSlot ? "★ " : ""}
                          Faction {row.slot + 1}
                          {row.slot === mySlot ? " (You)" : ""}
                          <span className="ml-1 text-[10px] text-slate-500">
                            {row.controller === "bot" ? "AI" : "Human"}
                          </span>
                        </th>
                        <td className="p-2 text-right">{row.coreHp}</td>
                        <td className="p-2 text-right">{row.ships}</td>
                        <td className="p-2 text-right">{row.structures}</td>
                        <td className="p-2 text-right">{row.ironGathered.toString()}</td>
                        <td className="p-2 text-right">{row.advancedGathered.toString()}</td>
                        <td className="p-2 text-right font-mono text-amber-300">{formatScore(row.score5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              Final server snapshot. Dominance follows the original Iron-based tiebreak
              formula; rare material totals are shown separately.
            </p>
          </div>
        )}

        {error && <p role="alert"
          className="rounded border border-rose-700/60 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</p>}

        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-800 pt-4">
          {botDuel && (
            <Button onClick={() => void act("ai")} disabled={!connected || pending !== null}
              className="bg-emerald-700 text-white hover:bg-emerald-600">
              <RotateCcw className="size-4" />
              {pending === "ai" ? "Preparing rematch..." : "Rematch vs AI"}
            </Button>
          )}
          {finished && (
            <Button onClick={() => void act("lobby")} disabled={!connected || pending !== null}
              variant="outline" className="border-sky-700 text-sky-200">
              <Users className="size-4" />
              {pending === "lobby" ? "Creating lobby..." : "New multiplayer lobby"}
            </Button>
          )}
          <Button onClick={onDeployment} variant="outline" disabled={pending !== null}
            className="border-slate-700 text-slate-300">
            Return to deployment
          </Button>
        </div>
        {finished && !botDuel && (
          <p className="text-center text-[11px] text-slate-500">
            Multiplayer rematches start in a fresh lobby. Share its match number
            with other players so they can join voluntarily.
          </p>
        )}
      </section>
    </div>
  );
}
