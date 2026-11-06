import { ScheduleAt } from "spacetimedb";
import spacetimedb, { botSchedule } from "./schema.ts";
import { BOT_RULES, decideBot, type BotDifficulty, type BotObservation,
  type LegalRefitCandidate } from "./sim/bot-policy.ts";
import { detectOpenBattlefieldEnemies } from "./sim/bot-perception.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
import { decodeTerrainChunks } from "./sim/navigation.ts";
import { isNavigationCellBlocked } from "./sim/collision.ts";
import { validateStructurePlacement, type StructureKind } from "./sim/construction.ts";
import { ECONOMY_RULES, type ShipKind } from "./sim/economy.ts";
import { COMBAT_RULES, terrainLineOfSight, weaponDefinition } from "./sim/combat.ts";
import { angularDifference, desiredBearing } from "./sim/turret-aim.ts";
import { SHIP_MOTION_RULES } from "./sim/ship-motion.ts";
import { orderedBuildOrigins } from "./sim/bot-observation.ts";
import { dispatchHarvest, dispatchProduction } from "./sim/command-dispatch.ts";
import { dispatchMaterialHarvest } from "./sim/material-harvest-command.ts";
import { ADVANCED_RESOURCE_KINDS, type AdvancedResourceKind,
  type ResourceWallet } from "./sim/materials.ts";
import { purchaseShipRefit, alreadyInstalled, NO_SHIP_REFITS,
  SHIP_REFIT_RULES, type ShipRefitState } from "./sim/ship-refits.ts";
import { validateRefitStation } from "./sim/ship-refit-station.ts";
import { dispatchMovement, dispatchConstruction } from "./sim/world-command-dispatch.ts";
import { dispatchAim, dispatchFire, type WeaponSource } from "./sim/combat-command-dispatch.ts";
import { dispatchAttackOrder, type AttackableTarget } from "./sim/attack-order.ts";

/**
 * One server-owned strategic scheduler per active match.
 *
 * No fake Identity: the actor is a controller+faction row, not ctx.sender.
 * Every proposed action is checked again against CURRENT authoritative tables
 * using the same pure physical/balance validators as human commands.
 * A rejected intent is a no-op; DB errors are NOT swallowed, so an unexpected
 * mutation failure rolls the whole transaction back rather than partially
 * applying a dangerous command.
 *
 * Source is not a claim of SDK/runtime verification.
 */
