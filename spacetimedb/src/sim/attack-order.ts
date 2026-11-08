/**
 * Pure authoritative Attack Target planning plus the shared order dispatcher.
 *
 * A single persistent row replaces per-frame client `fireWeapon` calls: the
 * combat scheduler re-reads the live target, closes to weapon range when
 * necessary, aims through the existing turret rules, and fires through the
 * existing `dispatchFire` validator. No damage, range, cooldown, ownership or
 * line-of-sight rule is duplicated or bypassed here.
 */
import { desiredBearing } from "./turret-aim.ts";
import { weaponDefinition } from "./combat.ts";
import type { CommandResult, FactionCapability } from "./command-dispatch.ts";

export const ATTACK_RULES = {
  /** One chase re-path per ship per 600ms keeps A* out of the 10Hz tick. */
  chaseRepathUs: 600_000n,
  /** Stop this fraction of weapon range away from the live target center. */
  approachFractions: [0.8, 0.65, 0.5, 0.35] as const,
  /** When in range but terrain blocks the shot, close further along the line. */
  blockedMarkFractions: [0.55, 0.35, 0.2] as const,
  /** Max distance considered by a player-facing order (sanity bound only). */
  maxTargetDistanceCells: 512,
} as const;

export type AttackPoint = Readonly<{ x: number; y: number }>;

export type AttackableTarget = Readonly<{
  id: bigint;
  matchId: bigint;
  ownerSlot: number;
  type: "ship" | "structure";
  x: number;
  y: number;
  hp: number;
}>;

export type AttackableShip = Readonly<{
  id: bigint;
  matchId: bigint;
  ownerSlot: number;
  kind: string;
  x: number;
  y: number;
  revision: bigint;
}>;

export type AttackPlan =
  | Readonly<{ kind: "cancel"; reason: string }>
  | Readonly<{
      kind: "chase";
      desiredAngleDeg: number;
      destinations: readonly AttackPoint[];
      distance: number;
    }>
  | Readonly<{ kind: "engage"; desiredAngleDeg: number; distance: number }>;

function finitePoint(p: AttackPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function clampToMap(point: AttackPoint, mapCells: number): AttackPoint {
  const min = 0.5;
  const max = mapCells - 0.5;
  return {
    x: Math.min(max, Math.max(min, point.x)),
    y: Math.min(max, Math.max(min, point.y)),
  };
}

/**
 * Approach points along the current ship->target bearing. Keeping the ship on
 * that line makes the turret solution stable while it closes the distance.
 */
export function approachDestinations(
  ship: AttackPoint,
  target: AttackPoint,
  weaponRange: number,
  mapCells: number,
  fractions: readonly number[] = ATTACK_RULES.approachFractions,
): AttackPoint[] {
  if (!finitePoint(ship) || !finitePoint(target) ||
      !Number.isFinite(weaponRange) || weaponRange <= 0 ||
      !Number.isInteger(mapCells) || mapCells < 2) return [];
  const dx = ship.x - target.x;
  const dy = ship.y - target.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return [];
  const ux = dx / distance;
  const uy = dy / distance;
  return fractions.map(fraction => clampToMap({
    x: target.x + ux * weaponRange * fraction,
    y: target.y + uy * weaponRange * fraction,
  }, mapCells));
}

/**
 * Decide the next server action for one attack order. `lineOfSight` is the
 * authoritative terrain check from the ship to the target's live position.
 */
export function planAttackStep(params: Readonly<{
  ship: AttackPoint;
  target: AttackableTarget | null;
  weaponRange: number;
  mapCells: number;
  lineOfSight: boolean;
}>): AttackPlan {
  const { ship, target, weaponRange, mapCells, lineOfSight } = params;
  if (!finitePoint(ship)) return { kind: "cancel", reason: "Invalid vessel position" };
  if (!target || target.hp <= 0) return { kind: "cancel", reason: "Target destroyed or gone" };
  if (!Number.isFinite(weaponRange) || weaponRange <= 0)
    return { kind: "cancel", reason: "Weapon unavailable" };
  if (!Number.isInteger(mapCells) || mapCells < 2)
    return { kind: "cancel", reason: "Invalid world" };
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return { kind: "cancel", reason: "Target overlaps vessel" };
  const bearing = desiredBearing(ship, target);
  if (distance <= weaponRange && lineOfSight)
    return { kind: "engage", desiredAngleDeg: bearing, distance };
  const fractions = distance <= weaponRange
    ? ATTACK_RULES.blockedMarkFractions
    : ATTACK_RULES.approachFractions;
  return {
    kind: "chase", desiredAngleDeg: bearing, distance,
    destinations: approachDestinations(ship, target, weaponRange, mapCells, fractions),
  };
}

export type AttackOrderPorts = Readonly<{
  clearRoute(shipId: bigint): void;
  clearHarvest(shipId: bigint): void;
  upsertOrder(order: Readonly<{
    shipId: bigint; matchId: bigint; targetType: "ship" | "structure";
    targetId: bigint; issuedAtUs: bigint; nextChaseAtUs: bigint;
  }>): void;
  stopShip(shipId: bigint, revision: bigint): void;
  ensureCombatTick(): void;
}>;

/**
 * Shared human/bot order authorization. Only the caller's verified faction
 * capability and current server rows may reach the ports; a client target ID
 * is validated against the authoritative match and ownership here.
 */
export function dispatchAttackOrder(
  params: Readonly<{
    faction: FactionCapability;
    ship: AttackableShip | null;
    target: AttackableTarget | null;
    nowUs: bigint;
    targetObserved?: boolean;
  }>,
  ports: AttackOrderPorts,
): CommandResult {
  const { faction, ship, target, nowUs } = params;
  if (faction.eliminated || !ship || ship.matchId !== faction.matchId ||
      ship.ownerSlot !== faction.slot) return { ok: false, reason: "Ship unavailable to faction" };
  if (!Number.isSafeInteger(faction.slot) || faction.slot < 0)
    return { ok: false, reason: "Invalid faction" };
  if (!weaponDefinition(ship.kind))
    return { ok: false, reason: "Ship has no weapon" };
  if (!target || target.hp <= 0 || target.matchId !== faction.matchId ||
      target.ownerSlot === faction.slot)
    return { ok: false, reason: "Target not visible or unavailable" };
  if (params.targetObserved === false)
    return { ok: false, reason: "Target not visible or unavailable" };
  if (nowUs < 0n) return { ok: false, reason: "Invalid server clock" };
  const distance = Math.hypot(target.x - ship.x, target.y - ship.y);
  if (!Number.isFinite(distance) || distance > ATTACK_RULES.maxTargetDistanceCells)
    return { ok: false, reason: "Target out of tactical range" };
  // Move/Stop/Harvest already delete the row; an explicit Attack also replaces
  // both, so exactly one persistent order exists for the ship.
  ports.clearRoute(ship.id);
  ports.clearHarvest(ship.id);
  ports.upsertOrder({
    shipId: ship.id, matchId: faction.matchId, targetType: target.type,
    targetId: target.id, issuedAtUs: nowUs, nextChaseAtUs: 0n,
  });
  ports.stopShip(ship.id, ship.revision + 1n);
  ports.ensureCombatTick();
  return { ok: true };
}
