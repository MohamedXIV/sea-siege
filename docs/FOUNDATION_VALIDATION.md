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

## Backend world, route, and authorization work — execution batch
- Generated world's **actual** seed is selected inside the reducer via `ctx.random.integerInRange` (never accepted from client input); persisted in a **private** `world_config`. It is deterministic for replay but not cryptographically secret against a determined timestamp attacker.
- `createMatch` transaction writes **private** `world_spawn`, `world_chunk`, and `salvage_node` rows. `joinMatch` places ships at persisted legal spawn points rather than hard-coded 8/8 or 12-cell offsets.
- `issueShipOrder` validates real match bounds, reconstructs real stored chunks, computes an authoritative bounded A* path, rejects blocked/unreachable destinations, and stores a private `ship_route` with revision and cursor.
- **Important:** this is route validation and storage, **not yet moving ships**. Scheduled server movement, dynamic building occupancy, per-ship hull clearance and fog-filtered world views remain in #8/#10/#13. Avoid treating #7/#10 as completed.
- Fresh locally executed evidence: **10/10 pure TS Node tests pass** (4 worldgen, 6 navigation); strict TypeScript checks of both pure modules pass with global `tsc`. Additional smoke: 2–8 slots × 1,200 seeds each generated without exceptions.
- Source integrity: GitHub blob SHA-1 matched exactly the locally tested worldgen, navigation, and their Node tests.
- SpacetimeDB module test additions are **prepared only**, not run (no npm/CLI connectivity); the schema and reducer execution remain **unverified**. No Cloud database or account credentials were used.

## Server-owned scheduled ship movement — 29 Oct 2026

**Verified locally (pure TypeScript only):**
- `spacetimedb/src/sim/ship-motion.ts` passes strict standalone TypeScript typecheck with global TypeScript 5.8.3.
- `node --experimental-strip-types --test tests/ship-motion.test.mjs` — **8/8 PASS**, including bounded elapsed time, no waypoint teleportation/overshoot, shortest heading arcs, 5/10/20Hz motion invariance for straight paths, idle completion and delayed tick cap.
- Verified exact GitHub blob IDs against locally executed source and test: `06e2975da23fb8c01b3e08a2581c333b88f00400` and `f5c0e7b61da32e08b3fa7a3b290794a2adf23f2d`.

**Code added, but NOT executed inside SpacetimeDB:**
- Official `t.scheduleAt()`, `ScheduleAt.interval(100_000n)` and `onSchedule` private per-moving-match timer.
- `advanceMatchSimulation` with `ctx.senderAuth.isInternal` guard, elapsed time from `ctx.timestamp`, indexed match/ship-route lookup, authoritative ship position/velocity updates and lazy timer teardown.
- `stopShip` with same ownership validation as orders.
- Prepared module-harness tests: external reducer impersonation rejected, server-internal ticks move a ship, one scheduler per match, stop/route completion drops timer.

**Outstanding gates:** no `spacetime build/publish`, no `npm install`/SpacetimeDB module typecheck, no real wall-clock scheduled ticks, no two-client subscription, no actual bandwidth or latency measurements, no dynamic occupancy/ship hull clearance. The draft PR remains unmerged; #3/#5/#10/#19 remain open.

**References:** official [schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/), [scheduled reducer lifecycle](https://spacetimedb.com/docs/functions/reducers/lifecycle/), [module unit-testing](https://spacetimedb.com/docs/how-to/unit-testing/), [ADR-0001](adr/0001-multiplayer-motion-tickrate.md).
