import {
  ECONOMY_RULES, shipDefinition, inRange,
} from "./economy.ts";
import {
  ADVANCED_RESOURCE_KINDS, type AdvancedResourceKind,
} from "./materials.ts";
import type { FactionCapability, CommandResult } from "./command-dispatch.ts";

export type MaterialShip = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; kind: string;
  hp: number; x: number; y: number; revision: bigint;
}>;
export type MaterialNode = Readonly<{
  id: bigint; matchId: bigint; kind: string;
  gridX: number; gridY: number; remaining: number;
}>;
export type MaterialHarvestPorts = Readonly<{
  clearRoute(shipId: bigint): void;
  clearIronHarvest(shipId: bigint): void;
  clearAttack(shipId: bigint): void;
  upsertMaterial(order: Readonly<{
    shipId: bigint; matchId: bigint; nodeId: bigint; assignedAtUs: bigint;
  }>): void;
  stopShip(shipId: bigint, revision: bigint): void;
}>;

/**
 * Same one-hull, one-material-order transaction for humans and Bots.
 * Callers must use an authoritative match snapshot for LOS and pass a
 * validated faction capability. No resource credits happen here: income is
 * exclusively processed by the existing economy tick.
 */
export function dispatchMaterialHarvest(
  params: Readonly<{
    faction: FactionCapability;
    ship: MaterialShip | null;
    node: MaterialNode | null;
    nowUs: bigint;
    lineOfSight: boolean;
  }>,
  ports: MaterialHarvestPorts,
): CommandResult {
  const { faction, ship, node, nowUs } = params;
  const fail = (reason: string): CommandResult => ({ ok: false, reason });
  if (faction.eliminated || nowUs < 0n || !ship ||
      ship.matchId !== faction.matchId || ship.ownerSlot !== faction.slot ||
      ship.hp <= 0) return fail("Ship unavailable to faction");
  const spec = shipDefinition(ship.kind);
  if (!spec || spec.harvestPerSecond <= 0)
    return fail("Ship cannot harvest materials");
  if (!node || node.matchId !== faction.matchId || node.remaining <= 0 ||
      !ADVANCED_RESOURCE_KINDS.includes(node.kind as AdvancedResourceKind))
    return fail("Material deposit unavailable");
  if (!inRange({ x: ship.x, y: ship.y },
      { x: node.gridX + 0.5, y: node.gridY + 0.5 },
      ECONOMY_RULES.harvestRangeCells)) return fail("Material deposit out of range");
  if (!params.lineOfSight) return fail("Terrain blocks the material deposit");
  const revision = ship.revision + 1n;
  ports.upsertMaterial({
    shipId: ship.id, matchId: faction.matchId,
    nodeId: node.id, assignedAtUs: nowUs,
  });
  ports.clearIronHarvest(ship.id);
  ports.clearRoute(ship.id);
  ports.clearAttack(ship.id);
  ports.stopShip(ship.id, revision);
  return { ok: true };
}
