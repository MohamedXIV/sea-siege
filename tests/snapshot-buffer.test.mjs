import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer, interpolateAngle } from '../src/game/motion/SnapshotBuffer.ts';

const rad = degrees => degrees * Math.PI / 180;
const snapshot = (timeMs, x, revision = 1, angle = 0) => ({
  timeMs, revision, x, y: 10, vx: 20, vy: 0, hullAngle: angle, turretAngle: angle,
});

test('interpolates at 60 FPS between sparse 5 Hz samples', () => {
  const buffer = new SnapshotBuffer();
  buffer.push(snapshot(0, 0));
  buffer.push(snapshot(200, 40));
  const atFrame = buffer.sample(1000 / 60 * 6);
  assert.equal(atFrame.kind, 'interpolated');
  assert.equal(atFrame.x, 20);
  assert.equal(buffer.sample(50).x, 10);
});

test('unwraps 359 to 1 degree by the shortest arc', () => {
  const angle = interpolateAngle(rad(359), rad(1), .5);
  assert.ok(Math.abs(Math.cos(angle) - 1) < 1e-12);
});

test('rejects stale, duplicate, and nonfinite snapshots', () => {
  const buffer = new SnapshotBuffer();
  assert.equal(buffer.push(snapshot(100, 4, 2)), true);
  assert.equal(buffer.push(snapshot(50, 99, 5)), false);
  assert.equal(buffer.push(snapshot(100, 99, 2)), false);
  assert.equal(buffer.push(snapshot(200, NaN, 5)), false);
  assert.equal(buffer.push(snapshot(100, 5, 3)), true);
  assert.equal(buffer.sample(100).x, 5);
});

test('caps dead reckoning and remains stable during long gaps', () => {
  const buffer = new SnapshotBuffer({ maxExtrapolationMs: 100 });
  buffer.push(snapshot(1000, 5));
  assert.equal(buffer.sample(1050).x, 6);
  assert.equal(buffer.sample(5000).x, 7);
  assert.equal(buffer.sample(5000).kind, 'extrapolated');
});

test('caps memory and never interpolates hidden entities after clear', () => {
  const buffer = new SnapshotBuffer({ capacity: 2 });
  for(let i=0;i<10;i++) buffer.push(snapshot(i*100, i, i));
  assert.equal(buffer.size, 2);
  assert.equal(buffer.sample(0).x, 8);
  buffer.clear();
  assert.equal(buffer.sample(1000), null);
  buffer.push(snapshot(2000, 42));
  assert.equal(buffer.sample(2100).x, 44);
});

test('invalid settings and empty buffers fail safely', () => {
  assert.throws(() => new SnapshotBuffer({capacity:1}), RangeError);
  assert.throws(() => new SnapshotBuffer({maxExtrapolationMs:-1}), RangeError);
  assert.equal(new SnapshotBuffer().sample(0), null);
});
