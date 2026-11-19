import test from "node:test";
import assert from "node:assert/strict";
import { chooseDefenseTarget } from "../spacetimedb/src/sim/defense-targeting.ts";
import { structureInfluenceRange } from "../src/game/buildings/structure-range.ts";
import { shipWakeSegments } from "../src/game/vfx/ship-wake.ts";

const water = new Uint8Array(64 * 64);
const cannon = { ownerSlot: 0, kind: "cannon", x: 10.5, y: 10.5 };
const opponent = (id, x, y, type = "ship") =>
  ({ id, matchId: 7n, ownerSlot: 1, type, x, y, hp: 100 });

test("fixed cannons choose a nearby hostile through the same real weapon range", () => {
  const targets = [
    { ...opponent(1n, 12.5, 10.5), ownerSlot: 0 }, // allied, never shoot
    opponent(3n, 25.5, 10.5),                      // beyond 8.5-cell fire range
    opponent(4n, 14.5, 10.5),
    opponent(5n, 13.5, 10.5),
  ];
  assert.equal(chooseDefenseTarget(cannon, targets, water, 64)?.id, 5n);
  assert.equal(chooseDefenseTarget(cannon, targets.slice(0, 2), water, 64), null);
});

test("terrain blocks cannon targeting; exact-distance ties are deterministic", () => {
  const terrain = water.slice();
  terrain[10 * 64 + 12] = 2; // ruined pillar between cannon and enemy
  assert.equal(chooseDefenseTarget(cannon, [opponent(1n, 14.5, 10.5)], terrain, 64), null);
  assert.equal(chooseDefenseTarget(cannon, [
    opponent(9n, 13.5, 10.5, "structure"),
    opponent(7n, 13.5, 10.5, "ship"),
  ], water, 64)?.id, 7n);
});

test("build influence circles use real server radius and Workshop tiers", () => {
  assert.equal(structureInfluenceRange("cannon"), 8.5);
  assert.equal(structureInfluenceRange("salvage_rig"), 4.5);
  assert.equal(structureInfluenceRange("workshop"), 4.5);
  assert.equal(structureInfluenceRange("workshop", 2), 6);
  assert.equal(structureInfluenceRange("workshop", 3), 8);
  assert.equal(structureInfluenceRange("platform"), null);
  assert.equal(structureInfluenceRange("workshop", 500), null);
});

test("wake VFX are local, aligned to motion, and disappear when stopped", () => {
  assert.deepEqual(shipWakeSegments(0, 0, 30, 0), []);
  assert.deepEqual(shipWakeSegments(Number.NaN, 2, 30, 0), []);
  const right = shipWakeSegments(3, 0, 30, 0);
  const down = shipWakeSegments(0, 3, 30, 0);
  assert.equal(right.length, 10);
  assert.equal(down.length, 10);
  assert.ok(right.every(segment => segment.bx < segment.ax));
  assert.ok(down.every(segment => segment.by < segment.ay));
  assert.ok(right.every(segment =>
    segment.alpha > 0 && segment.alpha <= 1 && segment.width > 0));
});
