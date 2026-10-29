import { schema, table, t } from "spacetimedb/server";

/** Private authoritative Sea Siege tables. Only non-sensitive match metadata is public. */
const match = table(
  { name: "match", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    host: t.identity(),
    phase: t.string(),
    maxSlots: t.u32(),
    winnerSlot: t.i32(), // -1 for draw/unresolved
    victoryReason: t.string(),
    winningScore5: t.u64(), // score units are fifths; 0 for non-timeout outcomes
    startedAtUs: t.i64(),
    endedAtUs: t.i64(),
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
    factionKey: t.string().index("btree"),
    salvage: t.u32(),
    totalSalvageGathered: t.u64(),
    eliminated: t.bool(),
  },
);

const ship = table(
  { name: "ship" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    ownerSlot: t.u32(),
    factionKey: t.string().index("btree"),
    kind: t.string(),
    hp: t.u32(),
    radiusCells: t.f64(),
    x: t.f64(),
    y: t.f64(),
    velocityX: t.f64(),
    velocityY: t.f64(),
    hullAngleDeg: t.f64(),
    turretAngleDeg: t.f64(),
    lastFiredAtUs: t.i64(),
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


/** Each ship can harvest one server-authorized salvage node at a time. */
const harvestOrder = table(
  { name: "harvest_order" },
  {
    shipId: t.u64().primaryKey(),
    matchId: t.u64().index("btree"),
    nodeId: t.u64(),
    assignedAtUs: t.i64(),
  },
);

/** Per-yard FIFO production. An order is charged exactly once at enqueue. */
const productionOrder = table(
  { name: "production_order" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    yardId: t.u64().index("btree"),
    ownerSlot: t.u32(),
    shipKind: t.string(),
    remainingUs: t.i64(),
    queuedAtUs: t.i64(),
    startedAtUs: t.i64(),
  },
);

/** One deterministic 1Hz economy timer for every active match. */
export const economySchedule = table(
  { name: "economy_schedule" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
    lastTickAt: t.timestamp(),
    leftoverUs: t.u64(),
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
    repathAfterUs: t.i64(), // Rate-limit expensive dynamic rerouting during congestion
  },
);

/**
 * Lazy per-match timer: a scheduled reducer is not an open websocket client.
 * There is no timer while a match is idle, and no timer per ship.
 */
export const motionSchedule = table(
  { name: "motion_schedule" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
    lastTickAt: t.timestamp(),
  },
);


/** Owned physical structures; the surface and mounted layers may coexist. */
const structure = table(
  { name: "structure" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    ownerSlot: t.u32(),
    kind: t.string(),
    channel: t.string(),
    gridX: t.u32(),
    gridY: t.u32(),
    width: t.u32(),
    height: t.u32(),
    hp: t.u32(),
    lastFiredAtUs: t.i64(),
    turretAngleDeg: t.f64(),
    level: t.u32(),                // Workshop tier (other kinds remain level 1)
    upgradeRemainingUs: t.i64(),  // 0 when no upgrade is pending
    upgradeStartedAtUs: t.i64(),  // Server clock, prevents retroactive progress
    complete: t.bool(),
    connected: t.bool(),
    completeAtUs: t.i64(),
  },
);

/** One-shot construction completion; the authoritative deadline is server time. */
export const constructionSchedule = table(
  { name: "construction_schedule" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    structureId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
  },
);


/** All projectile state stays private until identity-filtered FoW views exist. */
const projectile = table(
  { name: "projectile" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    sourceFaction: t.u32(),
    sourceId: t.u64(),
    sourceType: t.string(),
    firedAtUs: t.i64(),
    x: t.f64(), y: t.f64(),
    vx: t.f64(), vy: t.f64(),
    damage: t.u32(), splash: t.f64(),
    structureMultiplier: t.f64(),
    remainingRange: t.f64(),
  },
);

/** One lazy timer per active combat match, never one per projectile. */
export const combatSchedule = table(
  { name: "combat_schedule" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
    lastTickAt: t.timestamp(),
  },
);


/** Ephemeral but persisted rotation intentions. No client-supplied transform updates. */
const turretAim = table(
  { name: "turret_aim" },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    sourceType: t.string(),
    sourceId: t.u64(),
    desiredAngleDeg: t.f64(),
  },
);


/** Single one-shot, 12-minute match deadline; never one timer per player. */
export const matchDeadline = table(
  { name: "match_deadline" },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index("btree"),
    scheduledAt: t.scheduleAt(),
    deadlineUs: t.i64(),
  },
);

const spacetimedb = schema({
  match, matchMember, ship, shipRoute, motionSchedule,
  worldConfig, worldSpawn, worldChunk, salvageNode, structure, constructionSchedule,
  harvestOrder, productionOrder, economySchedule, projectile, combatSchedule, turretAim,
  matchDeadline,
});
export default spacetimedb;
