import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACK_RULES, approachDestinations, planAttackStep, dispatchAttackOrder,
} from '../spacetimedb/src/sim/attack-order.ts';
import { weaponDefinition } from '../spacetimedb/src/sim/combat.ts';

const ship = (overrides = {}) => ({
  id: 1n, matchId: 9n, ownerSlot: 0, kind: 'scout',
  x: 10, y: 10, revision: 4n, ...overrides,
});
const target = (overrides = {}) => ({
  id: 2n, matchId: 9n, ownerSlot: 1, type: 'ship',
  x: 13, y: 10, hp: 60, ...overrides,
});
const faction = (overrides = {}) => ({
  matchId: 9n, slot: 0, controller: 'human', eliminated: false, ...overrides,
});

test('approach destinations stay on the ship-target bearing and inside the map', () => {
  const points = approachDestinations({ x: 2, y: 2 }, { x: 12, y: 2 }, 5, 64);
  assert.equal(points.length, ATTACK_RULES.approachFractions.length);
  for (const point of points) {
    assert.equal(point.y, 2);
    assert.ok(point.x > 2 && point.x < 12);
  }
  // Fractions descend, so later points sit closer to the target.
  assert.ok(points[0].x < points[1].x);
  const clamped = approachDestinations({ x: 1, y: 1 }, { x: 3, y: 1 }, 1000, 8);
  for (const point of clamped) {
    assert.ok(point.x >= 0.5 && point.x <= 7.5);
    assert.ok(point.y >= 0.5 && point.y <= 7.5);
  }
});

test('in-range line of sight engages, out-of-range chases along the bearing', () => {
  const engaging = planAttackStep({
    ship: { x: 10, y: 10 }, target: target(), weaponRange: 5.5,
    mapCells: 64, lineOfSight: true,
  });
  assert.equal(engaging.kind, 'engage');
  assert.equal(engaging.desiredAngleDeg, 0);
  assert.equal(engaging.distance, 3);

  const chasing = planAttackStep({
    ship: { x: 10, y: 10 }, target: target({ x: 20, y: 10 }), weaponRange: 5.5,
    mapCells: 64, lineOfSight: true,
  });
  assert.equal(chasing.kind, 'chase');
  assert.equal(chasing.desiredAngleDeg, 0);
  assert.ok(chasing.destinations.length > 0);
});

test('terrain-blocked shots mark closer instead of firing through terrain', () => {
  const blocked = planAttackStep({
    ship: { x: 10, y: 10 }, target: target(), weaponRange: 5.5,
    mapCells: 64, lineOfSight: false,
  });
  assert.equal(blocked.kind, 'chase');
  const last = blocked.destinations[blocked.destinations.length - 1];
  // Closer than the normal approach: at most 0.2 weapon range from the target.
  assert.ok(Math.hypot(last.x - 13, last.y - 10) <= 5.5 * 0.2 + 1e-9);
});

test('destroyed, overlapping or invalid targets cancel rather than fire', () => {
  const base = {
    ship: { x: 10, y: 10 }, weaponRange: 5.5, mapCells: 64, lineOfSight: true,
  };
  assert.equal(planAttackStep({ ...base, target: target({ hp: 0 }) }).kind, 'cancel');
  assert.equal(planAttackStep({ ...base, target: null }).kind, 'cancel');
  assert.equal(planAttackStep({ ...base, target: target({ x: 10, y: 10 }) }).kind, 'cancel');
  assert.equal(planAttackStep({ ...base, target: target(), weaponRange: 0 }).kind, 'cancel');
  assert.equal(planAttackStep({
    ship: { x: NaN, y: 10 }, target: target(), weaponRange: 5.5,
    mapCells: 64, lineOfSight: true,
  }).kind, 'cancel');
  assert.ok(weaponDefinition('scout').range <= ATTACK_RULES.maxTargetDistanceCells);
});

function recordingPorts() {
  const calls = [];
  return {
    calls,
    ports: {
      clearRoute: id => calls.push(['clearRoute', id]),
      clearHarvest: id => calls.push(['clearHarvest', id]),
      upsertOrder: order => calls.push(['upsertOrder', order]),
      stopShip: (id, revision) => calls.push(['stopShip', id, revision]),
      ensureCombatTick: () => calls.push(['ensureCombatTick']),
    },
  };
}

test('shared dispatcher rejects foreign ships and friendly targets without side effects', () => {
  const { calls, ports } = recordingPorts();
  const foreign = dispatchAttackOrder({
    faction: faction(), ship: ship({ ownerSlot: 1 }), target: target(), nowUs: 100n,
  }, ports);
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /unavailable/i);

  const friendly = dispatchAttackOrder({
    faction: faction(), ship: ship(), target: target({ ownerSlot: 0 }), nowUs: 100n,
  }, ports);
  assert.equal(friendly.ok, false);
  assert.match(friendly.reason, /not visible/i);

  const otherMatch = dispatchAttackOrder({
    faction: faction(), ship: ship(), target: target({ matchId: 10n }), nowUs: 100n,
  }, ports);
  assert.equal(otherMatch.ok, false);

  const unarmed = dispatchAttackOrder({
    faction: faction(), ship: ship({ kind: 'barge' }), target: target(), nowUs: 100n,
  }, ports);
  assert.equal(unarmed.ok, false);
  assert.match(unarmed.reason, /weapon/i);

  const tooFar = dispatchAttackOrder({
    faction: faction(), ship: ship(), target: target({ x: 2000 }), nowUs: 100n,
  }, ports);
  assert.equal(tooFar.ok, false);
  assert.match(tooFar.reason, /tactical range/i);

  assert.deepEqual(calls, []);
});

test('authorized orders clear competing tasks, upsert once and kick the scheduler', () => {
  const { calls, ports } = recordingPorts();
  const result = dispatchAttackOrder({
    faction: faction(), ship: ship(), target: target(), nowUs: 500n,
  }, ports);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['clearRoute', 1n],
    ['clearHarvest', 1n],
    ['upsertOrder', {
      shipId: 1n, matchId: 9n, targetType: 'ship', targetId: 2n,
      issuedAtUs: 500n, nextChaseAtUs: 0n,
    }],
    ['stopShip', 1n, 5n],
    ['ensureCombatTick'],
  ]);
});
