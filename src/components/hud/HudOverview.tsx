import { Radio, Ship, Waves } from "lucide-react";
import { MaterialInventory } from "@/components/MaterialInventory";
import type { HudSummary } from "./hud-view-model";

const counts = [
  { key: "fleetCount", label: "Fleet", icon: Ship },
  { key: "structureCount", label: "Structures", icon: Waves },
  { key: "enemyAssetCount", label: "Enemy assets", icon: Radio },
] as const;

/** A persistent, display-only glance at the current authorized match. */
export function HudOverview({ summary, selectionLabel }: { summary: HudSummary; selectionLabel?: string }) {
  return (
    <div role="group" aria-label="Match overview" className="sea-hud-overview min-w-0">
      {!summary.connected && (
        <div role="status" className="px-2 pb-1 text-[11px] text-amber-200">
          Waiting for match data
        </div>
      )}
      <MaterialInventory summary={summary} />
      <div className="sea-hud-counts grid grid-cols-3 gap-1.5" aria-label="Match asset counts">
        {selectionLabel && selectionLabel !== "No selection" && (
          <div data-hud-selection="true" role="status"
            className="sea-hud-selection col-span-3 truncate px-1 font-mono text-[11px] font-bold text-cyan-200">
            {selectionLabel}
          </div>
        )}
        {counts.map(({ key, label, icon: Icon }) => {
          const count = summary[key];
          return (
            <div key={key} className="sea-hud-count min-w-0"
              aria-label={`${label}: ${count === null ? "Unavailable" : count.toLocaleString("en-US")}`}>
              <div className="flex min-w-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                <Icon className="size-3 shrink-0 text-cyan-300" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </div>
              <div data-hud-count={count ?? "unknown"} className="font-mono text-sm font-bold tabular-nums text-slate-50">
                {count === null ? "—" : count.toLocaleString("en-US")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
