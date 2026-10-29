import { t } from "spacetimedb/server";
import spacetimedb, { structure } from "./schema.ts";
import { BOT_RULES } from "./sim/bot-policy.ts";
import { detectBotEnemies, type Sensor } from "./sim/bot-perception.ts";
import { weaponDefinition, COMBAT_RULES } from "./sim/combat.ts";
import { decodeTerrainChunks } from "./sim/navigation.ts";

/** Only client-safe fields. No target HP, orders, resources, hidden world seed or AI plans. */
const detectedContact = t.row("DetectedEnemyContact", {
  contactKey: t.string().primaryKey(),
  matchId: t.u64(),
  entityId: t.u64(),
  entityType: t.string(),
  x: t.f64(),
  y: t.f64(),
});

/** Live sensor-and-terrain-limited enemy view for an authenticated human.
 * Re-evaluates from current indexed match-scoped private rows: no stale
 * enemy contact remains after its sensors or line of sight are lost.
 * This is NOT persistent exploration/fog terrain discovery.
 */
export const myVisibleEnemies = spacetimedb.view(
  { name: "my_visible_enemies", public: true },
  t.array(detectedContact),
  (ctx) => {
    const output: Array<{
      contactKey: string; matchId: bigint; entityId: bigint;
      entityType: string; x: number; y: number;
    }> = [];
    const memberships = Array.from(ctx.db.matchMember.identity.filter(ctx.sender))
      .sort((a,b) => a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0);
    for (const member of memberships) {
      const faction = Array.from(ctx.db.factionState.factionKey.filter(member.factionKey))
        .find(row => row.matchId === member.matchId &&
          row.slot === member.slot && row.controller === "human" && !row.eliminated);
      if (!faction) continue;
      const match = ctx.db.match.id.find(member.matchId);
      if (!match || match.phase !== "active") continue;
      const world = ctx.db.worldConfig.matchId.find(member.matchId);
      if (!world) continue;
      const terrain = decodeTerrainChunks(
        world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(member.matchId)),
      );
      const ships = Array.from(ctx.db.ship.matchId.filter(member.matchId));
      const structures = Array.from(ctx.db.structure.matchId.filter(member.matchId));
      const sensors: Sensor[] = [];
      for (const ship of ships) {
        if (ship.ownerSlot !== member.slot || ship.hp <= 0) continue;
        const weapon = weaponDefinition(ship.kind);
        if (weapon) sensors.push({
          id: ship.id, position: { x: ship.x, y: ship.y }, radius: weapon.vision,
        });
      }
      for (const st of structures) {
        if (st.ownerSlot !== member.slot || st.hp <= 0 ||
            !st.complete || !st.connected) continue;
        if (st.kind === "command_core" || st.kind === "cannon") sensors.push({
          id: st.id,
          position: { x: st.gridX + st.width / 2, y: st.gridY + st.height / 2 },
          radius: st.kind === "command_core" ? BOT_RULES.coreSensorRadius :
            COMBAT_RULES.weapons.cannon.vision,
        });
      }
      if (!sensors.length) continue;
      const contacts = [
        ...ships.map(row => ({
          id: row.id, faction: row.ownerSlot, entityType: "ship" as const,
          position: { x: row.x, y: row.y }, alive: row.hp > 0,
        })),
        ...structures.map(row => ({
          id: row.id, faction: row.ownerSlot, entityType: "structure" as const,
          position: { x: row.gridX + row.width / 2,
            y: row.gridY + row.height / 2 },
          alive: row.hp > 0 && row.complete,
        })),
      ];
      for (const contact of detectBotEnemies(member.slot,
        ctx.timestamp.microsSinceUnixEpoch, sensors, contacts, terrain, world.mapCells)) {
        output.push({
          contactKey: member.matchId.toString() + ":" + contact.entityType + ":" + contact.id.toString(),
          matchId: member.matchId, entityId: contact.id,
          entityType: contact.entityType, x: contact.position.x, y: contact.position.y,
        });
      }
    }
    return output;
  },
);

/** Full allied structure rows may be shared only with the owning human faction. */
export const myStructures = spacetimedb.view(
  { name: "my_structures", public: true },
  t.array(structure.rowType),
  (ctx) => {
    const result: typeof structure.rowType.type[] = [];
    for (const member of ctx.db.matchMember.identity.filter(ctx.sender)) {
      const faction = Array.from(ctx.db.factionState.factionKey.filter(member.factionKey))
        .find(row => row.matchId === member.matchId && row.slot === member.slot &&
          row.controller === "human");
      if (!faction) continue;
      for (const st of ctx.db.structure.matchId.filter(member.matchId))
        if (st.ownerSlot === member.slot) result.push(st);
    }
    return result;
  },
);
