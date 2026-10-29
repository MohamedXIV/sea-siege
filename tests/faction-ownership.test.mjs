import test from 'node:test';
import assert from 'node:assert/strict';
import { factionKey, mayControlFaction } from '../spacetimedb/src/sim/faction-ownership.ts';

test('match-scoped faction keys do not collide across matches or slots',()=>{
  const keys = new Set();
  for(let match=1n;match<=40n;match++)for(let slot=0;slot<8;slot++)
    keys.add(factionKey(match,slot));
  assert.equal(keys.size,320);
  assert.equal(factionKey(1n,7),'1:7');
  assert.equal(factionKey(2n,0),'2:0');
});
test('u32 slots and non-negative IDs are validated',()=>{
  assert.throws(()=>factionKey(-1n,0),RangeError);
  assert.throws(()=>factionKey(1n,-1),RangeError);
  assert.throws(()=>factionKey(1n,1.2),RangeError);
  assert.throws(()=>factionKey(1n,0x100000000),RangeError);
});
test('human permission is denied without membership or with eliminated seat',()=>{
  assert.equal(mayControlFaction(undefined,0,false),false);
  assert.equal(mayControlFaction(0,0,true),false);
  assert.equal(mayControlFaction(0,0,false),true);
});
test('human cannot command another faction or impersonate bot seats',()=>{
  assert.equal(mayControlFaction(0,1,false),false);
  assert.equal(mayControlFaction(3,7,false),false);
  assert.equal(mayControlFaction(undefined,7,false),false);
});
test('never trusts malformed faction slots',()=>{
  assert.equal(mayControlFaction(-1,0,false),false);
  assert.equal(mayControlFaction(0,Infinity,false),false);
  assert.equal(mayControlFaction(1.5,1.5,false),false);
});
