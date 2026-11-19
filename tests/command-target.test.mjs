import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRightClickCommand } from '../src/game/input/command-target.ts';

const ships = [
  { id: 1n, ownerSlot: 0, x: 10, y: 10, radiusCells: 0.42 },
  { id: 2n, ownerSlot: 1, x: 12, y: 10, radiusCells: 0.56 },
];
const structures = [
  { id: 4n, kind: 'shipyard', channel: 'superstructure', ownerSlot: 1,
    gridX: 20, gridY: 20, width: 2, height: 2 },
  { id: 5n, kind: 'platform', channel: 'surface', ownerSlot: 0,
    gridX: 30, gridY: 30, width: 1, height: 1 },
];
const salvage = [{ id: 9n, gridX: 40, gridY: 40, remaining: 50 }];

test('right-clicking a hostile ship resolves an attack, not a move', () => {
  const command = resolveRightClickCommand({ x: 12.2, y: 10.1 }, 0, ships, structures, salvage);
  assert.deepEqual(command, {
    kind: 'attack', targetType: 'ship', targetId: 2n, x: 12, y: 10,
  });
});

test('right-clicking a hostile structure resolves a structure attack', () => {
  const command = resolveRightClickCommand({ x: 21, y: 21 }, 0, ships, structures, salvage);
  assert.equal(command.kind, 'attack');
  assert.equal(command.targetType, 'structure');
  assert.equal(command.targetId, 4n);
  assert.equal(command.x, 21);
});

test('friendly ships and structures stay move targets', () => {
  assert.equal(resolveRightClickCommand({ x: 10.1, y: 10 }, 0, ships, structures, salvage).kind, 'move');
  assert.equal(resolveRightClickCommand({ x: 30.5, y: 30.5 }, 0, ships, structures, salvage).kind, 'move');
});

test('a hostile ship wins over a salvage node under the cursor', () => {
  const command = resolveRightClickCommand(
    { x: 12.3, y: 10.2 }, 0, ships, structures,
    [{ id: 10n, gridX: 11, gridY: 9, remaining: 20 }],
  );
  assert.equal(command.kind, 'attack');
});

test('salvage and empty water fall through in priority order', () => {
  const node = resolveRightClickCommand({ x: 40.5, y: 40.5 }, 0, ships, structures, salvage);
  assert.deepEqual(node, { kind: 'salvage', nodeId: 9n, gridX: 40, gridY: 40 });
  const water = resolveRightClickCommand({ x: 5, y: 5 }, 0, ships, structures, salvage);
  assert.deepEqual(water, { kind: 'move', x: 5, y: 5 });
});

test('missing faction or non-finite input never produces a hostile order', () => {
  assert.equal(resolveRightClickCommand({ x: 12, y: 10 }, undefined, ships, structures, salvage).kind, 'move');
  assert.equal(resolveRightClickCommand({ x: NaN, y: 10 }, 0, ships, structures, salvage).kind, 'move');
});
