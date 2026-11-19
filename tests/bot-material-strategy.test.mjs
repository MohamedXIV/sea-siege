import test from "node:test";
import assert from "node:assert/strict";
import { decideBot, BOT_RULES } from "../spacetimedb/src/sim/bot-policy.ts";
import { dispatchMaterialHarvest } from "../spacetimedb/src/sim/material-harvest-command.ts";
import { validateRefitStation } from "../spacetimedb/src/sim/ship-refit-station.ts";
import { detectOpenBattlefieldEnemies } from "../spacetimedb/src/sim/bot-perception.ts";

const p = (x, y) => ({ x, y });
const scout = (changes = {}) => ({
  id: 1n, kind: "scout", position: p(2.5, 2.5),
  hp: 210, turretAngleDeg: 0, busy: false, ...changes,
});
const wallet = (iron = 300, oil = 0, alloy = 0) =>
  ({ iron, oil, alloy, isotope: 0 });
const observed = (changes = {}) => ({
  slot: 1, seed: 42, nowUs: 10_000_000n, salvage: 300,
  wallet: wallet(), ships: [scout()], structures: [],
  visibleEnemies: [], knownDeposits: [], knownMaterials: [],
  legalRefits: [], legalBuildCandidates: [], explorationFrontiers: [],
  ...changes,
});
const oil = { id: 8n, kind: "oil", remaining: 100, position: p(3.5, 2.5) };
const alloy = { id: 9n, kind: "alloy", remaining: 100, position: p(4.5, 2.5) };

test("Bot can choose real Oil harvest and move toward a distant public deposit", () => {
  const near = decideBot(observed({ knownMaterials: [oil] }), "easy").intents;
  assert.deepEqual(near, [
    { type: "harvest_material", shipId: 1n, nodeId: 8n, kind: "oil" },
  ]);
  const far = decideBot(observed({
    knownMaterials: [{ ...oil, position: p(10.5, 2.5) }],
  }), "easy").intents;
  assert.deepEqual(far, [{
    type: "move", shipId: 1n, destination: p(10.5, 2.5),
  }]);
});

test("Bot shifts from sufficient Oil to required Alloys without mining isotope as a mandatory gate", () => {
  const result = decideBot(observed({
    wallet: wallet(300, 45, 0),
    knownMaterials: [oil, alloy, {
      id: 10n, kind: "isotope", remaining: 100, position: p(2.5, 2.5),
    }],
  }), "easy").intents;
  assert.deepEqual(result, [{
    type: "harvest_material", shipId: 1n, nodeId: 9n, kind: "alloy",
  }]);
});

test("Bot releases a completed material target instead of indefinitely camping", () => {
  const result = decideBot(observed({
    wallet: wallet(300, 45, 0),
    ships: [scout({ busy: true, harvestingMaterial: "oil" })],
    knownMaterials: [alloy],
  }), "easy").intents;
  assert.deepEqual(result, [{ type: "release_material", shipId: 1n }]);
});

test("Bot buys a legitimate optional refit before spending that same Iron twice", () => {
  const decision = decideBot(observed({
    wallet: wallet(300, 45, 35),
    legalRefits: [
      { workshopId: 20n, shipId: 1n, kind: "reinforced_hull" },
      { workshopId: 20n, shipId: 1n, kind: "high_output_engine" },
    ],
  }), "hard");
  assert.equal(decision.intents[0].type, "refit");
  assert.equal(decision.intents[0].kind, "high_output_engine");
  assert.equal(decision.intents.filter(i => i.type === "refit").length, 1);
  assert.ok(decision.intents.length <= BOT_RULES.difficulties.hard.maxOrders);
  const withoutOil = decideBot(observed({
    wallet: wallet(300, 0, 0),
    legalRefits: [{ workshopId: 20n, shipId: 1n, kind: "high_output_engine" }],
  }), "easy");
  assert.deepEqual(withoutOil.intents, []);
});

test("Open Battlefield grants equal public enemy locations, not friendly or dead contacts", () => {
  const contacts = [
    { id: 9n, faction: 3, entityType: "ship", alive: true, position: p(30, 30) },
    { id: 1n, faction: 1, entityType: "structure", alive: true, position: p(5, 5) },
    { id: 6n, faction: 3, entityType: "structure", alive: false, position: p(3, 3) },
    { id: 7n, faction: 2, entityType: "structure", alive: true, position: p(20, 20) },
  ];
  const seen = detectOpenBattlefieldEnemies(1, 10n, contacts);
  assert.deepEqual(seen.map(e => e.id), [7n, 9n]);
  assert.ok(seen.every(e =>
    !("salvage" in e) && !("productionOrder" in e) && !("ownerSlot" in e)));
  assert.deepEqual(detectOpenBattlefieldEnemies(1, 10n, [...contacts].reverse()), seen);
});

test("Shared material dispatcher forbids foreign faction, zero reserves, out-of-range and missing LOS", () => {
  const events = [];
  const ports = {
    clearRoute: id => events.push(["route", id]),
    clearIronHarvest: id => events.push(["iron", id]),
    clearAttack: id => events.push(["attack", id]),
    upsertMaterial: order => events.push(["material", order.nodeId]),
    stopShip: (id, revision) => events.push(["stop", id, revision]),
  };
  const ship = { id: 2n, matchId: 42n, ownerSlot: 1,
    kind: "scout", hp: 210, x: 3.5, y: 3.5, revision: 5n };
  const node = { id: 6n, matchId: 42n, kind: "oil",
    gridX: 4, gridY: 3, remaining: 100 };
  const context = {
    faction: { matchId: 42n, slot: 1, controller: "bot", eliminated: false },
    ship, node, nowUs: 100n, lineOfSight: true,
  };
  for (const patch of [
    { faction: { ...context.faction, slot: 0 } },
    { node: { ...node, remaining: 0 } },
    { node: { ...node, gridX: 40 } },
    { lineOfSight: false },
  ]) {
    assert.equal(dispatchMaterialHarvest({ ...context, ...patch }, ports).ok, false);
    assert.equal(events.length, 0);
  }
  assert.equal(dispatchMaterialHarvest(context, ports).ok, true);
  assert.deepEqual(events, [
    ["material", 6n], ["iron", 2n], ["route", 2n], ["attack", 2n],
    ["stop", 2n, 6n],
  ]);
});

test("Human and bot share real Workshop ownership, distance and stop checks", () => {
  const station = { matchId: 3n, ownerSlot: 1, kind: "workshop",
    complete: true, connected: true, hp: 680, upgradeRemainingUs: 0n,
    level: 1, gridX: 4, gridY: 4, width: 2, height: 2 };
  const ship = { matchId: 3n, ownerSlot: 1, kind: "scout",
    hp: 210, x: 7.5, y: 5.5, velocityX: 0, velocityY: 0 };
  assert.equal(validateRefitStation(3n, 1, station, ship, false), null);
  assert.match(validateRefitStation(3n, 0, station, ship, false), /own/);
  assert.match(validateRefitStation(3n, 1, {
    ...station, connected: false,
  }, ship, false), /offline/);
  assert.match(validateRefitStation(3n, 1, station, {
    ...ship, x: 30,
  }, false), /range/);
  assert.match(validateRefitStation(3n, 1, station, ship, true), /Stop/);
});
