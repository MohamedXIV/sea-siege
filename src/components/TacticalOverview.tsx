import type { MouseEvent } from "react";
import { FOCUS_MAP_CELL_EVENT } from "@/game/SeaScene";
import { geminiFactionColor } from "@/game/art/GeminiPixelArt";
import type { SpacetimeClientState } from "@/network/spacetime-client";
import { cellsForSlots } from "../../spacetimedb/src/sim/worldgen";

interface TacticalOverviewProps { state: SpacetimeClientState }

/** Gemini's 168px minimap: actual known terrain, salvage and *all* fleets. */
export function TacticalOverview({ state }: TacticalOverviewProps) {
  const match = state.activeMatch;
  if (!match) return null;
  const cells = state.worldChunks[0]?.mapCells ?? cellsForSlots(match.maxSlots);
  const obstacles = state.worldChunks.flatMap(chunk =>
    Array.from(chunk.terrain).flatMap((kind, index) => {
      const x = chunk.chunkX * 16 + index % 16;
      const y = chunk.chunkY * 16 + Math.floor(index / 16);
      if (kind === 0 || x >= cells || y >= cells) return [];
      return [{ x, y, kind }];
    })
  );
  const jumpToCell = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(0, Math.min(cells, (event.clientX - bounds.left) / bounds.width * cells));
    const y = Math.max(0, Math.min(cells, (event.clientY - bounds.top) / bounds.height * cells));
    window.dispatchEvent(new CustomEvent(FOCUS_MAP_CELL_EVENT, { detail: { x, y } }));
  };

  return (
    <aside className="pointer-events-auto absolute right-3 top-20 w-40 rounded-lg border border-slate-700 bg-slate-950/90 p-2 text-slate-200 shadow-xl backdrop-blur-sm sm:right-4 sm:w-48">
      <div className="mb-1 flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-400">
        <span>Strategic Minimap</span>
        <span className="font-mono text-slate-400">{cells}×{cells}</span>
      </div>
      <button
        type="button"
        onClick={jumpToCell}
        className="block aspect-square w-full overflow-hidden rounded border border-slate-700 bg-[#06131f] focus-visible:outline-2 focus-visible:outline-sky-400"
        title="Click to pan the camera"
        aria-label="Full Gemini battlefield minimap. Click to pan the camera."
      >
        <svg viewBox={`0 0 ${cells} ${cells}`} className="h-full w-full" aria-hidden="true">
          <rect x="0" y="0" width={cells} height={cells} fill="#06131f" />
          {obstacles.map(cell => (
            <rect key={`terrain-${cell.x}-${cell.y}`} x={cell.x} y={cell.y}
              width="1" height="1"
              fill={cell.kind === 1 ? "#145374" : cell.kind === 2 ? "#475569" : "#9a3412"}
              opacity={cell.kind === 1 ? 0.4 : 1} />
          ))}
          {state.salvageNodes.filter(node => node.remaining > 0).map(node => (
            <rect key={`node-${node.id}`} x={node.gridX - 0.55} y={node.gridY - 0.55}
              width="1.1" height="1.1" fill={node.contested ? "#f97316" : "#eab308"} />
          ))}
          {state.battleStructures.map(st => (
            <rect key={`structure-${st.id}`} x={st.gridX} y={st.gridY}
              width={st.width} height={st.height} fill={geminiFactionColor(st.ownerSlot)}
              opacity={st.complete ? 1 : 0.5} />
          ))}
          {state.battleShips.map(ship => (
            <g key={`ship-${ship.id}`}>
              <circle cx={ship.x} cy={ship.y} r="1.0" fill="#fff" />
              <rect x={ship.x - 0.65} y={ship.y - 0.65} width="1.3" height="1.3"
                fill={geminiFactionColor(ship.ownerSlot)} />
            </g>
          ))}
        </svg>
      </button>
      <div className="mt-1 text-[10px] text-slate-400">
        {state.worldChunks.length ? "Full known world · click to navigate" : "Loading world from server…"}
      </div>
    </aside>
  );
}
