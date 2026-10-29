import { t } from "spacetimedb/server";
import spacetimedb, { economySchedule } from "./schema.ts";
import { decodeTerrainChunks } from "./sim/navigation.ts";
import { progressWorkshopUpgrade } from "./sim/workshop.ts";
import {
  ECONOMY_RULES, advanceProduction, cappedElapsedUs, creditSalvage,
  debitSalvage, drawSalvage, replenishSalvage, inRange, rigExtraction,
  shipDefinition, findShipyardSpawn, type ShipKind,
} from "./sim/economy.ts";

/** A legal stationary scout/gunboat extracts only from a nearby authorized node. */
export const orderHarvest = spacetimedb.reducer(
  { shipId: t.u64(), nodeId: t.u64() },
  (ctx, { shipId, nodeId }) => {
    const vessel = ctx.db.ship.id.find(shipId);
    if (!vessel) throw new Error("Ship unavailable");
    if (!vessel.owner.isEqual(ctx.sender)) throw new Error("Cannot command another player's ship");
    const matchRow = ctx.db.match.id.find(vessel.matchId);
    if (!matchRow || matchRow.phase !== "active") throw new Error("Match is not active");
    const definition = shipDefinition(vessel.kind);
    if (!definition || definition.harvestPerSecond === 0) throw new Error("Ship cannot harvest");
    const node = ctx.db.salvageNode.id.find(nodeId);
    if (!node || node.matchId !== vessel.matchId) throw new Error("Salvage node unavailable");
    if (!inRange(
      { x: vessel.x, y: vessel.y },
      { x: node.gridX + 0.5, y: node.gridY + 0.5 },
      ECONOMY_RULES.harvestRangeCells,
    )) throw new Error("Salvage node out of range");
    // Only one locomotion/harvest command may control a ship.
    ctx.db.shipRoute.shipId.delete(shipId);
    const old = ctx.db.harvestOrder.shipId.find(shipId);
    if (old) ctx.db.harvestOrder.shipId.update({
      ...old, nodeId, assignedAtUs: ctx.timestamp.microsSinceUnixEpoch,
    });
    else ctx.db.harvestOrder.insert({
      shipId, matchId: vessel.matchId, nodeId,
      assignedAtUs: ctx.timestamp.microsSinceUnixEpoch,
    });
    ctx.db.ship.id.update({
      ...vessel, velocityX: 0, velocityY: 0,
      targetX: vessel.x, targetY: vessel.y,
      revision: vessel.revision + 1n,
      updatedAt: ctx.timestamp,
    });
  },
);

/** The queue is FIFO, charges once, and never trusts a client-supplied owner/cost. */
export const enqueueShip = spacetimedb.reducer(
  { shipyardId: t.u64(), kind: t.string() },
  (ctx, { shipyardId, kind }) => {
    const yard = ctx.db.structure.id.find(shipyardId);
    if (!yard || yard.kind !== "shipyard") throw new Error("Shipyard unavailable");
    const matchRow = ctx.db.match.id.find(yard.matchId);
    if (!matchRow || matchRow.phase !== "active") throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(yard.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!member || member.slot !== yard.ownerSlot) throw new Error("Not your shipyard");
    if (!yard.complete || !yard.connected || yard.hp <= 0) throw new Error("Shipyard offline");
    const definition = shipDefinition(kind);
    if (!definition) throw new Error("Unknown ship kind");
    const queueLength = Array.from(ctx.db.productionOrder.yardId.filter(shipyardId)).length;
    if (queueLength >= ECONOMY_RULES.shipyardQueueLimit) throw new Error("Shipyard queue full");
    const salvage = debitSalvage(member.salvage, definition.cost);
    ctx.db.matchMember.id.update({ ...member, salvage });
    ctx.db.productionOrder.insert({
      id: 0n, matchId: yard.matchId, yardId: shipyardId,
      ownerSlot: member.slot, shipKind: kind,
      remainingUs: BigInt(definition.buildMs) * 1_000n,
      queuedAtUs: ctx.timestamp.microsSinceUnixEpoch,
      startedAtUs: 0n,
    });
  },
);

/** Cancellation is safe only while the paid order still exists. */
export const cancelShipProduction = spacetimedb.reducer(
  { orderId: t.u64() },
  (ctx, { orderId }) => {
    const order = ctx.db.productionOrder.id.find(orderId);
    if (!order) throw new Error("Production order unavailable");
    const matchRow = ctx.db.match.id.find(order.matchId);
    if (!matchRow || matchRow.phase !== "active") throw new Error("Match is not active");
    const member = Array.from(ctx.db.matchMember.matchId.filter(order.matchId))
      .find(row => row.identity.isEqual(ctx.sender));
    if (!member || member.slot !== order.ownerSlot) throw new Error("Not your production order");
    const definition = shipDefinition(order.shipKind);
    if (!definition) throw new Error("Unknown ship kind");
    ctx.db.productionOrder.id.delete(order.id);
    ctx.db.matchMember.id.update({
      ...member, salvage: creditSalvage(member.salvage, definition.cost),
    });
  },
);

