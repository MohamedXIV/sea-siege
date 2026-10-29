import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TURRET_RULES, normalizeBearing, angularDifference, desiredBearing,
  advanceTurret, turretAligned,
} from '../spacetimedb/src/sim/turret-aim.ts';

test('wraps 359 to 1 degrees by shortest arc without 358 degree spin', () => {
  assert.equal(angularDifference(359, 1), 2);
  assert.equal(angularDifference(1, 359), -2);
  assert.equal(angularDifference(0, 180), -180);
  assert.equal(advanceTurret(359, 1, 'scout', .1).angle, 1);
  assert.equal(normalizeBearing(-1), 359);
});

test('server tick slew is bounded by class rate', () => {
  const step=advanceTurret(0, 90, 'cannon', .1);
  assert.equal(step.angle, 10);
  assert.equal(step.aligned, false);
  assert.equal(advanceTurret(step.angle, 90, 'cannon', .25).angle, 35);
  assert.ok(TURRET_RULES.turnDegreesPerSecond.siege < TURRET_RULES.turnDegreesPerSecond.scout);
});

test('a battery cannot fire until physically pointed at the bearing', () => {
  assert.equal(turretAligned(0, 90), false);
  assert.equal(turretAligned(88, 90), true);
  assert.equal(turretAligned(86, 90), false);
  let angle=0;
  for(let i=0;i<20&&!turretAligned(angle,90);i++)angle=advanceTurret(angle,90,'gunboat',.1).angle;
  assert.ok(turretAligned(angle,90));
});

test('bearing is derived from server world positions', () => {
  assert.equal(desiredBearing({x:2,y:2},{x:2,y:5}),90);
  assert.equal(desiredBearing({x:2,y:2},{x:0,y:2}),180);
  assert.equal(desiredBearing({x:2,y:2},{x:2,y:0}),270);
});

test('long delayed ticks cannot skip the physics clamp', () => {
  assert.throws(()=>advanceTurret(0,90,'cannon',.5),RangeError);
  assert.equal(advanceTurret(0,90,'cannon',.25).angle,25);
  assert.throws(()=>advanceTurret(0,90,'invalid',.1),RangeError);
});

test('invalid/nonfinite aim never reaches server state', () => {
  assert.throws(()=>normalizeBearing(NaN),RangeError);
  assert.throws(()=>desiredBearing({x:1,y:1},{x:1,y:1}),RangeError);
  assert.throws(()=>turretAligned(0,30,Infinity),RangeError);
  assert.throws(()=>advanceTurret(NaN,20,'scout',.1),RangeError);
});
