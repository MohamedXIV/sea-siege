import type { MouseEvent } from "react";
import { LocateFixed, Radio, Ship, Waves } from "lucide-react";
import {
  FOCUS_ENEMY_EVENT,
  FOCUS_HOME_EVENT,
  FOCUS_MAP_CELL_EVENT,
} from "@/game/SeaScene";
import { geminiFactionColor } from "@/game/art/GeminiPixelArt";
import type { SpacetimeClientState } from "@/network/spacetime-client";
import { cellsForSlots } from "../../spacetimedb/src/sim/worldgen";
import {
  RESOURCE_TYPES,
  type AdvancedResourceKind,
} from "../../spacetimedb/src/sim/materials";

interface TacticalOverviewProps {
  state: SpacetimeClientState;
}

/**
 * Bottom-left Industrial Circular Radar Mini-map + Mini-status telemetry panel.
 * Displays actual known terrain, salvage, material deposits and *all* fleets; clicking pans camera.
 */
export function TacticalOverview({ state }: TacticalOverviewProps) {
  const match = state.activeMatch;
  if (!match) return null;

  const cells = state.worldChunks[0]?.mapCells ?? cellsForSlots(match.maxSlots);
  const obstacles = state.worldChunks.flatMap((chunk) =>
    Array.from(chunk.terrain).flatMap((kind, index) => {
      const x = chunk.chunkX * 16 + (index % 16);
      const y = chunk.chunkY * 16 + Math.floor(index / 16);
      if (kind === 0 || x >= cells || y >= cells) return [];
      return [{ x, y, kind }];
    })
  );

  const jumpToCell = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(
      0,
      Math.min(cells, ((event.clientX - bounds.left) / bounds.width) * cells)
    );
    const y = Math.max(
      0,
      Math.min(cells, ((event.clientY - bounds.top) / bounds.height) * cells)
    );
    window.dispatchEvent(
      new CustomEvent(FOCUS_MAP_CELL_EVENT, { detail: { x, y } })
    );
  };

  const fleetCount = state.myShips.length;
  const structureCount = state.myStructures.length;
  const enemyCount = state.visibleEnemies.length;

  return (
    <aside className="pointer-events-auto flex shrink-0 items-end gap-2">
      {/* Circular Radar Mini-map */}
      <div className="flex flex-col items-center">
        <div className="hud-plate-header px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/90">
          Mini-map
        </div>
        <div className="hud-panel-steel relative flex size-36 items-center justify-center p-2 sm:size-44">
          {/* Bezel action buttons */}
          <button
            type="button"
            title="Focus Home Base (H)"
            aria-label="Focus Home Base"
            onClick={() => window.dispatchEvent(new Event(FOCUS_HOME_EVENT))}
            className="hud-btn absolute left-1.5 top-1.5 z-20 flex size-6 items-center justify-center rounded text-cyan-300"
          >
            <LocateFixed className="size-3.5" />
          </button>
          <button
            type="button"
            title="Focus Enemy Contact (E)"
            aria-label="Focus Enemy Contact"
            disabled={!enemyCount}
            onClick={() => window.dispatchEvent(new Event(FOCUS_ENEMY_EVENT))}
            className="hud-btn absolute right-1.5 top-1.5 z-20 flex size-6 items-center justify-center rounded text-rose-300 disabled:opacity-40"
          >
            <Radio className="size-3.5" />
          </button>

          {/* Circular Radar Screen */}
          <button
            type="button"
            onClick={jumpToCell}
            className="group relative block aspect-square h-full w-full overflow-hidden rounded-full border-2 border-[#3c5750] bg-[#061c19] shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] focus-visible:outline-2 focus-visible:outline-emerald-400"
            title="Click radar to pan the camera"
            aria-label="Full battlefield radar minimap. Click to pan the camera."
          >
            {/* Actual interactive battlefield map */}
            <svg
              viewBox={`0 0 ${cells} ${cells}`}
              className="h-full w-full"
              aria-hidden="true"
            >
              <rect x="0" y="0" width={cells} height={cells} fill="#071e1b" />
              {obstacles.map((cell) => (
                <rect
                  key={`terrain-${cell.x}-${cell.y}`}
                  x={cell.x}
                  y={cell.y}
                  width="1"
                  height="1"
                  fill={
                    cell.kind === 1
                      ? "#0f423d"
                      : cell.kind === 2
                        ? "#2b4d46"
                        : "#7c3a1d"
                  }
                  opacity={cell.kind === 1 ? 0.5 : 0.95}
                />
              ))}
              {state.salvageNodes
                .filter((node) => node.remaining > 0)
                .map((node) => (
                  <rect
                    key={`node-${node.id}`}
                    x={node.gridX - 0.55}
                    y={node.gridY - 0.55}
                    width="1.15"
                    height="1.15"
                    fill={node.contested ? "#f97316" : "#eab308"}
                  />
                ))}
              {state.materialDeposits.map((node) => (
                <circle
                  key={`material-${node.id}`}
                  cx={node.gridX + 0.5}
                  cy={node.gridY + 0.5}
                  r="1.15"
                  stroke={
                    RESOURCE_TYPES[node.kind as AdvancedResourceKind]?.color ??
                    "#f8fafc"
                  }
                  strokeWidth="0.35"
                  fill={
                    node.remaining > 0
                      ? (RESOURCE_TYPES[node.kind as AdvancedResourceKind]
                          ?.color ?? "#f8fafc")
                      : "#334155"
                  }
                />
              ))}
              {state.battleStructures.map((st) => (
                <rect
                  key={`structure-${st.id}`}
                  x={st.gridX}
                  y={st.gridY}
                  width={st.width}
                  height={st.height}
                  fill={geminiFactionColor(st.ownerSlot)}
                  opacity={st.complete ? 1 : 0.5}
                />
              ))}
              {state.battleShips.map((ship) => (
                <g key={`ship-${ship.id}`}>
                  <circle cx={ship.x} cy={ship.y} r="1.1" fill="#ffffff" />
                  <rect
                    x={ship.x - 0.7}
                    y={ship.y - 0.7}
                    width="1.4"
                    height="1.4"
                    fill={geminiFactionColor(ship.ownerSlot)}
                  />
                </g>
              ))}
            </svg>

            {/* Radar concentric rings & crosshair overlay */}
            <svg
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <circle
                cx="50"
                cy="50"
                r="16"
                fill="none"
                stroke="rgba(52, 211, 153, 0.28)"
                strokeWidth="0.6"
              />
              <circle
                cx="50"
                cy="50"
                r="32"
                fill="none"
                stroke="rgba(52, 211, 153, 0.25)"
                strokeWidth="0.6"
              />
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="rgba(52, 211, 153, 0.35)"
                strokeWidth="0.8"
              />
              <line
                x1="50"
                y1="2"
                x2="50"
                y2="98"
                stroke="rgba(52, 211, 153, 0.22)"
                strokeWidth="0.6"
              />
              <line
                x1="2"
                y1="50"
                x2="98"
                y2="50"
                stroke="rgba(52, 211, 153, 0.22)"
                strokeWidth="0.6"
              />
            </svg>

            {/* Rotating green radar sweep */}
            <div
              className="radar-sweep pointer-events-none absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(16, 185, 129, 0.34) 0deg, rgba(16, 185, 129, 0.08) 42deg, transparent 78deg)",
              }}
            />
          </button>

          <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[9px] text-emerald-300/75">
            {cells}×{cells}
          </span>
        </div>
      </div>

      {/* Mini-status panel */}
      <div className="hidden flex-col sm:flex">
        <div className="hud-plate-header px-2.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100/90">
          Mini-status
        </div>
        <div className="hud-panel flex w-28 flex-col gap-2 p-2">
          <div className="hud-inset px-2 py-1">
            <div className="flex items-center justify-between text-[10px] text-slate-300">
              <span className="flex items-center gap-1">
                <Ship className="size-3 text-cyan-300" /> Fleet
              </span>
              <span className="font-mono font-bold text-cyan-300">
                {fleetCount}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-slate-900">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-300 transition-all"
                style={{ width: `${Math.min(100, fleetCount * 12)}%` }}
              />
            </div>
          </div>

          <div className="hud-inset px-2 py-1">
            <div className="flex items-center justify-between text-[10px] text-slate-300">
              <span className="flex items-center gap-1">
                <Waves className="size-3 text-emerald-300" /> Structs
              </span>
              <span className="font-mono font-bold text-emerald-300">
                {structureCount}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-slate-900">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-300 transition-all"
                style={{ width: `${Math.min(100, structureCount * 8)}%` }}
              />
            </div>
          </div>

          <div className="hud-inset px-2 py-1">
            <div className="flex items-center justify-between text-[10px] text-slate-300">
              <span className="flex items-center gap-1">
                <Radio className="size-3 text-rose-400" /> Enemy
              </span>
              <span className="font-mono font-bold text-rose-400">
                {enemyCount}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-slate-900">
              <div
                className="h-full bg-gradient-to-r from-rose-700 to-rose-400 transition-all"
                style={{ width: `${Math.min(100, enemyCount * 10)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
