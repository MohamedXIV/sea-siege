import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectP0 } from '../scripts/p0-preflight.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sea-siege-p0-'));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function write(root, path, value) {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, value);
}

test('missing dependencies and generated bindings never pass preflight', () => {
  fixture(root => {
    const report = inspectP0(root, false);
    assert.equal(report.readyForVerification, false);
    assert.equal(report.checks.filter(([, passed]) => passed).length, 0);
  });
});

test('a complete local toolchain is only ready for verification, not verified', () => {
  fixture(root => {
    write(root, 'package.json', JSON.stringify({ dependencies: { spacetimedb: '^2.12.0' } }));
    write(root, 'spacetimedb/package.json', JSON.stringify({ dependencies: { spacetimedb: '^2.12.0' } }));
    for (const path of [
      'node_modules/phaser/package.json',
      'node_modules/spacetimedb/package.json',
      'spacetimedb/node_modules/spacetimedb/package.json',
      'src/module_bindings/index.ts',
    ]) write(root, path, '');
    assert.equal(inspectP0(root, true).readyForVerification, true);
    assert.equal(inspectP0(root, false).readyForVerification, false);
  });
});

test('client/server SDK divergence is rejected', () => {
  fixture(root => {
    write(root, 'package.json', JSON.stringify({ dependencies: { spacetimedb: '^2.13.0' } }));
    write(root, 'spacetimedb/package.json', JSON.stringify({ dependencies: { spacetimedb: '^2.12.0' } }));
    const result = inspectP0(root, true);
    assert.equal(result.checks[2][1], false);
    assert.equal(result.readyForVerification, false);
  });
});
