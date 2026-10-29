import { ScheduleAt } from "spacetimedb";
import { t } from "spacetimedb/server";
import spacetimedb, { combatSchedule } from "./schema.ts";
import { decodeTerrainChunks } from "./sim/navigation.ts";
import { structureOnline, type StructureKind } from "./sim/construction.ts";
import { boundedDeltaSeconds } from "./sim/ship-motion.ts";
import {
  COMBAT_RULES, advanceProjectile, canFire, createProjectile, terrainLineOfSight,
  weaponDefinition, withinRange, type CombatBody, type StructureCombatBody,
  type ShipCombatBody, type WeaponKind,
} from "./sim/combat.ts";

/** Build one match-scoped server-owned collision snapshot, never a client collection. */
function combatBodies(ctx: any, matchId: bigint): CombatBody[] {
  const members = Array.from(ctx.db.matchMember.matchId.filter(matchId)) as any[];
  const byIdentity = (identity: any): number | undefined =>
    members.find(row => row.identity.isEqual(identity))?.slot;
  const bodies: CombatBody[] = [];
  for (const vessel of ctx.db.ship.matchId.filter(matchId)) {
    const faction = byIdentity(vessel.owner);
    if (faction === undefined || vessel.hp <= 0) continue;
    bodies.push({
      entityType: "ship", id: vessel.id, faction, x: vessel.x, y: vessel.y,
      radius: vessel.radiusCells, hp: vessel.hp, kind: vessel.kind,
    });
  }
  for (const row of ctx.db.structure.matchId.filter(matchId)) {
    if (row.hp <= 0) continue;
    bodies.push({
      entityType: "structure", id: row.id, faction: row.ownerSlot,
      x: row.gridX, y: row.gridY, width: row.width, height: row.height,
      hp: row.hp, kind: row.kind,
    });
  }
  return bodies;
}

/** Fire at a current server-observed target; no raw point-and-click blind attacks. */
export const fireWeapon = spacetimedb.reducer(
  { sourceType: t.string(), sourceId: t.u64(), targetType: t.string(), targetId: t.u64() },
  (ctx, { sourceType, sourceId, targetType, targetId }) => {
    if (sourceType !== "ship" && sourceType !== "structure") throw new Error("Invalid weapon");
    if (targetType !== "ship" && targetType !== "structure") throw new Error("Target unavailable");
    const vessel = sourceType === "ship" ? ctx.db.ship.id.find(sourceId) : undefined;
    const turret = sourceType === "structure" ? ctx.db.structure.id.find(sourceId) : undefined;
    if (!vessel && (!turret || turret.kind !== "cannon")) throw new Error("Weapon unavailable");
    const matchId = vessel ? vessel.matchId : turret!.matchId;
    const match = ctx.db.match.id.find(matchId);
    if (!match || match.phase !== "active") throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!member || member.eliminated || (vessel ? !vessel.owner.isEqual(ctx.sender) : turret!.ownerSlot !== member.slot))
      throw new Error("Weapon unavailable");
    if (vessel ? vessel.hp <= 0 : (!turret!.complete || !turret!.connected || turret!.hp <= 0))
      throw new Error("Weapon offline");
    const kind = (vessel ? vessel.kind : "cannon") as WeaponKind;
    const definition = weaponDefinition(kind);
    if (!definition) throw new Error("Weapon unavailable");
    const nowUs = ctx.timestamp.microsSinceUnixEpoch;
    const lastFiredAtUs = vessel ? vessel.lastFiredAtUs : turret!.lastFiredAtUs;
    if (lastFiredAtUs !== 0n && !canFire(nowUs, lastFiredAtUs, definition.cooldownMs))
      throw new Error("Weapon cooldown");
    const source = vessel
      ? { x: vessel.x, y: vessel.y }
      : { x: turret!.gridX + turret!.width / 2, y: turret!.gridY + turret!.height / 2 };

    // A guessed secret target ID must not bypass identity or visibility.
    const hostileShip = targetType === "ship" ? ctx.db.ship.id.find(targetId) : undefined;
    const hostileStructure = targetType === "structure" ? ctx.db.structure.id.find(targetId) : undefined;
    const targetMatchId = hostileShip?.matchId ?? hostileStructure?.matchId;
    if (targetMatchId !== matchId || (hostileShip?.hp ?? hostileStructure?.hp ?? 0) <= 0)
      throw new Error("Target not visible or unavailable");
    if (hostileShip?.owner.isEqual(ctx.sender) || hostileStructure?.ownerSlot === member.slot)
      throw new Error("Target not visible or unavailable");
    const targetFaction = hostileShip
      ? Array.from(ctx.db.matchMember.matchId.filter(matchId))
          .find(row => row.identity.isEqual(hostileShip.owner))?.slot
      : hostileStructure!.ownerSlot;
    if (targetFaction === undefined || targetFaction === member.slot)
      throw new Error("Target not visible or unavailable");
    const destination = hostileShip
      ? { x: hostileShip.x, y: hostileShip.y }
      : { x: hostileStructure!.gridX + hostileStructure!.width / 2,
          y: hostileStructure!.gridY + hostileStructure!.height / 2 };
    const world = ctx.db.worldConfig.matchId.find(matchId);
    if (!world) throw new Error("Missing world");
    const terrain = decodeTerrainChunks(
      world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(matchId)),
    );
    // Preliminary source-sensor LoS. Full client-visible FoW is still #13.
    if (!withinRange(source, destination, definition.range) ||
        !withinRange(source, destination, definition.vision) ||
        !terrainLineOfSight(source, destination, terrain, world.mapCells))
      throw new Error("Target not visible or unavailable");

    if (Array.from(ctx.db.projectile.matchId.filter(matchId)).length >=
        COMBAT_RULES.maxProjectilesPerMatch) throw new Error("Match projectile cap");
    const shot = createProjectile(source, destination, kind, member.slot);
    const angle = ((Math.atan2(shot.vy, shot.vx) * 180 / Math.PI) % 360 + 360) % 360;
    // Both ammo bookkeeping and projectile creation are one DB transaction.
    if (vessel) {
      ctx.db.ship.id.update({
        ...vessel, lastFiredAtUs: nowUs, turretAngleDeg: angle, updatedAt: ctx.timestamp,
      });
    } else {
      ctx.db.structure.id.update({ ...turret!, lastFiredAtUs: nowUs, turretAngleDeg: angle });
    }
    ctx.db.projectile.insert({
      id: 0n, matchId, sourceFaction: member.slot,
      sourceId, sourceType, firedAtUs: nowUs,
      x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy,
      damage: shot.damage, splash: shot.splash,
      structureMultiplier: shot.structureMultiplier,
      remainingRange: shot.remainingRange,
    });
    if (!Array.from(ctx.db.combatSchedule.matchId.filter(matchId)).length) {
      ctx.db.combatSchedule.insert({
        scheduledId: 0n, matchId,
        scheduledAt: ScheduleAt.interval(COMBAT_RULES.tickMicroseconds),
        lastTickAt: ctx.timestamp,
      });
    }
  },
);