export const advanceBots = spacetimedb.reducer(
  { onSchedule: botSchedule },
  { arg: botSchedule.rowType },
  (ctx, { arg }) => {
    if (!ctx.senderAuth.isInternal) throw new Error("Bot scheduler is internal-only");
    const timer = ctx.db.botSchedule.scheduledId.find(arg.scheduledId);
    if (!timer) return;
    const match = ctx.db.match.id.find(timer.matchId);
    const nowUs = ctx.timestamp.microsSinceUnixEpoch;
    if (!match || !matchStillActive(match.phase, match.startedAtUs, nowUs)) {
      ctx.db.botSchedule.scheduledId.delete(timer.scheduledId);
      return;
    }
    const world = ctx.db.worldConfig.matchId.find(match.id);
    if (!world) throw new Error("Missing authoritative world for bots");
    const terrain = decodeTerrainChunks(
      world.mapCells, Array.from(ctx.db.worldChunk.matchId.filter(match.id)),
    );
    const bots = Array.from(ctx.db.botController.matchId.filter(match.id))
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!bots.length) {
      ctx.db.botSchedule.scheduledId.delete(timer.scheduledId);
      return;
    }

    const startMotion = () => {
      if (Array.from(ctx.db.motionSchedule.matchId.filter(match.id)).length) return;
      ctx.db.motionSchedule.insert({
        scheduledId: 0n, matchId: match.id,
        scheduledAt: ScheduleAt.interval(SHIP_MOTION_RULES.tickMicroseconds),
        lastTickAt: ctx.timestamp,
      });
    };
    const startCombat = () => {
      if (Array.from(ctx.db.combatSchedule.matchId.filter(match.id)).length) return;
      ctx.db.combatSchedule.insert({
        scheduledId: 0n, matchId: match.id,
        scheduledAt: ScheduleAt.interval(COMBAT_RULES.tickMicroseconds),
        lastTickAt: ctx.timestamp,
      });
    };
    const currentShapes = () => Array.from(ctx.db.structure.matchId.filter(match.id));
    const currentHulls = () => Array.from(ctx.db.ship.matchId.filter(match.id))
      .map(v => ({ x: v.x, y: v.y, radius: v.radiusCells }));
    const pathEnvironment = () => ({
      mapCells: world.mapCells, terrain,
      vessels: Array.from(ctx.db.ship.matchId.filter(match.id))
        .map(v => ({ id: v.id, x: v.x, y: v.y, radius: v.radiusCells })),
      footprints: currentShapes().filter(row => row.channel === "surface")
        .map(row => ({ x: row.gridX, y: row.gridY, width: row.width, height: row.height })),
    });
    const canBuild = (kind: StructureKind, slot: number, gridX: number, gridY: number,
      salvage: number): boolean => validateStructurePlacement({
        kind, ownerSlot: slot, gridX, gridY, salvage,
        mapCells: world.mapCells, terrain,
        structures: currentShapes().map(row => ({ ...row, kind: row.kind as StructureKind })),
        deposits: [
          ...Array.from(ctx.db.salvageNode.matchId.filter(match.id))
            .map(row => ({ x: row.gridX, y: row.gridY })),
          ...Array.from(ctx.db.materialNode.matchId.filter(match.id))
            .map(row => ({ x: row.gridX, y: row.gridY })),
        ],
        hulls: currentHulls(),
      }) === null;

    // Observe public battlefield locations and bot-owned data only.
    // Opponent wallets, queues, identities and upgrades never enter policy.
    for (const bot of bots) {
      if (bot.nextDecisionUs > nowUs) continue;
      const faction = Array.from(ctx.db.factionState.matchId.filter(match.id))
        .find(row => row.slot === bot.slot && row.factionKey === bot.factionKey &&
          row.controller === "bot" && !row.eliminated);
      if (!faction) {
        ctx.db.botController.id.delete(bot.id);
        continue;
      }
      const difficulty = bot.difficulty as BotDifficulty;
      const difficultyRule = BOT_RULES.difficulties[difficulty];
      if (!difficultyRule) throw new Error("Persisted invalid bot difficulty");
      const ownShips = Array.from(ctx.db.ship.matchId.filter(match.id))
        .filter(row => row.ownerSlot === bot.slot && row.hp > 0)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const ownStructures = currentShapes()
        .filter(row => row.ownerSlot === bot.slot && row.hp > 0)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      // The battlefield is OPEN by design: player and Bot know the same
      // live positions of enemies and public resource deposits. No private
      // wallets, orders or hidden opponent state enter the policy.
      const enemyContacts = [
        ...Array.from(ctx.db.ship.matchId.filter(match.id)).map(row => ({
          id: row.id, faction: row.ownerSlot, entityType: "ship" as const,
          position: { x: row.x, y: row.y }, alive: row.hp > 0,
        })),
        ...currentShapes().map(row => ({
          id: row.id, faction: row.ownerSlot, entityType: "structure" as const,
          position: {
            x: row.gridX + row.width / 2, y: row.gridY + row.height / 2,
          }, alive: row.hp > 0 && row.complete,
        })),
      ];
      const visibleEnemies = detectOpenBattlefieldEnemies(
        bot.slot, nowUs, enemyContacts,
      );
      const knownDeposits = Array.from(ctx.db.salvageNode.matchId.filter(match.id))
        .filter(node => node.remaining > 0)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(node => ({
          id: node.id, position: { x: node.gridX + 0.5, y: node.gridY + 0.5 },
          remaining: node.remaining,
        }));
      const knownMaterials = Array.from(ctx.db.materialNode.matchId.filter(match.id))
        .filter(node => node.remaining > 0 &&
          ADVANCED_RESOURCE_KINDS.includes(node.kind as AdvancedResourceKind))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(node => ({
          id: node.id, kind: node.kind as AdvancedResourceKind,
          position: { x: node.gridX + 0.5, y: node.gridY + 0.5 },
          remaining: node.remaining,
        }));
      const balances = Array.from(ctx.db.materialBalance.matchId.filter(match.id))
        .filter(row => row.ownerSlot === bot.slot);
      const currentWallet: ResourceWallet = {
        iron: faction.salvage,
        oil: balances.find(row => row.kind === "oil")?.amount ?? 0,
        alloy: balances.find(row => row.kind === "alloy")?.amount ?? 0,
        isotope: balances.find(row => row.kind === "isotope")?.amount ?? 0,
      };
      const legalRefits: LegalRefitCandidate[] = [];
      for (const workshop of ownStructures.filter(row => row.kind === "workshop")) {
        for (const vessel of ownShips) {
          if (ctx.db.harvestOrder.shipId.find(vessel.id) ||
              ctx.db.attackOrder.shipId.find(vessel.id)) continue;
          if (validateRefitStation(
            match.id, bot.slot, workshop, vessel,
            Boolean(ctx.db.shipRoute.shipId.find(vessel.id)),
          ) !== null) continue;
          const current = ctx.db.shipRefit.shipId.find(vessel.id);
          const installed: ShipRefitState = current ?? NO_SHIP_REFITS;
          for (const kind of ["high_output_engine", "reinforced_hull"] as const)
            if (!alreadyInstalled(installed, kind))
              legalRefits.push({ workshopId: workshop.id, shipId: vessel.id, kind });
        }
      }

      // Candidate locations come only from our own explored connected territory.
      // Each one is validated against the SAME physical construction rules as
      // a human build command. Search is capped per kind per strategic tick.
      const legalBuildCandidates: BotObservation["legalBuildCandidates"][number][] = [];
      for (const kind of ["shipyard","salvage_rig","workshop","cannon","platform"] as const) {
        let checked = 0;
        const candidates = orderedBuildOrigins(ownStructures,world.mapCells,kind !== "platform");
        for (const point of candidates) {
          if (checked++ >= BOT_RULES.maxPlacementChecksPerKind) break;
          if (canBuild(kind, bot.slot, point.x, point.y, faction.salvage))
            legalBuildCandidates.push({ kind, gridX: point.x, gridY: point.y });
        }
      }
      const frontiers = new Map<string, { x: number; y: number }>();
      for (const ship of ownShips) {
        if (ctx.db.shipRoute.shipId.find(ship.id) ||
            ctx.db.harvestOrder.shipId.find(ship.id) ||
            ctx.db.materialHarvestOrder.shipId.find(ship.id) ||
            ctx.db.attackOrder.shipId.find(ship.id))
          continue;
        const env = pathEnvironment();
        const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
        let count = 0;
        for (const [dx, dy] of directions) {
          if (count++ >= BOT_RULES.maxFrontiersPerShip) break;
          const x = Math.floor(ship.x + dx! * 4), y = Math.floor(ship.y + dy! * 4);
          if (x <= 0 || y <= 0 || x >= world.mapCells - 1 || y >= world.mapCells - 1) continue;
          if (isNavigationCellBlocked(x, y, ship.radiusCells, env, ship.id)) continue;
          frontiers.set(x + ":" + y, { x: x + 0.5, y: y + 0.5 });
        }
      }
      const observation: BotObservation = {
        slot: bot.slot, seed: bot.seed, nowUs,
        salvage: faction.salvage,
        ships: ownShips.map(row => ({
          id: row.id, kind: row.kind as ShipKind, hp: row.hp,
          position: { x: row.x, y: row.y }, turretAngleDeg: row.turretAngleDeg,
          busy: Boolean(ctx.db.shipRoute.shipId.find(row.id) ||
            ctx.db.harvestOrder.shipId.find(row.id) ||
            ctx.db.materialHarvestOrder.shipId.find(row.id) ||
            ctx.db.attackOrder.shipId.find(row.id)),
          harvestingMaterial: (() => {
            const order = ctx.db.materialHarvestOrder.shipId.find(row.id);
            const node = order ? ctx.db.materialNode.id.find(order.nodeId) : null;
            return node ? node.kind as AdvancedResourceKind : undefined;
          })(),
        })),
        structures: ownStructures.map(row => ({
          id: row.id, kind: row.kind,
          position: { x: row.gridX + row.width / 2, y: row.gridY + row.height / 2 },
          complete: row.complete, connected: row.connected,
          queueLength: Array.from(ctx.db.productionOrder.yardId.filter(row.id)).length,
        })),
        visibleEnemies, knownDeposits, knownMaterials,
        wallet: currentWallet, legalRefits, legalBuildCandidates,
        explorationFrontiers: [...frontiers.values()].sort((a,b) => a.y - b.y || a.x - b.x),
      };
      const result = decideBot(observation, difficulty);
      if (result.intents.length > difficultyRule.maxOrders)
        throw new Error("Bot exceeded configured strategic action budget");

      for (const intent of result.intents) {
        // These are suggestions, never direct blind database writes.
        if (intent.type === "harvest") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const node = ctx.db.salvageNode.id.find(intent.nodeId);
          const result = dispatchHarvest({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            ship: vessel ?? null, node: node ?? null, nowUs,
            observable: Boolean(vessel && node &&
              knownDeposits.some(seen => seen.id === intent.nodeId) &&
              terrainLineOfSight(
                { x: vessel.x, y: vessel.y },
                { x: node.gridX + 0.5, y: node.gridY + 0.5 },
                terrain, world.mapCells,
              )),
          }, {
            clearRoute: id => { ctx.db.shipRoute.shipId.delete(id); },
            upsertOrder: order => {
              const current = ctx.db.harvestOrder.shipId.find(order.shipId);
              if (current) ctx.db.harvestOrder.shipId.update({ ...current, ...order });
              else ctx.db.harvestOrder.insert(order);
            },
            stopForHarvest: (id, revision) => {
              if (!vessel) throw new Error("Harvest ship disappeared in transaction");
              ctx.db.ship.id.update({
                ...vessel, velocityX: 0, velocityY: 0,
                targetX: vessel.x, targetY: vessel.y,
                revision, updatedAt: ctx.timestamp,
              });
            },
          });
          if (!result.ok) continue;
          ctx.db.materialHarvestOrder.shipId.delete(intent.shipId);
          ctx.db.attackOrder.shipId.delete(intent.shipId);
        } else if (intent.type === "release_material") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const order = ctx.db.materialHarvestOrder.shipId.find(intent.shipId);
          if (!vessel || vessel.ownerSlot !== bot.slot ||
              vessel.matchId !== match.id || !order ||
              order.matchId !== match.id) continue;
          const node = ctx.db.materialNode.id.find(order.nodeId);
          const balancesNow = Array.from(ctx.db.materialBalance.matchId.filter(match.id))
            .filter(row => row.ownerSlot === bot.slot);
          const required = node?.kind === "oil" ?
            SHIP_REFIT_RULES.high_output_engine.cost.oil :
            node?.kind === "alloy" ?
              SHIP_REFIT_RULES.reinforced_hull.cost.alloy : null;
          const wallet = node
            ? balancesNow.find(row => row.kind === node.kind)?.amount ?? 0 : 0;
          if (required === null || wallet < required) continue;
          ctx.db.materialHarvestOrder.shipId.delete(vessel.id);
        } else if (intent.type === "harvest_material") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const node = ctx.db.materialNode.id.find(intent.nodeId);
          // Same exact physical conditions and task replacement as human
          // orderMaterialHarvest; no direct material credit or fabricated node.
          if (!node || node.kind !== intent.kind ||
              !knownMaterials.some(known => known.id === intent.nodeId &&
                known.kind === intent.kind)) continue;
          const result = dispatchMaterialHarvest({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            ship: vessel ?? null, node, nowUs,
            lineOfSight: Boolean(vessel && terrainLineOfSight(
              { x: vessel.x, y: vessel.y },
              { x: node.gridX + 0.5, y: node.gridY + 0.5 },
              terrain, world.mapCells,
            )),
          }, {
            clearRoute: id => { ctx.db.shipRoute.shipId.delete(id); },
            clearIronHarvest: id => { ctx.db.harvestOrder.shipId.delete(id); },
            clearAttack: id => { ctx.db.attackOrder.shipId.delete(id); },
            upsertMaterial: order => {
              const current = ctx.db.materialHarvestOrder.shipId.find(order.shipId);
              if (current) ctx.db.materialHarvestOrder.shipId.update({ ...current, ...order });
              else ctx.db.materialHarvestOrder.insert(order);
            },
            stopShip: (_, revision) => {
              if (!vessel) throw new Error("Material harvest ship disappeared");
              ctx.db.ship.id.update({
                ...vessel, velocityX: 0, velocityY: 0,
                targetX: vessel.x, targetY: vessel.y,
                revision, updatedAt: ctx.timestamp,
              });
            },
          });
          if (!result.ok) continue;
        } else if (intent.type === "refit") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const workshop = ctx.db.structure.id.find(intent.workshopId);
          const factionNow = ctx.db.factionState.id.find(faction.id);
          if (!factionNow || factionNow.eliminated ||
              !legalRefits.some(row => row.shipId === intent.shipId &&
                row.workshopId === intent.workshopId && row.kind === intent.kind)) continue;
          const error = validateRefitStation(
            match.id, bot.slot, workshop, vessel,
            Boolean(ctx.db.shipRoute.shipId.find(intent.shipId)),
          );
          if (error || !vessel) continue;
          const balancesNow = Array.from(ctx.db.materialBalance.matchId.filter(match.id))
            .filter(row => row.ownerSlot === bot.slot);
          const wallet: ResourceWallet = {
            iron: factionNow.salvage,
            oil: balancesNow.find(row => row.kind === "oil")?.amount ?? 0,
            alloy: balancesNow.find(row => row.kind === "alloy")?.amount ?? 0,
            isotope: balancesNow.find(row => row.kind === "isotope")?.amount ?? 0,
          };
          const current = ctx.db.shipRefit.shipId.find(vessel.id);
          const installed: ShipRefitState = current ?? NO_SHIP_REFITS;
          let purchase: ReturnType<typeof purchaseShipRefit>;
          try {
            purchase = purchaseShipRefit(wallet, installed, intent.kind);
          } catch {
            continue; // Not affordable, already fitted or policy went stale.
          }
          // All three mutations below commit in the same database reducer
          // transaction and share the human refit recipe and HP effect.
          ctx.db.factionState.id.update({
            ...factionNow, salvage: purchase.wallet.iron,
          });
          for (const balance of balancesNow) {
            const kind = balance.kind as AdvancedResourceKind;
            if (purchase.wallet[kind] !== balance.amount)
              ctx.db.materialBalance.id.update({
                ...balance, amount: purchase.wallet[kind],
              });
          }
          if (current) ctx.db.shipRefit.shipId.update({
            ...current, ...purchase.state,
          });
          else ctx.db.shipRefit.insert({
            shipId: vessel.id, matchId: match.id, ...purchase.state,
          });
          if (purchase.hpBonus > 0) ctx.db.ship.id.update({
            ...vessel, hp: vessel.hp + purchase.hpBonus,
            updatedAt: ctx.timestamp,
          });
        } else if (intent.type === "move") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          if (!vessel || ctx.db.shipRoute.shipId.find(vessel.id) ||
              ctx.db.harvestOrder.shipId.find(vessel.id) ||
              ctx.db.materialHarvestOrder.shipId.find(vessel.id) ||
              ctx.db.attackOrder.shipId.find(vessel.id)) continue;
          const result = dispatchMovement({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            ship: vessel, destination: intent.destination,
            environment: pathEnvironment(),
            destinationVisible: true, // Open Battlefield, same rules as player
          }, {
            cancelHarvest: id => {
              ctx.db.harvestOrder.shipId.delete(id);
              ctx.db.materialHarvestOrder.shipId.delete(id);
              ctx.db.attackOrder.shipId.delete(id);
            },
            setRoute: order => {
              const existing = ctx.db.shipRoute.shipId.find(vessel.id);
              if (!order) {
                if (existing) ctx.db.shipRoute.shipId.delete(vessel.id);
              } else if (existing) {
                ctx.db.shipRoute.shipId.update({
                  ...existing, cellPath: [...order.cellPath], cursor: 0,
                  revision: order.revision, repathAfterUs: order.repathAfterUs,
                });
              } else {
                ctx.db.shipRoute.insert({
                  ...order, cellPath: [...order.cellPath], cursor: 0,
                });
              }
            },
            updateShip: order => {
              ctx.db.ship.id.update({
                ...vessel, targetX: order.targetX, targetY: order.targetY,
                velocityX: order.stopImmediately ? 0 : vessel.velocityX,
                velocityY: order.stopImmediately ? 0 : vessel.velocityY,
                revision: order.revision, updatedAt: ctx.timestamp,
              });
            },
            ensureMotionTick: startMotion,
          });
          if (!result.ok) continue;
        } else if (intent.type === "attack") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const enemyShip = intent.targetType === "ship" ?
            ctx.db.ship.id.find(intent.targetId) : undefined;
          const enemyStructure = intent.targetType === "structure" ?
            ctx.db.structure.id.find(intent.targetId) : undefined;
          const target: AttackableTarget | null = enemyShip
            ? { id: enemyShip.id, matchId: enemyShip.matchId,
                ownerSlot: enemyShip.ownerSlot, type: "ship",
                x: enemyShip.x, y: enemyShip.y, hp: enemyShip.hp }
            : enemyStructure
              ? { id: enemyStructure.id, matchId: enemyStructure.matchId,
                  ownerSlot: enemyStructure.ownerSlot, type: "structure",
                  x: enemyStructure.gridX + enemyStructure.width / 2,
                  y: enemyStructure.gridY + enemyStructure.height / 2,
                  hp: enemyStructure.hp }
              : null;
          const observed = visibleEnemies.some(row =>
            row.id === intent.targetId && row.entityType === intent.targetType);
          const existingOrder = ctx.db.attackOrder.shipId.find(intent.shipId);
          if (existingOrder && existingOrder.targetType === intent.targetType &&
              existingOrder.targetId === intent.targetId) continue;
          const result = dispatchAttackOrder({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            ship: vessel ?? null, target, nowUs, targetObserved: observed,
          }, {
            clearRoute: id => { ctx.db.shipRoute.shipId.delete(id); },
            clearHarvest: id => {
              ctx.db.harvestOrder.shipId.delete(id);
              ctx.db.materialHarvestOrder.shipId.delete(id);
            },
            upsertOrder: order => {
              const existing = ctx.db.attackOrder.shipId.find(order.shipId);
              if (existing) ctx.db.attackOrder.shipId.update({ ...existing, ...order });
              else ctx.db.attackOrder.insert(order);
            },
            stopShip: (id, revision) => {
              if (!vessel) throw new Error("Attack ship disappeared in transaction");
              ctx.db.ship.id.update({
                ...vessel, velocityX: 0, velocityY: 0,
                targetX: vessel.x, targetY: vessel.y,
                revision, updatedAt: ctx.timestamp,
              });
            },
            ensureCombatTick: startCombat,
          });
          if (!result.ok) continue;
        } else if (intent.type === "aim") {
          // The persistent attack order already owns approach, aim and fire.
          if (ctx.db.attackOrder.shipId.find(intent.shipId)) continue;
          const vessel = ctx.db.ship.id.find(intent.shipId);
          const weapon = vessel ? weaponDefinition(vessel.kind) : null;
          if (!vessel || !weapon) continue;
          const allowedBearing = visibleEnemies.some(enemy => {
            const distance = Math.hypot(enemy.position.x - vessel.x,
              enemy.position.y - vessel.y);
            return distance > 0 && distance <= Math.min(weapon.range,weapon.vision) &&
              Math.abs(angularDifference(intent.angleDeg,
                desiredBearing({x:vessel.x,y:vessel.y},enemy.position))) <= 0.001;
          });
          if (!allowedBearing) continue;
          const source: WeaponSource = {
            type: "ship", id: vessel.id, matchId: vessel.matchId,
            ownerSlot: vessel.ownerSlot, kind: vessel.kind, x: vessel.x, y: vessel.y,
            hp: vessel.hp, complete: true, connected: true,
            turretAngleDeg: vessel.turretAngleDeg,
            lastFiredAtUs: vessel.lastFiredAtUs,
          };
          const result = dispatchAim({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            source, desiredAngleDeg: intent.angleDeg,
          }, {
            clearAim: (type,id) => {
              for (const row of Array.from(ctx.db.turretAim.matchId.filter(match.id)))
                if (row.sourceType === type && row.sourceId === id)
                  ctx.db.turretAim.id.delete(row.id);
            },
            upsertAim: (type,id,angle) => {
              const old = Array.from(ctx.db.turretAim.matchId.filter(match.id))
                .find(row => row.sourceType === type && row.sourceId === id);
              if (old) ctx.db.turretAim.id.update({ ...old, desiredAngleDeg: angle });
              else ctx.db.turretAim.insert({
                id: 0n, matchId: match.id, sourceType: type, sourceId: id,
                desiredAngleDeg: angle,
              });
            },
            ensureCombatTick: startCombat,
          });
          if (!result.ok) continue;
        } else if (intent.type === "fire") {
          // An active attack order already fires under the same rules.
          if (ctx.db.attackOrder.shipId.find(intent.shipId)) continue;
          const vessel = ctx.db.ship.id.find(intent.shipId);
          if (!vessel) continue;
          const seen = visibleEnemies.find(row =>
            row.id === intent.targetId && row.entityType === intent.targetType);
          if (!seen) continue;
          const enemyShip = intent.targetType === "ship" ?
            ctx.db.ship.id.find(intent.targetId) : undefined;
          const enemyStructure = intent.targetType === "structure" ?
            ctx.db.structure.id.find(intent.targetId) : undefined;
          const source: WeaponSource = {
            type: "ship", id: vessel.id, matchId: vessel.matchId,
            ownerSlot: vessel.ownerSlot, kind: vessel.kind, x: vessel.x, y: vessel.y,
            hp: vessel.hp, complete: true, connected: true,
            turretAngleDeg: vessel.turretAngleDeg,
            lastFiredAtUs: vessel.lastFiredAtUs,
          };
          const target = enemyShip
            ? { id: enemyShip.id, matchId: enemyShip.matchId,
                ownerSlot: enemyShip.ownerSlot, type: "ship" as const,
                x: enemyShip.x, y: enemyShip.y, hp: enemyShip.hp }
            : enemyStructure
              ? { id: enemyStructure.id, matchId: enemyStructure.matchId,
                  ownerSlot: enemyStructure.ownerSlot, type: "structure" as const,
                  x: enemyStructure.gridX + enemyStructure.width / 2,
                  y: enemyStructure.gridY + enemyStructure.height / 2,
                  hp: enemyStructure.hp }
              : null;
          const result = dispatchFire({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            source, target, nowUs, terrain, mapCells: world.mapCells,
            targetVisible: Boolean(seen && target),
            projectileCount: Array.from(ctx.db.projectile.matchId.filter(match.id)).length,
          }, {
            markFired: (_,atUs) => {
              ctx.db.ship.id.update({
                ...vessel, lastFiredAtUs: atUs, updatedAt: ctx.timestamp,
              });
            },
            insertProjectile: shot => {
              ctx.db.projectile.insert({ id: 0n, ...shot });
            },
            ensureCombatTick: startCombat,
          });
          if (!result.ok) continue;
        } else if (intent.type === "enqueue") {
          const yard = ctx.db.structure.id.find(intent.yardId);
          const factionNow = ctx.db.factionState.id.find(faction.id);
          if (!factionNow) continue;
          const result = dispatchProduction({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: factionNow.eliminated },
            yard: yard ?? null, kind: intent.shipKind, salvage: factionNow.salvage,
            queued: Array.from(ctx.db.productionOrder.yardId.filter(intent.yardId)).length,
            queueCap: Math.min(ECONOMY_RULES.shipyardQueueLimit, difficultyRule.queueLimit),
            nowUs,
          }, {
            setBalance: salvage => {
              ctx.db.factionState.id.update({ ...factionNow, salvage });
            },
            enqueue: order => {
              ctx.db.productionOrder.insert({ id: 0n, ...order });
            },
          });
          if (!result.ok) continue;
        } else if (intent.type === "build") {
          const factionNow = ctx.db.factionState.id.find(faction.id);
          if (!factionNow) continue;
          const allowed = legalBuildCandidates.some(row =>
            row.kind === intent.kind && row.gridX === intent.gridX &&
            row.gridY === intent.gridY);
          const result = dispatchConstruction({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: factionNow.eliminated },
            request: {
              kind: intent.kind, ownerSlot: bot.slot, gridX: intent.gridX,
              gridY: intent.gridY, salvage: factionNow.salvage,
              mapCells: world.mapCells, terrain,
              structures: currentShapes().map(row => ({
                ...row, kind: row.kind as StructureKind,
              })),
              deposits: [
                ...Array.from(ctx.db.salvageNode.matchId.filter(match.id))
                  .map(row => ({ x: row.gridX, y: row.gridY })),
                ...Array.from(ctx.db.materialNode.matchId.filter(match.id))
                  .map(row => ({ x: row.gridX, y: row.gridY })),
              ],
              hulls: currentHulls(),
            },
            nowUs, locationAllowed: allowed,
          }, {
            setBalance: salvage => {
              ctx.db.factionState.id.update({ ...factionNow, salvage });
            },
            insertStructure: row => ctx.db.structure.insert({
              id: 0n, ...row, lastFiredAtUs: -1n, turretAngleDeg: 0,
              level: 1, upgradeRemainingUs: 0n, upgradeStartedAtUs: 0n,
              complete: false,
            }).id,
            scheduleCompletion: (structureId, dueAtUs) => {
              ctx.db.constructionSchedule.insert({
                scheduledId: 0n, structureId,
                scheduledAt: ScheduleAt.time(dueAtUs),
              });
            },
          });
          if (!result.ok) continue;
        }
      }
      // Skip missed strategic decisions; never replay a huge backlog after lag.
      ctx.db.botController.id.update({
        ...bot, nextDecisionUs: result.nextDecisionUs,
      });
    }
  },
);
