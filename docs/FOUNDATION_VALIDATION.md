# Foundation validation and deferred Cloud integration

## What was verified (2026-10-29)
- Node.js 22.16.0 TypeScript strip-types: `node --experimental-strip-types --test tests/*.test.mjs` — **6/6 motion tests pass** in the execution VM.
- Global TypeScript 5.8.3: `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler src/game/motion/SnapshotBuffer.ts` — passed.
- These tests cover *only* the standalone presentation math and buffering; they do not establish that the game UI or SpacetimeDB module builds or runs.

## Additional prepared checks (not executed here)
- `npm install && npm run typecheck && npm run build` — frontend deps unavailable in this VM.
- `cd spacetimedb && npm install && npm test` — official SpacetimeDB >=2.12 module datastore test harness, not executed due to package download restrictions.
- `spacetime build --module-path ./spacetimedb`, `spacetime publish`, `spacetime generate`, 2-browser integration — **not run**. Do not close related acceptance criteria until verified.

## Why a module test harness?
The official `spacetimedb/server/test-utils` package uses the actual SpacetimeDB in-memory datastore and reducer transaction semantics, not a fake browser backend. It does **not** simulate subscriptions, WebSocket connections, published modules or cloud behavior. The latter remain acceptance criteria for #3, #4 and #17.

The module tests protect:
- 2–8 player slot bounds and rejected transaction rollback.
- Owner-only start and order commands.
- Caller-filtered private ship and membership views.

## Timing architecture
`SnapshotBuffer` is a pure presentation helper. It accepts **server-time-aligned**, already-authorized snapshots and exposes `sample(renderServerTimeMs)`. The caller must map the real server clock and subtract an intentional render delay. It never publishes state, and must be discarded upon fog hide, entity removal and reconnect. P0 integration will bind it to generated SDK subscriptions; full tuning and measurement are #19.

Official references: https://spacetimedb.com/docs/how-to/unit-testing/ and https://spacetimedb.com/docs/quickstarts/typescript/.

## New verified world-generation work (29 October 2026)
- Added `spacetimedb/src/sim/worldgen.ts`: deterministic server-side generation for 2/4/6/8 (+ intermediate) slots, static 16×16 chunks, localized and contested salvage deposits.
- `node --experimental-strip-types --test tests/worldgen.test.mjs` — **4/4 pass** (256 seed/slot stress cases inside tests), independently from SpacetimeDB packages.
- `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler spacetimedb/src/sim/worldgen.ts` — **PASS**.
- Uploaded source/test file Git blob hashes match the exact locally executed versions.
- The `createMatch` reducer now generates static world chunks, spawn assignments and deposits in a single transaction and keeps seed/map config private. `joinMatch` uses stored spawn coordinates and order bounds use each map's actual size. **Reducer integration tests are prepared but NOT run** in this environment. No FoW-aware resource/terrain views exist yet; do not mark world integration or discovery complete.

### Security guard
Do not move `worldConfig`, `worldChunk`, `worldSpawn`, `salvageNode`, or `ship` to public tables as a convenience: an attacker could reconstruct hidden spawns and salvage. Before client/world rendering, implement authorized discovery projections with the needed security invariants (#13). Public match metadata deliberately excludes the seed.
