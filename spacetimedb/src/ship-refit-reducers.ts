import { t, SenderError } from "spacetimedb/server";
import spacetimedb from "./schema.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
import { withinWorkshopRange } from "./sim/workshop.ts";
import { shipDefinition } from "./sim/economy.ts";
import {
  materialBalanceKey,
  type AdvancedResourceKind,
  type ResourceWallet,
} from "./sim/materials.ts";
import {
  NO_SHIP_REFITS, purchaseShipRefit, validShipRefitKind,
  type ShipRefitState,
} from "./sim/ship-refits.ts";

/**
 * Authoritative optional ship specialization. The client cannot supply a
 * price, speed, health, wallet, owner or target transform. An entire refit
 * (Iron debit + Oil/Alloy debit + persistent refit + bonus HP) commits in ONE
 * SpacetimeDB reducer transaction; failures roll back everything.
 */
export const refitShip = spacetimedb.reducer(
  { workshopId: t.u64(), shipId: t.u64(), kind: t.string() },
  (ctx, { workshopId, shipId, kind }) => {
    if (!validShipRefitKind(kind)) throw new SenderError("Unknown refit");
    const workshop = ctx.db.structure.id.find(workshopId);
    const vessel = ctx.db.ship.id.find(shipId);
    if (!workshop || !vessel || workshop.matchId !== vessel.matchId)
      throw new SenderError("Refit target unavailable");
    const matchId = vessel.matchId;
    const match = ctx.db.match.id.find(matchId);
    if (!match || !matchStillActive(match.phase, match.startedAtUs,
      ctx.timestamp.microsSinceUnixEpoch))
      throw new SenderError("Match is not active");
    const membership = Array.from(ctx.db.matchMember.matchId.filter(matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    const faction = membership
      ? Array.from(ctx.db.factionState.matchId.filter(matchId))
          .find(row => row.slot === membership.slot && row.controller === "human")
      : undefined;
    if (!faction || faction.eliminated ||
        vessel.ownerSlot !== faction.slot || workshop.ownerSlot !== faction.slot)
      throw new SenderError("Refit requires your own ship and Workshop");
    if (workshop.kind !== "workshop" || !workshop.complete ||
        !workshop.connected || workshop.hp === 0 ||
        workshop.upgradeRemainingUs > 0n)
      throw new SenderError("Workshop offline or upgrading");
    if (!shipDefinition(vessel.kind) || vessel.hp === 0)
      throw new SenderError("Ship unavailable for refit");
    const center = {
      x: workshop.gridX + workshop.width / 2,
      y: workshop.gridY + workshop.height / 2,
    };
    if (!withinWorkshopRange(center, { x: vessel.x, y: vessel.y }, workshop.level))
      throw new SenderError("Bring the ship within Workshop range");
    if (ctx.db.shipRoute.shipId.find(shipId) ||
        Math.hypot(vessel.velocityX, vessel.velocityY) > 0.01)
      throw new SenderError("Stop the ship before refitting");

    const current = ctx.db.shipRefit.shipId.find(shipId);
    const refits: ShipRefitState = current
      ? { reinforcedHull: current.reinforcedHull, highOutputEngine: current.highOutputEngine }
      : NO_SHIP_REFITS;
    const advanced = Array.from(ctx.db.materialBalance.matchId.filter(matchId))
      .filter(row => row.ownerSlot === faction.slot);
    const wallet: ResourceWallet = {
      iron: faction.salvage,
      oil: advanced.find(row => row.materialKey === materialBalanceKey(matchId, faction.slot, "oil"))?.amount ?? 0,
      alloy: advanced.find(row => row.materialKey === materialBalanceKey(matchId, faction.slot, "alloy"))?.amount ?? 0,
      isotope: advanced.find(row => row.materialKey === materialBalanceKey(matchId, faction.slot, "isotope"))?.amount ?? 0,
    };

    // A missing wallet from a legacy match cannot become a free or partially
    // charged upgrade: it simply has zero advanced materials.
    let purchase: ReturnType<typeof purchaseShipRefit>;
    try {
      purchase = purchaseShipRefit(wallet, refits, kind);
    } catch (error) {
      throw new SenderError(error instanceof Error ? error.message : "Refit unavailable");
    }

    ctx.db.factionState.id.update({ ...faction, salvage: purchase.wallet.iron });
    for (const row of advanced) {
      const material = row.kind as AdvancedResourceKind;
      const balance = purchase.wallet[material];
      if (balance !== undefined && balance !== row.amount)
        ctx.db.materialBalance.id.update({ ...row, amount: balance });
    }
    if (current) ctx.db.shipRefit.shipId.update({
      ...current, ...purchase.state,
    });
    else ctx.db.shipRefit.insert({
      shipId, matchId, ...purchase.state,
    });
    if (purchase.hpBonus > 0) ctx.db.ship.id.update({
      ...vessel, hp: vessel.hp + purchase.hpBonus, updatedAt: ctx.timestamp,
    });
  },
);
