import type { MouseEvent } from "react";
import { FOCUS_MAP_CELL_EVENT } from "@/game/SeaScene";
import type { SpacetimeClientState } from "@/network/spacetime-client";
import { cellsForSlots } from "../../spacetimedb/src/sim/worldgen";

interface TacticalOverviewProps {
  state: SpacetimeClientState;
}

/**
 * Small open-world navigation map using actual authorized match entities.
 * Terrain and salvage artwork will be supplied by the next world projection
 * slice. This deliberately does not generate a fake client-side world.
 */
export function TacticalOverview({ state }: TacticalOverviewProps) {
  const match = state.activeMatch;
  if (!match) return null;
  const cells = cellsForSlots(match.maxSlots);
  const guidePositions = [0.25, 0.5, 0.75].map(fraction => fraction * cells);

  const jumpToCell = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(0, Math.min(cells, (event.clientX - bounds.left) / bounds.width * cells));
    const y = Math.max(0, Math.min(cells, (event.clientY - bounds.top) / bounds.height * cells));
    window.dispatchEvent(new CustomEvent(FOCUS_MAP_CELL_EVENT, { detail: { x, y } }));
  };

  return (
    <aside className="pointer-events-auto absolute right-3 top-20 w-40 rounded-lg border border-cyan-900/80 bg-slate-950/90 p-2 text-slate-200 shadow-xl backdrop-blur-md sm:right-4 sm:w-48">
      <div className="mb-1 flex items-center justify-between gap-1 text-[10px] uppercase tracking-wide">
        <span className="font-bold text-cyan-300">Battlefield overview</span>
        <span className="font-mono text-slate-500">{cells}²</span>
      </div>
      <button
        type="button"
        onClick={jumpToCell}
        className="block aspect-square w-full overflow-hidden rounded border border-slate-700 bg-[#061521] focus-visible:outline-2 focus-visible:outline-cyan-400"
        title="Click anywhere to move the camera to that location"
        aria-label="Open battlefield overview. Click to focus the Phaser camera."
      >
        <svg
          viewBox={`0 0 ${cells} ${cells}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          aria-hidden="true"
        >
          <rect x="0" y="0" width={cells} height={cells} fill="#071520" />
          {guidePositions.map(position => (
            <g key={position} stroke="#1a3848" strokeWidth=".22">
              <line x1={position} y1="0" x2={position} y2={cells} />
              <line x1="0" y1={position} x2={cells} y2={position} />
            </g>
          ))}
          {state.myStructures.map(st => (
            <rect
              key={`own-structure-${st.id}`}
              x={st.gridX} y={st.gridY}
              width={st.width} height={st.height}
              fill={st.kind === "command_core" ? "#22d3ee" : "#0e7490"}
              opacity=".88"
            />
          ))}
          {state.visibleEnemies.map(contact =>
            contact.entityType === "ship" ? (
              <circle
                key={contact.contactKey}
                cx={contact.x} cy={contact.y}
                r=".85" fill="#f87171" stroke="#fca5a5" strokeWidth=".25"
              />
            ) : (
              <rect
                key={contact.contactKey}
                x={contact.x - .65} y={contact.y - .65}
                width="1.3" height="1.3" fill="#ef4444"
              />
            )
          )}
          {state.myShips.map(ship => (
            <circle
              key={`own-ship-${ship.id}`}
              cx={ship.x} cy={ship.y}
              r=".85" fill="#67e8f9" stroke="#ecfeff" strokeWidth=".3"
            />
          ))}
        </svg>
      </button>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span><span className="text-cyan-300">●</span> Yours</span>
        <span><span className="text-rose-400">●</span> Enemy</span>
      </div>
      <div className="mt-1 text-[9px] text-slate-500">
        Terrain and salvage map rendering next
      </div>
    </aside>
  );
}
