import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateDeterministicWorld, cellsForSlots, TERRAIN, WORLD_RULES } from '../spacetimedb/src/sim/worldgen.ts';

const digest = world => createHash('sha256').update(world.cells).update(JSON.stringify(world.spawns)).update(JSON.stringify(world.deposits)).digest('hex');

test('all four presets support distinct starts and stable seeded digests', () => {
  for (const slots of [2, 4, 6, 8]) {
    for (const seed of [0, 1, 42, 0x12345678, 0xffffffff]) {
      const a = generateDeterministicWorld(seed, slots);
      const b = generateDeterministicWorld(seed, slots);
      assert.equal(digest(a), digest(b));
      assert.equal(a.spawns.length, slots);
      assert.equal(a.mapCells, cellsForSlots(slots));
      assert.equal(new Set(a.spawns.map(s => s.gridX + ':' + s.gridY)).size, slots);
      assert.equal(a.deposits.filter(d => !d.contested).length, slots * 2);
      assert.equal(a.deposits.filter(d => d.contested).length, Math.max(4, slots));
    }
  }
});

test('chunk encoding matches all final cells, including partial edge chunks', () => {
  for (const slots of [2, 4, 6, 8]) {
    const world = generateDeterministicWorld(99, slots);
    const count = Math.ceil(world.mapCells / WORLD_RULES.chunkSize);
    assert.equal(world.chunks.length, count ** 2);
    for (const chunk of world.chunks) {
      assert.equal(chunk.terrain.length, 256);
      for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
        const x = chunk.chunkX * 16 + lx, y = chunk.chunkY * 16 + ly;
        const actual = chunk.terrain[ly * 16 + lx];
        assert.equal(actual, x >= world.mapCells || y >= world.mapCells ? TERRAIN.DEEP_WATER : world.cells[y * world.mapCells + x]);
      }
    }
  }
});

test('spawn footprints remain clear and deposits are distinct legal shallow-water cells', () => {
  for (let seed = 0; seed < 64; seed++) {
    for (const slots of [2, 4, 6, 8]) {
      const world = generateDeterministicWorld(seed, slots);
      const seen = new Set();
      for (const s of world.spawns) for (let y = s.gridY; y < s.gridY + 3; y++) for (let x = s.gridX; x < s.gridX + 3; x++) {
        assert.ok(x >= 0 && y >= 0 && x < world.mapCells && y < world.mapCells);
        assert.equal(world.cells[y * world.mapCells + x], TERRAIN.DEEP_WATER);
      }
      for (const d of world.deposits) {
        const key = d.gridY * world.mapCells + d.gridX;
        assert.ok(!seen.has(key));
        seen.add(key);
        assert.equal(world.cells[key], TERRAIN.SHALLOW_WATER);
        assert.ok(d.capacity > 0);
      }
    }
  }
});

test('bad slot counts and seeds fail explicitly', () => {
  for (const n of [0, 1, 9, 2.5, NaN]) assert.throws(() => cellsForSlots(n), RangeError);
  for (const seed of [-1, 1.5, NaN, 0x100000000]) assert.throws(() => generateDeterministicWorld(seed, 4), RangeError);
});
