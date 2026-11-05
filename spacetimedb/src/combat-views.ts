import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

/**
 * Combat presentation projections for authenticated match participants.
 * These are member-scoped views, not public base tables: outsider identities
 * receive no orders or projectiles from another match. There is intentionally
 * no Fog of War — every participant sees the same open battlefield.
 */
const ownedAttackOrder = t.row("OwnedAttackOrder", {
  shipId: t.u64().primaryKey(),
  matchId: t.u64(),
  targetType: t.string(),
  targetId: t.u64(),
  issuedAtUs: t.i64(),
});

const battleProjectile = t.row("BattleProjectile", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  sourceFaction: t.u32(),
  sourceId: t.u64(),
  sourceType: t.string(),
  firedAtUs: t.i64(),
  x: t.f64(),
  y: t.f64(),
  vx: t.f64(),
  vy: t.f64(),
  remainingRange: t.f64(),
});

function activeMemberMatches(
  memberships: Iterable<{ matchId: bigint }>,
  phaseForMatch: (matchId: bigint) => string | undefined,
): bigint[] {
  const ids = new Set<bigint>();
  for (const membership of memberships) {
    if (phaseForMatch(membership.matchId) === "active") ids.add(membership.matchId);
  }
  return [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/** Persistent attack targets for the caller's own ships; used for HUD feedback. */
export const myAttackOrders = spacetimedb.view(
  { name: "my_attack_orders", public: true },
  t.array(ownedAttackOrder),
  (ctx) => Array.from(ctx.db.matchMember.identity.filter(ctx.sender)).flatMap(member => {
    const ownShips = Array.from(ctx.db.ship.matchId.filter(member.matchId))
      .filter(ship => ship.ownerSlot === member.slot);
    return Array.from(ctx.db.attackOrder.matchId.filter(member.matchId))
      .filter(order => ownShips.some(ship => ship.id === order.shipId))
      .map(order => ({
        shipId: order.shipId,
        matchId: order.matchId,
        targetType: order.targetType,
        targetId: order.targetId,
        issuedAtUs: order.issuedAtUs,
      }));
  }).sort((a, b) =>
    a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 :
    a.shipId < b.shipId ? -1 : a.shipId > b.shipId ? 1 : 0),
);

/**
 * Real authoritative projectile rows: launch data, current position and
 * remaining travel. Presentation only — damage still resolves server-side.
 */
export const myBattleProjectiles = spacetimedb.view(
  { name: "my_battle_projectiles", public: true },
  t.array(battleProjectile),
  (ctx) => activeMemberMatches(
    ctx.db.matchMember.identity.filter(ctx.sender),
    id => ctx.db.match.id.find(id)?.phase,
  ).flatMap(matchId =>
    Array.from(ctx.db.projectile.matchId.filter(matchId)).map(row => ({
      id: row.id,
      matchId,
      sourceFaction: row.sourceFaction,
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      firedAtUs: row.firedAtUs,
      x: row.x,
      y: row.y,
      vx: row.vx,
      vy: row.vy,
      remainingRange: row.remainingRange,
    }))
  ).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
);
