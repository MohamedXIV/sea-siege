import { ScheduleAt } from "spacetimedb";
import { t } from "spacetimedb/server";
import spacetimedb, {
  motionSchedule, constructionSchedule, economySchedule,
} from "./schema.ts";
import { deadlineMicroseconds } from "./sim/match-outcome.ts";
import { factionKey, mayControlFaction } from "./sim/faction-ownership.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
export default spacetimedb;
import { generateDeterministicWorld } from "./sim/worldgen.ts";
import { ECONOMY_RULES, creditSalvage, shipDefinition } from "./sim/economy.ts";
import { nextWorkshopUpgrade } from "./sim/workshop.ts";
import { decodeTerrainChunks, findTerrainPath } from "./sim/navigation.ts";
import { advanceShipOnRoute, boundedDeltaSeconds, SHIP_MOTION_RULES } from "./sim/ship-motion.ts";
import {
  CONSTRUCTION_RULES, initialStructures, structureDefinition, structureOnline,
  validateStructurePlacement, type StructureKind, type StructureShape,
} from "./sim/construction.ts";
import {
  canSweepVessel, isNavigationCellBlocked, COLLISION_RULES,
} from "./sim/collision.ts";

/**
 * Minimal REAL SpacetimeDB module for Sea Siege (not a browser authority clone).
 * Only non-secret lobby metadata is public. Membership and ship state are private
 * until an authenticated, identity-filtered view deliberately exposes them.
 *
 * Server-side motion, construction, salvage and shipyard queues are implemented
 * as source code. Fog-safe views and real runtime integration remain pending.
 * This module has NOT been published or integration-tested yet.
 */


/** Creates lobby + host's ship atomically. Join/start rules will expand in #4/#14. */
export const createMatch = spacetimedb.reducer(
  { maxSlots: t.u32() },
  (ctx, { maxSlots }) => {
    if (maxSlots < 2 || maxSlots > 8) throw new Error("Matches support 2–8 slots");
    // Choose the seed on the authoritative server, not from a player-supplied value.
    // SpacetimeDB context RNG is deterministic for reducer execution, but is not
    // intended to be cryptographically unpredictable (fine for casual RTS maps).
    const seed = ctx.random.integerInRange(0, 0xffffffff);
    const world = generateDeterministicWorld(seed, maxSlots);
    const created = ctx.db.match.insert({
      id: 0n,
      host: ctx.sender,
      phase: "lobby",
      winnerSlot: -1, victoryReason: "", winningScore5: 0n,
      startedAtUs: 0n, endedAtUs: 0n,
      maxSlots,
      createdAt: ctx.timestamp,
    });
    ctx.db.worldConfig.insert({ matchId: created.id, seed, mapCells: world.mapCells });
    for (const spawn of world.spawns) {
      ctx.db.worldSpawn.insert({
        id: 0n, matchId: created.id, slot: spawn.slotIndex,
        gridX: spawn.gridX, gridY: spawn.gridY,
      });
    }
    for (const chunk of world.chunks) {
      ctx.db.worldChunk.insert({
        id: 0n, matchId: created.id,
        chunkX: chunk.chunkX, chunkY: chunk.chunkY,
        terrain: [...chunk.terrain],
      });
    }
    for (const node of world.deposits) {
      ctx.db.salvageNode.insert({
        id: 0n, matchId: created.id,
        gridX: node.gridX, gridY: node.gridY,
        capacity: node.capacity, remaining: node.capacity,
        regenPerSec: node.regenPerSec, contested: node.contested,
      });
    }
    ctx.db.matchMember.insert({
      id: 0n, matchId: created.id, identity: ctx.sender, slot: 0,
      factionKey: factionKey(created.id, 0),
      salvage: CONSTRUCTION_RULES.startingSalvage,
      totalSalvageGathered: 0n, eliminated: false,
    });
    const initial = world.spawns[0]!;
    for (const base of initialStructures(0, initial.gridX, initial.gridY)) {
      const definition = CONSTRUCTION_RULES.definitions[base.kind];
      ctx.db.structure.insert({
        id: 0n, matchId: created.id, ownerSlot: base.ownerSlot,
        kind: base.kind, channel: definition.channel, gridX: base.gridX, gridY: base.gridY,
        width: base.width, height: base.height, hp: definition.hp,
        lastFiredAtUs: -1n, turretAngleDeg: 0,
        level: 1, upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
        complete: true, connected: true,
        completeAtUs: ctx.timestamp.microsSinceUnixEpoch,
      });
    }
    // The launch vessel must NOT spawn inside its solid 3×3 Command Core.
    const initialX = initial.gridX - 1.5;
    const initialY = initial.gridY + 1.5;
    ctx.db.ship.insert({
      id: 0n,
      matchId: created.id,
      ownerSlot: 0, factionKey: factionKey(created.id, 0),
      kind: "scout", hp: ECONOMY_RULES.ships.scout.hp,
      radiusCells: ECONOMY_RULES.ships.scout.radius,
      x: initialX,
      y: initialY,
      velocityX: 0,
      velocityY: 0,
      hullAngleDeg: 0,
      turretAngleDeg: 0,
      lastFiredAtUs: -1n,
      targetX: initialX,
      targetY: initialY,
      revision: 0n,
      updatedAt: ctx.timestamp,
    });
  },
);

