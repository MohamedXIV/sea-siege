import { ScheduleAt } from "spacetimedb";
import spacetimedb, { botSchedule } from "./schema.ts";
import { BOT_RULES, decideBot, type BotDifficulty, type BotObservation, type BotIntent } from "./sim/bot-policy.ts";
import { detectBotEnemies, type Sensor } from "./sim/bot-perception.ts";
import { matchStillActive } from "./sim/match-outcome.ts";
import { decodeTerrainChunks, findTerrainPath } from "./sim/navigation.ts";
import { isNavigationCellBlocked } from "./sim/collision.ts";
import { structureDefinition, validateStructurePlacement, type StructureKind } from "./sim/construction.ts";
import { ECONOMY_RULES, debitSalvage, type ShipKind } from "./sim/economy.ts";
import { COMBAT_RULES, canFire, createProjectile, terrainLineOfSight, weaponDefinition, withinRange, type WeaponKind } from "./sim/combat.ts";
import { angularDifference, desiredBearing, turretAligned } from "./sim/turret-aim.ts";
import { SHIP_MOTION_RULES } from "./sim/ship-motion.ts";
import { visibleResources, orderedBuildOrigins } from "./sim/bot-observation.ts";
import { dispatchHarvest, dispatchProduction } from "./sim/command-dispatch.ts";
import { dispatchMovement, dispatchConstruction } from "./sim/world-command-dispatch.ts";
import { dispatchAim, dispatchFire, type WeaponSource } from "./sim/combat-command-dispatch.ts";

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
        deposits: Array.from(ctx.db.salvageNode.matchId.filter(match.id))
          .map(row => ({ x: row.gridX, y: row.gridY })),
        hulls: currentHulls(),
      }) === null;

    // A bot has no access to opponents' private rows until a sensor projects
    // that contact. Construct this observation anew every due strategic tick.
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
      const sensors: Sensor[] = [];
      for (const ship of ownShips) {
        const weapon = weaponDefinition(ship.kind);
        if (weapon) sensors.push({
          id: ship.id, position: { x: ship.x, y: ship.y }, radius: weapon.vision,
        });
      }
      for (const structure of ownStructures) {
        if (!structure.complete || !structure.connected) continue;
        if (structure.kind === "command_core" || structure.kind === "cannon") {
          sensors.push({
            id: structure.id, position: {
              x: structure.gridX + structure.width / 2,
              y: structure.gridY + structure.height / 2,
            },
            radius: structure.kind === "command_core" ? BOT_RULES.coreSensorRadius :
              COMBAT_RULES.weapons.cannon.vision,
          });
        }
      }
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
      const visibleEnemies = detectBotEnemies(
        bot.slot, nowUs, sensors, enemyContacts, terrain, world.mapCells,
      );
      const sensorSees = (x: number, y: number): boolean => sensors.some(sensor =>
        withinRange(sensor.position, { x, y }, sensor.radius) &&
        terrainLineOfSight(sensor.position, { x, y }, terrain, world.mapCells),
      );
      const knownDeposits = visibleResources(
        Array.from(ctx.db.salvageNode.matchId.filter(match.id)),
        sensors,
        (from,to) => terrainLineOfSight(from,to,terrain,world.mapCells),
      );

      // Candidate locations come only from our own explored connected territory.
      // Each one is validated against the SAME physical construction rules as
      // a human build command. Search is capped per kind per strategic tick.
      const legalBuildCandidates: BotObservation["legalBuildCandidates"][number][] = [];
      for (const kind of ["shipyard","salvage_rig","cannon","platform"] as const) {
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
        if (ctx.db.shipRoute.shipId.find(ship.id) || ctx.db.harvestOrder.shipId.find(ship.id))
          continue;
        const env = pathEnvironment();
        const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
        let count = 0;
        for (const [dx, dy] of directions) {
          if (count++ >= BOT_RULES.maxFrontiersPerShip) break;
          const x = Math.floor(ship.x + dx! * 4), y = Math.floor(ship.y + dy! * 4);
          if (x <= 0 || y <= 0 || x >= world.mapCells - 1 || y >= world.mapCells - 1) continue;
          if (isNavigationCellBlocked(x, y, ship.radiusCells, env, ship.id)) continue;
          if (!sensorSees(x + 0.5, y + 0.5)) continue;
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
            ctx.db.harvestOrder.shipId.find(row.id)),
        })),
        structures: ownStructures.map(row => ({
          id: row.id, kind: row.kind,
          position: { x: row.gridX + row.width / 2, y: row.gridY + row.height / 2 },
          complete: row.complete, connected: row.connected,
          queueLength: Array.from(ctx.db.productionOrder.yardId.filter(row.id)).length,
        })),
        visibleEnemies, knownDeposits, legalBuildCandidates,
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
            observable: knownDeposits.some(seen => seen.id === intent.nodeId),
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
        } else if (intent.type === "move") {
          const vessel = ctx.db.ship.id.find(intent.shipId);
          if (!vessel || ctx.db.shipRoute.shipId.find(vessel.id) ||
              ctx.db.harvestOrder.shipId.find(vessel.id)) continue;
          const result = dispatchMovement({
            faction: { matchId: match.id, slot: bot.slot, controller: "bot",
              eliminated: faction.eliminated },
            ship: vessel, destination: intent.destination,
            environment: pathEnvironment(),
            destinationVisible: sensorSees(intent.destination.x, intent.destination.y),
          }, {
            cancelHarvest: id => { ctx.db.harvestOrder.shipId.delete(id); },
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
        } else if (intent.type === "aim") {
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
              deposits: Array.from(ctx.db.salvageNode.matchId.filter(match.id))
                .map(row => ({ x: row.gridX, y: row.gridY })),
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
