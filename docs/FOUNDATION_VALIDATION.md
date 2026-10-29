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

**Outstanding gates:** no `spacetime build/publish`, no `npm install`/SpacetimeDB module typecheck, no real wall-clock scheduled ticks, no two-client subscription, no actual bandwidth or latency measurements, no *runtime-verified* construction-footprint occupancy or class-specific hull clearance. The draft PR remains unmerged; #3/#5/#10/#19 remain open.

**References:** official [schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/), [scheduled reducer lifecycle](https://spacetimedb.com/docs/functions/reducers/lifecycle/), [module unit-testing](https://spacetimedb.com/docs/how-to/unit-testing/), [ADR-0001](adr/0001-multiplayer-motion-tickrate.md).

## Collision and dynamic obstruction slice — 29 Oct 2026

**Pure TypeScript test execution, actually run:** `node --experimental-strip-types --test tests/collision.test.mjs` **6/6 PASS**; isolated TypeScript strict typecheck **PASS**. Tests cover high-speed tunneling, 3×2 structure footprints, diagonal sweeps, vessel overlap/self-exclusion, invalid/boundary cases and A* cell occupancy. Exact uploaded Git blob SHA-1 matches the locally tested originals:
- `collision.ts`: `233e54c5351270a53fd423a58a9af7075714b0c1`
- `collision.test.mjs`: `d034210afb99c4b81d3c5379ec01e0dfa34d87c9`

**Server source change, unverified in SpacetimeDB runtime:** `issueShipOrder` uses the dynamic per-match ship occupancy check to avoid ordering into another ship's current hull. `advanceMatchSimulation` checks swept ship motion, updates per-tick vessel bodies deterministically, and holds/repaths around blocked lanes at a 1s retry interval without client authority. New real-module datastore test cases are prepared for occupied goals and obstacle emergence between command and tick; **NOT executed** here.

**Not implemented yet:** real-runtime confirmation of construction reducer → private footprints → live collision; per-vessel hull radii and avoidance of moving-vessel trajectories through a future time horizon; sophisticated congestion/deadlock guarantees, scalability benchmarks, real SpacetimeDB module compilation/integration. The temporary UI is intentionally untouched pending the user's design review (#15).

## Construction and support — source implementation / verification (29 October 2026)

**Actually executed in VM:**
- `node --experimental-strip-types --test tests/construction.test.mjs` — **8/8 PASS**, including source-grounded Gemini starter decks, separate mounted/surface layers, orthogonal Core connectivity, cross-chunk 2×2 footprints, rejected enemy support/costs/salvage deposits/hull intersections, and loss of support.
- Standalone strict `tsc` on `spacetimedb/src/sim/construction.ts` — **PASS**.
- GitHub blob SHA-1 checked against byte-identical files executed locally:
  - `construction.ts`: `060e3e19339005961ff2078926c0896b98889270`
  - `construction.test.mjs`: `b0bb7243b298c862fb2c89cae1df1793273f4e01`

**Source implemented but NOT executed inside SpacetimeDB** (official SDK/CLI dependencies unavailable here):
- Private structures and one-shot construction schedule tables; initial Core/decks for each new faction and 420 starting salvage; launch the scout outside solid buildings.
- `placeStructure` validates every footprint on authoritative private rows, subtracts salvage exactly once in the same reducer transaction and schedules completion via `ScheduleAt.time(...)`.
- `demolishStructure` enforces caller's seat, protects cores, refunds once, cancels orphaned schedules, collapses unsupported mounted buildings and recomputes Core connectivity.
- `completeConstruction` accepts only internally scheduled calls; on completion, recomputes support connectivity.
- Both authoritative A* planning and scheduled hull motion now pass live private surface footprints (not a client-provided blocker list) to collision validation.
- Prepared (not executed) actual-module harness tests for construction price, authorization, completion timing, support removal, timer cancellation and refunds.

**Not yet complete:** actual module build/publish, datastore/scheduler execution, 2-browser subscriptions and anti-cheat testing; optimized occupancy indexes for large match sizes, structural damage from combat, repair, passive salvage income, production queues, fog-visible map projections, and full connected UI. No design/implementation of final UI was started (issue #15 review gate).
