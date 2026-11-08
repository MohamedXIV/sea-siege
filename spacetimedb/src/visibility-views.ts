import { t } from "spacetimedb/server";
import spacetimedb, { structure } from "./schema.ts";

/**
 * Known-world naval RTS: all live enemy ship and structure positions are
 * visible to each authenticated match participant throughout an active game.
 * This does NOT publish private server rows, control data or other matches.
 *
 * The view and row type retain their historic 'visible enemies' identifiers
 * to preserve existing generated client bindings during the parity migration.
 * Its gameplay semantics are now OPEN BATTLEFIELD, not sensor-limited FoW.
 */
const detectedContact = t.row("DetectedEnemyContact", {
  contactKey: t.string().primaryKey(),
  matchId: t.u64(),
  entityId: t.u64(),
  entityType: t.string(),
  x: t.f64(),
  y: t.f64(),
});

export const myVisibleEnemies = spacetimedb.view(
  { name: "my_visible_enemies", public: true },
  t.array(detectedContact),
  (ctx) => {
    const output: Array<{
      contactKey: string; matchId: bigint; entityId: bigint;
      entityType: string; x: number; y: number;
    }> = [];
    const members = Array.from(ctx.db.matchMember.identity.filter(ctx.sender))
      .sort((a, b) => a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0);

    for (const member of members) {
      const ownSeat = Array.from(ctx.db.factionState.factionKey.filter(member.factionKey))
        .find(row => row.matchId === member.matchId &&
          row.slot === member.slot && row.controller === "human");
      if (!ownSeat) continue;

      const match = ctx.db.match.id.find(member.matchId);
      if (!match || match.phase !== "active") continue;

      for (const ship of ctx.db.ship.matchId.filter(member.matchId)) {
        if (ship.ownerSlot === member.slot || ship.hp <= 0) continue;
        output.push({
          contactKey: member.matchId.toString() + ":ship:" + ship.id.toString(),
          matchId: member.matchId, entityId: ship.id,
          entityType: "ship", x: ship.x, y: ship.y,
        });
      }

      for (const st of ctx.db.structure.matchId.filter(member.matchId)) {
        if (st.ownerSlot === member.slot || st.hp <= 0 || !st.complete) continue;
        output.push({
          contactKey: member.matchId.toString() + ":structure:" + st.id.toString(),
          matchId: member.matchId, entityId: st.id, entityType: "structure",
          x: st.gridX + st.width / 2, y: st.gridY + st.height / 2,
        });
      }
    }

    return output.sort((a, b) =>
      a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 :
      a.contactKey.localeCompare(b.contactKey));
  },
);

/** Full allied structure rows may be shared only with the owning human faction. */
export const myStructures = spacetimedb.view(
  { name: "my_structures", public: true },
  t.array(structure.rowType),
  (ctx) => Array.from(ctx.db.matchMember.identity.filter(ctx.sender)).flatMap(member => {
    const faction = Array.from(ctx.db.factionState.factionKey.filter(member.factionKey))
      .find(row => row.matchId === member.matchId &&
        row.slot === member.slot && row.controller === "human");
    if (!faction) return [];
    return Array.from(ctx.db.structure.matchId.filter(member.matchId))
      .filter(st => st.ownerSlot === member.slot);
  }),
);
