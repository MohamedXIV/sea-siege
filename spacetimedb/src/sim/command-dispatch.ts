/**
 * Shared authoritative transaction orchestration for humans and server bots.
 * A caller supplies a VERIFIED faction capability from its authentication
 * boundary, plus current rows re-read from the same SpacetimeDB transaction.
 * None of these inputs originate from client-declared ownership or pricing.
 */
import {
  ECONOMY_RULES, shipDefinition, debitSalvage, inRange,
} from "./economy.ts";

export type FactionCapability = Readonly<{
  matchId: bigint; slot: number; controller: "human" | "bot";
  eliminated: boolean;
}>;
export type ShipForHarvest = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; kind: string;
  x: number; y: number; revision: bigint;
}>;
export type HarvestNode = Readonly<{
  id: bigint; matchId: bigint; gridX: number; gridY: number; remaining: number;
}>;
export type ShipyardForProduction = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; kind: string;
  complete: boolean; connected: boolean; hp: number;
}>;
export type CommandResult = Readonly<{ ok: true } | { ok: false; reason: string }>;
const reject = (reason: string): CommandResult => ({ ok: false, reason });
const accepted: CommandResult = { ok: true };

export type HarvestPorts = Readonly<{
  clearRoute(shipId: bigint): void;
  upsertOrder(order: Readonly<{
    shipId: bigint; matchId: bigint; nodeId: bigint; assignedAtUs: bigint;
  }>): void;
  stopForHarvest(shipId: bigint, revision: bigint): void;
}>;

export function dispatchHarvest(
  params: Readonly<{
    faction: FactionCapability; ship: ShipForHarvest | null;
    node: HarvestNode | null; nowUs: bigint; observable: boolean;
  }>,
  ports: HarvestPorts,
): CommandResult {
  const { faction, ship, node, nowUs, observable } = params;
  if (nowUs < 0n || faction.eliminated || !ship ||
      ship.matchId !== faction.matchId || ship.ownerSlot !== faction.slot) {
    return reject("Ship unavailable to faction");
  }
  const spec = shipDefinition(ship.kind);
  if (!spec || spec.harvestPerSecond <= 0) return reject("Ship cannot harvest");
  if (!node || node.matchId !== faction.matchId || node.remaining <= 0 || !observable) {
    return reject("Salvage node unavailable");
  }
  if (!inRange({ x: ship.x, y: ship.y },
      { x: node.gridX + 0.5, y: node.gridY + 0.5 },
      ECONOMY_RULES.harvestRangeCells)) return reject("Salvage node out of range");

  // The same route cancellation, single-target upsert, and revision advance
  // apply to either controller. Ports are bound to the current DB transaction.
  ports.clearRoute(ship.id);
  ports.upsertOrder({
    shipId: ship.id, matchId: faction.matchId, nodeId: node.id, assignedAtUs: nowUs,
  });
  ports.stopForHarvest(ship.id, ship.revision + 1n);
  return accepted;
}

export type ProductionPorts = Readonly<{
  setBalance(nextBalance: number): void;
  enqueue(order: Readonly<{
    matchId: bigint; yardId: bigint; ownerSlot: number;
    shipKind: string; remainingUs: bigint;
    queuedAtUs: bigint; startedAtUs: bigint;
  }>): void;
}>;

export function dispatchProduction(
  params: Readonly<{
    faction: FactionCapability; yard: ShipyardForProduction | null;
    kind: string; salvage: number; queued: number;
    queueCap?: number; nowUs: bigint;
  }>,
  ports: ProductionPorts,
): CommandResult {
  const { faction, yard, kind, salvage, queued, nowUs } = params;
  if (faction.eliminated || !yard || yard.matchId !== faction.matchId ||
      yard.ownerSlot !== faction.slot || yard.kind !== "shipyard") {
    return reject("Shipyard unavailable to faction");
  }
  if (!yard.complete || !yard.connected || yard.hp <= 0)
    return reject("Shipyard offline");
  const spec = shipDefinition(kind);
  if (!spec) return reject("Unknown ship kind");
  const cap = params.queueCap ?? ECONOMY_RULES.shipyardQueueLimit;
  if (!Number.isSafeInteger(cap) || cap < 1 ||
      cap > ECONOMY_RULES.shipyardQueueLimit ||
      !Number.isSafeInteger(queued) || queued < 0 || queued >= cap)
    return reject("Shipyard queue full");
  if (nowUs < 0n) return reject("Invalid server clock");
  // Validate the debit BEFORE any side effect: an invalid proposal cannot
  // charge salvage or enqueue a free ship.
  if (!Number.isSafeInteger(salvage) || salvage < spec.cost ||
      salvage > ECONOMY_RULES.maxSalvage) return reject("Insufficient salvage");
  const nextBalance = debitSalvage(salvage, spec.cost);
  ports.setBalance(nextBalance);
  ports.enqueue({
    matchId: faction.matchId, yardId: yard.id, ownerSlot: faction.slot,
    shipKind: kind, remainingUs: BigInt(spec.buildMs) * 1_000n,
    queuedAtUs: nowUs, startedAtUs: 0n,
  });
  return accepted;
}
