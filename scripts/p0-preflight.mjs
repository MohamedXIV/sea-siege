import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function cliAvailable() {
  const probe = spawnSync('spacetime', ['--version'], {
    encoding: 'utf8', timeout: 5000, stdio: 'pipe',
  });
  return !probe.error && probe.status === 0;
}

/** Read-only readiness checks. This does not claim a successful build or connection. */
export function inspectP0(root = repoRoot, hasCli = cliAvailable()) {
  const frontend = readJson(join(root, 'package.json'));
  const backend = readJson(join(root, 'spacetimedb', 'package.json'));
  const clientSdk = frontend?.dependencies?.spacetimedb;
  const serverSdk = backend?.dependencies?.spacetimedb;
  const checks = [
    ['Frontend package manifest', frontend !== null],
    ['Server package manifest', backend !== null],
    ['Matching client/server SpacetimeDB SDK ranges', Boolean(clientSdk && serverSdk && clientSdk === serverSdk)],
    ['Frontend dependencies installed', existsSync(join(root, 'node_modules', 'phaser', 'package.json')) && existsSync(join(root, 'node_modules', 'spacetimedb', 'package.json'))],
    ['Server SDK installed', existsSync(join(root, 'spacetimedb', 'node_modules', 'spacetimedb', 'package.json'))],
    ['SpacetimeDB CLI accessible', hasCli],
    ['Official generated TypeScript bindings present', existsSync(join(root, 'src', 'module_bindings', 'index.ts'))],
  ];
  return { checks, readyForVerification: checks.every(([, passed]) => passed) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectP0();
  for (const [name, passed] of result.checks) {
    console.log((passed ? 'OK     ' : 'BLOCKED') + ' ' + name);
  }
  console.log('\nNext verification steps (not executed by preflight):');
  console.log('  npm install && npm --prefix spacetimedb install');
  console.log('  npm run db:build && npm run db:generate');
  console.log('  npm run typecheck && npm run build');
  console.log('  npm run db:typecheck && npm run db:test');
  console.log('  Then: publish to local SpacetimeDB and verify two independent browser identities.');
  console.log('No Cloud database, fake client, or SDK connection was created.');
  if (!result.readyForVerification) process.exitCode = 1;
}
