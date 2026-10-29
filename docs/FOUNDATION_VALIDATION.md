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


## Salvage + production batch — verified and deferred gates (29 October 2026)

**Locally executed, actual evidence:**
- `node --experimental-strip-types --test tests/economy.test.mjs` — **9/9 PASS**; strict TypeScript standalone check of `sim/economy.ts` — **PASS**.
- The pure unit-test exercise uses a local compatible `collision.ts` implementation while the GitHub branch includes its own tested collision implementation from an earlier batch; **this is not a SpacetimeDB end-to-end test**.
- Git blob SHA verified exact content of uploaded locally tested files: `economy.ts` `da638481e2ac29620d8263f456e23701aba80235`; `economy.test.mjs` `61ab359021d4f8801a83a3b214a6b4f287096d20`.
- Tests check reference balance, u32 overflow and insufficient funds, conserving shared salvage, regeneration, rig bonus depletion, paused FIFO work, 5s delayed-tick cap, and launch positions clear of terrain/buildings/other hulls.

**Prepared in real SpacetimeDB source, but NOT executed:**
- Private match-scoped `harvest_order`, `production_order` and one-per-active-match `economy_schedule` tables in `schema.ts`; protected periodic `advanceEconomy`, `orderHarvest`, `enqueueShip`, `cancelShipProduction` reducers in `economy-reducers.ts`.
- The server ledger computes node regen, Core/Rig passive income, per-ship harvest, deterministic FIFO ship production and one-time ship row insert + paid queue removal. Paid jobs pause when Shipyard offline or launch location blocked and are refunded if user demolition/collapse destroys the Shipyard.
- `index.test.ts` includes additional **unexecuted** module-harness cases for internal-only economy ticks, range/owner restrictions, no pre-enqueue production time, FIFO launches, cancellation/refunds and incomplete rigs.

**Release blockers:** no actual `npm install`, `spacetime build`, V8 module execution, scheduled clock run, generated bindings, independent client connections, or live authorization/visibility audit. Source validity at SDK level and 2-player operation are **not proven**; keep #3/#4/#9/#17 open. Workshop repair/upgrades and client-visible authorized production state are still outstanding. The UI design gate #15 remains intact.


## Workshop repairs and tier upgrades — 29 Oct 2026

**Actually executed (pure TypeScript only):**
- Node 22 `node --experimental-strip-types --test tests/workshop.test.mjs`: **7/7 PASS**; strict `tsc --noEmit` of `spacetimedb/src/sim/workshop.ts`: **PASS**.
- The files uploaded to GitHub are **byte-identical** to locally executed/tested files, Git blob IDs:
  - `workshop.ts` — `9341b347da20036454284250029cc0c4a30e45bb`
  - `workshop.test.mjs` — `7ce9403876139fe20bc41c02b2cb215bf17405dc`
- Pure tests cover tier pricing/config, repair cap/missing HP, exact ceiling costs, no dead/full repairs, 2D range, level-specific structure max HP and offline upgrade pause.

**Source changes prepared, not executed in SpacetimeDB:**
- `structure` rows now carry `level`, `upgradeRemainingUs`, and `upgradeStartedAtUs`; every starter/construction insertion initializes these fields.
- `repairStructure`, `repairShip`, `upgradeWorkshop` exported via module entrypoint with server-checked match, ownership, range, health, affordability and atomic cost/state updates.
- Active upgrades are progressed within the existing **internal-only** 1 Hz economy reducer; disconnection pauses progress, and cost/remaining work survive reconnects.
- Demolition and collapsed support refund paid but uncompleted Workshop upgrades once. Prepared official harness tests in `index.test.ts` cover repairs, access control, missing support, time progression and refunds.

**Not verified:** actual SpacetimeDB module typecheck/build or V8 reducer execution, scheduled tick integration, two independent client subscriptions, combat damage input, UI. Keep the relevant P0/P1 issues and Draft PR #20 open until live verification. Workshop tier balancing is **new provisional design**, not asserted as a value from Gemini reference files.


## Combat Foundation slice — 29 October 2026

