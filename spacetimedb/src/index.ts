import { ScheduleAt } from "spacetimedb";
import { schema, table, t } from "spacetimedb/server";
import { generateDeterministicWorld } from "./sim/worldgen.ts";
import { decodeTerrainChunks, findTerrainPath } from "./sim/navigation.ts";
import { advanceShipOnRoute, boundedDeltaSeconds, SHIP_MOTION_RULES } from "./sim/ship-motion.ts";

/**
 * Minimal REAL SpacetimeDB module for Sea Siege (not a browser authority clone).
 * Only non-secret lobby metadata is public. Membership and ship state are private
 * until an authenticated, identity-filtered view deliberately exposes them.
 *
 * Basic route-following movement now runs through a server-only scheduled
 * reducer. Dynamic collision, visibility, and production gameplay are still
 * pending. This module has NOT been published or integration-tested yet.
 */
const match = table(
  { name: "match", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    host: t.identity(),
    phase: t.string(),
    maxSlots: t.u32(),
    createdAt: t.timestamp(),
  },
);

const matchMember = table(
  { name: "match_member" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    identity: t.identity().index("btree"),
    slot: t.u32(),
  },
);

const ship = table(
  { name: "ship" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    owner: t.identity().index("btree"),
    x: t.f64(),
    y: t.f64(),
    velocityX: t.f64(),
    velocityY: t.f64(),
    hullAngleDeg: t.f64(),
    turretAngleDeg: t.f64(),
    targetX: t.f64(),
    targetY: t.f64(),
    revision: t.u64(),
    updatedAt: t.timestamp(),
  },
);


/** Secret generation parameters: public match rows must NEVER expose the world seed. */
const worldConfig = table(
  { name: "world_config" },
  {
    matchId: t.u64().primaryKey(),
    seed: t.u32(),
    mapCells: t.u32(),
  },
);

/** True starting positions are server-owned; not exposed ahead of discovery. */
const worldSpawn = table(
  { name: "world_spawn" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    slot: t.u32(),
    gridX: t.u32(),
    gridY: t.u32(),
  },
);

/** Static 16x16 terrain chunks, stored once per match; no per-tile DB rows. */
const worldChunk = table(
  { name: "world_chunk" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    chunkX: t.u32(),
    chunkY: t.u32(),
    terrain: t.array(t.u8()),
  },
);

/** Mutable salvage deposits are separate from immutable chunk terrain. */
const salvageNode = table(
  { name: "salvage_node" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    gridX: t.u32(),
    gridY: t.u32(),
    capacity: t.u32(),
    remaining: t.u32(),
    regenPerSec: t.u32(),
    contested: t.bool(),
  },
);

/** Server-owned navigation route, not published to unauthorized players. */
const shipRoute = table(
  { name: "ship_route" },
  {
    shipId: t.u64().primaryKey(),
    matchId: t.u64().index("btree"),
    cellPath: t.array(t.u32()),
    cursor: t.u32(),
    revision: t.u64(),
  },
);

/**
 * Lazy per-match timer: a scheduled reducer is not an open websocket client.
 * There is no timer while a match is idle, and no timer per ship.
 */
const motionSchedule = table(
  { name: "motion_schedule" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
    lastTickAt: t.timestamp(),
  },
);

const spacetimedb = schema({
  match, matchMember, ship, shipRoute, motionSchedule,
  worldConfig, worldSpawn, worldChunk, salvageNode,
});
export default spacetimedb;

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
    ctx.db.matchMember.insert({ id: 0n, matchId: created.id, identity: ctx.sender, slot: 0 });
    const initial = world.spawns[0]!;
    const initialX = initial.gridX + 1.5;
    const initialY = initial.gridY + 1.5;
    ctx.db.ship.insert({
      id: 0n,
      matchId: created.id,
      owner: ctx.sender,
      x: initialX,
      y: initialY,
      velocityX: 0,
      velocityY: 0,
      hullAngleDeg: 0,
      turretAngleDeg: 0,
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
    ctx.db.matchMember.insert({ id: 0n, matchId, identity: ctx.sender, slot });
    const spawn = Array.from(ctx.db.worldSpawn.matchId.filter(matchId)).find(row => row.slot === slot);
    if (!spawn) throw new Error("Missing server-owned spawn assignment");
    const x = spawn.gridX + 1.5;
    const y = spawn.gridY + 1.5;
    ctx.db.ship.insert({
      id: 0n,
      matchId,
      owner: ctx.sender,
      x,
      y,
      velocityX: 0,
      velocityY: 0,
      hullAngleDeg: 0,
      turretAngleDeg: 0,
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
    ctx.db.match.id.update({ ...lobby, phase: "active" });
  },
);

/** Orders are owner-validated and route-planned against stored static terrain.
 * The lazy internal-only scheduler moves ships after a valid order. Future
 * dynamic structure occupancy must become part of the route predicate. */
export const issueShipOrder = spacetimedb.reducer(
  { shipId: t.u64(), targetX: t.f64(), targetY: t.f64() },
  (ctx, { shipId, targetX, targetY }) => {
    const current = ctx.db.ship.id.find(shipId);
    if (!current) throw new Error("Ship unavailable");
    if (!current.owner.isEqual(ctx.sender)) throw new Error("Cannot command another player's ship");
    const match = ctx.db.match.id.find(current.matchId);
    if (!match || match.phase !== "active") throw new Error("Match is not active");
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
    const route = findTerrainPath(
      terrain, config.mapCells,
      { x: current.x, y: current.y },
      { x: targetX, y: targetY },
    );
    if (!route) throw new Error("Destination unreachable");
    const nextRevision = current.revision + 1n;
    const cellPath = route.waypoints.slice(1).map(
      point => Math.floor(point.y) * config.mapCells + Math.floor(point.x),
    );
    const existing = ctx.db.shipRoute.shipId.find(shipId);
    if (cellPath.length === 0) {
      if (existing) ctx.db.shipRoute.shipId.delete(shipId);
    } else if (existing) {
      ctx.db.shipRoute.shipId.update({
        ...existing, cellPath, cursor: 0, revision: nextRevision,
      });
    } else {
      ctx.db.shipRoute.insert({
        shipId, matchId: current.matchId,
        cellPath, cursor: 0, revision: nextRevision,
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
  (ctx) => ctx.from.ship.where((row) => row.owner.eq(ctx.sender)),
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
    if (!current.owner.isEqual(ctx.sender)) throw new Error("Cannot command another player's ship");
    const lobby = ctx.db.match.id.find(current.matchId);
    if (!lobby || lobby.phase !== "active") throw new Error("Match is not active");
    ctx.db.shipRoute.shipId.delete(shipId);
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
    if (!active || active.phase !== "active") {
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

    let routesRemaining = 0;
    for (const vessel of ctx.db.ship.matchId.filter(timer.matchId)) {
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
