# Sea Siege — Foundation development guide

> This branch contains **source code only**. No successful build/publish or two-browser integration result is claimed. The current VM cannot reach npm/SpacetimeDB downloads, so validation requires a network-enabled environment. Cloud account credentials are **not** needed for local development.

## Stack
- Vite + TypeScript + React 19, Tailwind v4 + shadcn/ui component source code.
- Phaser 4 real Scene in a React-managed mount (only a decorative water grid for now).
- A separate **real SpacetimeDB 2.x TypeScript module** in `spacetimedb/src/index.ts`, using `spacetimedb/server` (schema, reducers, caller identity, private tables and per-identity views). **No pseudo-server runs in the browser**.

## Client setup

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Client UI explicitly says **Backend not connected**. That is intentional: generated bindings do not exist before CLI generation and no network subscription has yet been implemented. The visual foundation must not imply Quick Play or multiplayer is functional.

## SpacetimeDB local build/publish (follow current 2.x CLI)

With a network-enabled environment and the official `spacetime` CLI installed:

```bash
cd spacetimedb && npm install && cd ..
spacetime start                 # keep this running in another terminal
spacetime build --module-path ./spacetimedb
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
spacetime generate --lang typescript --module-path ./spacetimedb --out-dir ./src/module_bindings
```

Once the module actually builds, the next change (#3/#4) must import those **generated** bindings, connect with `DbConnection.builder()`, subscribe to `match`, `my_ships`, `my_memberships`, send reducer commands and display the **real** status. Nothing in this branch is a substitute for that integration.

## Security gates before multiplayer
- `ship` and `match_member` are **private**. Do not mark them public just to make prototyping easier.
- Views presently reveal only caller-owned ships and memberships, not enemies; future fog-of-war requires server-side authorized visibility (#13).
- The private match's public lobby metadata contains no hidden ship coordinates.
- Current reducer rules only prove basic caller ownership and 2–8 slot creation; combat, scheduled movement and game lifecycle remain future tasks.
- `issueShipOrder` stores a destination on the real server; it intentionally **does not move** the ship. Navigation and the simulation cadence come from #10 and ADR-0001.

## Testing policy
Prefer frequent inexpensive static/unit checks as features land; defer actual Cloud deployment and end-to-end multiplayer tests until we have a complete integration slice. Do not mark #2/#3/#4 as passing without executed typecheck/build/module publish and two independent browser sessions.

References: [official TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/), [table visibility](https://spacetimedb.com/docs/tables/access-permissions/), [React/Vite shadcn setup](https://ui.shadcn.com/docs/installation/vite/), [ADR-0001](adr/0001-multiplayer-motion-tickrate.md).

## World and navigation development status

The pure, tested world and navigation modules live in `spacetimedb/src/sim/`:

- `worldgen.ts`: Mulberry32 procedural layout and 16×16 terrain chunks, safe 2–8 slot starts and salvage nodes.
- `navigation.ts`: terrain reassembly and bounded deterministic A* (no diagonal corner cutting; accepts future dynamic occupancy callbacks).
- `index.ts`: server-only, transactionally persisted world state and authoritative ship order path validation.

Local tests:
```bash
npm run test:unit
# OR without dependencies in Node 22:
node --experimental-strip-types --test tests/*.test.mjs
```

The `ship_route` table stores authoritative grid-cell paths. The internal scheduled reducer advances vessel position/cursor; swept collision handling and temporary congestion rerouting are now present. Future construction footprints, hull-class-specific radii and full fleet traffic resolution remain pending (#8/#10). Visibility-aware views are mandatory before publishing hidden chunks or resource data to any clients (#13). The match seed is now server generated (not a `createMatch` input).

## Authoritative ship movement — scheduled reducer slice (#10)

- The private `ship_route` table holds the A* cell path/cursor and order revision. Only the authenticated ship owner may issue a path or `stopShip` command.
- `issueShipOrder` starts **one private `motion_schedule` timer per moving match**, using the official `ScheduleAt.interval(100_000n)` / `onSchedule` API. A stopped or completed match naturally drops the timer once there are no active routes. Idle matches do not consume 10 reducer transactions per second.
- `advanceMatchSimulation` explicitly rejects calls lacking `ctx.senderAuth.isInternal`; clients cannot force simulation ticks. The reducer steps all active routes, persists authoritative movement samples and velocities with `ctx.timestamp`, then deletes completed routes/timers.
- The pure `ship-motion.ts` uses 2 cells/sec, a 150°/sec hull-turn cap, and max 250ms elapsed-time catch-up per invocation, with headings stored in degrees. These values live in `SHIP_MOTION_RULES` and are **tuning defaults**, not guaranteed platform tickrates.
- Client rendering **does not set or own server positions**. The Phaser interpolation adapter in #5/#19 will read authorized ship snapshots from generated bindings. Scheduled frequency, subscription row-change frequency and Phaser FPS are separate (ADR-0001).
- No full ship sizes, fleet formations, fog-aware subscriptions or true sailing physics yet. Structure footprints are now read directly from private server-owned structure rows, but ship-specific hull radius and full inter-ship collision recovery are still pending. Please do not characterize this as full naval movement or a multiplayer-ready implementation.

Pure TS smoke verification (no SpacetimeDB dependencies):
```bash
node --experimental-strip-types --test tests/ship-motion.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  spacetimedb/src/sim/ship-motion.ts
```

Real datastore/scheduler acceptance tests were prepared in `spacetimedb/src/index.test.ts`, but **remain unexecuted** until the actual SpacetimeDB module packages/runtime can run. The test harness invokes scheduled reducers as `TestAuth.internal()`; it does not run a wall-clock scheduler. It cannot prove deployment/subscriptions or security on a real server.

## Swept hull collision and congestion rerouting — October 29, 2026

`spacetimedb/src/sim/collision.ts` implements **pure, conservative swept collision detection** against:
- static terrain blockers (ruined pillars and shoals, plus unknown impassable terrain codes);
- rectangular platforms/Command Cores from private per-match `structure` rows, including newly constructed platforms;
- other server-owned vessel bodies with a shared initial scout hull radius `COLLISION_RULES.scoutRadiusCells`.

`issueShipOrder` rejects destinations occupied by other ships through the authoritative A* cell predicate. `advanceMatchSimulation` checks **each segment** before committing the movement, in deterministic ship-ID order using updated positions from earlier ships in that tick. If the new position would intersect a blocker, movement is held and velocity cleared; a reroute toward the original goal is attempted at most once per second per blocked ship. The old route is preserved when no valid alternative exists, so a temporarily congested passage can resume on later ticks.

The current server source now supplies **ship + static terrain + per-match surface structure footprints** to collision checks both when ordering and on each movement tick. This has not yet been validated against a running SpacetimeDB module. Construction rejects surface placements intersecting existing hulls.

Run standalone local tests with Node 22:
```bash
node --experimental-strip-types --test tests/collision.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions \
  spacetimedb/src/sim/collision.ts
```

## Layered construction and connected territory — 29 October 2026

The original Gemini design was referenced for the **3×3 Command Core, six initial floating decks, 2×2 mounted structures, 1×1 cannons, starting salvage (420), build costs and durations**. No fake Gemini authority code was copied.

The pure rules in `spacetimedb/src/sim/construction.ts` enforce:
- Separate surface and superstructure occupancy: a mounted Workshop/Shipyard/Cannon/Extractor **does not delete its supporting decks**.
- Platform expansion requires an orthogonally adjacent, connected and completed friendly surface cell. Connection is determined by iterative BFS from the 3×3 Command Core; diagonal-only contacts and enemy decks never connect.
- Every footprint cell of a mounted building must rest on **its own faction's complete, Core-connected platform**, including 2×2 shapes across 16-cell chunk boundaries. Command Core tiles cannot be repurposed as Workshop support.
- Water passability, salvage deposits, surface overlap, ships currently occupying the build location, and Shipyard access to orthogonally adjacent open water.
- One-time faction salvage deduction in the real `placeStructure` reducer transaction. `completeConstruction` uses an internal-only SpacetimeDB one-shot schedule at a server timestamp, not client timers.
- `demolishStructure` restricts owner and protects the Command Core, refunds exactly once, removes mounted structures that lose any required deck, cancels their pending completion schedules and recalculates connected status for the survivors. Disconnected but still supported territory stays offline; it can reconnect when new completed decks join the Core.
- On match creation/join, each active participant receives one Command Core + six initial decks and one launching ship **in water left of the Core** (not inside the solid footprint).

All tables remain private until authorized views are designed (#13). The present gameplay slice does not implement passive economy, extraction, structure damage/collapse from combat, build preview UI or ship production (#9/#11/#15).

**Locally executed, package-free checks:**
```bash
node --experimental-strip-types --test tests/construction.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  --allowImportingTsExtensions spacetimedb/src/sim/construction.ts
```

**8/8 pure construction tests passed** (Node 22), plus standalone strict TypeScript passed. Existing `index.test.ts` now includes unexecuted module-harness tests for atomic salvage/cost/placement, construction completion and authority, one-time demolition refunds and support collapse. These are **not proof that the SpacetimeDB module compiles or the timers execute**. Continue to mark #8 and #9 open until runtime verification and remaining scope.


## Salvage economy and ship production — implementation batch (29 October 2026)

The genuine SpacetimeDB module source has been organized into:
- `schema.ts`: typed tables and the default module schema (re-exported as the default from `index.ts`).
- `economy-reducers.ts`: harvesting, queue commands, and the internal scheduled economy reducer.
- `sim/economy.ts`: deterministic, dependency-light rules and reference-derived balance values; tests in `tests/economy.test.mjs`.

**Balance from the archived Gemini reference (starting hypotheses):** Core +4 salvage/sec, online Salvage Rig +9/sec base plus up to 11/sec drawn from a nearby node, harvesting range 3.5 cells, rig node bonus range 4.5. Scout/Gunboat/Siege cost **70/130/220**, build time **4/6.5/9.5s**, harvesting **14/8/0 per second**, and hull radii **0.42/0.56/0.72** cells. These values are centralized in `ECONOMY_RULES` and must be tuned via real multiplayer observations.

**Server-only operations and persistence:**
- Each active match starts exactly one 1-second `economy_schedule`. Each invocation validates internal scheduler identity and uses a capped real elapsed time with fractional microsecond carry to limit long delayed-tick catch-up.
- `orderHarvest`: checks the caller's ship, its type, a same-match salvage node and actual server-measured range. Issuing Move/Stop cancels harvest; harvesting cancels movement.
- Nodes regenerate up to capacity and are drawn down atomically. Multiple collectors and rigs share the same authoritative node remainder within the transaction. Work is sorted by stable IDs to avoid unordered transaction iteration.
- Only an existing, completed, Core-connected, non-destroyed Core or Rig produces income. Rig bonus draws from a physically nearby node and never overdraws it. Harvest orders and newly completed rigs cannot claim an entire delayed tick that predates their activation.
- `enqueueShip` authorizes the player's completed/connected Shipyard, enforces a queue maximum of **5**, and deducts cost exactly once. `cancelShipProduction` returns the original price only while the job exists.
- `production_order` is a private persistent FIFO table; only the oldest job per yard progresses, only while that yard is online. A new active job starts on its first eligible economy tick and cannot receive earlier elapsed time. Destroyed/unsupported yards pause work (unless demolished, in which case their pending jobs are canceled/refunded).
- Completed jobs hold at zero remaining work if no safe-water launch point exists; creation and paid-queue deletion occur atomically on the first legal spawn. The bounded launch search checks authoritative terrain, surface structures and current ship hulls using per-class radius.
- A demolished/collapsed Shipyard cancels its pending orders and returns their prepaid unit costs in the same transaction; no duplicate launches or cancellation refunds after a job is consumed.
- All sensitive tables are **private**. Owner-filtered views for production orders and structure economy status, and fog-safe visibility to other units, remain #13/#15 before any client gameplay HUD.
- Ship types and radii are stored on server rows, but class-specific naval acceleration, damage/armor and behavior are **not** implemented here (#10/#11).

**Verified now:** `node --experimental-strip-types --test tests/economy.test.mjs` — **9/9 passing**; standalone strict TypeScript on `sim/economy.ts` passing. This pure-test execution used a compatible local collision implementation to satisfy imports; the committed economy source and tests are byte-identical to the ones executed, while actual full SpacetimeDB module tests remain unexecuted. See `FOUNDATION_VALIDATION.md`.

**Still required for full #9 acceptance:** real module build/runtime/reducer timing and 2-client verification; production queue owner-visible views, workshop repair/upgrades, optimized server query indexes, ship combat/damage integration, future accounting policy for destroyed ships/buildings, and benchmarked live performance.


## Workshop Repair & Upgrades — implementation (29 October 2026)

The code lives in `spacetimedb/src/sim/workshop.ts` (pure repair math/rules) and `spacetimedb/src/workshop-reducers.ts` (real server-authoritative reducer source), with corresponding private `structure` fields in `schema.ts`. `index.ts` re-exports the command reducers, keeping one module contract.

**Balance:** three data-driven tiers with starting repair range of 4.5/6/8 cells, repair cap 60/100/150 HP per command, 2/3/4 restored HP per Salvage, and +0/120/240 Workshop max HP. Tier 1→2 costs 200 Salvage and 6 seconds, Tier 2→3 costs 320 Salvage and 10 seconds. **These are provisional balancing choices for this implementation, not verified Gemini balance constants.** Workshop construction still costs 120 Salvage and takes 5 seconds, as implemented earlier.

**Server behavior:**
- Only the owning faction's match member can operate a fully built, connected, living Workshop in an active match. Repair commands are disabled while it is upgrading.
- `repairStructure` validates the target's match, faction, completed/connected/alive status, actual health and Euclidean reach from the Workshop center. `repairShip` checks the actual owned vessel class/max HP and position. Both charge Salvage once for **actual healed HP**, with no healing of dead/full entities, no client-provided costs, and no HP overflow.
- `upgradeWorkshop` takes the cost exactly once, refuses multiple concurrent upgrades or level >3 and saves `upgradeRemainingUs` and `upgradeStartedAtUs` in the authoritative private `structure` row.
- The existing internal-only per-match `advanceEconomy` tick advances Workshop upgrade remaining work, using measured/capped microseconds. **Offline/incomplete/destroyed** Workshops do not progress; upgrades issued after the previous tick are not credited for prior elapsed time. Reconnect does not reset persisted progress. Completed upgrades increment level exactly once and unlock the next tier.
- Demolishing or physically collapsing a Workshop cancels its unfinished upgrade and refunds its paid tier-upgrade cost once in the same transaction; the standard structure demolition/collapse rules still apply.

No final HUD, builder preview, health bars, or visual workshop design has been attempted; user approval is required before issue #15 UI work. Combat damage and death elimination are future work (#11).

Run the pure rules verification from repository root (Node 22+):
```bash
node --experimental-strip-types --test tests/workshop.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  --allowImportingTsExtensions spacetimedb/src/sim/workshop.ts
```

**Real module execution still deferred:** `spacetimedb/src/index.test.ts` has prepared but unexecuted tests for owner, cost, range, server-timed progress, support loss and refunds. A real `spacetime build`, datastore harness run, publisher, generated client bindings and two-client E2E remain outstanding and must gate issue closure.


## Combat Foundation — server-authoritative projectile slice (29 October 2026)

The archived Gemini balance is used for the initial **Scout / Gunboat / Siege / Cannon** weapons in `spacetimedb/src/sim/combat.ts`: ranges **5.5 / 7.2 / 11 / 8.5** cells, damage **18 / 44 / 115 / 48**, cooldowns **950 / 1350 / 2600 / 1400 ms**, projectile speeds **18 / 15 / 12 / 16 cells/s**. Ship armor is **2 / 7 / 12**; ship damage versus structures uses the weapon-specific multiplier (Siege 1.65). Siege has **1.35-cell splash radius**. These are balance inputs, not validated multiplayer feel.

The **pure combat rules** provide:
- launch-time velocity/heading and finite range, no target-ID homing;
- swept server impact checks against **actual ship/structure positions at impact time**, stable earliest-hit tie-breaking, friendly-fire exclusion, armor and bounded HP loss;
- splash against actual affected enemy bodies, without re-hitting intact platform deck cells already covered by mounted structures;
- terrain line-of-sight and source weapon range/vision checks. Full fog-of-war lifecycle and identity-visible projections are still #13.

The **real SpacetimeDB module source** adds private `projectile` and lazy `combat_schedule` rows, signed microsecond last-fired stamps, turret orientation and match elimination/winner state. `fireWeapon` requires caller ownership, active match, a living source, actual server-observed enemy in source vision, actual weapon range and legal cooldown. It **does not accept client-computed damage or spawn positions**. The projectile's launch timestamp and velocity are persisted for eventual visual reconstruction in the authorized client views.

`advanceCombat` is a private 100ms intended scheduled reducer with an explicit internal-caller check and bounded server elapsed time. It evaluates each projectile once per tick in projectile-ID order; on damage it updates HP or deletes destroyed ships/structures and their harvest/navigation/production/one-shot schedules. Surface-deck destruction removes physically unsupported mounted structures, refreshes Core connectivity, and charges **no peaceful demolition refunds**. When a faction loses its Core, its remaining units/buildings lose authority and are cleaned up. When one Core remains, the match records that faction's slot as winner; if none remain, it records a draw (-1). Active economy and movement schedules are shut down after match finish.

**Scope limits:**
- This is the **first combat slice**. Turrets now obey server-owned, class-specific bounded turn rates, and a fire command checks the live heading against its actual target. Automatic enemy tracking and turn acceleration remain future work. Terrain LoS currently uses 4 samples/cell; robust pixel-perfect obstruction and full shared-faction sensing remain #11/#13.
- Private projectiles cannot yet appear in a secure enemy-inclusive client view. Launch/impact effects and final UI/HUD are **not implemented**; the UI design gate #15 remains.
- Sudden-death timer, deterministic multi-client damage digests, armor balancing, projectile collision against moving targets within the **same** scheduler time slice, bot target selection, performance benchmarking, and SpacetimeDB module compile/publish remain pending.
- Projectile cap is **512 per match**; there is one lazy combat timer per match, not one timer per shot. Full runtime performance is unmeasured.
- The module is **NOT integration-tested**. The official test harness cases in `index.test.ts` are prepared for ownership, cooldowns, evasion, damage and Core victory, but have not been executed due to missing SDK/CLI dependency availability.

Standalone local smoke tests:
```bash
node --experimental-strip-types --test tests/combat.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions \
  spacetimedb/src/sim/combat.ts
```

## Independent turret slew — 29 October 2026

- `sim/turret-aim.ts` is dependency-free, deterministic angle math. Server-based desired bearing, signed shortest-arc rotation (359→1°), angular tolerance, class-specific maximum turning rates (Scout 180°, Gunboat 125°, Siege 75°, Cannon 100° per second) and at most 250ms progress per scheduled tick are centrally configurable. These are **new initial tuning defaults**.
- Private `turret_aim` rows hold one pending desired bearing per owned ship or cannon. `aimWeapon` validates a finite canonical [0,360) bearing, real source ownership, match activity and living/online state. It deliberately accepts a **bearing, not a secret target ID**; it cannot by itself be used to guess whether a hidden enemy exists.
- A single **lazy** per-match combat timer services both projectiles and pending aiming. Each internal tick advances the private ship/cannon turret angle; completed/invalidated intentions are discarded. An aim-only match does not create or keep a projectile row; its timer stops once all bearings are aligned.
- `fireWeapon` now rejects `Weapon not aligned` unless the current server-owned turret bearing is within 3° of the **target's current authoritative position**. Firing updates only cooldown and projectile data; **no angle snap**. Changing targets or moving targets may require a fresh aim.
- Destruction removes pending aim commands and match-end cleanup also clears the private table; movement/hull heading is independent from turret heading.
- Important limitations: no automatic tracking/predictive lead, no turret acceleration curve or firing-arc restrictions, no authorized enemy subscription yet (#13), and no client visuals until collaborative UI/game-presentation review (#15).

Local exact-source checks (Node v22.16, TypeScript v5.8):
```bash
node --experimental-strip-types --test tests/turret-aim.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler spacetimedb/src/sim/turret-aim.ts
```


## Match deadline and naval dominance outcome — 29 October 2026

The archived Gemini gameplay reference explicitly specifies a **12-minute match duration**, after which the match ends **immediately** by a Naval Dominance tiebreaker. Despite its `SUDDEN_DEATH_TIME_MS` name, the reference does **not** implement an overtime phase with accelerated damage or resource depletion. This slice preserves that behavior; don't imply extra sudden-death phases.

`spacetimedb/src/sim/match-outcome.ts` implements the source formula without floating point:
```
Score = Core HP + 80 × active structures + 100 × active ships
        + 0.2 × total lifetime Salvage gathered
Exact score5 = 5 × Core HP + 400 × structures + 500 × ships + gatheredSalvage
```

Surviving factions are ranked by score; an exact tie is resolved by **lowest living player slot** (an explicit stable version of Gemini's first-surviving-slot rule). A sole living Core wins immediately; zero living Cores yields a **draw (-1)**, correcting the reference's ambiguous zero-for-draw sentinel.

**Server-source contract:**
- On `startMatch`, the host creates exactly one private `match_deadline` row with `ScheduleAt.time(startUs + 720_000_000n)`. `match` also records `startedAtUs`, `endedAtUs`, `victoryReason`, `winnerSlot` and `winningScore5`. Deadline/score are server-owned, not client time.
- `match_member.totalSalvageGathered` is a private **u64 lifetime earned ledger**. The economy's Core/Rig/harvest credits increment the ledger atomically with actual salvage credited, without decreasing it when resources are spent. Combat kill bounties and bonus accounting remain unimplemented.
- `finishMatchAtDeadline` requires an internal scheduler caller, verifies the persisted one-shot deadline actually elapsed, constructs server-owned surviving Core/structure/ship counts and lifetime credits, resolves the winner and tears down active gameplay schedules/projectiles/aims. Completed state is stable against later calls.
- Normal Combat Core-elimination victory now persists the same match end timestamp/reason fields and cancels its outstanding deadline timer, preventing a later timeout from overriding an earlier win.
- **Critical race guard:** all existing active-gameplay command/tick entrypoints use `matchStillActive(phase, startTime, serverNow)`. At or after the absolute deadline, new combat, building, repairs, harvesting, production and simulated ticks cannot change the scores even if scheduled deadline execution is delayed. Construction completion is also deadline gated. This makes scoreboard cutoff independent of dispatch ordering.
- Persisted result metadata can later be presented through the agreed UI design; no UI has been modified (#15).

Package-free tests:
```bash
node --experimental-strip-types --test tests/match-outcome.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  spacetimedb/src/sim/match-outcome.ts
```

**Outstanding gates:** match deadline module build, actual scheduled reducer/one-shot lifecycle, integrated 2-client results and Clock behavior, serialized final scoreboard subscriptions, kill-bounty accounting, player surrender flow (not added here), and real-match balance. No Cloud account/database was used.

## Server-owned bot policy (standalone slice)

- `spacetimedb/src/sim/bot-policy.ts` is a pure deterministic decision policy: easy/normal/hard modes, bounded strategic intervals (4/2/1 seconds) and max intents (1/2/3 per interval). Can propose visible-target aim/fire, discovered-node harvest/move, legal-platform/building placement, shipyard queueing and frontier exploration.
- `spacetimedb/src/sim/bot-perception.ts` restricts enemy contacts to those detected via **server-owned sensor radius and terrain line of sight**. The bot policy takes **only** this reduced observation: no omniscient DB table access or browser-only authority.
- Policy intents are NOT trusted direct commands. All must be revalidated by the same authority layer as human actions; construction and fleet intentions must never alter the ledger directly.
- **Important:** the current schema ties ships to a human `Identity`, so this is **NOT** a functioning bot faction. Never assign the human host's identity to bot ships, fake connection IDs, or bypass human permission checks for internal reducers. Before integration, migrate canonical faction ownership to slot/controller mapping and create one per-match bot scheduler, then run a truly bot-only headless match.
- The migration sequence and complete negative-test/acceptance matrix are in `docs/BOT_SERVER_INTEGRATION.md`. The standalone Node tests passed 14/14 with strict TypeScript checks; complete SpacetimeDB module tests have not been executed.


## Match-scoped faction ship ownership — 29 October 2026

The bot readiness migration has begun without faking client identities. `ship.owner: Identity` is replaced with `ownerSlot: u32` plus an indexed `factionKey` derived from match ID and slot. Human membership rows store the matching indexed key. All ship actions and accounting now resolve faction ownership via the member's match and slot; destroyed/eliminated human seats cannot continue building or producing.

The private `my_ships` identity view uses `matchMember.where(identity == sender).rightSemijoin(ship, factionKey == factionKey)`; filtering on slot alone would **leak same-numbered factions from unrelated matches**. This indexed semijoin is supported by the [official SpacetimeDB 2.x view API](https://spacetimedb.com/docs/functions/views/), but this module's actual SDK build and subscription security tests are pending.

`tests/faction-ownership.test.mjs` passes 5/5 standalone cases and the exact Git blobs match locally executed source/tests. Two new **unexecuted** module harness cases check cross-match subscriptions and human command rejection. See `docs/BOT_SERVER_INTEGRATION.md` for the remaining faction ledger/controller migration and explicit non-playability boundary. **No UI or HUD edits.**


## Independent faction ledgers and lobby Bots — 29 October 2026

The server now treats **Faction as the economy/combat unit** and **Human Membership as authentication only**. Private `faction_state` rows own the balance, lifetime earned salvage and elimination state, and identify `controller` as human or bot. A real human `match_member` has just its true Identity, match, slot and match-scoped faction key. This supersedes the older statement above that no bot controller or independent ledger exists.

Host-only `addBot(matchId, difficulty)` and `removeBot(matchId, slot)` work at the *source reducer* level during lobby setup. Adding a Bot claims a free slot, creates a private `bot_controller` with a deterministic server-derived seed and resources, a Core + six platforms and its own scout; deleting a Bot removes only its own lobby assets. Join never overwrites a bot seat. A human can start a match with a Bot as the second faction, but bots **do not yet issue any actions**. There is no server strategic tick or real headless runner yet.

Both `myShips` and the new `myFactionStates` are identity-filtered views joining full match-scoped faction keys, intended to exclude other humans' and all Bots' private state. The real SpacetimeDB query builder / subscriptions still need runtime verification and generated binding updates.

All construction, repair, resource income, shipyard production, combat elimination and Naval Dominance score now read/write `faction_state`. Client commands still require a valid human membership and a non-eliminated human-controlled faction. See `docs/BOT_SERVER_INTEGRATION.md` for the shared-validator and strategic scheduler work still needed.

Pure Bot seat tests `tests/bot-seats.test.mjs`: **4/4 passed** on Node 22.16 with strict standalone TypeScript (5.8.3) passing. These do **not** prove the integrated reducers compile or that Bots are playable. No UI/HUD edits were made.


## Active Strategic Bot Scheduler — 29 October 2026

A running match with Bot factions now schedules one internal 1-second `bot_schedule` row. The `advanceBots` source reducer processes only Bots due to think, in faction-slot order, with difficulty-specific intervals/action budgets. Each observation is constructed from server-owned sensor + terrain-LoS visible contacts, discovered deposits, own resources, bounded legal building locations and nearby exploration frontiers.

Bot suggestions can lead to authoritative `harvest_order`, A* `ship_route`, `turret_aim`, projectile, construction and `production_order` rows. Every decision is checked at application time against current ownership, real resource balance and the existing pure movement/build/weapon validators; there are no fake identities or client connections. Finished matches clear the strategic schedule.

**Caveats:** This is real module *source code*, not proof of execution. Server-side transaction orchestration is not yet a fully shared module with human reducer entrypoints, even though physical/balance validation helpers are reused. Complete SpacetimeDB SDK module build, official reducer harness, bot-only headless and 1-human/7-bot live matches remain pending. Full Fog of War/subscription authorization also remains #13.

Standalone `bot-observation` pure tests: **5/5 PASS**, exact Git blobs match locally executed files, strict TypeScript PASS. No UI/HUD changes; owner design review #15 still required.


## Shared authoritative command dispatcher, first two commands (30 October 2026)

The human economy reducers and the Bot strategy scheduler now share `sim/command-dispatch.ts` for **Harvest** and **Shipyard Enqueue**. Both actions use the same match-scoped faction validation, ability/availability/queue/resource checks, and transactional operation order via DB-bound ports. This eliminates independent mutation logic for these two command types only. Human auth and Bot internal-controller authentication remain separate wrappers; bot gameplay does not simulate `ctx.sender`. A new server-side line-of-sight check prevents a human from harvesting an obscured deposit by guessed ID.

Ten exact-file isolated Node tests and strict standalone TypeScript pass; see `docs/FOUNDATION_VALIDATION.md`. Full SpacetimeDB module and transaction rollback tests were not executed because the runtime SDK is unavailable. Next command families to unify: movement, construction, aim/fire, then workshop flows; maintain headless 2–8 faction performance and FoW authorization gates before declaring playable.


## Command dispatcher parity & preliminary fog contacts — 30 October 2026

Following Harvest and Shipyard Production, both human and server Bot command paths now also use **the same `world-command-dispatch.ts`** for Movement and Construction and **the same `combat-command-dispatch.ts`** for Aim and Fire. Server-validated actor capability is separate from the shared mutation lifecycle; the shared logic rechecks owned match slots, routes, structure support, affordability, target visibility, weapon cooldowns and shot alignment before making any database writes. Table-specific ports are transaction-bound, while the SDK integration itself is still unverified.

The first Fog-of-War-safe **live enemy contact view** is exported as `myVisibleEnemies`, calculating observed hostile contacts from private match-scoped sensors and terrain LoS. It returns only contact key, match ID, type, ID and position. The new `myStructures` view returns only allied structures to an authenticated faction. Underlying ship, structure, resource, bot planning and order tables remain private. These are **initial contact projections**, not complete terrain discovery or spectator policy; they require SDK negative-subscription and performance tests (Issue #13).

Local standalone tests for shared dispatchers: **27/27 PASS** across three suites with compatible test fixtures, and new dispatcher TypeScript strict check PASS. Exact files were hash-verified against connected GitHub. Full SpacetimeDB module compilation/testing and Cloud deployment were NOT performed; see `docs/FOUNDATION_VALIDATION.md`.


## October 30 — integrated command parity and real-segment collision fix

The primary interactive command types are routed through shared pure, transaction-bound orchestration: Harvest, Shipyard Enqueue, A* Movement, Construction, Aim and Fire; human Workshop repair/upgrade now uses another reusable authoritative dispatcher. Both human and Bots use the same first six command contracts, but bots do not currently select Workshop repair/upgrade intents.

Physics correctness: server motion updates validate the **ordered physical waypoint segments** returned from `advanceShipOnRoute`. A tick that turns at a waypoint no longer collides along an imaginary straight-line chord between initial and final positions.

Fog source foundation: identity-limited `myVisibleEnemies` returns minimal live enemy contacts under friendly sensor + terrain LoS, while `myStructures` returns owned structures; all underlying sensitive tables remain private. Real SDK subscription correctness, read-set performance and spectator policy are pending Issue #13.

Local standalone regression: **47/47 PASS** and strict pure TypeScript PASS on exact GitHub blob-matched new files, with compatible simplified helper fixtures for dispatcher tests. **NOT** an SDK build or live multiplayer evidence. More detail: `docs/FOUNDATION_VALIDATION.md`.

No UI or HUD edits pending collaborative owner review (#15); no merge, GitHub Actions or Cloud deployments.
