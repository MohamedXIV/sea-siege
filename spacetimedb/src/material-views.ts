import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

/**
 * Only match participants may see a known battlefield's deposits.
 * Only a human owner may see their own advanced-resource balances.
 * These are projections; the raw material tables stay private.
 */
const knownMaterial = t.row("KnownMaterialDeposit", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  kind: t.string(),
  gridX: t.u32(),
  gridY: t.u32(),
  remaining: t.u32(),
  capacity: t.u32(),
  contested: t.bool(),
});

const ownedBalance = t.row("OwnedMaterialBalance", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  kind: t.string(),
  amount: t.u32(),
});

export const myMaterialDeposits = spacetimedb.view(
  { name: "my_material_deposits", public: true },
  t.array(knownMaterial),
  ctx => {
    const ids = new Set<bigint>();
    for (const member of ctx.db.matchMember.identity.filter(ctx.sender)) {
      const match = ctx.db.match.id.find(member.matchId);
      if (match?.phase === "active") ids.add(member.matchId);
    }
    return [...ids].flatMap(matchId =>
      Array.from(ctx.db.materialNode.matchId.filter(matchId))
        .map(node => ({
          id: node.id, matchId: node.matchId, kind: node.kind,
          gridX: node.gridX, gridY: node.gridY,
          remaining: node.remaining, capacity: node.capacity,
          contested: node.contested,
        }))
    );
  },
);

export const myMaterialBalances = spacetimedb.view(
  { name: "my_material_balances", public: true },
  t.array(ownedBalance),
  ctx => Array.from(ctx.db.matchMember.identity.filter(ctx.sender)).flatMap(member => {
    const faction = Array.from(ctx.db.factionState.matchId.filter(member.matchId))
      .find(row => row.slot === member.slot && row.controller === "human");
    if (!faction) return [];
    return Array.from(ctx.db.materialBalance.matchId.filter(member.matchId))
      .filter(row => row.ownerSlot === member.slot)
      .map(row => ({
        id: row.id, matchId: row.matchId,
        kind: row.kind, amount: row.amount,
      }));
  }),
);
