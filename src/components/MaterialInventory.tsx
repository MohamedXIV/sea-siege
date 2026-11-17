import { RESOURCE_TYPES, type ResourceKind } from "../../spacetimedb/src/sim/materials";
import type { HudSummary } from "@/components/hud/hud-view-model";

const kinds: readonly ResourceKind[] = ["iron", "oil", "alloy", "isotope"];

/** Only amounts exposed by the authenticated match subscription appear here. */
export function MaterialInventory({ summary }: { summary: HudSummary }) {
  return (
    <section aria-label="Owned material balances" className="sea-hud-resources grid grid-cols-4 gap-1.5">
      {kinds.map(kind => {
        const amount = summary.materials[kind];
        const resource = RESOURCE_TYPES[kind];
        return (
          <div key={kind} className="sea-hud-resource min-w-0" title={resource.name}
            aria-label={`${resource.name}: ${amount === null ? "Unavailable" : amount.toLocaleString("en-US")}`}>
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              <span className="size-2 shrink-0 border border-white/25" style={{ backgroundColor: resource.color }} aria-hidden="true" />
              <span className="truncate">{resource.name}</span>
            </div>
            <div data-resource-amount={amount ?? "unknown"}
              className="mt-0.5 truncate font-mono text-sm font-bold tabular-nums text-slate-50">
              {amount === null ? "—" : amount.toLocaleString("en-US")}
            </div>
          </div>
        );
      })}
    </section>
  );
}
