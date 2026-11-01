/** Shared authoritative weapon decision + mutation order for humans and bots. */
import { COMBAT_RULES, canFire, createProjectile, terrainLineOfSight,
  weaponDefinition, withinRange, type WeaponKind } from "./combat.ts";
import { desiredBearing, normalizeBearing, turretAligned } from "./turret-aim.ts";
import type { CommandResult, FactionCapability } from "./command-dispatch.ts";

export type WeaponSource = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; kind: string;
  type: "ship" | "structure"; x: number; y: number;
  hp: number; complete: boolean; connected: boolean;
  turretAngleDeg: number; lastFiredAtUs: bigint;
}>;
export type TargetContact = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number;
  type: "ship" | "structure"; x: number; y: number; hp: number;
}>;
const deny = (reason: string): CommandResult => ({ ok: false, reason });

export type AimPorts = Readonly<{
  clearAim(type: WeaponSource["type"], id: bigint): void;
  upsertAim(type: WeaponSource["type"], id: bigint, angle: number): void;
  ensureCombatTick(): void;
}>;

export function dispatchAim(
  params: Readonly<{ faction: FactionCapability; source: WeaponSource | null;
    desiredAngleDeg: number }>, ports: AimPorts,
): CommandResult {
  const { faction, source, desiredAngleDeg } = params;
  if (!source || faction.eliminated || source.matchId !== faction.matchId ||
      source.ownerSlot !== faction.slot) return deny("Weapon unavailable");
  if (source.type === "structure" && source.kind !== "cannon")
    return deny("Weapon unavailable");
  if (source.hp <= 0 || (source.type === "structure" &&
      (!source.complete || !source.connected)) || !weaponDefinition(source.kind))
    return deny("Weapon offline");
  if (!Number.isFinite(desiredAngleDeg) || desiredAngleDeg < 0 || desiredAngleDeg >= 360)
    return deny("Invalid aim bearing");
  const angle = normalizeBearing(desiredAngleDeg);
  if (turretAligned(source.turretAngleDeg,angle,0)) {
    ports.clearAim(source.type,source.id);
  } else {
    ports.upsertAim(source.type,source.id,angle);
    ports.ensureCombatTick();
  }
  return { ok: true };
}
export type FirePorts = Readonly<{
  markFired(source: WeaponSource, atUs: bigint): void;
  insertProjectile(shot: Readonly<{
    matchId: bigint; sourceFaction: number; sourceId: bigint;
    sourceType: "ship" | "structure"; firedAtUs: bigint;
    x: number; y: number; vx: number; vy: number;
    damage: number; splash: number; structureMultiplier: number;
    remainingRange: number;
  }>): void;
  ensureCombatTick(): void;
}>;

export function dispatchFire(
  params: Readonly<{
    faction: FactionCapability; source: WeaponSource | null;
    target: TargetContact | null; nowUs: bigint; terrain: Uint8Array;
    mapCells: number; targetVisible: boolean; projectileCount: number;
  }>,
  ports: FirePorts,
): CommandResult {
  const { faction, source, target, nowUs, terrain, mapCells } = params;
  if (!source || faction.eliminated || source.matchId !== faction.matchId ||
      source.ownerSlot !== faction.slot) return deny("Weapon unavailable");
  if (source.type === "structure" && source.kind !== "cannon")
    return deny("Weapon unavailable");
  const weapon = weaponDefinition(source.kind);
  if (!weapon || source.hp <= 0 || (source.type === "structure" &&
      (!source.complete || !source.connected))) return deny("Weapon offline");
  if (!target || target.matchId !== faction.matchId ||
      target.ownerSlot === faction.slot || target.hp <= 0 || !params.targetVisible)
    return deny("Target not visible or unavailable");
  if (nowUs < 0n || (source.lastFiredAtUs !== -1n &&
      !canFire(nowUs,source.lastFiredAtUs,weapon.cooldownMs)))
    return deny("Weapon cooldown");
  if (!Number.isSafeInteger(params.projectileCount) || params.projectileCount < 0 ||
      params.projectileCount >= COMBAT_RULES.maxProjectilesPerMatch)
    return deny("Match projectile cap");
  const origin = { x: source.x, y: source.y };
  const destination = { x: target.x, y: target.y };
  if (!withinRange(origin,destination,weapon.range) ||
      !withinRange(origin,destination,weapon.vision) ||
      !terrainLineOfSight(origin,destination,terrain,mapCells))
    return deny("Target not visible or unavailable");
  if (!turretAligned(source.turretAngleDeg,desiredBearing(origin,destination)))
    return deny("Weapon not aligned");
  const shot = createProjectile(origin,destination,source.kind as WeaponKind,faction.slot);
  ports.markFired(source,nowUs);
  ports.insertProjectile({
    matchId: faction.matchId, sourceId: source.id,
    sourceType: source.type, firedAtUs: nowUs, ...shot,
  });
  ports.ensureCombatTick();
  return { ok: true };
}
