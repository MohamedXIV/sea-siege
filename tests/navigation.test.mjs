import test from 'node:test';
import assert from 'node:assert/strict';
import { findTerrainPath } from '../spacetimedb/src/sim/navigation.ts';
import { generateDeterministicWorld, TERRAIN } from '../spacetimedb/src/sim/worldgen.ts';

const point = (x, y) => ({x, y});

test('routes around a blocked industrial wall through a valid gap', () => {
  const cells = new Uint8Array(25);
  for(let y=0;y<5;y++) if(y !== 2) cells[y*5+2] = TERRAIN.RUINED_PILLAR;
  const route = findTerrainPath(cells, 5, point(.5,.5), point(4.5,4.5));
  assert.ok(route);
  assert.ok(route.waypoints.some(p => p.x === 2.5 && p.y === 2.5));
  for(const p of route.waypoints) assert.ok(cells[Math.floor(p.y)*5+Math.floor(p.x)] < 2);
});

test('does not cut diagonally between touching obstacles', () => {
  const cells = new Uint8Array(9);
  cells[1] = TERRAIN.RUINED_PILLAR;
  cells[3] = TERRAIN.WRECKAGE_SHOAL;
  assert.equal(findTerrainPath(cells, 3, point(.5,.5), point(1.5,1.5)), null);
});

test('can reject dynamic occupancy and clearance violations', () => {
  const cells = new Uint8Array(49);
  assert.equal(findTerrainPath(cells, 7, point(1.5,1.5), point(5.5,5.5), {blocked:(x,y)=>x===5 && y===5}), null);
  cells[3*7+3] = TERRAIN.RUINED_PILLAR;
  const route = findTerrainPath(cells, 7, point(1.5,1.5), point(5.5,5.5), {clearanceCells:1});
  assert.ok(route);
  for(const p of route.waypoints) assert.ok(Math.abs(p.x-3.5)>1 || Math.abs(p.y-3.5)>1);
});

test('seeded worlds give deterministic valid cross-chunk routes', () => {
  for(const slots of [2,4,6,8]) {
    const world = generateDeterministicWorld(42, slots);
    const from = world.spawns[0];
    const to = world.spawns[1];
    const a = findTerrainPath(world.cells, world.mapCells, point(from.gridX+1.5,from.gridY+1.5), point(to.gridX+1.5,to.gridY+1.5));
    const b = findTerrainPath(world.cells, world.mapCells, point(from.gridX+1.5,from.gridY+1.5), point(to.gridX+1.5,to.gridY+1.5));
    assert.deepEqual(a,b);
    assert.ok(a && a.waypoints.length > 0);
    for(const p of a.waypoints) assert.ok(world.cells[Math.floor(p.y)*world.mapCells+Math.floor(p.x)] < 2);
  }
});

test('invalid cells or budgets reject safely, and search has bounded work', () => {
  assert.throws(()=>findTerrainPath(new Uint8Array(4), 3, point(0,0),point(1,1)),RangeError);
  assert.throws(()=>findTerrainPath(new Uint8Array(9), 3, point(0,0),point(1,1),{maxExpanded:0}),RangeError);
  assert.equal(findTerrainPath(new Uint8Array(9), 3, point(0,0),point(2,2),{maxExpanded:1}),null);
  assert.equal(findTerrainPath(new Uint8Array(9), 3, point(NaN,0),point(1,1)),null);
});

test('chunk reconstruction preserves exact authoritative terrain bytes', async () => {
  const { decodeTerrainChunks } = await import('../spacetimedb/src/sim/navigation.ts');
  for(const slots of [2,4,6,8]) {
    const world = generateDeterministicWorld(222, slots);
    const restored = decodeTerrainChunks(world.mapCells, world.chunks);
    assert.deepEqual(restored, world.cells);
    assert.throws(() => decodeTerrainChunks(world.mapCells, world.chunks.slice(1)), /incomplete/);
    const duplicate = [...world.chunks]; duplicate[0] = world.chunks[1];
    assert.throws(() => decodeTerrainChunks(world.mapCells, duplicate), /duplicate/);
  }
});
