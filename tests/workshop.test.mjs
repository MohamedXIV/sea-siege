import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSHOP_RULES, workshopTier, nextWorkshopUpgrade, maximumStructureHp,
  withinWorkshopRange, calculateRepair, progressWorkshopUpgrade } from '../spacetimedb/src/sim/workshop.ts';

test('data-driven tiers improve reach, recovery capacity and efficiency', () => {
  assert.deepEqual(Object.keys(WORKSHOP_RULES.tiers), ['1', '2', '3']);
  assert.deepEqual([1, 2, 3].map(t => workshopTier(t).maxRepairHp), [60, 100, 150]);
  assert.deepEqual([1, 2, 3].map(t => workshopTier(t).hpPerSalvage), [2, 3, 4]);
  assert.throws(() => workshopTier(4), RangeError);
});
test('upgrade cap and costs are explicit, not dependent on client input', () => {
  assert.equal(nextWorkshopUpgrade(1).cost, 200);
  assert.equal(nextWorkshopUpgrade(2).durationUs, 10_000_000n);
  assert.equal(nextWorkshopUpgrade(3), null);
});
test('repair is capped by tier, request and missing health', () => {
  assert.deepEqual(calculateRepair(500, 680, 500, 1), { restoredHp: 60, salvageCost: 30, newHp: 560 });
  assert.deepEqual(calculateRepair(670, 680, 100, 2), { restoredHp: 10, salvageCost: 4, newHp: 680 });
  assert.deepEqual(calculateRepair(200, 680, 37, 3), { restoredHp: 37, salvageCost: 10, newHp: 237 });
});
test('never heals destroyed/full targets or accepts negative and fractional HP', () => {
  assert.throws(() => calculateRepair(0, 680, 80, 1), /Invalid/);
  assert.throws(() => calculateRepair(680, 680, 80, 1), /full health/);
  assert.throws(() => calculateRepair(500, 680, 0, 1), RangeError);
  assert.throws(() => calculateRepair(500.3, 680, 50, 1), RangeError);
});
test('workshop tier increases its own max HP, not any other structure', () => {
  assert.equal(maximumStructureHp(680, 1, 'workshop'), 680);
  assert.equal(maximumStructureHp(680, 3, 'workshop'), 920);
  assert.equal(maximumStructureHp(820, 3, 'shipyard'), 820);
});
test('range uses actual server positions and no nonfinite input', () => {
  assert.equal(withinWorkshopRange({x:0,y:0}, {x:6,y:0}, 1), false);
  assert.equal(withinWorkshopRange({x:0,y:0}, {x:6,y:0}, 2), true);
  assert.equal(withinWorkshopRange({x:0,y:0}, {x:NaN,y:0}, 3), false);
});
test('upgrades stop while disconnected and resume without instant completion', () => {
  assert.equal(progressWorkshopUpgrade(6_000_000n, 2_000_000n, false), 6_000_000n);
  assert.equal(progressWorkshopUpgrade(6_000_000n, 2_000_000n, true), 4_000_000n);
  assert.equal(progressWorkshopUpgrade(4_000_000n, 8_000_000n, true), 0n);
  assert.throws(() => progressWorkshopUpgrade(-1n, 1n, true), RangeError);
});