/** A real identity claims at most one lobby seat; no simulated second-player client. */
export const joinMatch = spacetimedb.reducer(
  { matchId: t.u64() },
  (ctx, { matchId }) => {
    const lobby = ctx.db.match.id.find(matchId);
    if (!lobby || lobby.phase !== "lobby") throw new Error("Lobby unavailable");
    const occupied = new Set<number>();
    for (const member of ctx.db.matchMember.matchId.filter(matchId)) {
      if (member.identity.isEqual(ctx.sender)) return; // reconnect / idempotent join
      occupied.add(member.slot);
    }
    const slot = Array.from({ length: lobby.maxSlots }, (_, index) => index).find(index => !occupied.has(index));
    if (slot === undefined) throw new Error("Lobby full");
    ctx.db.matchMember.insert({
      id: 0n, matchId, identity: ctx.sender, slot,
      factionKey: factionKey(matchId, slot),
      salvage: CONSTRUCTION_RULES.startingSalvage,
      totalSalvageGathered: 0n, eliminated: false,
    });
    const spawn = Array.from(ctx.db.worldSpawn.matchId.filter(matchId)).find(row => row.slot === slot);
    if (!spawn) throw new Error("Missing server-owned spawn assignment");
    for (const base of initialStructures(slot, spawn.gridX, spawn.gridY)) {
      const definition = CONSTRUCTION_RULES.definitions[base.kind];
      ctx.db.structure.insert({
        id: 0n, matchId, ownerSlot: slot,
        kind: base.kind, channel: definition.channel, gridX: base.gridX, gridY: base.gridY,
        width: base.width, height: base.height, hp: definition.hp,
        lastFiredAtUs: -1n, turretAngleDeg: 0,
        level: 1, upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
        complete: true, connected: true,
        completeAtUs: ctx.timestamp.microsSinceUnixEpoch,
      });
    }
    const x = spawn.gridX - 1.5;
    const y = spawn.gridY + 1.5;
    ctx.db.ship.insert({
      id: 0n,
      matchId,
      ownerSlot: slot, factionKey: factionKey(matchId, slot),
      kind: "scout", hp: ECONOMY_RULES.ships.scout.hp,
      radiusCells: ECONOMY_RULES.ships.scout.radius,
      x,
      y,
      velocityX: 0,
      velocityY: 0,
      hullAngleDeg: 0,
      turretAngleDeg: 0,
      lastFiredAtUs: -1n,
      targetX: x,
      targetY: y,
      revision: 0n,
      updatedAt: ctx.timestamp,
    });
  },
);

export const startMatch = spacetimedb.reducer(
  { matchId: t.u64() },
  (ctx, { matchId }) => {
    const lobby = ctx.db.match.id.find(matchId);
    if (!lobby || lobby.phase !== "lobby") throw new Error("Lobby unavailable");
    if (!lobby.host.isEqual(ctx.sender)) throw new Error("Only the host may start");
    let count = 0;
    for (const _member of ctx.db.matchMember.matchId.filter(matchId)) count++;
    if (count < 2) throw new Error("Need at least two actual members");
    const startUs = ctx.timestamp.microsSinceUnixEpoch;
    ctx.db.match.id.update({ ...lobby, phase: "active", startedAtUs: startUs });
    const deadlineUs = deadlineMicroseconds(startUs);
    ctx.db.matchDeadline.insert({
      scheduledId: 0n, matchId, deadlineUs,
      scheduledAt: ScheduleAt.time(deadlineUs),
    });
    ctx.db.economySchedule.insert({
      scheduledId: 0n, matchId,
      scheduledAt: ScheduleAt.interval(ECONOMY_RULES.tickMicroseconds),
      lastTickAt: ctx.timestamp, leftoverUs: 0n,
    });
  },
);

