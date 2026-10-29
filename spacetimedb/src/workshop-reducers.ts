import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";
import { structureDefinition } from "./sim/construction.ts";
import { debitSalvage, shipDefinition } from "./sim/economy.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
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
    if (!workshop.complete || !workshop.connected || workshop.hp <= 0 ||
        workshop.upgradeRemainingUs > 0n) throw new Error("Workshop offline or upgrading");

    const target = ctx.db.structure.id.find(structureId);
    if (!target || target.matchId !== workshop.matchId ||
        target.ownerSlot !== member.slot) throw new Error("Structure not owned by this faction");
    if (!target.complete || !target.connected || target.hp <= 0)
      throw new Error("Cannot repair an incomplete, disconnected or destroyed structure");
    const targetDef = structureDefinition(target.kind);
    if (!targetDef) throw new Error("Invalid structure type");
    const workshopPosition = {
      x: workshop.gridX + workshop.width / 2, y: workshop.gridY + workshop.height / 2,
    };
    const targetPosition = { x: target.gridX + target.width / 2, y: target.gridY + target.height / 2 };
    if (!withinWorkshopRange(workshopPosition, targetPosition, workshop.level))
      throw new Error("Repair target out of range");
    const maximumHp = maximumStructureHp(targetDef.hp, target.level, target.kind);
    const result = calculateRepair(target.hp, maximumHp, requestedHp, workshop.level);
    const salvage = debitSalvage(faction.salvage, result.salvageCost);
    ctx.db.factionState.id.update({ ...faction, salvage });
    ctx.db.structure.id.update({ ...target, hp: result.newHp });
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
    if (!workshop.complete || !workshop.connected || workshop.hp <= 0 ||
        workshop.upgradeRemainingUs > 0n) throw new Error("Workshop offline or upgrading");

    const target = ctx.db.ship.id.find(shipId);
    if (!target || target.matchId !== workshop.matchId || target.ownerSlot !== member.slot)
      throw new Error("Ship not owned by this faction");
    if (target.hp <= 0) throw new Error("Cannot repair destroyed ship");
    const shipDef = shipDefinition(target.kind);
    if (!shipDef) throw new Error("Invalid ship type");
    if (!withinWorkshopRange(
      { x: workshop.gridX + workshop.width / 2, y: workshop.gridY + workshop.height / 2 },
      { x: target.x, y: target.y }, workshop.level,
    )) throw new Error("Repair target out of range");
    const result = calculateRepair(target.hp, shipDef.hp, requestedHp, workshop.level);
    const salvage = debitSalvage(faction.salvage, result.salvageCost);
    ctx.db.factionState.id.update({ ...faction, salvage });
    ctx.db.ship.id.update({ ...target, hp: result.newHp, updatedAt: ctx.timestamp });
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
    if (!workshop.complete || !workshop.connected || workshop.hp <= 0)
      throw new Error("Workshop offline");
    if (workshop.upgradeRemainingUs > 0n) throw new Error("Workshop already upgrading");
    const next = nextWorkshopUpgrade(workshop.level);
    if (!next) throw new Error("Workshop already at maximum tier");
    const salvage = debitSalvage(faction.salvage, next.cost);
    ctx.db.factionState.id.update({ ...faction, salvage });
    ctx.db.structure.id.update({
      ...workshop, upgradeRemainingUs: next.durationUs,
      upgradeStartedAtUs: ctx.timestamp.microsSinceUnixEpoch,
    });
  },
);