**Local, package-free verification:** a matching standalone implementation of the pure `combat.ts` geometry passed **8/8 Node 22 tests** and standalone strict TypeScript. The committed repository `tests/combat.test.mjs` exercises the same eight scenarios. **Important evidence limitation:** the locally executed prototype and GitHub-committed combat source/tests are not byte-identical; the exact committed versions have NOT been re-executed in the current VM. Do not advertise 8/8 as a verified Git HEAD build. The scenarios exercised evasion of fixed-heading shots, swept nearest collision, friendly exclusion, ruin-blocked sight, armor, siege splash, covered support decks and projectile expiry.

**Prepared and committed, but not verified inside SpacetimeDB:**
- Authoritative `fireWeapon` with real caller authentication, ownership, cooldown, observed-target checks and range, deterministic initial velocity and private launched projectile timestamp.
- Private per-moving-match `combat_schedule`, internal-only `advanceCombat`, authoritative HP/destroyed unit cleanup, support collapse and Core-based victory/draw.
- The `ship`, `structure`, `match_member`, `match` and `projectile` schemas carry required combat data; all ship/structure constructors now initialize last-fired state (sentinel -1n) and turret bearing.
- Four new official module-harness cases cover foreign/friendly fire rejection, cooldown, evasion after launch, single resolved damage and Core elimination. These tests are **prepared only**, not executed.

**Remaining release blockers:** exact-HEAD pure Node tests, a full `npm install && npm run typecheck && npm test` under `spacetimedb/`, `spacetime build/publish`, scheduled tick and fog-security proof on a real module, two independent authoritative clients, client-generated bindings and Phaser renderer, and benchmarks of 2–8 faction matches. No Cloud credentials or Cloud database were touched. All Issues stay open until acceptance evidence is actually obtained.

## Verified exact turret slew files — 29 October 2026

**Actually executed:** Node v22.16 `node --experimental-strip-types --test tests/turret-aim.test.mjs` — **6/6 PASS**; TypeScript v5.8.3 isolated strict `tsc --noEmit` — **PASS**.

Git blob SHA-1 values of locally executed files were independently compared with the connected GitHub branch and match **byte-for-byte**:
- `spacetimedb/src/sim/turret-aim.ts`: `3ff3ed63d352e5166ac83a3664389229d5aa0b79`
- `tests/turret-aim.test.mjs`: `b36a2ebc7192b53aca9be37ec004b515bfc87456`

Coverage: wrap-around, 180° tie, class-specific maximum turn speed, aiming tolerance gating, actual source/target bearing and NaN/invalid tick rejection.

**Unverified runtime code:** private `turret_aim` persistence; authenticated `aimWeapon`; server-ticked turret bearing changes in `advanceCombat`; `fireWeapon` rejects misaligned shots; timer reactivation/cleanup and source destruction. New official SpacetimeDB in-memory harness tests for aim ownership, premature fire, 100ms increments and destroyed source cleanup are **prepared but not executed**. No npm package installation, generated SDK bindings, live SpacetimeDB scheduler, independent-client or FoW negative test evidence. Do not close #11/#13/#19 or merge PR #20 on this isolated test evidence alone.

**Design boundary:** no UI/HUD edits were made; issue #15 remains a mandatory review gate. Sudden Death rules have not been chosen or implemented yet.


## Source-grounded deterministic match ending — 29 October 2026

**Verified exact committed pure files:** `node --experimental-strip-types --test tests/match-outcome.test.mjs` **9/9 PASS**; standalone strict TypeScript **PASS**, Node v22.16.0, TS v5.8.3. Blob SHA-1 checked against GitHub and matched locally executed bytes:
- `spacetimedb/src/sim/match-outcome.ts` — `091fc8ac2f1cfaea120c66e92849341e4d8bee42`
- `tests/match-outcome.test.mjs` — `9a2d280a39132c9584269443a0597b42af96b574`

Coverage: exact 12-minute microsecond deadline, integer-fifths dominance score (Core HP, structure/ship counts, lifetime salvage), immediate one-survivor victory, zero-survivor draw, no premature end, fixed-score time-limit winner, stable lowest-slot equal-score tie-break and commands rejected at the precise cutoff.

**Source prepared but SpacetimeDB runtime NOT verified:** one private one-shot `match_deadline` per active match, internal-only deadline completion and teardown, early combat victory cancellation of timer, public match metadata for winner/reason/time, private u64 lifetime salvage ledger, and active-match deadline guard across gameplay reducers. Official module harness now includes **unexecuted** deadline and ledger tests (internal-only invocation, no early finish, 720-second result, command score freeze before delayed timer, income accrual vs spending).

