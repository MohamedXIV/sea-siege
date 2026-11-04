import { useState } from "react";
import { Button } from "@/components/ui/button";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import type { Ship } from "@/module_bindings/types";
import { withinWorkshopRange } from "../../spacetimedb/src/sim/workshop";
import {
  SHIP_REFIT_RULES, type ShipRefitKind, type ShipRefitState,
  NO_SHIP_REFITS, alreadyInstalled,
} from "../../spacetimedb/src/sim/ship-refits";
import { canAffordResources, type ResourceWallet } from "../../spacetimedb/src/sim/materials";

const kinds: readonly ShipRefitKind[] = ["reinforced_hull", "high_output_engine"];

/** Live, owner-only upgrade buttons. All ownership/prices/HP/speed are rechecked by DB. */
export function ShipRefitPanel({
  state, ship,
}: {
  state: SpacetimeClientState;
  ship: Ship;
}) {
  const [pending, setPending] = useState<ShipRefitKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const installed = state.shipRefits.find(row => row.shipId === ship.id);
  const installedState: ShipRefitState = installed ?? NO_SHIP_REFITS;
  const wallet: ResourceWallet = {
    iron: state.myFaction?.salvage ?? 0,
    oil: state.materialBalances.find(row => row.kind === "oil")?.amount ?? 0,
    alloy: state.materialBalances.find(row => row.kind === "alloy")?.amount ?? 0,
    isotope: state.materialBalances.find(row => row.kind === "isotope")?.amount ?? 0,
  };
  const workshops = state.myStructures.filter(row =>
    row.kind === "workshop" && row.complete && row.connected && row.hp > 0 &&
    row.upgradeRemainingUs === 0n &&
    withinWorkshopRange(
      { x: row.gridX + row.width / 2, y: row.gridY + row.height / 2 },
      { x: ship.x, y: ship.y },
      row.level,
    )
  );
  const workshop = workshops[0];

  const buy = async (kind: ShipRefitKind) => {
    if (!workshop || pending !== null) return;
    setPending(kind);
    setMessage(null);
    try {
      await spacetimeClient.refitShip(workshop.id, ship.id, kind);
      setMessage(`${SHIP_REFIT_RULES[kind].label} requested from Workshop`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Server rejected refit");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-2 border-t border-slate-700/70 pt-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
        Workshop Refits
      </div>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map(kind => {
          const rule = SHIP_REFIT_RULES[kind];
          const equipped = alreadyInstalled(installedState, kind);
          const affordable = canAffordResources(wallet, rule.cost);
          const price = Object.entries(rule.cost)
            .map(([resource, amount]) => `${amount} ${resource}`).join(" + ");
          return (
            <Button key={kind} size="sm" variant="outline"
              disabled={pending !== null || equipped || !workshop || !affordable}
              onClick={() => void buy(kind)}
              className="h-auto min-h-11 flex-col items-start gap-0.5 border-slate-700 px-2 py-1.5 text-left text-[10px]"
            >
              <span className="font-semibold">{rule.label}{equipped ? " ✓" : ""}</span>
              <span className="text-amber-300">{price}</span>
              <span className="text-slate-400">
                {kind === "reinforced_hull" ? "+120 max HP" : "+20% sailing speed"}
              </span>
            </Button>
          );
        })}
      </div>
      {!workshop && (
        <p className="mt-1 text-[10px] text-slate-400">
          Bring the ship to an operational allied Workshop to refit. Stop it before buying.
        </p>
      )}
      {workshop && (
        <p className="mt-1 text-[10px] text-slate-400">
          In Workshop range. Stop the ship before purchasing.
        </p>
      )}
      {message && <p role="status" className="mt-1 text-[10px] text-slate-200">{message}</p>}
    </div>
  );
}
