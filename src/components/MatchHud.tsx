import { Heart, Menu, Shield, Zap } from "lucide-react";
import { TacticalOverview } from "@/components/TacticalOverview";
import { GeminiCommandDock } from "@/components/GeminiCommandDock";
import { MaterialInventory } from "@/components/MaterialInventory";
import { MatchClock } from "@/components/MatchClock";
import { buildingMaxHp } from "@/game/buildings/building-info";
import type { SpacetimeClientState } from "@/network/spacetime-client";

interface MatchHudProps {
  state: SpacetimeClientState;
  onMenu: () => void;
}

function CommanderEmblem() {
  return (
    <div className="hud-inset relative flex size-12 shrink-0 items-center justify-center overflow-hidden border border-[#6a5846] bg-gradient-to-b from-[#1e2d39] to-[#0c141b]">
      <svg viewBox="0 0 48 48" className="size-11" aria-hidden="true">
        {/* Naval cap */}
        <path d="M10 17 L24 10 L38 17 L35 21 L13 21 Z" fill="#1e2b36" stroke="#c89b5a" strokeWidth="1.4" />
        <rect x="13" y="19" width="22" height="3" fill="#0d151c" />
        <circle cx="24" cy="14.5" r="2.2" fill="#e5b869" />
        {/* Face & beard silhouette */}
        <path d="M16 22 H32 V30 C32 34 28 37 24 37 C20 37 16 34 16 30 Z" fill="#b7967a" />
        <path d="M16 28 C16 35 20 38 24 38 C28 38 32 35 32 28 L29 31 H19 Z" fill="#5b6670" />
        <rect x="19" y="25" width="3" height="1.8" fill="#18222b" />
        <rect x="26" y="25" width="3" height="1.8" fill="#18222b" />
        {/* Uniform shoulders */}
        <path d="M8 46 C9 39 15 37 24 37 C33 37 39 39 40 46 Z" fill="#21313f" stroke="#856e54" strokeWidth="1.2" />
        <path d="M21 37 L24 44 L27 37" fill="#c89b5a" />
      </svg>
    </div>
  );
}

/**
 * Industrial riveted-steel In-Game RTS HUD.
 * All readouts and actions bind directly to authoritative SpacetimeDB state and reducers.
 */
export function MatchHud({ state, onMenu }: MatchHudProps) {
  const match = state.activeMatch;
  if (!match) return null;

  const connected =
    state.status === "connected" && state.subscriptionStatus === "applied";

  const factionNumber = (state.myMembership?.slot ?? 0) + 1;
  const commandCore = state.myStructures.find((st) => st.kind === "command_core");
  const coreMaxHp = buildingMaxHp("command_core") ?? 1000;
  const coreHp = commandCore?.hp ?? 0;
  const corePct = Math.max(0, Math.min(100, Math.round((coreHp / coreMaxHp) * 100)));

  const onlineStructures = state.myStructures.filter(
    (st) => st.complete && st.connected && st.hp > 0
  ).length;
  const totalStructures = Math.max(1, state.myStructures.length);
  const gridPowerPct = Math.max(
    0,
    Math.min(100, Math.round((onlineStructures / totalStructures) * 100))
  );

  return (
    <div
      data-game-ui="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between text-slate-100"
    >
      {/* Top Bar: Player Faction Card | Digital Match Clock | Material Inventory */}
      <header className="flex flex-wrap items-start justify-between gap-2 p-2.5 sm:p-3">
        {/* Top-Left Player Faction Card */}
        <div className="hud-panel pointer-events-auto flex items-center gap-2.5 px-2.5 py-2">
          <CommanderEmblem />
          <div className="min-w-[155px] sm:min-w-[185px]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-200">
                PLAYER:{" "}
                <span className="text-amber-400">FACTION {factionNumber}</span>
              </div>
              <div
                role="status"
                title={connected ? "Connected to SpacetimeDB" : "Reconnecting"}
                className="flex items-center gap-1 text-[10px] font-semibold"
              >
                <span
                  className={`size-2 rounded-full ${
                    connected
                      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                      : "animate-pulse bg-amber-400"
                  }`}
                />
                <span className="hidden text-slate-300 sm:inline">
                  {connected ? "LIVE" : "SYNC"}
                </span>
              </div>
            </div>

            {/* Command Core Health Bar */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <Heart className="size-3 shrink-0 text-rose-400" />
              <div
                className="hud-inset h-2.5 flex-1 overflow-hidden p-[1px]"
                title={`Command Core HP: ${coreHp} / ${coreMaxHp}`}
              >
                <div
                  className="h-full rounded-[2px] bg-gradient-to-r from-rose-700 via-rose-500 to-amber-400 transition-all duration-300"
                  style={{ width: `${corePct}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-slate-300">
                {corePct}%
              </span>
            </div>

            {/* Grid Connectivity / Operational Bar */}
            <div className="mt-1 flex items-center gap-1.5">
              <Zap className="size-3 shrink-0 text-teal-300" />
              <div
                className="hud-inset h-2 flex-1 overflow-hidden p-[1px]"
                title={`Online Structures: ${onlineStructures} / ${state.myStructures.length}`}
              >
                <div
                  className="h-full rounded-[2px] bg-gradient-to-r from-teal-600 to-cyan-300 transition-all duration-300"
                  style={{ width: `${gridPowerPct}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-teal-200">
                {onlineStructures}/{state.myStructures.length}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 border-l border-[#374654] pl-2">
            <button
              type="button"
              onClick={onMenu}
              className="hud-btn flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-100"
            >
              <Menu className="size-3.5 text-amber-300" /> Menu
            </button>
            <span className="flex items-center gap-1 font-mono text-[9px] text-slate-400">
              <Shield className="size-2.5 text-cyan-400" /> #{match.id.toString()}
            </span>
          </div>
        </div>

        {/* Top-Center Digital Match Clock */}
        <div className="order-3 mx-auto sm:order-2 sm:mx-0">
          <MatchClock match={match} />
        </div>

        {/* Top-Right Material Inventory */}
        <div className="order-2 sm:order-3">
          <MaterialInventory state={state} />
        </div>
      </header>

      {/* Bottom Dock: Circular Radar + Mini-status | Tactical Command Dock + Inspector */}
      <footer className="flex flex-col gap-1.5 p-2.5 sm:p-3">
        {state.error && (
          <p
            role="alert"
            className="pointer-events-auto max-w-md rounded border border-rose-600/80 bg-[#1f0d12]/95 px-3 py-1.5 text-xs text-rose-200 shadow-lg"
          >
            {state.error}
          </p>
        )}

        <div className="flex flex-col items-stretch justify-between gap-2 xl:flex-row xl:items-end">
          <TacticalOverview state={state} />
          <GeminiCommandDock state={state} />
        </div>
      </footer>
    </div>
  );
}