**Semantic note:** Gemini calls the 12-minute immediate score termination “Sudden Death,” but does not include a special overtime state. This implementation follows that reference, not an invented damage-acceleration phase. Exact equal-score outcomes use the lowest slot, and mutual Core destruction records a draw (-1).

**Unverified:** `npm install` / `spacetime build` / scheduled SDK execution, test-utils harness run, end-to-end two-client match result consistency, encrypted or fog-filtered subscribers and UI. PR #20 remains Draft, issues remain open. No Cloud DB or account credentials were used.

## Bot strategic policy and perception (29 Oct 2026)

**Executed local verification:** `node --experimental-strip-types --test tests/bot-policy.test.mjs tests/bot-perception.test.mjs` — **14/14 PASS** on Node 22.16.0. Isolated `tsc --noEmit --strict` on both new pure modules **PASS** with TypeScript 5.8.3. These exercises used locally available compatible combat/turret rule modules and a minimal economy fixture, **not a checked-out complete GitHub HEAD**; the exact new policy/perception sources and tests were separately verified byte-for-byte by Git blob SHA.

New exact HEAD Git blob SHA-1:
- `spacetimedb/src/sim/bot-policy.ts`: `3f6cc2aba310d7d58c23a89b91e8a86de17f39d3`
- `tests/bot-policy.test.mjs`: `1ad7a9006fc7ac9926faa30800c629403ca478e5`
- `spacetimedb/src/sim/bot-perception.ts`: `15aad5b3e98be57c5ef120eb2732748143c62d84`
- `tests/bot-perception.test.mjs`: `e06502f9d6e40fd35c7f1c62b368207203f6a534`

Pure policy covers exact difficulty strategic intervals/order caps, visible-enemy aim/fire, stale or hidden intel denial, resource and legal construction decisions, queue budgets, input-order determinism, exploration frontiers, and invalid observation rejection. Sensor filter covers friendly/dead exclusion, distance, blocked terrain LoS, multi-sensor stable union, and zero-sensor denials.

**NOT implemented/verified in SpacetimeDB:** canonical bot faction slots independent of human `Identity`, bot account-less seat creation, server scheduler, reducer validation bridge, bot-only match execution, secure subscriber projections, 1-human-vs-7-bots session, full SDK build/typecheck. No claim of real bots playing. See `docs/BOT_SERVER_INTEGRATION.md`. All prior module compilation/security gates remain open; #12 and #13 must not be closed.


## Faction ownership separation — 29 October 2026

**Actually executed** on Node 22.16.0: `node --experimental-strip-types --test tests/faction-ownership.test.mjs` **5/5 PASS**; standalone `tsc --noEmit --strict` on `sim/faction-ownership.ts` **PASS** using TypeScript 5.8.3. Git blob SHA-1 of BOTH files verified identical to locally executed bytes:
- `spacetimedb/src/sim/faction-ownership.ts`: `4622f66e6da290b60b494c44e263b2a0dda882a0`
- `tests/faction-ownership.test.mjs`: `ee61bfcddb738d5cdf23986f9cb5f49a7b5b737e`

Pure tests cover 320 match/slot combinations, invalid slots/IDs, no membership, eliminated seats, cross-faction control and malformed input. **These are not SDK integration tests.**

**Source-only updates, not executed inside SpacetimeDB:**
- Server-derived `ship.ownerSlot` and indexed `factionKey` instead of `ship.owner`; human `match_member.factionKey` with indexed match-scoped key.
- `myShips` identity-scoped indexed `rightSemijoin` on key, avoiding same-slot cross-match leaks.
- Ship ownership across movement, stop, harvest, combat, turret aim/fire, repair, economy, production and match score migrated from Identity lookups to faction slots.
- All human build/demolition/shipyard/Workshop commands reject eliminated seats. Existing official tests updated; **two additional unexecuted module tests** cover cross-match ship views and cross-match command denial.
- Static review of actual connected GitHub module sources found no remaining `ship.owner` / `vessel.owner` / `row.owner.isEqual` usages in the migrated reducers/tests.

**Not verified:** complete `spacetimedb/` TypeScript module build, exact SDK view join type safety, real module harness execution, cross-match subscription negative test and two clients. Since schema changed, generated client bindings must be regenerated later. No bot-only faction/scheduler/economy migration was completed. PR remains Draft, issue #12 remains open; no UI edits or Cloud DB changes.


