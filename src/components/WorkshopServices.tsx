import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import type { Structure } from "@/module_bindings/types";
import { structureDefinition } from "../../spacetimedb/src/sim/construction";
import { shipDefinition } from "../../spacetimedb/src/sim/economy";
import {
  calculateRepair, maximumStructureHp, withinWorkshopRange,
  workshopTier,
} from "../../spacetimedb/src/sim/workshop";
import {
  NO_SHIP_REFITS, refitMaximumShipHp,
} from "../../spacetimedb/src/sim/ship-refits";

type ServiceTarget = {
  id: bigint; type: "ship" | "structure"; name: string;
  hp: number; maxHp: number; restoredHp: number; ironCost: number;
};

/**
 * Reuses the real Workshop repair reducers. Nothing is repaired on the
 * client: requested HP is only a ceiling; the server recomputes the price,
 * range, tier, ownership and real missing health in one transaction.
 */
export function WorkshopServices({
  state, workshop, pending, perform,
}: {
  state: SpacetimeClientState;
  workshop: Structure;
  pending: boolean;
  perform: (action: () => Promise<void>) => Promise<void>;
}) {
  const center = {
    x: workshop.gridX + workshop.width / 2,
    y: workshop.gridY + workshop.height / 2,
  };
  const serviceRule = workshopTier(workshop.level);
  const online = workshop.complete && workshop.connected &&
    workshop.hp > 0 && workshop.upgradeRemainingUs === 0n;
  const serviceTargets: ServiceTarget[] = [];
  for (const ship of state.myShips) {
    const definition = shipDefinition(ship.kind);
    if (!definition || ship.hp <= 0 ||
        !withinWorkshopRange(center, { x: ship.x, y: ship.y }, workshop.level)) continue;
    const fitted = state.shipRefits.find(row => row.shipId === ship.id);
    const maxHp = refitMaximumShipHp(definition.hp, fitted ?? NO_SHIP_REFITS);
    if (ship.hp >= maxHp) continue;
    const repair = calculateRepair(ship.hp, maxHp, maxHp - ship.hp, workshop.level);
    serviceTargets.push({
      id: ship.id, type: "ship", name: ship.kind,
      hp: ship.hp, maxHp, restoredHp: repair.restoredHp,
      ironCost: repair.salvageCost,
    });
  }
  for (const structure of state.myStructures) {
    const definition = structureDefinition(structure.kind);
    if (!definition || structure.hp <= 0 || !structure.complete ||
        !structure.connected ||
        !withinWorkshopRange(center, {
          x: structure.gridX + structure.width / 2,
          y: structure.gridY + structure.height / 2,
        }, workshop.level)) continue;
    const maxHp = maximumStructureHp(definition.hp, structure.level, structure.kind);
    if (structure.hp >= maxHp) continue;
    const repair = calculateRepair(structure.hp, maxHp, maxHp - structure.hp, workshop.level);
    serviceTargets.push({
      id: structure.id, type: "structure", name: structure.kind,
      hp: structure.hp, maxHp, restoredHp: repair.restoredHp,
      ironCost: repair.salvageCost,
    });
  }
  serviceTargets.sort((a, b) =>
    a.hp / a.maxHp - b.hp / b.maxHp ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const iron = state.myFaction?.salvage ?? 0;

  return (
    <div className="space-y-1.5 border-t border-slate-700/60 pt-2 text-[11px]">
      <div className="flex items-center gap-1 font-semibold text-sky-200">
        <Wrench className="size-3" /> Repair Dock · radius {serviceRule.radiusCells} cells
      </div>
      <p className="text-slate-400">
        Manual, server-authoritative repairs. Tier {workshop.level} restores up to
        {" "}{serviceRule.maxRepairHp} HP per order, for
        {" "}{serviceRule.hpPerSalvage} HP per Iron.
        Repairing stops while this Workshop is upgrading or disconnected.
      </p>
      {!serviceTargets.length ? (
        <p className="text-emerald-300">No damaged allied ships or structures within range.</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {serviceTargets.map(target => (
            <div key={`${target.type}-${target.id}`}
              className="flex flex-wrap items-center justify-between gap-1 rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5">
              <div>
                <div className="font-medium">{target.name} · {target.type}</div>
                <div className="text-slate-400">
                  {target.hp}/{target.maxHp} HP
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-8 border-slate-700 text-[10px]"
                disabled={!online || pending || iron < target.ironCost}
                onClick={() => void perform(() =>
                  target.type === "ship"
                    ? spacetimeClient.repairShip(workshop.id, target.id, target.restoredHp)
                    : spacetimeClient.repairStructure(workshop.id, target.id, target.restoredHp)
                )}>
                Repair +{target.restoredHp} · {target.ironCost} Iron
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
