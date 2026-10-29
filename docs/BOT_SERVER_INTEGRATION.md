# Server-Owned Bots — Integration Contract (draft, 29 October 2026)

Status: **pure policy and pure sensor filter implemented and tested; no playable bot factions yet**.
Related: #12 (bots), #13 (fog), #8/#9/#10/#11 (authoritative action rules), Draft PR #20.

## What is implemented today

- `spacetimedb/src/sim/bot-policy.ts` exposes `decideBot(observation, difficulty)`.
  It returns at most 1/2/3 intents on a strategic 4s/2s/1s interval for easy/normal/hard.
  Difficulty changes policy parameters, **not resource amounts, unit statistics, or vision cheats**.
- Supported initial intents: `aim`, `fire`, `harvest`, `move`, `build`, and `enqueue`.
  All are *suggestions*, not trusted mutations or guaranteed-valid actions.
- `spacetimedb/src/sim/bot-perception.ts` exposes `detectBotEnemies`.
  The caller provides **server-owned** sensors, enemy candidates, static terrain and a server timestamp.
  The helper returns only live foreign contacts passing range + terrain LoS, with a stable order.
- The policy reads only the explicitly supplied **visible enemies**, **discovered deposits**,
  **server-vetted legal build candidates** and **authorized exploration frontiers**.
  It never queries SpacetimeDB, uses a browser/websocket, or reads hidden world chunks.
- Pure tests check stable determinism under reordered inputs, bounded work, stale intel denial,
  anti-overdraft reservation, class-based tactical reactions, sensing, occlusion, and no sensors.
  They **do not** constitute a headless match simulation.

## Ownership migration required BEFORE bot commands are connected

The current live module schema has `ship.owner: Identity` and a `match_member.identity`
for every playing seat. This is suitable for humans, **not** bot-only seats. Assigning
host identity to bot ships would falsely make those ships player-owned and could allow
the host to control them; inventing fake bot identities would also violate #12.

1. Introduce a canonical *match-scoped faction slot* on ships (`ownerSlot`),
   or equivalent authoritative faction membership. Structures already use `ownerSlot`.
2. Store human account ownership separately from server-owned bot controllers:
   a human seat has its real `Identity`; a bot seat has a server-owned bot controller row
   and **no user Identity**. Do not repurpose the host's Identity as a bot owner.
3. Refactor **every** human reducer (move/stop/aim/fire/harvest/build/demolish/repair/
   upgrade/queue/cancel) to resolve `ctx.sender` to a human seat and validate its
   faction slot, rather than allowing a matching `ship.owner` as sole authority.
4. Refactor combat faction lookup and economy/production/score aggregation to use the
   canonical slot, without `Identity` lookups for bot-owned vessels. Migration must
   include all inserts, destructors, tests, spawned ships and victory counting.
5. Only then create `bot_faction` rows with stored difficulty, deterministic seed,
   next decision time, observation/discovery state and no client ownership.
6. A **single bounded per-match strategic scheduler** should process due bots in slot
   order. The server constructs the observation (never passing all enemies to policy),
   gets bounded intents and applies them through the **same reusable authoritative
   validators** used by human reducers. Do **not** have a scheduled reducer pretend
   to be a player, forge a connection, or directly bypass ownership/placement/combat.
7. The server must revalidate every proposed action (terrain path, range, cooldown,
   costs, completed structures, actual visibility, congestion, match phase and deadline).
   Rejected proposals must be safe no-ops or explicit logged outcomes, not rollbacks
   of other bots' successful commands in the strategic batch.
8. **Bot-only headless matches** need internal/test-authorized match initialization
   without any player-controlled slot, no browser connections, and deterministic
   final match digest at seed/time cutoff. The current public `createMatch` creates a
   human host, so it cannot represent a bot-only match as-is.

## Required tests before claiming Issue #12 is complete

- One human + seven independent server-owned bots; zero extra socket connections.
- Bot-only headless full match reaches a deterministic result/deadline; same seed gives
  identical ordered digest, regardless of table iteration order and reconnects.
