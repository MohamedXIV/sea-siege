import test from 'node:test';
import assert from 'node:assert/strict';
import { firstFreeSlot, deriveBotSeed } from '../spacetimedb/src/sim/bot-seats.ts';

test('fills only empty seats, including holes after removals', () => {
  assert.equal(firstFreeSlot(4, [0, 2]), 1);
  assert.equal(firstFreeSlot(4, [0, 1, 2]), 3);
  assert.equal(firstFreeSlot(4, [0, 1, 2, 3]), null);
});
test('human and bot seats share the same capacity and slot domain', () => {
  assert.equal(firstFreeSlot(2, [0]), 1);
  assert.throws(() => firstFreeSlot(2, [0, 0]), /Duplicate/);
  assert.throws(() => firstFreeSlot(2, [2]), RangeError);
  assert.throws(() => firstFreeSlot(9, []), RangeError);
});
test('stable derived seeds do not depend on order or wall clock', () => {
  const a = [1, 2, 3].map(slot => deriveBotSeed(123456, slot));
  const b = [3, 1, 2].map(slot => deriveBotSeed(123456, slot));
  assert.deepEqual(b, [a[2], a[0], a[1]]);
  assert.equal(new Set(a).size, 3);
  assert.equal(deriveBotSeed(123456, 1), a[0]);
});
test('rejects invalid world seeds and slots', () => {
  assert.throws(() => deriveBotSeed(-1, 0), RangeError);
  assert.throws(() => deriveBotSeed(0x100000000, 0), RangeError);
  assert.throws(() => deriveBotSeed(123, 8), RangeError);
});
