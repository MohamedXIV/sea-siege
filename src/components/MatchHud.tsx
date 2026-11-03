import { Anchor, Compass, Menu, Radio, Ship, Waves, LocateFixed } from "lucide-react";
import { FOCUS_ENEMY_EVENT, FOCUS_HOME_EVENT } from "@/game/SeaScene";
import { Button } from "@/components/ui/button";
import type { SpacetimeClientState } from "@/network/spacetime-client";

interface MatchHudProps {
  state: SpacetimeClientState;
  onMenu: () => void;
}

/**
 * Small real-data HUD for the first playable parity slice.
 * Gameplay controls stay in Phaser. Construction, production and combat tools
 * will be wired in their own vertical slices; don't display fake controls.
 */
export function MatchHud({ state, onMenu }: MatchHudProps) {
  const match = state.activeMatch;
  if (!match) return null;

  const connected =
    state.status === "connected" && state.subscriptionStatus === "applied";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-cyan-800/60 bg-slate-950/85 px-3 py-2 shadow-lg backdrop-blur-md">
          <Anchor className="size-5 text-cyan-300" />
          <div>
            <div className="text-xs font-black tracking-widest">SEA SIEGE</div>
            <div className="text-[11px] text-slate-300">
              Match #{match.id.toString()} · Slot {state.myMembership?.slot ?? "—"}
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            role="status"
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold backdrop-blur-md ${
              connected
                ? "border-emerald-700/60 bg-slate-950/85 text-emerald-300"
                : "border-amber-700/60 bg-slate-950/85 text-amber-200"
            }`}
          >
            <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
            {connected ? "Live match" : "Reconnecting"}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onMenu}
            className="border-slate-700 bg-slate-950/85 backdrop-blur-md"
          >
            <Menu className="size-4" /> Menu
          </Button>
        </div>
      </header>

      <div className="flex flex-col items-start justify-end gap-2 p-3 sm:p-4">
        {state.error && (
          <p role="alert" className="max-w-sm rounded-md border border-rose-700/60 bg-slate-950/90 px-3 py-2 text-xs text-rose-200">
            {state.error}
          </p>
        )}

        <div className="w-full max-w-2xl rounded-lg border border-slate-700/70 bg-slate-950/85 p-3 shadow-xl backdrop-blur-md">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Salvage</div>
              <div className="font-mono text-lg font-bold text-amber-300">
                {state.myFaction?.salvage ?? "—"}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
                <Ship className="size-3" /> Fleet
              </div>
              <div className="font-mono text-lg font-bold text-cyan-300">{state.myShips.length}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
                <Waves className="size-3" /> Structures
              </div>
              <div className="font-mono text-lg font-bold text-emerald-300">{state.myStructures.length}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
                <Radio className="size-3" /> Enemy assets
              </div>
              <div className="font-mono text-lg font-bold text-rose-300">{state.visibleEnemies.length}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-2 text-[11px] text-slate-300">
            <div className="space-y-1">
              <span className="flex items-center gap-1">
                <Compass className="size-3 text-cyan-300" /> Click your ship, then water to move
              </span>
              <div>Open battlefield: all enemy positions are visible. E: rival base · H: home</div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-slate-700 text-xs"
                onClick={() => window.dispatchEvent(new Event(FOCUS_HOME_EVENT))}
              >
                <LocateFixed className="size-3" /> Home
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-rose-800 text-xs text-rose-300"
                disabled={!state.visibleEnemies.length}
                onClick={() => window.dispatchEvent(new Event(FOCUS_ENEMY_EVENT))}
              >
                <LocateFixed className="size-3" /> Find Enemy
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
