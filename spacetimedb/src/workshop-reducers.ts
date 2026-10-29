import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";
import { structureDefinition } from "./sim/construction.ts";
import { debitSalvage, shipDefinition } from "./sim/economy.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
import { dispatchWorkshopRepair, dispatchWorkshopUpgrade } from "./sim/workshop-command-dispatch.ts";
import {
  calculateRepair, maximumStructureHp, nextWorkshopUpgrade,
  withinWorkshopRange,
} from "./sim/workshop.ts";

/**
 * Repairs are single authoritative transactions: the same transaction checks
 * ownership, range, workshop operational state, actual HP, salvage and credit.
 * No client-provided HP, prices, radius, or faction identity is trusted.
 */
export const repairStructure = spacetimedb.reducer(
  { workshopId: t.u64(), structureId: t.u64(), requestedHp: t.u32() },
  (ctx, { workshopId, structureId, requestedHp }) => {
    const workshop = ctx.db.structure.id.find(workshopId);
    if (!workshop || workshop.kind !== "workshop") throw new Error("Workshop unavailable");
    const match = ctx.db.match.id.find(workshop.matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(workshop.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = member ? Array.from(ctx.db.factionState.matchId.filter(workshop.matchId))
      .find(row => row.slot === member.slot && row.controller === "human") : undefined;
    if (!faction || faction.eliminated || faction.slot !== workshop.ownerSlot)
      throw new Error("Not your workshop");
    const target = ctx.db.structure.id.find(structureId);
    const result = dispatchWorkshopRepair({
      faction: { matchId: workshop.matchId, slot: faction.slot,
        controller: "human", eliminated: faction.eliminated },
      workshop, target: target ? {
        id: target.id, matchId: target.matchId, ownerSlot: target.ownerSlot,
        type: "structure", kind: target.kind, hp: target.hp, level: target.level,
        complete: target.complete, connected: target.connected,
        x: target.gridX + target.width / 2,
        y: target.gridY + target.height / 2,
      } : null,
      requestedHp, salvage: faction.salvage,
    }, {
      setBalance: salvage => {
        ctx.db.factionState.id.update({ ...faction, salvage });
      },
      setTargetHp: (_,hp) => {
        if (!target) throw new Error("Structure disappeared during repair");
        ctx.db.structure.id.update({ ...target, hp });
      },
    });
    if (!result.ok) throw new Error(result.reason);
  },
);

/** Allied vessels are repaired by nearby workshops, not by remote client calls. */
export const repairShip = spacetimedb.reducer(
  { workshopId: t.u64(), shipId: t.u64(), requestedHp: t.u32() },
  (ctx, { workshopId, shipId, requestedHp }) => {
    const workshop = ctx.db.structure.id.find(workshopId);
    if (!workshop || workshop.kind !== "workshop") throw new Error("Workshop unavailable");
    const match = ctx.db.match.id.find(workshop.matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(workshop.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = member ? Array.from(ctx.db.factionState.matchId.filter(workshop.matchId))
      .find(row => row.slot === member.slot && row.controller === "human") : undefined;
    if (!faction || faction.eliminated || faction.slot !== workshop.ownerSlot)
      throw new Error("Not your workshop");
    const target = ctx.db.ship.id.find(shipId);
    const result = dispatchWorkshopRepair({
      faction: { matchId: workshop.matchId, slot: faction.slot,
        controller: "human", eliminated: faction.eliminated },
      workshop, target: target ? {
        id: target.id, matchId: target.matchId, ownerSlot: target.ownerSlot,
        type: "ship", kind: target.kind, hp: target.hp, level: 1,
        complete: true, connected: true, x: target.x, y: target.y,
      } : null,
      requestedHp, salvage: faction.salvage,
    }, {
      setBalance: salvage => {
        ctx.db.factionState.id.update({ ...faction, salvage });
      },
      setTargetHp: (_,hp) => {
        if (!target) throw new Error("Ship disappeared during repair");
        ctx.db.ship.id.update({ ...target, hp, updatedAt: ctx.timestamp });
      },
    });
    if (!result.ok) throw new Error(result.reason);
  },
);

/**
 * A workshop can upgrade only one tier at a time; all cost/progress is private,
 * saved in the authoritative structure row and consumed on the economy tick.
 */
export const upgradeWorkshop = spacetimedb.reducer(
  { workshopId: t.u64() },
  (ctx, { workshopId }) => {
    const workshop = ctx.db.structure.id.find(workshopId);
    if (!workshop || workshop.kind !== "workshop") throw new Error("Workshop unavailable");
    const match = ctx.db.match.id.find(workshop.matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs, ctx.timestamp.microsSinceUnixEpoch)) throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(workshop.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = member ? Array.from(ctx.db.factionState.matchId.filter(workshop.matchId))
      .find(row => row.slot === member.slot && row.controller === "human") : undefined;
    if (!faction || faction.eliminated || faction.slot !== workshop.ownerSlot)
      throw new Error("Not your workshop");
    const result = dispatchWorkshopUpgrade({
      faction: { matchId: workshop.matchId, slot: faction.slot,
        controller: "human", eliminated: faction.eliminated },
      workshop, salvage: faction.salvage,
      nowUs: ctx.timestamp.microsSinceUnixEpoch,
    }, {
      setBalance: salvage => {
        ctx.db.factionState.id.update({ ...faction, salvage });
      },
      setUpgrade: (remainingUs,startedAtUs) => {
        ctx.db.structure.id.update({
          ...workshop, upgradeRemainingUs: remainingUs,
          upgradeStartedAtUs: startedAtUs,
        });
      },
    });
    if (!result.ok) throw new Error(result.reason);
  },
);