- Unauthorized human attempts to control bot units, claim bot resources or read bot
  private plan rows fail; unknown/spectator identities get no access.
- Bots only act on server-visible enemies and actually discovered nodes/frontiers;
  obscured/out-of-range enemy positions cannot influence actions. Run real #13
  negative subscription and reducer probes.
- Concurrent build/queue intents remain cost-correct and occupancy-safe; bots obey
  normal cooldown, pathfinding and collision rules.
- Profile 2–8 seats, strategic transaction budgets and 12-minute completion in an
  actual SpacetimeDB runtime. Save GitHub Actions minutes; prefer local execution.

## Explicit boundaries

No `bot_faction` table, scheduler, real bot command adapter, bot-only match runner or
identity-to-faction migration is merged by this slice. Private tables and server-side
intent signatures are **not** proof of fog security or actual playability. The new policy's
difficulty/priority choices are initial tuning defaults. No UI or HUD work begins before
the owner reviews its visual direction (Issue #15).


## Ownership migration phase 1 — actual implementation (29 October 2026)

**Implemented (source code, pending SpacetimeDB module build):**
- Every `ship` row now persists **`ownerSlot: u32`** and **`factionKey: indexed string`** rather than a `ship.owner: Identity` field. Each human `match_member` row persists the same indexed `factionKey`, derived **on the server** from its match ID and slot (e.g. `4:0`). Neither component is accepted from a client as authoritative input.
- `myShips` now uses an identity-filtered, indexed **right semijoin** from `matchMember` to `ship` on `factionKey`, not just `ownerSlot`. This prevents a slot-0 player in one match seeing slot-0 ships in another match, while preserving the per-identity view API.
- All starting and shipyard-produced ships receive the canonical slot/key; moving/stopping/harvesting/aiming/firing/repairing, combat victim faction lookup/elimination, passive harvesting and deadline ship counts now use match-scoped faction slots rather than `ship.owner.isEqual(humanIdentity)`.
- Human reducers check *actual membership in the ship's match* and exact faction slot. Elimination is enforced for human structure/build/production/repair commands as well.
- `sim/faction-ownership.ts` supplies a standalone tested key builder and human-only authorization primitive.

**Still intentionally incomplete — don't mark bots playable:** Human `match_member` still owns the salvage ledger, and all lobby seat initialization creates human-owned members. There is **no bot-only controller row, bot ledger, server AI scheduler, bot-owned starting fleet, headless bot match or shared AI command execution adapter yet**. This is the first *ship ownership separation* milestone, **not** the full controller/economy migration.

**Required phase 2:** move shared faction resources/elimination accounting into a canonical per-match faction state table (independent of human identity); keep human seat associations separate; add server-owned bot controllers with no fake `Identity`. Then refactor human reducers to delegate to shared authoritative command validators used also by bot scheduler, and test both 1 human + 7 bots and bot-only matches. After that implement actual bot sensing/projections and #13 security tests.

**SDK caveat:** Full SpacetimeDB module build and live indexed-semijoin subscription have **not** been executed here. Check SDK 2.x query builder and row-type constraints before release. Existing generated client bindings from before schema migration are stale and MUST be regenerated when integration testing begins.


## Ownership migration phase 2 — independent faction ledger and Bot Controllers (29 October 2026)

**This section supersedes the historical "Still intentionally incomplete" paragraph above.**
The source now implements these backend foundations:
- `faction_state` is a **private row per actual match faction**, with `matchId`, `slot`, indexed `factionKey`, `controller: human | bot`, `salvage`, `totalSalvageGathered` and `eliminated`. `match_member` stores **only** the real human Identity, match ID, slot and factionKey; it no longer duplicates the economic ledger.
- `createMatch` and `joinMatch` create one human membership **plus** its corresponding faction ledger transactionally. Joining fills the first genuinely available slot across **both** human and bot factions and cannot claim an occupied Bot slot.
- `addBot(matchId, difficulty)` requires the human host during lobby phase. It validates Easy/Normal/Hard, allocates one unclaimed slot, inserts a private Bot Controller **without a fake Identity**, creates its own faction balance, Command Core, six initial platforms and scout. The bot seed is derived reproducibly from the private server world seed and slot.
- `removeBot(matchId, slot)` is host-only during lobby phase, deletes just that Bot's own faction, ships, structures and controller, and frees the slot for a human or another Bot. It cannot delete human factions or eject running-game Bots.
- `startMatch` can now start with any two occupied factions, including **one real human and one server-owned bot**. This only establishes the real match and normal economy/movement timers; it does **not** make the Bot execute decisions automatically yet.
- `myFactionStates` is an identity-filtered indexed semijoin that provides only the logged-in human's own private resource ledger. Neither other humans' resources nor bot faction balances should be visible.
- Building, demolition, repairs, upgrades, production, harvesting, income, combat, elimination, and 12-minute dominance score now use `faction_state`, regardless of human/bot controller type. Human command auth still requires an actual matching `match_member` and checks the faction's non-eliminated human-controller status.
- Ship ownership remains match-scoped `ownerSlot + factionKey`; production inherits the faction key, not a human identity.

**Execution status:**
- **Actually run:** `tests/bot-seats.test.mjs` **4/4 PASS** (Node 22) and isolated strict TypeScript check **PASS**. Exact committed file hashes match locally executed bytes.
- **Added but not run:** official module-harness cases covering a 1-human/3-bot lobby, private views, unauthorized human access, Bot seats with independent income, owner-only lobby removal, and match start with 1 human + 1 bot.
- The full SpacetimeDB module was **not compiled, executed, published or observed by independent clients** in this environment. The schema changes require regenerated client bindings; the SDK semijoin/table declarations remain unverified.

### Remaining phase 3 — first *playing* Bots

The private `bot_controller` rows currently store difficulty, seed and `nextDecisionUs`, **but no strategic scheduler is registered**. The policy and perception helper are still only pure modules. Next, introduce a bounded one-timer-per-match strategic scheduler, construct authoritative visibility-limited observations, and apply proposed actions through reusable shared validators used for human commands too. Those commands must never impersonate users or bypass resource, navigation, visibility, firing or ownership contracts. **Bot-only headless matches** also need separate internal fixture initialization without requiring a real host Identity. Keep Issue #12 open until these are running and tested.

The P0 acceptance gates (SpacetimeDB build/test/publish, identity-filtered subscriptions and two-client validation) remain outstanding. The user-approved UI/HUD design gate is untouched.


## Phase 3 — server-scheduled strategic decisions (29 Oct 2026)

**Implemented as SpacetimeDB source, not runtime-validated:** the active match now creates **one private `bot_schedule` interval per match with at least one Bot**. `advanceBots` accepts only an internal scheduled caller, checks absolute match deadline and persists a next-decision timestamp per private `bot_controller`. Easy/Normal/Hard retain their 4/2/1-second cadence and 1/2/3-intent caps. Skipped ticks are *not* replayed; endgame removes the timer whether victory is by Core elimination or deadline score.

Each due Bot gets a fresh server-built `BotObservation`, never a raw table handle:
- Friendly ships/structures and an independent `faction_state` balance;
- current enemy contacts **only** when projected through actual friendly sensors and terrain line-of-sight;
- deposits **only** when within sensor radius and terrain LoS, plus legal build locations validated from friendly connected territory and physical occupancy;
- bounded nearby navigable exploration frontiers. Unobserved enemy ships, enemy faction ledgers and undiscovered deposits are not passed to `decideBot`.
- placement checks are capped to 16 candidate origins **per type** and favor existing completed friendly platforms for mounted structures.

The scheduler interprets and **revalidates** every proposed intent against current SpacetimeDB state: faction ownership, correct match, surviving unit, non-eliminated Bot controller, resource cost and queue limit, legal building footprint/support, destination A* with hull-specific collision, harvest range and visible deposit, firing sensor/LoS/range/cooldown/aligned turret, and bounded projectiles. Accepted actions update the same private ship-route, harvest-order, turret-aim, projectile, production, structure and faction-ledger tables used by human reducers. This is **not** a second in-browser simulation. The bot does not forge `ctx.sender`, invoke a human reducer, or gain special resources.

**Important architecture limitation:** while the scheduler reuses the *same pure validation/rules functions* as human reducer paths (`validateStructurePlacement`, `findTerrainPath`, `isNavigationCellBlocked`, `shipDefinition`, `debitSalvage`, `inRange`, `canFire`, `terrainLineOfSight`, `turretAligned`, etc.), the authoritative **transaction orchestration is still duplicated** between human reducers and the bot scheduler. A central, typed command application layer is needed before we claim full guaranteed reducer parity. Don't claim shared transaction code, or full #12 completion, yet.

**Actually executed now:** standalone `tests/bot-observation.test.mjs` **5/5 PASS**, strict `tsc` **PASS**; exact executed source/tests verified byte-identical with GitHub blobs:
- `sim/bot-observation.ts`: `e105265f9022e04d5c15ead78b974c7dccdc830b`
- `tests/bot-observation.test.mjs`: `8e54161148e3b85e9bf21ab8f8ccae47fdb79319`

**Prepared but not executed:** official SpacetimeDB module-harness tests for internal-only strategic tick, one shared timer for 2–7 Bot seats, zero fake human memberships, human inability to control Bot fleets, sensor-hidden contact denial, resource conservation and bot-timer cleanup at victory. The actual 1-human + 7-Bot scheduled loop, headless Bot-only match, fog subscription security, full SDK compile/build, performance and two-client gameplay **are NOT VERIFIED**. Regenerate bindings and run the SDK test harness before calling bots playable. The UI/HUD review gate #15 remains intact.


## Phase 4, slice A — shared human/Bot Harvest and Shipyard transaction dispatcher (30 October 2026)

`spacetimedb/src/sim/command-dispatch.ts` is the first **actual shared command mutation path**, not merely a second use of physics helpers. Both authenticated human reducers (`economy-reducers.ts`) and the internal Bot scheduler (`bot-simulation.ts`) now invoke:
- `dispatchHarvest`: server-provided authenticated faction capability and current ship/node, match+ownership checks, harvest-capable ship, current deposit availability and caller-specific server visibility, server distance check, then the SAME route cancellation, harvest-order insert/update and ship revision/stop operations through transaction-bound ports.
- `dispatchProduction`: current paid faction balance, real functioning friendly shipyard and queue size/cap, canonical `shipDefinition`, then the SAME single debit and FIFO production insert through transaction-bound ports. Bot difficulty may only **lower**, not exceed, the global queue cap.

Human `orderHarvest` now computes terrain-based source-to-deposit Line of Sight against decoded **server-owned terrain**, rather than accepting a guessed in-range hidden deposit ID with no occlusion check. Bot harvest requires the node already be in its server-projected `knownDeposits`.

Both wrappers keep their distinct security boundary: a human needs real authenticated membership and `controller=human`; a Bot must be reached only from the internal `advanceBots` scheduled reducer with `controller=bot`. Both wrappers already require the active match to be before the deadline. The shared dispatcher itself neither grants a client Identity nor accepts an untrusted claim of ownership. Under SpacetimeDB reducer transactions, an unexpected DB write failure is expected to roll back the entire transaction; **this SDK rollback has not been exercised**.

**Verified locally:** exact file bytes on branch for `command-dispatch.ts` and `tests/command-dispatch.test.mjs` (Git blobs `a1b6b5e4cd7274100b0c486949edf8848ff98997` and `31c45c8093318efa620eb02005c9415fafdc4f6b`) passed **10/10 Node 22 standalone tests**, isolated strict TypeScript passed. The local test environment used a **minimal Economy compatibility stub** matching relevant production costs, harvest range, queue size and helper semantics; this is not a full GitHub module build.

**Remaining:** movement, building, aiming, firing and workshop commands still require an equivalent shared transaction dispatch refactor. The full SpacetimeDB SDK, real `advanceBots` execution, database rollback, authoritative two-client subscription tests, headless bot-only match and deterministic full-match digest are NOT verified. Keep #12/#13/#9 open and PR #20 Draft. No UI/HUD edits.


## Phase 4, slices B–C — shared movement, construction and combat (30 October 2026)

**This supersedes the older “Remaining: movement, building, aiming, firing” note.** There are now THREE pure shared command modules actually called by BOTH authenticated human reducers and the internal Bot scheduler:
1. `sim/command-dispatch.ts` — harvest order lifecycle and paid shipyard enqueue;
2. `sim/world-command-dispatch.ts` — navigation via the same terrain A*, hull collision, route cancellation/upsert, motion scheduling, and physical multi-cell construction support/occupancy validation, single resource debit and completion scheduling;
3. `sim/combat-command-dispatch.ts` — authenticated faction source, aligned cannon/ship turret aim, canonical weapon range/LoS/cooldown, fixed-heading projectile creation, authoritative firing timestamp, per-match projectile cap and single combat-timer activation.

The server supplies authenticated faction capabilities, never client-supplied owner IDs. Human wrappers verify `ctx.sender` is the matching non-eliminated human member. Bot wrappers run only inside the private internal `advanceBots` schedule, check real `bot_controller`, and pass sensor-filtered enemy sightings and bounded legal build destinations. All shared dispatchers recheck current match/slot ownership and action preconditions before invoking transaction-bound mutation callbacks. The logical mutations for those SIX command types are shared. The concrete SpacetimeDB table adapters (ports) are still repeated at the call sites and require full SDK tests.

**Verified locally:** new exact `world-command-dispatch.ts` plus `tests/world-command-dispatch.test.mjs` **9/9 PASS**; new exact `combat-command-dispatch.ts` plus `tests/combat-command-dispatch.test.mjs` **8/8 PASS**. Alongside the earlier Harvest/Production suite, **27/27 isolated Node 22 tests PASS** and strict TypeScript for the two new source modules PASS. Exact Git SHA-1 blob IDs match the locally executed four new files. **Important:** test fixtures contain compatible *simplified* navigation, collision, construction, combat, turret and economy dependencies, not a real SDK module or all real helper code. The 27 successes prove dispatcher logic under those fixtures, NOT real-game correctness.

**Still unimplemented or unverified:** Workshop repair/upgrade transaction dispatcher, actual bot-only match initialization and end-to-end deterministic headless run, full SpacetimeDB build/scheduler/rollback, real fog subscriptions and cross-client visibility, and performance profile. Keep issues #9/#11/#12/#13 open and PR Draft.


## Phase 4, slice D — Workshop parity and traced ship motion (30 Oct 2026)

The existing shared-command authority work now additionally includes `sim/workshop-command-dispatch.ts`, with one validated transactional sequence for structure repair, vessel repair and tier upgrade. The three authenticated human Workshop reducers invoke that common command implementation, and remain protected by same-match identity/controller/ownership. The Bot policy does **not yet propose Workshop actions**; the dispatcher accepts a verified Bot faction capability for a future autonomous repair policy. No client controls HP, price or upgrade duration.

The movement primitive now returns `traversedSegments` for every actual waypoint leg within a tick. The live motion scheduler checks `canSweepVessel` separately against each segment, **not a shortcut chord**; this avoids incorrect collision detection on sharp turns in one tick.

**Verified locally:** 36/36 shared-command tests (10 Harvest/Production + 9 Move/Build + 8 Aim/Fire + 9 Workshop), plus 11/11 actual ship-motion tests. All **47/47 PASS**, standalone strict TS PASS; exact new source/test Git blob hashes documented in `docs/FOUNDATION_VALIDATION.md`. Simplified dependencies are used for the dispatcher tests and actual real source is used for ship motion. The full SpacetimeDB SDK module and scheduler have **NOT** been built or run.

Phase 5 remains a strict acceptance gate: real module build, full test harness, authenticated negative subscription probes, deterministic Bot-only headless game, scheduled 1-human/7-bot match test, and performance profiling. Do not claim bots play successfully end-to-end until those pass. The user-review gate on game UI/HUD remains untouched.
