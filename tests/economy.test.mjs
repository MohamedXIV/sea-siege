import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY_RULES, advanceProduction, cappedElapsedUs, creditSalvage, debitSalvage,
  drawSalvage, findShipyardSpawn, inRange, replenishSalvage, rigExtraction, shipDefinition }
  from '../spacetimedb/src/sim/economy.ts';
import { TERRAIN } from '../spacetimedb/src/sim/worldgen.ts';

const mapCells = 16;
const env = (more = {}) => ({ mapCells, terrain: new Uint8Array(mapCells * mapCells), ...more });
const yard = { gridX: 6, gridY: 6, width: 2, height: 2 };

test('reference-derived ship costs, durations and harvesting rates are data driven', () => {
  assert.deepEqual(Object.keys(ECONOMY_RULES.ships), ['scout', 'gunboat', 'siege']);
  assert.deepEqual(['scout', 'gunboat', 'siege'].map(k => shipDefinition(k).cost), [70, 130, 220]);
  assert.deepEqual(['scout', 'gunboat', 'siege'].map(k => shipDefinition(k).buildMs), [4000, 6500, 9500]);
  assert.equal(shipDefinition('siege').harvestPerSecond, 0);
  assert.equal(shipDefinition('invalid'), null);
});

test('no negative funds, extra credits, or overflow', () => {
  assert.equal(debitSalvage(420, 130), 290);
  assert.equal(creditSalvage(ECONOMY_RULES.maxSalvage - 1, 100), ECONOMY_RULES.maxSalvage);
  assert.throws(() => debitSalvage(10, 70), /Insufficient/);
  assert.throws(() => creditSalvage(-1, 10), RangeError);
  assert.throws(() => drawSalvage(-1, 3), RangeError);
});

test('node depletion, regeneration, and partial harvest remain conservative', () => {
  assert.deepEqual(drawSalvage(5, 16), { taken: 5, remaining: 0 });
  assert.equal(replenishSalvage({gridX:1,gridY:1,capacity:25,remaining:19,regenPerSec:4},3),25);
  assert.equal(replenishSalvage({gridX:1,gridY:1,capacity:25,remaining:0,regenPerSec:4},2),8);
  assert.throws(() => replenishSalvage({gridX:0,gridY:0,capacity:10,remaining:11,regenPerSec:3},1), RangeError);
});

test('rig output is capped by actual node salvage, including fully depleted deposits', () => {
  assert.deepEqual(rigExtraction(8, 1), { earned: 17, takenFromNode: 8, remaining: 0 });
  assert.deepEqual(rigExtraction(0, 1), { earned: 9, takenFromNode: 0, remaining: 0 });
  assert.equal(inRange({x:0,y:0},{x:3,y:4},5), true);
  assert.equal(inRange({x:0,y:0},{x:3,y:4},4.9), false);
});

test('queue work pauses while offline and never over-completes', () => {
  assert.equal(advanceProduction(4_000_000n, 2_000_000n, true), 2_000_000n);
  assert.equal(advanceProduction(2_000_000n, 7_000_000n, true), 0n);
  assert.equal(advanceProduction(2_000_000n, 7_000_000n, false), 2_000_000n);
  assert.throws(() => advanceProduction(-1n, 0n, true), RangeError);
});

test('late ticks have bounded real elapsed time and no duplicate catch-up', () => {
  assert.equal(cappedElapsedUs(0n, 1_000_000n), 1_000_000n);
  assert.equal(cappedElapsedUs(0n, 9_000_000n), 5_000_000n);
  assert.equal(cappedElapsedUs(10n, 0n), 0n);
});

test('shipyard finds legal water around its footprint for every hull class', () => {
  const world = env({ footprints: [{x:6,y:6,width:2,height:2}] });
  for (const kind of ['scout','gunboat','siege']) {
    const point = findShipyardSpawn(yard, kind, world);
    assert.ok(point);
    assert.ok(point.x < 6 || point.x > 8 || point.y < 6 || point.y > 8);
  }
});

test('shipyard never spawns inside blocked terrain or an overlapping vessel', () => {
  const terrain = new Uint8Array(mapCells * mapCells).fill(TERRAIN.RUINED_PILLAR);
  const blocked = env({terrain, footprints:[{x:6,y:6,width:2,height:2}]});
  assert.equal(findShipyardSpawn(yard,'scout',blocked),null);
  const available = env({footprints:[{x:6,y:6,width:2,height:2}], vessels:[{id:1n,x:5.5,y:6.5,radius:0.56}]});
  const spawn = findShipyardSpawn(yard,'gunboat',available);
  assert.ok(spawn);
  assert.ok(Math.hypot(spawn.x-5.5,spawn.y-6.5) >= 0.56+0.56);
});

test('a flooded or overcrowded shipyard holds production without granting a ship', () => {
  const blocked = env({vessels: Array.from({length:256}, (_,i)=>({id:BigInt(i+1),x:i%16+.5,y:Math.floor(i/16)+.5,radius:.9}))});
  assert.equal(findShipyardSpawn(yard,'scout',blocked),null);
});