/** Combat deaths never pay peaceful demolition refunds. */
function destroyShip(ctx: any, id: bigint): void {
  ctx.db.harvestOrder.shipId.delete(id);
  ctx.db.shipRoute.shipId.delete(id);
  ctx.db.ship.id.delete(id);
}
function destroyStructure(ctx: any, id: bigint): void {
  const row = ctx.db.structure.id.find(id);
  if (!row) return;
  ctx.db.structure.id.delete(id);
  for (const timer of ctx.db.constructionSchedule.structureId.filter(id))
    ctx.db.constructionSchedule.scheduledId.delete(timer.scheduledId);
  if (row.kind === "shipyard") {
    for (const order of ctx.db.productionOrder.yardId.filter(id))
      ctx.db.productionOrder.id.delete(order.id);
  }
}

/** Immediately propagate support loss, then refresh all online flags. */
function reconcileSupport(ctx: any, matchId: bigint): void {
  const config = ctx.db.worldConfig.matchId.find(matchId);
  if (!config) throw new Error("Missing combat world");
  const rows = Array.from(ctx.db.structure.matchId.filter(matchId)) as any[];
  const platforms = rows.filter(row => row.kind === "platform" && row.complete && row.hp > 0);
  for (const st of rows) {
    if (st.channel !== "superstructure") continue;
    let supported = true;
    for (let dy = 0; dy < st.height && supported; dy++) for (let dx = 0; dx < st.width; dx++) {
      const x = st.gridX + dx, y = st.gridY + dy;
      if (!platforms.some(deck => deck.ownerSlot === st.ownerSlot &&
          x >= deck.gridX && x < deck.gridX + deck.width &&
          y >= deck.gridY && y < deck.gridY + deck.height)) {
        supported = false;
        break;
      }
    }
    if (!supported) destroyStructure(ctx, st.id);
  }
  const surviving = Array.from(ctx.db.structure.matchId.filter(matchId)) as any[];
  const shapes = surviving.map(row => ({ ...row, kind: row.kind as StructureKind }));
  for (const st of surviving) {
    const connected = structureOnline({ ...st, kind: st.kind as StructureKind },
      shapes, config.mapCells);
    if (st.connected !== connected) ctx.db.structure.id.update({ ...st, connected });
  }
}

