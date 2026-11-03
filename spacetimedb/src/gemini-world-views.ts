import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

/**
 * Gemini-reference gameplay uses a completely known battlefield.
 * These are member-scoped presentation projections, NOT public DB tables:
 * outsiders receive no chunks, nodes, ships or structures from a match.
 * Never expose private order queues, server seeds, AI plans or credentials.
 */
const knownChunk = t.row("GeminiKnownChunk", {
  chunkKey: t.string().primaryKey(),
  matchId: t.u64(),
  chunkX: t.u32(),
  chunkY: t.u32(),
  mapCells: t.u32(),
  terrain: t.array(t.u8()),
});
const knownSalvage = t.row("GeminiKnownSalvage", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  gridX: t.u32(),
  gridY: t.u32(),
  remaining: t.u32(),
  capacity: t.u32(),
  contested: t.bool(),
});
const visibleShip = t.row("GeminiBattleShip", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  ownerSlot: t.u32(),
  kind: t.string(),
  hp: t.u32(),
  radiusCells: t.f64(),
  x: t.f64(),
  y: t.f64(),
  velocityX: t.f64(),
  velocityY: t.f64(),
  hullAngleDeg: t.f64(),
  turretAngleDeg: t.f64(),
  revision: t.u64(),
});
const visibleStructure = t.row("GeminiBattleStructure", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  ownerSlot: t.u32(),
  kind: t.string(),
  channel: t.string(),
  gridX: t.u32(),
  gridY: t.u32(),
  width: t.u32(),
  height: t.u32(),
  hp: t.u32(),
  complete: t.bool(),
  connected: t.bool(),
  turretAngleDeg: t.f64(),
});

function authorizedMatches(ctx: any): bigint[] {
  const ids = new Set<bigint>();
  for (const membership of ctx.db.matchMember.identity.filter(ctx.sender)) {
    const match = ctx.db.match.id.find(membership.matchId);
    if (!match || match.phase !== "active") continue;
    ids.add(membership.matchId);
  }
  return Array.from(ids).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export const myGeminiWorldChunks = spacetimedb.view(
  { name: "my_gemini_world_chunks", public: true },
  t.array(knownChunk),
  (ctx) => authorizedMatches(ctx).flatMap(matchId => {
    const config = ctx.db.worldConfig.matchId.find(matchId);
    if (!config) return [];
    return Array.from(ctx.db.worldChunk.matchId.filter(matchId)).map(chunk => ({
      chunkKey: matchId.toString() + ":" + chunk.chunkX + ":" + chunk.chunkY,
      matchId,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      mapCells: config.mapCells,
      terrain: [...chunk.terrain],
    }));
  }),
);

export const myGeminiSalvage = spacetimedb.view(
  { name: "my_gemini_salvage", public: true },
  t.array(knownSalvage),
  (ctx) => authorizedMatches(ctx).flatMap(matchId =>
    Array.from(ctx.db.salvageNode.matchId.filter(matchId)).map(node => ({
      id: node.id,
      matchId,
      gridX: node.gridX,
      gridY: node.gridY,
      remaining: node.remaining,
      capacity: node.capacity,
      contested: node.contested,
    }))
  ),
);

export const myGeminiShips = spacetimedb.view(
  { name: "my_gemini_ships", public: true },
  t.array(visibleShip),
  (ctx) => authorizedMatches(ctx).flatMap(matchId =>
    Array.from(ctx.db.ship.matchId.filter(matchId))
      .filter(ship => ship.hp > 0)
      .map(ship => ({
        id: ship.id,
        matchId,
        ownerSlot: ship.ownerSlot,
        kind: ship.kind,
        hp: ship.hp,
        radiusCells: ship.radiusCells,
        x: ship.x,
        y: ship.y,
        velocityX: ship.velocityX,
        velocityY: ship.velocityY,
        hullAngleDeg: ship.hullAngleDeg,
        turretAngleDeg: ship.turretAngleDeg,
        revision: ship.revision,
      }))
  ),
);

export const myGeminiStructures = spacetimedb.view(
  { name: "my_gemini_structures", public: true },
  t.array(visibleStructure),
  (ctx) => authorizedMatches(ctx).flatMap(matchId =>
    Array.from(ctx.db.structure.matchId.filter(matchId))
      .filter(st => st.hp > 0)
      .map(st => ({
        id: st.id,
        matchId,
        ownerSlot: st.ownerSlot,
        kind: st.kind,
        channel: st.channel,
        gridX: st.gridX,
        gridY: st.gridY,
        width: st.width,
        height: st.height,
        hp: st.hp,
        complete: st.complete,
        connected: st.connected,
        turretAngleDeg: st.turretAngleDeg,
      }))
  ),
);
