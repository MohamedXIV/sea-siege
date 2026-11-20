import type { SpacetimeClientState } from "@/network/spacetime-client";
import {
  RESOURCE_TYPES,
  type ResourceKind,
  type ResourceWallet,
} from "../../spacetimedb/src/sim/materials";

const kinds: readonly ResourceKind[] = ["iron", "oil", "alloy", "isotope"];

function ResourceIcon({ kind, color }: { kind: ResourceKind; color: string }) {
  if (kind === "iron") {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
        <path
          d="M4 7h16v3H4V7zm3 3h10v4H7v-4zm-3 4h16v3H4v-3z"
          fill={color}
          stroke="#0a1218"
          strokeWidth="1.2"
        />
      </svg>
    );
  }
  if (kind === "oil") {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
        <rect
          x="6"
          y="4"
          width="12"
          height="16"
          rx="2"
          fill="#26323d"
          stroke={color}
          strokeWidth="1.6"
        />
        <line x1="6" y1="9" x2="18" y2="9" stroke={color} strokeWidth="1.4" />
        <line x1="6" y1="15" x2="18" y2="15" stroke={color} strokeWidth="1.4" />
        <circle cx="12" cy="12" r="2" fill={color} />
      </svg>
    );
  }
  if (kind === "alloy") {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
        <polygon
          points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"
          fill="#22323d"
          stroke={color}
          strokeWidth="1.6"
        />
        <polygon points="12,7 16,9.5 16,14.5 12,17 8,14.5 8,9.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <rect x="6" y="4" width="3" height="16" rx="1" fill={color} />
      <rect x="10.5" y="4" width="3" height="16" rx="1" fill={color} />
      <rect x="15" y="4" width="3" height="16" rx="1" fill={color} />
      <rect x="4" y="16" width="16" height="3" rx="1" fill="#3a4a57" />
    </svg>
  );
}

/**
 * Live, owned wallet styled as the top-right Industrial Material Inventory panel.
 * Legacy Salvage is shown as Iron Scrap during migration; other resources come from the private typed ledger.
 */
export function MaterialInventory({ state }: { state: SpacetimeClientState }) {
  const wallet: ResourceWallet = {
    iron: state.myFaction?.salvage ?? 0,
    oil: state.materialBalances.find((row) => row.kind === "oil")?.amount ?? 0,
    alloy: state.materialBalances.find((row) => row.kind === "alloy")?.amount ?? 0,
    isotope: state.materialBalances.find((row) => row.kind === "isotope")?.amount ?? 0,
  };

  return (
    <section
      aria-label="Material Inventory"
      className="pointer-events-auto flex flex-col items-end"
    >
      <div className="hud-plate-header mx-auto px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/90">
        Material Inventory
      </div>
      <div className="hud-panel grid grid-cols-4 gap-1.5 px-2 py-1.5">
        {kinds.map((kind) => (
          <div
            key={kind}
            title={RESOURCE_TYPES[kind].name}
            className="hud-inset flex min-w-[56px] flex-col items-center justify-center px-2 py-1"
          >
            <div className="flex items-center gap-1">
              <ResourceIcon kind={kind} color={RESOURCE_TYPES[kind].color} />
              <span className="hidden text-[9px] font-semibold uppercase tracking-wider text-slate-400 md:inline">
                {kind}
              </span>
            </div>
            <div
              className="mt-0.5 font-mono text-xs font-extrabold tabular-nums sm:text-sm"
              style={{ color: RESOURCE_TYPES[kind].color }}
            >
              {wallet[kind].toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