/** An eliminated faction cannot retain controllable units or paid job queues. */
function reconcileEliminations(ctx: any, matchId: bigint): void {
  const members = Array.from(ctx.db.matchMember.matchId.filter(matchId)) as any[];
  const cores = Array.from(ctx.db.structure.matchId.filter(matchId))
    .filter((row: any) => row.kind === "command_core" && row.hp > 0);
  const living = new Set(cores.map((row: any) => row.ownerSlot));
  for (const member of members) {
    if (living.has(member.slot) || member.eliminated) continue;
    ctx.db.matchMember.id.update({ ...member, eliminated: true });
    for (const ship of ctx.db.ship.matchId.filter(matchId))
      if (ship.owner.isEqual(member.identity)) destroyShip(ctx, ship.id);
    for (const st of ctx.db.structure.matchId.filter(matchId))
      if (st.ownerSlot === member.slot) destroyStructure(ctx, st.id);
  }
  if (living.size > 1) return;
  const match = ctx.db.match.id.find(matchId);
  if (!match || match.phase !== "active") return;
  ctx.db.match.id.update({
    ...match, phase: "finished", winnerSlot: living.size === 1 ? [...living][0]! : -1,
  });
  // No further periodic economy / movement / combat activity after match finish.
  for (const job of ctx.db.economySchedule.matchId.filter(matchId))
    ctx.db.economySchedule.scheduledId.delete(job.scheduledId);
  for (const job of ctx.db.motionSchedule.matchId.filter(matchId))
    ctx.db.motionSchedule.scheduledId.delete(job.scheduledId);
  for (const job of ctx.db.projectile.matchId.filter(matchId))
    ctx.db.projectile.id.delete(job.id);
}

/** Impact-time projectiles; exactly one bounded tick per *moving match*. */
export const advanceCombat = spacetimedb.reducer(
  { onSchedule: combatSchedule },
  { arg: combatSchedule.rowType },
  (ctx, { arg }) => {
    if (!ctx.senderAuth.isInternal) throw new Error("Combat scheduler is internal-only");
    const timer = ctx.db.combatSchedule.scheduledId.find(arg.scheduledId);
    if (!timer) return;
    const match = ctx.db.match.id.find(timer.matchId);
    if (!match || match.phase !== "active") {
      ctx.db.combatSchedule.scheduledId.delete(timer.scheduledId);
      return;
    }
    const seconds = boundedDeltaSeconds(
      timer.lastTickAt.microsSinceUnixEpoch, ctx.timestamp.microsSinceUnixEpoch,
    );
    if (seconds === 0) return;
    const projectiles = Array.from(ctx.db.projectile.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let changedStructure = false;
    for (const row of projectiles) {
      // Re-read bodies after each impact to avoid double-counting dead targets.
      const bodies = combatBodies(ctx, timer.matchId);
      const output = advanceProjectile({
        x: row.x, y: row.y, vx: row.vx, vy: row.vy,
        sourceFaction: row.sourceFaction, damage: row.damage, splash: row.splash,
        structureMultiplier: row.structureMultiplier, remainingRange: row.remainingRange,
      }, seconds, bodies);
      if (output.impact) {
        for (const hit of output.impact.hits) {
          if (hit.entityType === "ship") {
            const vessel = ctx.db.ship.id.find(hit.id);
            if (!vessel) continue;
            if (hit.damage >= vessel.hp) destroyShip(ctx, hit.id);
            else ctx.db.ship.id.update({ ...vessel, hp: vessel.hp - hit.damage });
          } else {
            const structure = ctx.db.structure.id.find(hit.id);
            if (!structure) continue;
            if (hit.damage >= structure.hp) destroyStructure(ctx, hit.id);
            else ctx.db.structure.id.update({ ...structure, hp: structure.hp - hit.damage });
            changedStructure = true;
          }
        }
      }
      if (!output.next) ctx.db.projectile.id.delete(row.id);
      else ctx.db.projectile.id.update({
        ...row, x: output.next.x, y: output.next.y,
        remainingRange: output.next.remainingRange,
      });
    }
    if (changedStructure) {
      reconcileSupport(ctx, timer.matchId);
      reconcileEliminations(ctx, timer.matchId);
    }
    const remaining = Array.from(ctx.db.projectile.matchId.filter(timer.matchId)).length;
    if (remaining === 0) ctx.db.combatSchedule.scheduledId.delete(timer.scheduledId);
    else ctx.db.combatSchedule.scheduledId.update({
      ...timer, lastTickAt: ctx.timestamp,
    });
  },
);
