# Sea Siege — Roadmap

> Project planning baseline: 29 October 2026; **experimental source foundation squash-merged 30 October 2026** via [PR #20](https://github.com/MohamedXIV/sea-siege/pull/20). This is NOT an accepted playable release. [Implementation/validation status](./docs/STATUS.md) distinguishes code present from acceptance gates. The [master epic](https://github.com/MohamedXIV/sea-siege/issues/1) tracks feature completion.

## Current verification sequence — user decision (29 Oct 2026)

The user has a **SpacetimeDB account but has not created a Cloud database**. **Develop the project first; perform Cloud deployment/account authorization and full connected multi-browser E2E verification at the end of the implementation slice.** Do not create a Maincloud database or request account tokens during early code work.

This defers **integration evidence**, not the expectation of real APIs: build real TypeScript SpacetimeDB module source, generated SDK integration when tools become available, Phaser rendering and gameplay systems directly. Perform cheap static/unit/build checks opportunistically; never use fake clients/server or claim successful publication or multiplayer before a real run. Individual issues whose acceptance criteria require deployed evidence remain **open**, even if code is drafted, and later phases may proceed as development-only work with the unresolved P0 proof explicitly tracked. The first comprehensive end-to-end verification is #17, which must also close the pending P0 proof (#3/#4/#5/#6). Do not merge unverified production claims into `main`.

**Source checkpoint:** [PR #20](https://github.com/MohamedXIV/sea-siege/pull/20) was squash-merged into `main`. The browser-to-server integration and P0 acceptance remain unfinished; subsequent implementation should use small focused branches/PRs.

## Vision
2–8-faction real-time top-down naval strategy in a drowned-industrial world. Salvage and build connected floating platforms, support multi-cell workshops/shipyards/cannons, gather resources, command naval fleets, siege rival Command Cores and win. Human/bot/empty slots, Quick Play and private lobbies, fair procedural maps, secure fog of war, a reactive stylized ocean.

### Technology contract
- **Rendering:** actual Phaser 4 + TypeScript with Vite; React application shell + Tailwind + shadcn/ui.
- **Backend:** real SpacetimeDB TypeScript server module, reducers, scheduled gameplay operations, generated SDK bindings and authorized subscriptions. No browser-local pseudo-server or fake second player.
- **Authority:** server owns matches, identity, economy, placement, navigation, combat, bots, visibility and victory. Client interpolates movement and animates local water/VFX only.
- **Source material:** Gemini's `sea_siege_project.zip` and standalone HTML are reference implementations only; retain useful rules and assets selectively, not their fake backend/render architecture.
- **Engineering:** small reviewable PRs, no feature creep, tests before claiming a feature. Prefer local checks over GitHub Actions minutes.

## Phase plan and exit gates

### P0: Prove the *real* stack (hard gate)
**Issues:** [#2](https://github.com/MohamedXIV/sea-siege/issues/2), [#3](https://github.com/MohamedXIV/sea-siege/issues/3), [#4](https://github.com/MohamedXIV/sea-siege/issues/4), [#5](https://github.com/MohamedXIV/sea-siege/issues/5), [#6](https://github.com/MohamedXIV/sea-siege/issues/6).

**Acceptance criteria (verification deferred):** install/typecheck/build/test pass; SpacetimeDB module publishes; generated SDK client connects; two independent browsers view the same authoritative match and reconnect; Phaser 4 renders subscribed world. **Per the user decision above, do not falsely close P0 or block all code authoring on unavailable cloud/VM access; full integration evidence remains required at #17 before release.**

### P1: Playable naval RTS
**Issues:** [#7](https://github.com/MohamedXIV/sea-siege/issues/7), [#8](https://github.com/MohamedXIV/sea-siege/issues/8), [#9](https://github.com/MohamedXIV/sea-siege/issues/9), [#10](https://github.com/MohamedXIV/sea-siege/issues/10), [#11](https://github.com/MohamedXIV/sea-siege/issues/11), [#12](https://github.com/MohamedXIV/sea-siege/issues/12), [#19](https://github.com/MohamedXIV/sea-siege/issues/19).

**Exit gate:** deterministic seeded 2–8 spawn world, spatial chunks, legal multi-layer platform construction and support collapse, salvage gathering/costs, production, ships/formation/navigation, server-validated weapons/damage, Core destruction/victory and bots playing under the same rules. A complete human-vs-bots match must finish. Ship motion must render smoothly via buffered interpolation, with performance evidence comparing 5/10/20Hz simulation rather than direct DB-position snapping (see #19).

### P2: Secure, complete player experience
**Issues:** [#13](https://github.com/MohamedXIV/sea-siege/issues/13), [#14](https://github.com/MohamedXIV/sea-siege/issues/14), [#15](https://github.com/MohamedXIV/sea-siege/issues/15), [#16](https://github.com/MohamedXIV/sea-siege/issues/16).

**Exit gate:** real server-side fog of war/private intel; working matchmaking, slot types, join codes, reconnection, policy-controlled bot takeover/spectator; main menu, lobby, HUD/minimap/build UI, results/rematch in React/shadcn; Phaser-native industrial art, water wakes/splashes and audio. UI reflects real state.

### P3: Release candidate
**Issues:** [#17](https://github.com/MohamedXIV/sea-siege/issues/17), [#18](https://github.com/MohamedXIV/sea-siege/issues/18).

**Exit gate:** executed real two-browser E2E, 8-slot/headless AI simulations, negative authorization and intel-access probes, reconnect/late join, performance/bandwidth evidence, production build, reproducible setup and release documentation.

## Ordered tasks and dependencies

| Issue | Deliverable | Blocked by |
|---|---|---|
| #2 | Vite + React + TS + Phaser | — |
| #3 | Real SpacetimeDB module/bindings | — |
| #4 | 2 clients and reconnect | #2, #3 |
| #5 | Phaser subscribed renderer | #2, #3 |
| #6 | Automated test gates | #2, #3 |
| #7 | Seeded map/chunks | #3, #5 |
| #8 | Construction/connectivity | #3, #7 |
| #9 | Economy/production | #7, #8 |
| #10 | Ships/navigation | #3, #5, #7 |
| #19 | Smooth ship presentation, bounded dead reckoning, tickrate benchmarking | #3, #5, #10 |
| #11 | Combat/victory | #8, #10 |
| #12 | Bots | #8–#11 |
| #13 | Secure FoW | #3, #7, #10, #11 |
| #14 | Full match lifecycle | #4, #7; #13 for public security |
| #15 | React UI and HUD | #2, #4, #5; integrate core systems |
| #16 | Art/ocean/audio | #5, #10, #11; integrate #15 |
| #17 | Full E2E/performance, including smooth-motion quality gate | #6, #12–#16, #19 |
| #18 | Release packaging/docs | #17 |

**Initial dependency-ready issues:** [#2](https://github.com/MohamedXIV/sea-siege/issues/2) and [#3](https://github.com/MohamedXIV/sea-siege/issues/3). Keep `main` healthy; deliver through feature branches and reviewable PRs.

## Multiplayer motion and tickrate decision (ADR-0001)

**[ADR-0001: Smooth server-authoritative ship motion](./docs/adr/0001-multiplayer-motion-tickrate.md)** is the accepted implementation direction, with [Issue #19](https://github.com/MohamedXIV/sea-siege/issues/19) tracking the robust implementation/benchmark. This does **not** mean the implementation has already been completed.

- **Server simulation** is authoritative: begin with measured **10–20Hz**, test **5/10/20Hz**; monitor reducer cost and actual tick intervals.
- **Observable subscription/motion updates** are independent of simulation and display FPS; **5–10Hz is a trial target, not a setting promised by SpacetimeDB**. Server-side coalescing or parametric movement requires explicit design and measurement.
- **Phaser rendering** targets smooth 60 FPS using timestamped snapshot buffering, configurable small interpolation delay, shortest-arc angles, limited dead reckoning and authoritative correction.
- **Lifecycle and security:** no stale extrapolation on reconnect, fog-of-war hiding/reveal, spawn/despawn or change of ownership; never reveal hidden enemy ship state to smooth its renderer.
- **Test:** actual two-client movement of **20–50 ships**, 5/10/20Hz simulations, variable latency/jitter, frame time, server cost and bandwidth metrics.

**Sequencing:** #3 and #5 establish the timestamped movement contract and minimum Phaser interpolation in P0; #10 provides authoritative movement/orders; #19 hardens smoothness in P1; #11/#16 reconstruct projectiles/wakes visually; #17 verifies the release gate.

## Minimum content for version 1
- Resource: Salvage.
- Structures: Command Core, Floating Platform, Workshop, Shipyard, Defensive Cannon, Salvage Extractor.
- Ships: Scout, Gunboat, Siege Vessel.
- Victory: last surviving Command Core; deterministic stalemate/tie policy when necessary.
- Modes: vs bots, Quick Play, Private Match, spectator as authorized.

## Explicitly deferred
Persistent open-ocean MMO/Sea Siege.io scale, additional currencies/large rosters, true browser offline simulation, expensive rendering/backend rewrites, unrelated progression systems. These require new decisions/roadmap issues rather than silently entering P0–P3.

## Done means evidence
Each issue has explicit acceptance criteria. Closing an issue should cite passing executed unit/integration/browser checks and mention any environmental constraints. In particular, passing local JS simulation tests does **not** prove Phaser integration, real SpacetimeDB or multiplayer security.
