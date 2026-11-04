import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

/** Only the ship's owning human may view its optional Workshop refits. */
const ownedShipRefit = t.row("OwnedShipRefit", {
  shipId: t.u64().primaryKey(),
  matchId: t.u64(),
  reinforcedHull: t.bool(),
  highOutputEngine: t.bool(),
});

export const myShipRefits = spacetimedb.view(
  { name: "my_ship_refits", public: true },
  t.array(ownedShipRefit),
  ctx => Array.from(ctx.db.matchMember.identity.filter(ctx.sender)).flatMap(member => {
    const faction = Array.from(ctx.db.factionState.matchId.filter(member.matchId))
      .find(row => row.slot === member.slot && row.controller === "human");
    const match = ctx.db.match.id.find(member.matchId);
    if (!faction || match?.phase !== "active") return [];
    const owned = new Set(
      Array.from(ctx.db.ship.matchId.filter(member.matchId))
        .filter(row => row.ownerSlot === faction.slot).map(row => row.id),
    );
    return Array.from(ctx.db.shipRefit.matchId.filter(member.matchId))
      .filter(row => owned.has(row.shipId))
      .map(row => ({
        shipId: row.shipId, matchId: row.matchId,
        reinforcedHull: row.reinforcedHull, highOutputEngine: row.highOutputEngine,
      }));
  }),
);
