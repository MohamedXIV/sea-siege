import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMatchIdInput, U64_MAX } from '../src/network/match-id-validation.ts';

test('validateMatchIdInput rejects empty or blank input', () => {
  assert.equal(validateMatchIdInput('').valid, false);
  assert.equal(validateMatchIdInput('   ').valid, false);
  assert.equal(validateMatchIdInput('\t\n').valid, false);
  assert.equal(validateMatchIdInput('').error, 'Match ID cannot be empty');
});

test('validateMatchIdInput rejects non-decimal strings, negative values, and floats', () => {
  for (const bad of ['abc', '-1', '-99', '3.14', '0x12', '12a', '1e5', '++5', 'null', 'undefined']) {
    const res = validateMatchIdInput(bad);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'Match ID must be a positive decimal number');
  }
});

test('validateMatchIdInput rejects zero', () => {
  const res = validateMatchIdInput('0');
  assert.equal(res.valid, false);
  assert.equal(res.error, 'Match ID must be greater than zero');
});

test('validateMatchIdInput rejects overflow beyond u64 max', () => {
  const overflow = '18446744073709551616';
  const res = validateMatchIdInput(overflow);
  assert.equal(res.valid, false);
  assert.equal(res.error, 'Match ID exceeds maximum 64-bit integer value');

  const huge = '99999999999999999999999999999999999999';
  const resHuge = validateMatchIdInput(huge);
  assert.equal(resHuge.valid, false);
  assert.equal(resHuge.error, 'Match ID exceeds maximum 64-bit integer value');
});

test('validateMatchIdInput accepts valid positive decimal u64 values', () => {
  const one = validateMatchIdInput('1');
  assert.equal(one.valid, true);
  assert.equal(one.value, 1n);

  const fortyTwo = validateMatchIdInput('  42  ');
  assert.equal(fortyTwo.valid, true);
  assert.equal(fortyTwo.value, 42n);

  const max = validateMatchIdInput(U64_MAX.toString());
  assert.equal(max.valid, true);
  assert.equal(max.value, U64_MAX);
});
