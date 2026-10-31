/** Shared server transaction orchestration for movement and construction. */
import { findTerrainPath } from "./navigation.ts";
import { isNavigationCellBlocked, type CollisionEnvironment } from "./collision.ts";
import { structureDefinition, validateStructurePlacement, type BuildRequest, type StructureKind } from "./construction.ts";
import { debitSalvage } from "./economy.ts";
import type { FactionCapability, CommandResult } from "./command-dispatch.ts";

type Point = Readonly<{ x: number; y: number }>;
type MovingShip = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; radiusCells: number;
  x: number; y: number; revision: bigint; velocityX: number; velocityY: number;
}>;
export type MovePorts = Readonly<{
  cancelHarvest(shipId: bigint): void;
  setRoute(order: Readonly<{
    shipId: bigint; matchId: bigint; cellPath: readonly number[];
    revision: bigint; repathAfterUs: bigint;
  }> | null): void;
  updateShip(order: Readonly<{
    shipId: bigint; targetX: number; targetY: number;
    revision: bigint; stopImmediately: boolean;
  }>): void;
  ensureMotionTick(): void;
}>;
const deny = (reason: string): CommandResult => ({ ok: false, reason });

export function dispatchMovement(
  params: Readonly<{
    faction: FactionCapability; ship: MovingShip | null; destination: Point;
    environment: CollisionEnvironment; destinationVisible: boolean;
  }>,
  ports: MovePorts,
): CommandResult {
  const { faction, ship, destination, environment } = params;
  if (faction.eliminated || !ship || ship.matchId !== faction.matchId ||
      ship.ownerSlot !== faction.slot) return deny("Ship unavailable to faction");
  if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y) ||
      destination.x < 0 || destination.y < 0 ||
      destination.x >= environment.mapCells || destination.y >= environment.mapCells)
    return deny("Destination out of bounds");
  if (!params.destinationVisible) return deny("Destination not observed");
  const path = findTerrainPath(environment.terrain, environment.mapCells,
    { x: ship.x, y: ship.y }, destination, {
      blocked: (x,y) => isNavigationCellBlocked(x,y,ship.radiusCells,environment,ship.id),
    });
  if (!path) return deny("Destination unreachable");
  const cellPath = path.waypoints.slice(1).map(point =>
    Math.floor(point.y) * environment.mapCells + Math.floor(point.x));
  const revision = ship.revision + 1n;
  ports.cancelHarvest(ship.id);
  ports.setRoute(cellPath.length ? {
    shipId: ship.id, matchId: ship.matchId, cellPath,
    revision, repathAfterUs: 0n,
  } : null);
  ports.updateShip({
    shipId: ship.id, targetX: Math.floor(destination.x) + 0.5,
    targetY: Math.floor(destination.y) + 0.5,
    revision, stopImmediately: cellPath.length === 0,
  });
  if (cellPath.length) ports.ensureMotionTick();
  return { ok: true };
}

export type BuildPorts = Readonly<{
  setBalance(salvage: number): void;
  insertStructure(row: Readonly<{
    matchId: bigint; ownerSlot: number; kind: StructureKind;
    channel: "surface" | "superstructure";
    gridX: number; gridY: number; width: number; height: number;
    hp: number; completeAtUs: bigint; connected: boolean;
  }>): bigint;
  scheduleCompletion(structureId: bigint, dueAtUs: bigint): void;
}>;

/** Never debit before the same support/footprint validation as human building. */
export function dispatchConstruction(
  params: Readonly<{
    faction: FactionCapability; request: BuildRequest;
    nowUs: bigint; locationAllowed: boolean;
  }>,
  ports: BuildPorts,
): CommandResult {
  const { faction, request, nowUs } = params;
  if (faction.eliminated || faction.slot !== request.ownerSlot ||
      nowUs < 0n) return deny("Faction cannot build");
  if (!params.locationAllowed) return deny("Construction location unavailable");
  const definition = structureDefinition(request.kind);
  if (!definition || request.kind === "command_core") return deny("Protected structure kind");
  const error = validateStructurePlacement(request);
  if (error) return deny(error);
  const dueAtUs = nowUs + BigInt(definition.buildMs) * 1_000n;
  const salvage = debitSalvage(request.salvage,definition.cost);
  ports.setBalance(salvage);
  const id = ports.insertStructure({
    matchId: faction.matchId, ownerSlot: faction.slot, kind: request.kind,
    channel: definition.channel, gridX: request.gridX, gridY: request.gridY,
    width: definition.width, height: definition.height,
    hp: definition.hp, connected: definition.channel === "superstructure",
    completeAtUs: dueAtUs,
  });
  ports.scheduleCompletion(id,dueAtUs);
  return { ok: true };
}