## Independent faction ledger and identity-free Bot seats — 29 Oct 2026

**Exact local verification:** `node --experimental-strip-types --test tests/bot-seats.test.mjs` **4/4 PASS**; `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler spacetimedb/src/sim/bot-seats.ts` **PASS**. GitHub blobs for locally executed exact files:
- `spacetimedb/src/sim/bot-seats.ts` — `89147fb0818fdcf781564f38062362178c510942`
- `tests/bot-seats.test.mjs` — `c5344310b987c700f8cc1078873a4805a8136a6d`

Pure coverage: consistent empty-seat selection and reuse, no duplicate slots, bounded 2–8 lobby, deterministic stable bot seed derivation and invalid input rejection.

**Source code integrated into the Draft PR but not executed:**
- Private `faction_state` owns per-faction salvage, lifetime earnings and elimination; private `bot_controller` holds bot slot, difficulty, deterministic private seed and next decision timestamp without an Identity.
- `match_member` now stores only human seat identity and match-scoped faction key; host/join create corresponding human faction-state rows and join respects bot-occupied slots.
- Host-authorized `addBot` and `removeBot` reducers create/remove complete Bot lobby seats with own Core, six platforms and scout; a 1-human + 1-Bot match may now start.
- `myFactionStates` identity-filtered semijoin is designed to expose only human-owned ledgers; all relevant gameplay reducers and match outcome use the faction ledger and reject human access to Bot-controlled assets.
- Module test harness prepared to inspect 1 Human + 3 Bots, private view visibility, forged command denial, full-lobby rejection, Bot removal and slot reuse. The existing economy, workshop and score test cases were migrated to `factionState` rows.

**NOT verified:** official SpacetimeDB 2.x module typecheck/build/publish, scheduled reducers, private view join runtime behavior, real two-client negative tests, generated bindings, client stability or headless Bot match. The Bots remain **idle** because the strategic scheduler/validated execution bridge is not implemented. No Cloud DB or user credentials were touched. Keep PR #20 DRAFT, #12/#13 open and #15 UI design gate intact.


## Strategic Bots: first server-ticked action path — 29 Oct 2026

**Verified exact-source local checks** (Node 22.16.0, TypeScript 5.8.3):
- `node --experimental-strip-types --test tests/bot-observation.test.mjs` — **5/5 PASS**.
- Standalone `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler spacetimedb/src/sim/bot-observation.ts` — **PASS**.
- Git blob SHA equality proven for exact committed/tested source `e105265f9022e04d5c15ead78b974c7dccdc830b` and test `8e54161148e3b85e9bf21ab8f8ccae47fdb79319`.

These tests check that resources are only proposed to a Bot if seen by a friendly sensor with line-of-sight; no-sensor information denial, stable input ordering, and that complete friendly platforms are prioritized for mounted buildings. **No real SpacetimeDB transactions were executed by these checks.**

**Not yet tested in a real SpacetimeDB module:**
- New private `bot_schedule` (one scheduled interval per match) created during `startMatch` when actual Bot controllers exist, and deleted on either match finalization path;
- internal-only `advanceBots` constructs visibility-limited `BotObservation`, invokes deterministic bounded `decideBot`, rechecks commands against live server data, and applies ship routes, gathering, aim/fire, construction and shipyard production;
- capped per-kind construction candidate search and timestamp-based cadence without replaying missed strategic ticks;
- four additional **prepared, unexecuted** module-harness cases for server-only scheduling, sensor-hidden hostiles, time-limit cleanup and 1-human/7-bot single-timer scenario.

**Known gaps:** no actual SDK module compilation/test harness, direct 2-client subscription audit, bot-only headless game, exact-head deterministic whole-match digest, or benchmark for 8 concurrent Bot seats. Human/bot reducer mutation orchestration is still duplicated despite shared pure validators. Keep PR #20 draft and issues #12/#13/#17 open. Client generated bindings must be refreshed before real integration. No UI/HUD edits.


## Shared command transaction orchestration — 30 Oct 2026