/** Movement orders are server-validated against private static and structure
 * occupancy. Issuing one also atomically cancels any harvesting assignment. */
export const issueShipOrder = spacetimedb.reducer(
  { shipId: t.u64(), targetX: t.f64(), targetY: t.f64() },
  (ctx, { shipId, targetX, targetY }) => {
    const current = ctx.db.ship.id.find(shipId);
    if (!current) throw new Error("Ship unavailable");
    const seat = Array.from(ctx.db.matchMember.matchId.filter(current.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!mayControlFaction(seat?.slot, current.ownerSlot, seat?.eliminated ?? true))
      throw new Error("Cannot command another player's ship");
    const match = ctx.db.match.id.find(current.matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) throw new Error("Invalid destination");
    const config = ctx.db.worldConfig.matchId.find(current.matchId);
    if (!config) throw new Error("Missing match world configuration");
    if (targetX < 0 || targetY < 0 || targetX >= config.mapCells || targetY >= config.mapCells) {
      throw new Error("Destination out of bounds");
    }
    // Decode real authoritative stored chunks. Rebuilding from browser-visible
    // seeds would leak the unexplored map; there is no client-owned routing.
    const terrain = decodeTerrainChunks(
      config.mapCells,
      Array.from(ctx.db.worldChunk.matchId.filter(current.matchId)),
    );
    const env = {
      mapCells: config.mapCells, terrain,
      vessels: Array.from(ctx.db.ship.matchId.filter(current.matchId)).map(vessel => ({
        id: vessel.id, x: vessel.x, y: vessel.y, radius: vessel.radiusCells,
      })),
      footprints: Array.from(ctx.db.structure.matchId.filter(current.matchId))
        .filter(row => row.channel === "surface")
        .map(row => ({ x: row.gridX, y: row.gridY, width: row.width, height: row.height })),
    };
    const route = findTerrainPath(
      terrain, config.mapCells,
      { x: current.x, y: current.y },
      { x: targetX, y: targetY },
      {
        blocked: (x, y) => isNavigationCellBlocked(
          x, y, current.radiusCells, env, shipId,
        ),
      },
    );
    if (!route) throw new Error("Destination unreachable");
    // A move order cancels the previous harvest target atomically.
    ctx.db.harvestOrder.shipId.delete(shipId);
    const nextRevision = current.revision + 1n;
    const cellPath = route.waypoints.slice(1).map(
      point => Math.floor(point.y) * config.mapCells + Math.floor(point.x),
    );
    const existing = ctx.db.shipRoute.shipId.find(shipId);
    if (cellPath.length === 0) {
      if (existing) ctx.db.shipRoute.shipId.delete(shipId);
    } else if (existing) {
      ctx.db.shipRoute.shipId.update({
        ...existing, cellPath, cursor: 0, revision: nextRevision, repathAfterUs: 0n,
      });
    } else {
      ctx.db.shipRoute.insert({
        shipId, matchId: current.matchId,
        cellPath, cursor: 0, revision: nextRevision, repathAfterUs: 0n,
      });
    }
    // The navigation grid is cell-centered. Store the precise actual destination
    // that the server can reach, rather than a misleading arbitrary cursor pixel.
    const finalX = Math.floor(targetX) + 0.5;
    const finalY = Math.floor(targetY) + 0.5;
    ctx.db.ship.id.update({
      ...current,
      targetX: finalX,
      targetY: finalY,
      velocityX: cellPath.length === 0 ? 0 : current.velocityX,
      velocityY: cellPath.length === 0 ? 0 : current.velocityY,
      revision: nextRevision,
      updatedAt: ctx.timestamp,
    });
    if (cellPath.length > 0) {
      // Schedule on demand, exactly once per live match. Another order in the
      // same transaction stream observes the existing timer.
      let hasTimer = false;
      for (const _row of ctx.db.motionSchedule.matchId.filter(current.matchId)) {
        hasTimer = true;
        break;
      }
      if (!hasTimer) {
        ctx.db.motionSchedule.insert({
          scheduledId: 0n,
          matchId: current.matchId,
          scheduledAt: ScheduleAt.interval(SHIP_MOTION_RULES.tickMicroseconds),
          lastTickAt: ctx.timestamp,
        });
      }
    }
  },
);

/** Private table, public per-identity view. Never publish raw ship rows. */
export const myShips = spacetimedb.view(
  { name: "my_ships", public: true },
  t.array(ship.rowType),
  (ctx) => ctx.from.matchMember
    .where(member => member.identity.eq(ctx.sender))
    .rightSemijoin(ctx.from.ship, (member, vessel) =>
      member.factionKey.eq(vessel.factionKey)),
);

export const myMemberships = spacetimedb.view(
  { name: "my_memberships", public: true },
  t.array(matchMember.rowType),
  (ctx) => ctx.from.matchMember.where((row) => row.identity.eq(ctx.sender)),
);

/** Cancel a route without teleportation; callers may only stop their own units. */
export const stopShip = spacetimedb.reducer(
  { shipId: t.u64() },
  (ctx, { shipId }) => {
    const current = ctx.db.ship.id.find(shipId);
    if (!current) throw new Error("Ship unavailable");
    const seat = Array.from(ctx.db.matchMember.matchId.filter(current.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!mayControlFaction(seat?.slot, current.ownerSlot, seat?.eliminated ?? true))
      throw new Error("Cannot command another player's ship");
    const lobby = ctx.db.match.id.find(current.matchId);
    if (!lobby || !matchStillActive(lobby.phase, lobby.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    ctx.db.shipRoute.shipId.delete(shipId);
    ctx.db.harvestOrder.shipId.delete(shipId);
    ctx.db.ship.id.update({
      ...current,
      velocityX: 0, velocityY: 0,
      targetX: current.x, targetY: current.y,
      revision: current.revision + 1n,
      updatedAt: ctx.timestamp,
    });
  },
);

/**
 * The *real* scheduled SpacetimeDB reducer, owned by the database scheduler.
 * Delayed ticks use measured elapsed time (bounded to 250ms), not idealized
 * 100ms steps. Idle matches have no schedule row; a finished route removes it.
 *
 * The ship table is PRIVATE. A later view will disclose only visible enemies.
 */
export const advanceMatchSimulation = spacetimedb.reducer(
  { onSchedule: motionSchedule },
  { arg: motionSchedule.rowType },
  (ctx, { arg }) => {
    // Scheduled reducers can otherwise be called by network clients. Never
    // let an untrusted caller impersonate the authoritative simulation.
    if (!ctx.senderAuth.isInternal) throw new Error("Scheduled simulation is internal-only");
    const timer = ctx.db.motionSchedule.scheduledId.find(arg.scheduledId);
    if (!timer) return;
    const active = ctx.db.match.id.find(timer.matchId);
    if (!active || !matchStillActive(active.phase, active.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) {
      ctx.db.motionSchedule.scheduledId.delete(timer.scheduledId);
      return;
    }
    const seconds = boundedDeltaSeconds(
      timer.lastTickAt.microsSinceUnixEpoch,
      ctx.timestamp.microsSinceUnixEpoch,
    );
    if (seconds === 0) return;
    const world = ctx.db.worldConfig.matchId.find(timer.matchId);
    if (!world) throw new Error("World configuration missing for active match");

    const terrain = decodeTerrainChunks(
      world.mapCells,
      Array.from(ctx.db.worldChunk.matchId.filter(timer.matchId)),
    );
    // Deterministic ship-id ordering and updated positions prevent different
    // transaction iteration orders from deciding who may cross first.
    const matchShips = Array.from(ctx.db.ship.matchId.filter(timer.matchId));
    matchShips.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const bodies = matchShips.map(v => ({ id: v.id, x: v.x, y: v.y, radius: v.radiusCells }));
    const footprints = Array.from(ctx.db.structure.matchId.filter(timer.matchId))
      .filter(row => row.channel === "surface")
      .map(row => ({ x: row.gridX, y: row.gridY, width: row.width, height: row.height }));
    const env = { mapCells: world.mapCells, terrain, vessels: bodies, footprints };
    let routesRemaining = 0;
    for (const vessel of matchShips) {
      const route = ctx.db.shipRoute.shipId.find(vessel.id);
      if (!route) continue;
      // Stale orders must never outlive their ship's current command revision.
      if (route.revision !== vessel.revision || route.matchId !== timer.matchId) {
        ctx.db.shipRoute.shipId.delete(vessel.id);
        continue;
      }
      const stepped = advanceShipOnRoute(
        {
          x: vessel.x, y: vessel.y,
          velocityX: vessel.velocityX, velocityY: vessel.velocityY,
          hullAngleDeg: vessel.hullAngleDeg,
        },
        route.cellPath, route.cursor, world.mapCells, seconds,
      );

      // Never trust an old path after another ship has changed position.
      // Swept validation rejects crossing a blocker even when both endpoints
      // themselves are navigable (no tunneling on a delayed tick).
      const clear = canSweepVessel(
        { x: vessel.x, y: vessel.y },
        { x: stepped.ship.x, y: stepped.ship.y },
        vessel.radiusCells, env, vessel.id,
      );
      if (!clear) {
        routesRemaining++;
        const nowUs = ctx.timestamp.microsSinceUnixEpoch;
        if (nowUs >= route.repathAfterUs) {
          // Congested routes retry no more than once/second per ship. If a
          // future structure blocks the old path, seek a new legal route.
          const reroute = findTerrainPath(
            terrain, world.mapCells,
            { x: vessel.x, y: vessel.y },
            { x: vessel.targetX, y: vessel.targetY },
            {
              blocked: (x, y) => isNavigationCellBlocked(
                x, y, vessel.radiusCells, env, vessel.id,
              ),
            },
          );
          const reroutedCells = reroute?.waypoints.slice(1).map(
            point => Math.floor(point.y) * world.mapCells + Math.floor(point.x),
          );
          ctx.db.shipRoute.shipId.update({
            ...route,
            cellPath: reroutedCells && reroutedCells.length > 0 ? reroutedCells : route.cellPath,
            cursor: reroutedCells && reroutedCells.length > 0 ? 0 : route.cursor,
            repathAfterUs: nowUs + 1_000_000n,
          });
        }
        if (vessel.velocityX !== 0 || vessel.velocityY !== 0) {
          ctx.db.ship.id.update({
            ...vessel, velocityX: 0, velocityY: 0, updatedAt: ctx.timestamp,
          });
        }
        continue;
      }
      if (stepped.arrived) {
        ctx.db.shipRoute.shipId.delete(vessel.id);
      } else {
        routesRemaining++;
        if (stepped.cursor !== route.cursor) {
          ctx.db.shipRoute.shipId.update({ ...route, cursor: stepped.cursor });
        }
      }
      if (stepped.changed) {
        ctx.db.ship.id.update({
          ...vessel,
          ...stepped.ship,
          updatedAt: ctx.timestamp,
        });
        const body = bodies.find(entry => entry.id === vessel.id);
        if (body) {
          // Later ships in this same transaction collide against the actual,
          // just-updated authoritative position, not last tick's position.
          const index = bodies.indexOf(body);
          bodies[index] = { ...body, x: stepped.ship.x, y: stepped.ship.y };
        }
      }
    }
    // Running one periodic reducer per *moving match* is much cheaper than
    // one schedule row per ship or an always-on tick for every empty lobby.
    if (routesRemaining === 0) {
      ctx.db.motionSchedule.scheduledId.delete(timer.scheduledId);
    } else {
      ctx.db.motionSchedule.scheduledId.update({
        ...timer, lastTickAt: ctx.timestamp,
      });
    }
  },
);

/** The caller's active match seat is the only source of construction ownership. */
export const placeStructure = spacetimedb.reducer(
  { matchId: t.u64(), kind: t.string(), gridX: t.u32(), gridY: t.u32() },
  (ctx, { matchId, kind, gridX, gridY }) => {
    const matchRow = ctx.db.match.id.find(matchId);
    if (!matchRow || !matchStillActive(matchRow.phase, matchRow.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!member || member.eliminated) throw new Error("Cannot construct in another player's match");
    const definition = structureDefinition(kind);
    if (!definition || kind === "command_core") throw new Error("Unknown or protected structure kind");
    const world = ctx.db.worldConfig.matchId.find(matchId);
    if (!world) throw new Error("Missing authoritative world");
    const terrain = decodeTerrainChunks(
      world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(matchId)),
    );
    const existing = Array.from(ctx.db.structure.matchId.filter(matchId));
    const error = validateStructurePlacement({
      kind: kind as StructureKind, ownerSlot: member.slot, gridX, gridY,
      salvage: member.salvage, mapCells: world.mapCells, terrain,
      structures: existing.map(row => ({ ...row, kind: row.kind as StructureKind })),
      deposits: Array.from(ctx.db.salvageNode.matchId.filter(matchId))
        .map(row => ({ x: row.gridX, y: row.gridY })),
      hulls: Array.from(ctx.db.ship.matchId.filter(matchId))
        .map(row => ({ x: row.x, y: row.y, radius: COLLISION_RULES.scoutRadiusCells })),
    });
    if (error) throw new Error(error);
    // A thrown insertion/schedule error rolls back BOTH cost and placement.
    ctx.db.matchMember.id.update({ ...member, salvage: member.salvage - definition.cost });
    const deadline = ctx.timestamp.microsSinceUnixEpoch + BigInt(definition.buildMs) * 1000n;
    const placed = ctx.db.structure.insert({
      id: 0n, matchId, ownerSlot: member.slot, kind,
      channel: definition.channel, gridX, gridY,
      width: definition.width, height: definition.height,
      hp: definition.hp, lastFiredAtUs: -1n, turretAngleDeg: 0, level: 1, upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
      complete: false,
      connected: definition.channel === "superstructure",
      completeAtUs: deadline,
    });
    ctx.db.constructionSchedule.insert({
      scheduledId: 0n, structureId: placed.id,
      scheduledAt: ScheduleAt.time(deadline),
    });
  },
);

/** Owner demolition applies refunds and recomputes live support in one transaction. */
export const demolishStructure = spacetimedb.reducer(
  { structureId: t.u64() },
  (ctx, { structureId }) => {
    const target = ctx.db.structure.id.find(structureId);
    if (!target) throw new Error("Structure unavailable");
    if (target.kind === "command_core") throw new Error("Command Core cannot be demolished");
    const matchRow = ctx.db.match.id.find(target.matchId);
    if (!matchRow || !matchStillActive(matchRow.phase, matchRow.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(target.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!member || member.eliminated || member.slot !== target.ownerSlot) throw new Error("Cannot demolish another faction's structure");
    const definition = structureDefinition(target.kind);
    if (!definition) throw new Error("Unknown stored structure kind");
    const world = ctx.db.worldConfig.matchId.find(target.matchId);
    if (!world) throw new Error("Missing authoritative world");
    const refund = Math.floor(definition.cost * (target.complete ? 0.5 : 0.75));
    let newSalvage = creditSalvage(member.salvage, refund);
    // An uncompleted tier upgrade is refunded if the Workshop is demolished.
    // The pending paid work is deleted with the same structure transaction.
    if (target.kind === "workshop" && target.upgradeRemainingUs > 0n) {
      const pending = nextWorkshopUpgrade(target.level);
      if (pending) newSalvage = creditSalvage(newSalvage, pending.cost);
    }
    const removedYards = new Set<bigint>();
    if (target.kind === "shipyard") removedYards.add(target.id);
    if (newSalvage > 0xffffffff) throw new Error("Salvage overflow");
    ctx.db.structure.id.delete(target.id);
    for (const pending of ctx.db.constructionSchedule.structureId.filter(target.id)) {
      ctx.db.constructionSchedule.scheduledId.delete(pending.scheduledId);
    }
    // Any mounted building losing even one supporting cell collapses without a
    // second refund. Other structures may disconnect but remain as offline decks.
    let remaining = Array.from(ctx.db.structure.matchId.filter(target.matchId));
    const shapes = remaining.map(row => ({ ...row, kind: row.kind as StructureKind }));
    for (const row of remaining) {
      if (row.channel !== "superstructure") continue;
      const support = structureOnline({ ...row, kind: row.kind as StructureKind }, shapes, world.mapCells);
      const stillSupported = (() => {
        for (let dy = 0; dy < row.height; dy++) for (let dx = 0; dx < row.width; dx++) {
          const x = row.gridX + dx, y = row.gridY + dy;
          if (!remaining.some(s => s.channel === "surface" && s.ownerSlot === row.ownerSlot &&
            s.kind === "platform" && s.complete &&
            x >= s.gridX && x < s.gridX + s.width &&
            y >= s.gridY && y < s.gridY + s.height)) return false;
        }
        return true;
      })();
      if (!stillSupported) {
        if (row.kind === "shipyard") removedYards.add(row.id);
        if (row.kind === "workshop" && row.upgradeRemainingUs > 0n) {
          const pending = nextWorkshopUpgrade(row.level);
          if (pending) newSalvage = creditSalvage(newSalvage, pending.cost);
        }
        ctx.db.structure.id.delete(row.id);
        for (const pending of ctx.db.constructionSchedule.structureId.filter(row.id)) {
          ctx.db.constructionSchedule.scheduledId.delete(pending.scheduledId);
        }
      } else if (row.connected !== support) {
        ctx.db.structure.id.update({ ...row, connected: support });
      }
    }
    remaining = Array.from(ctx.db.structure.matchId.filter(target.matchId));
    const currentShapes = remaining.map(row => ({ ...row, kind: row.kind as StructureKind }));
    for (const row of remaining) {
      const connected = structureOnline(
        { ...row, kind: row.kind as StructureKind }, currentShapes, world.mapCells,
      );
      if (row.connected !== connected) ctx.db.structure.id.update({ ...row, connected });
    }
    // Cancel all paid but not yet launched ships when their shipyard is
    // demolished or collapses. Refund once in this same authoritative transaction.
    for (const order of ctx.db.productionOrder.matchId.filter(target.matchId)) {
      if (!removedYards.has(order.yardId)) continue;
      const definition = shipDefinition(order.shipKind);
      if (!definition || order.ownerSlot !== member.slot) {
        throw new Error("Invalid shipyard queue ownership");
      }
      newSalvage = creditSalvage(newSalvage, definition.cost);
      ctx.db.productionOrder.id.delete(order.id);
    }
    ctx.db.matchMember.id.update({ ...member, salvage: newSalvage });
  },
);

/** One-shot completion executes as a trusted internal scheduled transaction. */
export const completeConstruction = spacetimedb.reducer(
  { onSchedule: constructionSchedule },
  { arg: constructionSchedule.rowType },
  (ctx, { arg }) => {
    if (!ctx.senderAuth.isInternal) throw new Error("Construction scheduler is internal-only");
    const pending = ctx.db.constructionSchedule.scheduledId.find(arg.scheduledId);
    if (!pending) return;
    const target = ctx.db.structure.id.find(pending.structureId);
    if (!target) return; // Demolition could have removed the supporting building.
    const phase = ctx.db.match.id.find(target.matchId);
    if (!phase || !matchStillActive(phase.phase, phase.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) return;
    if (target.complete) return;
    if (ctx.timestamp.microsSinceUnixEpoch < target.completeAtUs) {
      throw new Error("Construction completion executed before authoritative deadline");
    }
    ctx.db.structure.id.update({ ...target, complete: true });
    const world = ctx.db.worldConfig.matchId.find(target.matchId);
    if (!world) throw new Error("Missing authoritative world");
    const rows = Array.from(ctx.db.structure.matchId.filter(target.matchId));
    const shapes = rows.map(row => ({ ...row, kind: row.kind as StructureKind }));
    for (const row of rows) {
      const connected = structureOnline({ ...row, kind: row.kind as StructureKind }, shapes, world.mapCells);
      if (row.connected !== connected) ctx.db.structure.id.update({ ...row, connected });
    }
  },
);


/** Reducers are exported by the module entrypoint for generated bindings and tests. */
export {
  orderHarvest, enqueueShip, cancelShipProduction, advanceEconomy,
} from "./economy-reducers.ts";

export {
  repairStructure, repairShip, upgradeWorkshop,
} from "./workshop-reducers.ts";

export { aimWeapon, fireWeapon, advanceCombat } from "./combat-reducers.ts";

export { finishMatchAtDeadline } from "./match-reducers.ts";
