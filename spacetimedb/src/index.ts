import { schema, table, t } from "spacetimedb/server";
import { generateDeterministicWorld } from "./sim/worldgen.ts";

/**
 * Minimal REAL SpacetimeDB module for Sea Siege (not a browser authority clone).
 * Only non-secret lobby metadata is public. Membership and ship state are private
 * until an authenticated, identity-filtered view deliberately exposes them.
 *
 * This file is deliberately limited to a real match/ownership *contract*.
 * Movement ticks, fog of war and ship physics follow in #10/#13; the module has
 * NOT been published or integration-tested yet.
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

const spacetimedb = schema({ match, matchMember, ship, worldConfig, worldSpawn, worldChunk, salvageNode });
export default spacetimedb;

/** Creates lobby + host's ship atomically. Join/start rules will expand in #4/#14. */
export const createMatch = spacetimedb.reducer(
  { seed: t.u32(), maxSlots: t.u32() },
  (ctx, { seed, maxSlots }) => {
    if (maxSlots < 2 || maxSlots > 8) throw new Error("Matches support 2–8 slots");
    // Generate deterministically in a server transaction, not in the browser.
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

/** Order assignment is authoritative; does NOT teleport or move ships. Scheduled
 * steering and collision simulation will consume targetX/targetY in #10. */
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
    ctx.db.ship.id.update({
      ...current,
      targetX,
      targetY,
      revision: current.revision + 1n,
      updatedAt: ctx.timestamp,
    });
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