**Executed on byte-identical GitHub source/test files:** Node v22.16.0 `node --experimental-strip-types --test tests/command-dispatch.test.mjs`: **10/10 PASS**. Strict standalone `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions spacetimedb/src/sim/command-dispatch.ts`: **PASS**, TypeScript v5.8.3.

Git SHA-1 blobs of local tested bytes exactly match connected GitHub:
- `spacetimedb/src/sim/command-dispatch.ts` — `a1b6b5e4cd7274100b0c486949edf8848ff98997`
- `tests/command-dispatch.test.mjs` — `31c45c8093318efa620eb02005c9415fafdc4f6b`

Tests verified human/Bot identical harvest-order and production writes, cross-faction/cross-match rejection, missing perception, depleted/remote salvage, eliminated actors, non-harvest ship, paid FIFO insertion, over-cap/insufficient funds rejection before ANY mutation, invalid shipyard or queue cap rejection and two sequential paid proposals using freshly reread balance.

**Testing limitation:** local `sim/economy.ts` is an *isolated matching-rules stub* for this test, not the repository's full dependency graph. There is no locally available SpacetimeDB SDK or CLI; full module TypeScript build, official Vitest datastore harness, real DB transaction rollback, scheduled bot reducer and two-client integration were **not run**.

**Integration changes present but unexecuted:** both human and Bot entrypoints now call shared `dispatchHarvest` and `dispatchProduction`, with transaction-backed mutation callbacks. Human harvest also checks current server terrain LoS to the chosen node. Other command types remain partially duplicated and the official tests need a real SDK/CLI environment. PR Draft, main unmodified, UI gate #15 enforced.


## Shared move, build, aim and fire command contracts — 30 October 2026

**Actually executed in local Node 22.16.0 with standalone strict TypeScript 5.8.3**:
- `tests/command-dispatch.test.mjs`: **10/10 PASS** (previous Harvest & Enqueue slice);
- `tests/world-command-dispatch.test.mjs`: **9/9 PASS**;
- `tests/combat-command-dispatch.test.mjs`: **8/8 PASS**;
- **All three suites together: 27/27 PASS**, zero failures.
- Standalone `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions` on the **two new dispatcher modules**: **PASS**.

The exact new four source/test files were verified byte-for-byte by local Git-blob SHA-1 calculation against the GitHub connector:
- `spacetimedb/src/sim/world-command-dispatch.ts`: `c0458889a1449f7d691157919a426c95be307341`
- `tests/world-command-dispatch.test.mjs`: `573e007735cd3bfa8a821b89ed1f3199f118c6cf`
- `spacetimedb/src/sim/combat-command-dispatch.ts`: `d0e1fcdf4ce77cef527a52fa40da0b1e8916b827`
- `tests/combat-command-dispatch.test.mjs`: `429a3a5cb33ffa0a89b3ad8de3b393ea2802d208`

**Exact dependency limitation:** the executable local fixture uses simplified, compatible `economy.ts`, `navigation.ts`, `collision.ts`, `construction.ts`, `combat.ts` and `turret-aim.ts` for this purpose. It validates the byte-identical dispatcher implementation and staged mutation calls under the fixture, but does **not** validate the entire real helper implementation, the actual SpacetimeDB module, the SDK row types, DB atomic rollback or 2–8 client networking. The GitHub tests have not been run with the full real dependency graph.

**Source-only new authorization views:** `spacetimedb/src/visibility-views.ts` defines `myVisibleEnemies` (minimal current sensor/terrain-LoS-projected enemy contact ID, type and position) and `myStructures` (only caller-owned private structure rows). Their underlying tables remain PRIVATE. View code uses only match-scoped indexed reads. Three additional official module-harness negative subscription tests are checked into `spacetimedb/src/index.test.ts` but were NOT run. Full discovered terrain, last-known enemy positions, spectators, client interpolation, and performant incremental view behavior are NOT done.

**External SDK verification:** official SpacetimeDB 2.x docs support authenticated procedural views and `rightSemijoin`, private table isolation, `ScheduleAt.time/interval` and private scheduled reducers. However `npm install`, `spacetime build`, real module typechecking/publishing and the official Vitest datastore harness **remain blocked by absent SDK/CLI and unavailable npm registry DNS**. An alternate shell execution tunnel was also unavailable. This is an explicit release blocker, not evidence of a passing integration build. No GitHub Actions minutes were consumed, no Cloud database was touched and no UI/HUD was modified.