/** One real scheduled transaction applies income, node state, harvest, and FIFO production. */
export const advanceEconomy = spacetimedb.reducer(
  { onSchedule: economySchedule },
  { arg: economySchedule.rowType },
  (ctx, { arg }) => {
    if (!ctx.senderAuth.isInternal) throw new Error("Economy scheduler is internal-only");
    const timer = ctx.db.economySchedule.scheduledId.find(arg.scheduledId);
    if (!timer) return;
    const matchRow = ctx.db.match.id.find(timer.matchId);
    if (!matchRow || matchRow.phase !== "active") {
      ctx.db.economySchedule.scheduledId.delete(timer.scheduledId);
      return;
    }
    const nowUs = ctx.timestamp.microsSinceUnixEpoch;
    const elapsedUs = cappedElapsedUs(timer.lastTickAt.microsSinceUnixEpoch, nowUs);
    const microseconds = elapsedUs + timer.leftoverUs;
    const seconds = Number(microseconds / 1_000_000n);
    if (elapsedUs === 0n && seconds === 0) return;
    const members = Array.from(ctx.db.matchMember.matchId.filter(timer.matchId));
    const balances = new Map(members.map(member => [member.slot, member.salvage]));
    const credit = (slot: number, amount: number) => {
      const previous = balances.get(slot);
      if (previous !== undefined && amount > 0) balances.set(slot, creditSalvage(previous, amount));
    };
    const structures = Array.from(ctx.db.structure.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    // Progress upgrades only for complete, connected and living Workshops.
    // Newly issued upgrades cannot inherit time from before their order.
    for (const row of structures) {
      if (row.kind !== "workshop" || row.upgradeRemainingUs <= 0n) continue;
      const operational = row.complete && row.connected && row.hp > 0;
      const activeSince = row.upgradeStartedAtUs > timer.lastTickAt.microsSinceUnixEpoch
        ? row.upgradeStartedAtUs : timer.lastTickAt.microsSinceUnixEpoch;
      const eligibleUs = nowUs > activeSince
        ? (nowUs - activeSince < elapsedUs ? nowUs - activeSince : elapsedUs)
        : 0n;
      const remainingUs = progressWorkshopUpgrade(row.upgradeRemainingUs, eligibleUs, operational);
      if (remainingUs === 0n) {
        ctx.db.structure.id.update({
          ...row, level: row.level + 1,
          upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
        });
      } else if (remainingUs !== row.upgradeRemainingUs) {
        ctx.db.structure.id.update({ ...row, upgradeRemainingUs: remainingUs });
      }
    }
    const nodes = Array.from(ctx.db.salvageNode.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const remaining = new Map(nodes.map(node => [
      node.id, seconds > 0 ? replenishSalvage(node, seconds) : node.remaining,
    ]));

    if (seconds > 0) {
      for (const structureRow of structures) {
        if (structureRow.kind === "command_core" &&
            structureRow.complete && structureRow.connected && structureRow.hp > 0) {
          credit(structureRow.ownerSlot, ECONOMY_RULES.coreIncomePerSecond * seconds);
        }
      }
      const harvesters = Array.from(ctx.db.harvestOrder.matchId.filter(timer.matchId))
        .sort((a, b) => a.shipId < b.shipId ? -1 : a.shipId > b.shipId ? 1 : 0);
      for (const order of harvesters) {
        const vessel = ctx.db.ship.id.find(order.shipId);
        const node = ctx.db.salvageNode.id.find(order.nodeId);
        const definition = vessel ? shipDefinition(vessel.kind) : null;
        const member = vessel ? members.find(row => row.identity.isEqual(vessel.owner)) : null;
        if (!vessel || !node || node.matchId !== timer.matchId ||
            !member || !definition || definition.harvestPerSecond <= 0 ||
            !inRange({ x: vessel.x, y: vessel.y },
              { x: node.gridX + 0.5, y: node.gridY + 0.5 },
              ECONOMY_RULES.harvestRangeCells)) {
          ctx.db.harvestOrder.shipId.delete(order.shipId);
          continue;
        }
        const activeSince = order.assignedAtUs > timer.lastTickAt.microsSinceUnixEpoch
          ? order.assignedAtUs : timer.lastTickAt.microsSinceUnixEpoch;
        const eligibleSeconds = Math.min(seconds, Number((nowUs - activeSince) / 1_000_000n));
        const drawn = drawSalvage(
          remaining.get(node.id) ?? 0, definition.harvestPerSecond * eligibleSeconds,
        );
        remaining.set(node.id, drawn.remaining);
        credit(member.slot, drawn.taken);
      }

      for (const rig of structures) {
        if (rig.kind !== "salvage_rig" || !rig.complete || !rig.connected || rig.hp === 0) continue;
        const position = { x: rig.gridX + rig.width / 2, y: rig.gridY + rig.height / 2 };
        // Nearest eligible deposit, stable tie-breaking by node ID.
        const nearest = nodes.filter(node => inRange(
          position, { x: node.gridX + 0.5, y: node.gridY + 0.5 },
          ECONOMY_RULES.rigRangeCells,
        )).sort((a, b) => {
          const da = Math.hypot(position.x - a.gridX - 0.5, position.y - a.gridY - 0.5);
          const db = Math.hypot(position.x - b.gridX - 0.5, position.y - b.gridY - 0.5);
          return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        })[0];
        const activeSince = rig.completeAtUs > timer.lastTickAt.microsSinceUnixEpoch
          ? rig.completeAtUs : timer.lastTickAt.microsSinceUnixEpoch;
        const eligibleSeconds = Math.min(seconds, Number((nowUs - activeSince) / 1_000_000n));
        const extracted = rigExtraction(nearest ? remaining.get(nearest.id) ?? 0 : 0, eligibleSeconds);
        if (nearest) remaining.set(nearest.id, extracted.remaining);
        credit(rig.ownerSlot, extracted.earned);
      }
    }

    for (const node of nodes) {
      const after = remaining.get(node.id)!;
      if (after !== node.remaining) ctx.db.salvageNode.id.update({ ...node, remaining: after });
    }

    const jobs = Array.from(ctx.db.productionOrder.matchId.filter(timer.matchId))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const jobsHandled = new Set<bigint>();
    let launchEnvironment: {
      mapCells: number; terrain: Uint8Array;
      footprints: { x: number; y: number; width: number; height: number }[];
      vessels: { id: bigint; x: number; y: number; radius: number }[];
    } | null = null;
    for (const job of jobs) {
      if (jobsHandled.has(job.yardId)) continue;
      jobsHandled.add(job.yardId);
      const yard = ctx.db.structure.id.find(job.yardId);
      const member = members.find(row => row.slot === job.ownerSlot);
      const definition = shipDefinition(job.shipKind);
      if (!yard || yard.matchId !== timer.matchId || yard.kind !== "shipyard" ||
          yard.ownerSlot !== job.ownerSlot || !member || !definition) {
        // Invalid or destroyed queues are canceled; never fabricate a new ship.
        // Real demolition cancels/refunds valid outstanding orders transactionally.
        ctx.db.productionOrder.id.delete(job.id);
        continue;
      }
      const operational = yard.complete && yard.connected && yard.hp > 0;
      if (!operational) continue;
      // A queued job must NEVER inherit elapsed time accrued before it became
      // the active FIFO head. Mark the start now and only consume later ticks.
      if (job.startedAtUs === 0n) {
        ctx.db.productionOrder.id.update({ ...job, startedAtUs: nowUs });
        continue;
      }
      const nextRemaining = advanceProduction(job.remainingUs, elapsedUs, operational);
      if (nextRemaining > 0n) {
        if (nextRemaining !== job.remainingUs || job.startedAtUs === 0n) {
          ctx.db.productionOrder.id.update({
            ...job, remainingUs: nextRemaining,
            startedAtUs: job.startedAtUs || nowUs,
          });
        }
        continue;
      }
      if (!launchEnvironment) {
        const world = ctx.db.worldConfig.matchId.find(timer.matchId);
        if (!world) throw new Error("Missing world for production");
        launchEnvironment = {
          mapCells: world.mapCells,
          terrain: decodeTerrainChunks(
            world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(timer.matchId)),
          ),
          footprints: structures.filter(row => row.channel === "surface")
            .map(row => ({ x: row.gridX, y: row.gridY, width: row.width, height: row.height })),
          vessels: Array.from(ctx.db.ship.matchId.filter(timer.matchId))
            .map(row => ({ id: row.id, x: row.x, y: row.y, radius: row.radiusCells })),
        };
      }
      const where = findShipyardSpawn(yard, job.shipKind as ShipKind, launchEnvironment);
      if (!where) {
        if (job.remainingUs !== 0n) ctx.db.productionOrder.id.update({
          ...job, remainingUs: 0n, startedAtUs: job.startedAtUs || nowUs,
        });
        continue; // Completed work waits for a navigable launch berth.
      }
      const launched = ctx.db.ship.insert({
        id: 0n, matchId: timer.matchId, owner: member.identity, kind: job.shipKind,
        hp: definition.hp, radiusCells: definition.radius,
        x: where.x, y: where.y, velocityX: 0, velocityY: 0,
        hullAngleDeg: 0, turretAngleDeg: 0, lastFiredAtUs: -1n,
        targetX: where.x, targetY: where.y, revision: 0n,
        updatedAt: ctx.timestamp,
      });
      launchEnvironment.vessels.push({
        id: launched.id, x: where.x, y: where.y, radius: definition.radius,
      });
      // Deletion is atomic with insertion; duplicate ticks cannot relaunch job.
      ctx.db.productionOrder.id.delete(job.id);
    }

    for (const member of members) {
      const balance = balances.get(member.slot);
      if (balance !== undefined && balance !== member.salvage)
        ctx.db.matchMember.id.update({ ...member, salvage: balance });
    }
    ctx.db.economySchedule.scheduledId.update({
      ...timer, lastTickAt: ctx.timestamp, leftoverUs: microseconds % 1_000_000n,
    });
  },
);

