import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { FOCUS_MAP_CELL_EVENT } from "@/game/SeaScene";
import { geminiFactionColor } from "@/game/art/GeminiPixelArt";
import type { SpacetimeClientState } from "@/network/spacetime-client";
import { cellsForSlots } from "../../spacetimedb/src/sim/worldgen";
import { RESOURCE_TYPES, type AdvancedResourceKind } from "../../spacetimedb/src/sim/materials";

interface TacticalOverviewProps { state: SpacetimeClientState }

/** Gemini's 168px minimap: actual known terrain, salvage and *all* fleets. */
export function TacticalOverview({ state }: TacticalOverviewProps) {
  const match = state.activeMatch;
  if (!match) return null;
  const cells = state.worldChunks[0]?.mapCells ?? cellsForSlots(match.maxSlots);
  const [focusCell, setFocusCell] = useState({ x: cells / 2, y: cells / 2 });
  const panTo = (x: number, y: number) => {
    const target = {
      x: Math.max(0, Math.min(cells, x)),
      y: Math.max(0, Math.min(cells, y)),
    };
    setFocusCell(target);
    window.dispatchEvent(new CustomEvent(FOCUS_MAP_CELL_EVENT, { detail: target }));
  };
  const panWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = Math.max(1, Math.round(cells / 12)) * (event.shiftKey ? 3 : 1);
    let x = focusCell.x;
    let y = focusCell.y;
    switch (event.key) {
      case "ArrowLeft": x -= step; break;
      case "ArrowRight": x += step; break;
      case "ArrowUp": y -= step; break;
      case "ArrowDown": y += step; break;
      case "Home": x = cells / 2; y = cells / 2; break;
      default: return;
    }
    event.preventDefault();
    panTo(x, y);
  };
  const obstacles = state.worldChunks.flatMap(chunk =>
    Array.from(chunk.terrain).flatMap((kind, index) => {
      const x = chunk.chunkX * 16 + index % 16;
      const y = chunk.chunkY * 16 + Math.floor(index / 16);
      if (kind === 0 || x >= cells || y >= cells) return [];
      return [{ x, y, kind }];
    })
  );
  const jumpToCell = (event: MouseEvent<HTMLButtonElement>) => {
    // Keyboard / assistive-technology clicks lack pointer coordinates; use
    // the last navigated focus point instead of accidentally jumping to (0,0).
    if (event.detail === 0) {
      panTo(focusCell.x, focusCell.y);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) / bounds.width * cells;
    const y = (event.clientY - bounds.top) / bounds.height * cells;
    panTo(x, y);
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
        onKeyDown={panWithKeyboard}
        aria-describedby="minimap-keyboard-guide"
        className="block aspect-square w-full overflow-hidden rounded border border-slate-700 bg-[#06131f] focus-visible:outline-2 focus-visible:outline-sky-400"
        title="Click to pan the camera"
        aria-label="Strategic minimap. Arrow keys pan; Shift plus arrows pans faster; Home centers; Enter navigates."
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
          {state.materialDeposits.map(node => (
            <g key={`material-${node.id}`}>
              <circle cx={node.gridX + 0.5} cy={node.gridY + 0.5}
                r="1.1"
                stroke={RESOURCE_TYPES[node.kind as AdvancedResourceKind]?.color ?? "#f8fafc"}
                strokeWidth="0.35"
                fill={node.remaining > 0
                  ? RESOURCE_TYPES[node.kind as AdvancedResourceKind]?.color ?? "#f8fafc"
                  : "#334155"} />
            </g>
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
          <circle cx={focusCell.x} cy={focusCell.y} r="2.4"
            fill="none" stroke="#e2e8f0" strokeWidth="0.65" />
        </svg>
      </button>
      <div id="minimap-keyboard-guide" className="mt-1 text-[10px] text-slate-300">
        {state.worldChunks.length
          ? "Click to jump · focus and use arrows to pan"
          : "Loading world from server…"}
      </div>
    </aside>
  );
}
