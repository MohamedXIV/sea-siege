import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

/**
 * Shipyard jobs are private. Project only the owning human's production
 * orders into an identity-scoped view, not the global production_order table.
 * SpacetimeDB remains authoritative for job progress and launch conditions.
 */
const ownedJob = t.row("OwnedProductionJob", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  yardId: t.u64(),
  shipKind: t.string(),
  remainingUs: t.i64(),
  startedAtUs: t.i64(),
  queuedAtUs: t.i64(),
});

export const myProductionJobs = spacetimedb.view(
  { name: "my_production_jobs", public: true },
  t.array(ownedJob),
  ctx => Array.from(ctx.db.matchMember.identity.filter(ctx.sender)).flatMap(member => {
    const match = ctx.db.match.id.find(member.matchId);
    const faction = Array.from(ctx.db.factionState.matchId.filter(member.matchId))
      .find(row => row.slot === member.slot && row.controller === "human");
    if (!faction || match?.phase !== "active") return [];
    return Array.from(ctx.db.productionOrder.matchId.filter(member.matchId))
      .filter(order => order.ownerSlot === faction.slot)
      .map(order => ({
        id: order.id, matchId: order.matchId, yardId: order.yardId,
        shipKind: order.shipKind, remainingUs: order.remainingUs,
        startedAtUs: order.startedAtUs, queuedAtUs: order.queuedAtUs,
      }));
  }),
);
