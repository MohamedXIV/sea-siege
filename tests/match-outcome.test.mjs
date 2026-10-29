import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_RULES, dominanceScore5, resolveMatchOutcome, deadlineMicroseconds }
  from '../spacetimedb/src/sim/match-outcome.ts';
const side = (slot, coreHp=1000, structures=4, ships=3, totalSalvageGathered=100n) =>
  ({ slot, coreHp, structures, ships, totalSalvageGathered });
test('preserves Gemini twelve-minute timeout in microseconds', () => {
  assert.equal(MATCH_RULES.durationMs,720000);
  assert.equal(deadlineMicroseconds(1_000_000n),721_000_000n);
});
test('uses exact score formula in integer fifths (no float drift)', () => {
  assert.equal(dominanceScore5(side(0,2200,7,2,501n)),2200n*5n+7n*400n+2n*500n+501n);
  assert.equal(dominanceScore5(side(0,0,0,0,1n)),1n);
});
test('one surviving core wins without waiting for time limit', () => {
  assert.deepEqual(resolveMatchOutcome([side(2)],false), {winnerSlot:2,reason:'domination',winningScore5:null});
});
test('zero survivors is mutual destruction draw', () => {
  assert.deepEqual(resolveMatchOutcome([],false), {winnerSlot:-1,reason:'mutual_destruction',winningScore5:null});
});
test('multiple surviving cores do not finish early', () => {
  assert.equal(resolveMatchOutcome([side(0),side(1)],false),null);
});
test('higher naval dominance score wins at timeout regardless of input order', () => {
  const a=side(0,500,4,2,100n), b=side(3,650,5,3,100n);
  const x=resolveMatchOutcome([a,b],true), y=resolveMatchOutcome([b,a],true);
  assert.deepEqual(x,y);
  assert.equal(x.winnerSlot,3);assert.equal(x.reason,'time_limit');
});
test('exact equal-score tie picks stable lowest living slot', () => {
  const sides=[side(7),side(4),side(1)];
  assert.equal(resolveMatchOutcome(sides,true).winnerSlot,1);
  assert.equal(resolveMatchOutcome(sides.toReversed(),true).winnerSlot,1);
});
test('rejects duplicate slots, negative values and bad timestamps', () => {
  assert.throws(()=>resolveMatchOutcome([side(0),side(0)],true),RangeError);
  assert.throws(()=>dominanceScore5(side(0,-1)),RangeError);
  assert.throws(()=>dominanceScore5(side(0,1000,2,3,-1n)),RangeError);
  assert.throws(()=>deadlineMicroseconds(-1n),RangeError);
});
