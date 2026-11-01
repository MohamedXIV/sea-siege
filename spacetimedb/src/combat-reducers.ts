import { ScheduleAt } from "spacetimedb";
import { t } from "spacetimedb/server";
import spacetimedb, { combatSchedule } from "./schema.ts";
import { decodeTerrainChunks } from "./sim/navigation.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
import { dispatchAim, dispatchFire, type WeaponSource } from "./sim/combat-command-dispatch.ts";
import { structureOnline, type StructureKind } from "./sim/construction.ts";
import { boundedDeltaSeconds } from "./sim/ship-motion.ts";
import {
  advanceTurret, type TurretKind,
} from "./sim/turret-aim.ts";
import {
  COMBAT_RULES, advanceProjectile, weaponDefinition, type CombatBody,
} from "./sim/combat.ts";


/**
 * Clients may request a bearing but may not update turret angles directly.
 * This command intentionally does not accept/read enemy target IDs, so aiming
 * alone cannot be abused as a hidden-unit discovery oracle.
 */
export const aimWeapon = spacetimedb.reducer(
  { sourceType: t.string(), sourceId: t.u64(), desiredAngleDeg: t.f64() },
  (ctx, { sourceType, sourceId, desiredAngleDeg }) => {
    if (sourceType !== "ship" && sourceType !== "structure")
      throw new Error("Weapon unavailable");
    const vessel = sourceType === "ship" ? ctx.db.ship.id.find(sourceId) : undefined;
    const cannon = sourceType === "structure" ? ctx.db.structure.id.find(sourceId) : undefined;
    if (!vessel && (!cannon || cannon.kind !== "cannon"))
      throw new Error("Weapon unavailable");
    const matchId = vessel ? vessel.matchId : cannon!.matchId;
    const match = ctx.db.match.id.find(matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs,
      ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = member ? Array.from(ctx.db.factionState.matchId.filter(matchId))
      .find(row => row.slot === member.slot && row.controller === "human") : undefined;
    if (!faction || faction.eliminated ||
        (vessel ? vessel.ownerSlot !== faction.slot : cannon!.ownerSlot !== faction.slot))
      throw new Error("Weapon unavailable");
    const source: WeaponSource = vessel
      ? { type: "ship", id: vessel.id, matchId, ownerSlot: vessel.ownerSlot,
          kind: vessel.kind, x: vessel.x, y: vessel.y, hp: vessel.hp,
          complete: true, connected: true, turretAngleDeg: vessel.turretAngleDeg,
          lastFiredAtUs: vessel.lastFiredAtUs }
      : { type: "structure", id: cannon!.id, matchId, ownerSlot: cannon!.ownerSlot,
          kind: cannon!.kind, x: cannon!.gridX + cannon!.width / 2,
          y: cannon!.gridY + cannon!.height / 2, hp: cannon!.hp,
          complete: cannon!.complete, connected: cannon!.connected,
          turretAngleDeg: cannon!.turretAngleDeg, lastFiredAtUs: cannon!.lastFiredAtUs };
    const result = dispatchAim({
      faction: { matchId, slot: faction.slot, controller: "human", eliminated: faction.eliminated },
      source, desiredAngleDeg,
    }, {
      clearAim: (type,id) => {
        for (const row of Array.from(ctx.db.turretAim.matchId.filter(matchId)))
          if (row.sourceType === type && row.sourceId === id)
            ctx.db.turretAim.id.delete(row.id);
      },
      upsertAim: (type,id,angle) => {
        const current = Array.from(ctx.db.turretAim.matchId.filter(matchId))
          .find(row => row.sourceType === type && row.sourceId === id);
        if (current) ctx.db.turretAim.id.update({ ...current, desiredAngleDeg: angle });
        else ctx.db.turretAim.insert({
          id: 0n, matchId, sourceType: type, sourceId: id, desiredAngleDeg: angle,
        });
      },
      ensureCombatTick: () => {
        if (!Array.from(ctx.db.combatSchedule.matchId.filter(matchId)).length)
          ctx.db.combatSchedule.insert({
            scheduledId: 0n, matchId,
            scheduledAt: ScheduleAt.interval(COMBAT_RULES.tickMicroseconds),
            lastTickAt: ctx.timestamp,
          });
      },
    });
    if (!result.ok) throw new Error(result.reason);
  },
);

/** Fire at a current server-observed target; no raw point-and-click blind attacks. */
export const fireWeapon = spacetimedb.reducer(
  { sourceType: t.string(), sourceId: t.u64(), targetType: t.string(), targetId: t.u64() },
  (ctx, { sourceType, sourceId, targetType, targetId }) => {
    if (sourceType !== "ship" && sourceType !== "structure")
      throw new Error("Weapon unavailable");
    if (targetType !== "ship" && targetType !== "structure")
      throw new Error("Target not visible or unavailable");
    const vessel = sourceType === "ship" ? ctx.db.ship.id.find(sourceId) : undefined;
    const cannon = sourceType === "structure" ? ctx.db.structure.id.find(sourceId) : undefined;
    if (!vessel && (!cannon || cannon.kind !== "cannon"))
      throw new Error("Weapon unavailable");
    const matchId = vessel ? vessel.matchId : cannon!.matchId;
    const match = ctx.db.match.id.find(matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs,
      ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = member ? Array.from(ctx.db.factionState.matchId.filter(matchId))
      .find(row => row.slot === member.slot && row.controller === "human") : undefined;
    if (!faction || faction.eliminated ||
        (vessel ? vessel.ownerSlot !== faction.slot : cannon!.ownerSlot !== faction.slot))
      throw new Error("Weapon unavailable");
    const hostileShip = targetType === "ship" ? ctx.db.ship.id.find(targetId) : undefined;
    const hostileStructure = targetType === "structure" ?
      ctx.db.structure.id.find(targetId) : undefined;
    const world = ctx.db.worldConfig.matchId.find(matchId);
    if (!world) throw new Error("Missing world");
    const terrain = decodeTerrainChunks(
      world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(matchId)),
    );
    const source: WeaponSource = vessel
      ? { type: "ship", id: vessel.id, matchId, ownerSlot: vessel.ownerSlot,
          kind: vessel.kind, x: vessel.x, y: vessel.y, hp: vessel.hp,
          complete: true, connected: true, turretAngleDeg: vessel.turretAngleDeg,
          lastFiredAtUs: vessel.lastFiredAtUs }
      : { type: "structure", id: cannon!.id, matchId, ownerSlot: cannon!.ownerSlot,
          kind: cannon!.kind, x: cannon!.gridX + cannon!.width / 2,
          y: cannon!.gridY + cannon!.height / 2, hp: cannon!.hp,
          complete: cannon!.complete, connected: cannon!.connected,
          turretAngleDeg: cannon!.turretAngleDeg, lastFiredAtUs: cannon!.lastFiredAtUs };
    const target = hostileShip
      ? { id: hostileShip.id, matchId: hostileShip.matchId,
          ownerSlot: hostileShip.ownerSlot, type: "ship" as const,
          x: hostileShip.x, y: hostileShip.y, hp: hostileShip.hp }
      : hostileStructure
        ? { id: hostileStructure.id, matchId: hostileStructure.matchId,
            ownerSlot: hostileStructure.ownerSlot, type: "structure" as const,
            x: hostileStructure.gridX + hostileStructure.width / 2,
            y: hostileStructure.gridY + hostileStructure.height / 2,
            hp: hostileStructure.hp }
        : null;
    const result = dispatchFire({
      faction: { matchId, slot: faction.slot, controller: "human", eliminated: faction.eliminated },
      source, target, nowUs: ctx.timestamp.microsSinceUnixEpoch,
      targetVisible: true, terrain, mapCells: world.mapCells,
      projectileCount: Array.from(ctx.db.projectile.matchId.filter(matchId)).length,
    }, {
      markFired: (_,atUs) => {
        if (vessel) ctx.db.ship.id.update({
          ...vessel, lastFiredAtUs: atUs, updatedAt: ctx.timestamp,
        });
        else ctx.db.structure.id.update({ ...cannon!, lastFiredAtUs: atUs });
      },
      insertProjectile: shot => { ctx.db.projectile.insert({ id: 0n, ...shot }); },
      ensureCombatTick: () => {
        if (!Array.from(ctx.db.combatSchedule.matchId.filter(matchId)).length)
          ctx.db.combatSchedule.insert({
            scheduledId: 0n, matchId,
            scheduledAt: ScheduleAt.interval(COMBAT_RULES.tickMicroseconds),
            lastTickAt: ctx.timestamp,
          });
      },
    });
    if (!result.ok) throw new Error(result.reason);
  },
);

/** Impact-time projectiles; exactly one bounded tick per *moving match*. */
export const advanceCombat = spacetimedb.reducer(
  { onSchedule: combatSchedule },
  { arg: combatSchedule.rowType },
  (ctx, { arg }) => {


    /** Build one match-scoped server-owned collision snapshot, never a client collection. */
    function combatBodies(matchId: bigint): CombatBody[] {

      const bodies: CombatBody[] = [];
      for (const vessel of ctx.db.ship.matchId.filter(matchId)) {
        const faction = vessel.ownerSlot;
        if (vessel.hp <= 0) continue;
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

    /** Remove obsolete steering intent when a source is eliminated. */
    function clearAim(sourceType: string, sourceId: bigint): void {
      for (const aim of Array.from(ctx.db.turretAim.matchId.filter(timer!.matchId))) {
        if (aim.sourceType === sourceType && aim.sourceId === sourceId)
          ctx.db.turretAim.id.delete(aim.id);
      }
    }

    /** Combat deaths never pay peaceful demolition refunds. */
    function destroyShip(id: bigint): void {
      clearAim("ship", id);
      ctx.db.harvestOrder.shipId.delete(id);
      ctx.db.shipRoute.shipId.delete(id);
      ctx.db.ship.id.delete(id);
    }
    function destroyStructure(id: bigint): void {
      const row = ctx.db.structure.id.find(id);
      if (!row) return;
      clearAim("structure", id);
      ctx.db.structure.id.delete(id);
      for (const timer of Array.from(ctx.db.constructionSchedule.structureId.filter(id)))
        ctx.db.constructionSchedule.scheduledId.delete(timer.scheduledId);
      if (row.kind === "shipyard") {
        for (const order of Array.from(ctx.db.productionOrder.yardId.filter(id)))
          ctx.db.productionOrder.id.delete(order.id);
      }
    }
    
    /** Immediately propagate support loss, then refresh all online flags. */
    function reconcileSupport(matchId: bigint): void {
      const config = ctx.db.worldConfig.matchId.find(matchId);
      if (!config) throw new Error("Missing combat world");
      const rows = Array.from(ctx.db.structure.matchId.filter(matchId));
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
        if (!supported) destroyStructure(st.id);
      }
      const surviving = Array.from(ctx.db.structure.matchId.filter(matchId));
      const shapes = surviving.map(row => ({ ...row, kind: row.kind as StructureKind }));
      for (const st of surviving) {
        const connected = structureOnline({ ...st, kind: st.kind as StructureKind },
          shapes, config.mapCells);
        if (st.connected !== connected) ctx.db.structure.id.update({ ...st, connected });
      }
    }
    
    /** An eliminated faction cannot retain controllable units or paid job queues. */
    function reconcileEliminations(matchId: bigint): void {
      const factions = Array.from(ctx.db.factionState.matchId.filter(matchId));
      const cores = Array.from(ctx.db.structure.matchId.filter(matchId))
        .filter((row) => row.kind === "command_core" && row.hp > 0);
      const living = new Set(cores.map((row) => row.ownerSlot));
      for (const faction of factions) {
        if (living.has(faction.slot) || faction.eliminated) continue;
        ctx.db.factionState.id.update({ ...faction, eliminated: true });
        for (const ship of Array.from(ctx.db.ship.matchId.filter(matchId)))
          if (ship.ownerSlot === faction.slot) destroyShip(ship.id);
        for (const st of Array.from(ctx.db.structure.matchId.filter(matchId)))
          if (st.ownerSlot === faction.slot) destroyStructure(st.id);
      }
      if (living.size > 1) return;
      const match = ctx.db.match.id.find(matchId);
      if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) return;
      ctx.db.match.id.update({
        ...match, phase: "finished",
        winnerSlot: living.size === 1 ? [...living][0]! : -1,
        victoryReason: living.size === 1 ? "domination" : "mutual_destruction",
        winningScore5: 0n,
        endedAtUs: ctx.timestamp.microsSinceUnixEpoch,
      });
      // Cancel the one-shot deadline when combat has already decided the match.
      for (const pending of Array.from(ctx.db.matchDeadline.matchId.filter(matchId)))
        ctx.db.matchDeadline.scheduledId.delete(pending.scheduledId);
      // No further periodic economy / movement / combat activity after match finish.
      for (const job of Array.from(ctx.db.economySchedule.matchId.filter(matchId)))
        ctx.db.economySchedule.scheduledId.delete(job.scheduledId);
      for (const job of Array.from(ctx.db.motionSchedule.matchId.filter(matchId)))
        ctx.db.motionSchedule.scheduledId.delete(job.scheduledId);
      for (const job of Array.from(ctx.db.botSchedule.matchId.filter(matchId)))
        ctx.db.botSchedule.scheduledId.delete(job.scheduledId);
      for (const job of Array.from(ctx.db.projectile.matchId.filter(matchId)))
        ctx.db.projectile.id.delete(job.id);
      for (const job of Array.from(ctx.db.turretAim.matchId.filter(matchId)))
        ctx.db.turretAim.id.delete(job.id);
    }
    if (!ctx.senderAuth.isInternal) throw new Error("Combat scheduler is internal-only");
    const timer = ctx.db.combatSchedule.scheduledId.find(arg.scheduledId);
    if (!timer) return;
    const match = ctx.db.match.id.find(timer.matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) {
      ctx.db.combatSchedule.scheduledId.delete(timer.scheduledId);
      return;
    }
    const seconds = boundedDeltaSeconds(
      timer.lastTickAt.microsSinceUnixEpoch, ctx.timestamp.microsSinceUnixEpoch,
    );
    if (seconds === 0) return;
    const aiming = Array.from(ctx.db.turretAim.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const order of aiming) {
      const vessel = order.sourceType === "ship" ? ctx.db.ship.id.find(order.sourceId) : undefined;
      const cannon = order.sourceType === "structure" ? ctx.db.structure.id.find(order.sourceId) : undefined;
      if ((!vessel && !cannon) || (vessel && vessel.hp <= 0) ||
          (cannon && (cannon.kind !== "cannon" || !cannon.complete ||
                      !cannon.connected || cannon.hp <= 0))) {
        ctx.db.turretAim.id.delete(order.id);
        continue;
      }
      const kind = vessel ? vessel.kind : "cannon";
      if (!weaponDefinition(kind)) {
        ctx.db.turretAim.id.delete(order.id);
        continue;
      }
      const current = vessel ? vessel.turretAngleDeg : cannon!.turretAngleDeg;
      const stepped = advanceTurret(current, order.desiredAngleDeg, kind as TurretKind, seconds);
      if (stepped.angle !== current) {
        if (vessel) ctx.db.ship.id.update({
          ...vessel, turretAngleDeg: stepped.angle, updatedAt: ctx.timestamp,
        });
        else ctx.db.structure.id.update({ ...cannon!, turretAngleDeg: stepped.angle });
      }
      if (stepped.aligned) ctx.db.turretAim.id.delete(order.id);
    }
    const projectiles = Array.from(ctx.db.projectile.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let changedStructure = false;
    for (const row of projectiles) {
      // Re-read bodies after each impact to avoid double-counting dead targets.
      const bodies = combatBodies(timer.matchId);
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
            if (hit.damage >= vessel.hp) destroyShip(hit.id);
            else ctx.db.ship.id.update({ ...vessel, hp: vessel.hp - hit.damage });
          } else {
            const structure = ctx.db.structure.id.find(hit.id);
            if (!structure) continue;
            if (hit.damage >= structure.hp) destroyStructure(hit.id);
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
      reconcileSupport(timer.matchId);
      reconcileEliminations(timer.matchId);
    }
    const remaining = Array.from(ctx.db.projectile.matchId.filter(timer.matchId)).length;
    const pendingAim = Array.from(ctx.db.turretAim.matchId.filter(timer.matchId)).length;
    if (remaining === 0 && pendingAim === 0) ctx.db.combatSchedule.scheduledId.delete(timer.scheduledId);
    else ctx.db.combatSchedule.scheduledId.update({
      ...timer, lastTickAt: ctx.timestamp,
    });
  },
);
