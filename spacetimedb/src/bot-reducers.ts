import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";
import { BOT_RULES, type BotDifficulty } from "./sim/bot-policy.ts";
import { firstFreeSlot, deriveBotSeed } from "./sim/bot-seats.ts";
import { factionKey } from "./sim/faction-ownership.ts";
import { CONSTRUCTION_RULES, initialStructures } from "./sim/construction.ts";
import { ECONOMY_RULES } from "./sim/economy.ts";

/**
 * Humans may provision server-owned BOT seats in the lobby, without connecting
 * a fake Identity or letting the human host own bot ships.
 * Bot thinking/actions have their own later scheduler/validator milestone.
 */
export const addBot = spacetimedb.reducer(
  { matchId: t.u64(), difficulty: t.string() },
  (ctx, { matchId, difficulty }) => {
    const match = ctx.db.match.id.find(matchId);
    if (!match || match.phase !== "lobby") throw new Error("Lobby unavailable");
    if (!match.host.isEqual(ctx.sender)) throw new Error("Only the host may add bots");
    if (!Object.prototype.hasOwnProperty.call(BOT_RULES.difficulties, difficulty))
      throw new Error("Invalid bot difficulty");

    const factions = Array.from(ctx.db.factionState.matchId.filter(matchId));
    const slot = firstFreeSlot(match.maxSlots, factions.map(row => row.slot));
    if (slot === null) throw new Error("Lobby full");
    const world = ctx.db.worldConfig.matchId.find(matchId);
    const spawn = Array.from(ctx.db.worldSpawn.matchId.filter(matchId))
      .find(row => row.slot === slot);
    if (!world || !spawn) throw new Error("Missing server-owned bot spawn");
    const key = factionKey(matchId, slot);
    const newFaction = ctx.db.factionState.insert({
      id: 0n, matchId, slot, factionKey: key, controller: "bot",
      salvage: CONSTRUCTION_RULES.startingSalvage,
      totalSalvageGathered: 0n, eliminated: false,
    });
    ctx.db.botController.insert({
      id: 0n, matchId, factionKey: newFaction.factionKey,
      slot, difficulty, seed: deriveBotSeed(world.seed, slot),
      nextDecisionUs: 0n,
    });

    for (const base of initialStructures(slot, spawn.gridX, spawn.gridY)) {
      const definition = CONSTRUCTION_RULES.definitions[base.kind];
      ctx.db.structure.insert({
        id: 0n, matchId, ownerSlot: slot,
        kind: base.kind, channel: definition.channel,
        gridX: base.gridX, gridY: base.gridY,
        width: base.width, height: base.height, hp: definition.hp,
        lastFiredAtUs: -1n, turretAngleDeg: 0,
        level: 1, upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
        complete: true, connected: true,
        completeAtUs: ctx.timestamp.microsSinceUnixEpoch,
      });
    }
    const x = spawn.gridX - 1.5, y = spawn.gridY + 1.5;
    ctx.db.ship.insert({
      id: 0n, matchId, ownerSlot: slot, factionKey: key,
      kind: "scout", hp: ECONOMY_RULES.ships.scout.hp,
      radiusCells: ECONOMY_RULES.ships.scout.radius,
      x, y, velocityX: 0, velocityY: 0,
      hullAngleDeg: 0, turretAngleDeg: 0, lastFiredAtUs: -1n,
      targetX: x, targetY: y, revision: 0n, updatedAt: ctx.timestamp,
    });
  },
);

/** Host-only removal is limited to lobby time: no in-game free refunds. */
export const removeBot = spacetimedb.reducer(
  { matchId: t.u64(), slot: t.u32() },
  (ctx, { matchId, slot }) => {
    const match = ctx.db.match.id.find(matchId);
    if (!match || match.phase !== "lobby") throw new Error("Lobby unavailable");
    if (!match.host.isEqual(ctx.sender)) throw new Error("Only the host may remove bots");
    const faction = Array.from(ctx.db.factionState.matchId.filter(matchId))
      .find(row => row.slot === slot && row.controller === "bot");
    if (!faction) throw new Error("Bot faction unavailable");
    for (const ship of Array.from(ctx.db.ship.matchId.filter(matchId))) {
      if (ship.ownerSlot === slot) ctx.db.ship.id.delete(ship.id);
    }
    for (const structure of Array.from(ctx.db.structure.matchId.filter(matchId))) {
      if (structure.ownerSlot === slot) ctx.db.structure.id.delete(structure.id);
    }
    for (const bot of Array.from(ctx.db.botController.matchId.filter(matchId))) {
      if (bot.slot === slot) ctx.db.botController.id.delete(bot.id);
    }
    ctx.db.factionState.id.delete(faction.id);
  },
);
