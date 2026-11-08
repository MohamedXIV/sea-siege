import type { SpacetimeClientState } from "@/network/spacetime-client";
import {
  RESOURCE_TYPES, type ResourceKind, type ResourceWallet,
} from "../../spacetimedb/src/sim/materials";

const kinds: readonly ResourceKind[] = ["iron", "oil", "alloy", "isotope"];

/**
 * Live, owned wallet. Legacy Salvage is deliberately shown as Iron Scrap
 * during migration; other resources come from the new private typed ledger.
 */
export function MaterialInventory({ state }: { state: SpacetimeClientState }) {
  const wallet: ResourceWallet = {
    iron: state.myFaction?.salvage ?? 0,
    oil: state.materialBalances.find(row => row.kind === "oil")?.amount ?? 0,
    alloy: state.materialBalances.find(row => row.kind === "alloy")?.amount ?? 0,
    isotope: state.materialBalances.find(row => row.kind === "isotope")?.amount ?? 0,
  };
  return (
    <div className="grid grid-cols-4 gap-1.5 border-b border-slate-700/60 pb-2.5">
      {kinds.map(kind => (
        <div key={kind} className="min-w-0 rounded border border-slate-800/70 bg-slate-900/50 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: RESOURCE_TYPES[kind].color }} />
            <span className="truncate">{RESOURCE_TYPES[kind].name}</span>
          </div>
          <div className="font-mono text-sm font-bold" style={{ color: RESOURCE_TYPES[kind].color }}>
            {wallet[kind].toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
