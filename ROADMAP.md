# Sea Siege — Roadmap

> Project planning baseline: 29 October 2026. The [master implementation epic](https://github.com/MohamedXIV/sea-siege/issues/1) tracks all feature issues and is the canonical source for their completion state. **No game implementation has been merged by this planning step.**

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

**Exit gate:** install/typecheck/build/test pass; SpacetimeDB module publishes locally; generated SDK client connects; two independent browsers (not one in-page simulation) view the same match, exchange authoritative updates and reconnect; Phaser 4 renders the subscribed world. No cosmetic feature work substitutes for this proof.

### P1: Playable naval RTS
**Issues:** [#7](https://github.com/MohamedXIV/sea-siege/issues/7), [#8](https://github.com/MohamedXIV/sea-siege/issues/8), [#9](https://github.com/MohamedXIV/sea-siege/issues/9), [#10](https://github.com/MohamedXIV/sea-siege/issues/10), [#11](https://github.com/MohamedXIV/sea-siege/issues/11), [#12](https://github.com/MohamedXIV/sea-siege/issues/12).

**Exit gate:** deterministic seeded 2–8 spawn world, spatial chunks, legal multi-layer platform construction and support collapse, salvage gathering/costs, production, ships/formation/navigation, server-validated weapons/damage, Core destruction/victory and bots playing under the same rules. A complete human-vs-bots match must finish.

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
| #11 | Combat/victory | #8, #10 |
| #12 | Bots | #8–#11 |
| #13 | Secure FoW | #3, #7, #10, #11 |
| #14 | Full match lifecycle | #4, #7; #13 for public security |
| #15 | React UI and HUD | #2, #4, #5; integrate core systems |
| #16 | Art/ocean/audio | #5, #10, #11; integrate #15 |
| #17 | Full E2E/performance | #6, #12–#16 |
| #18 | Release packaging/docs | #17 |

**Initial dependency-ready issues:** [#2](https://github.com/MohamedXIV/sea-siege/issues/2) and [#3](https://github.com/MohamedXIV/sea-siege/issues/3). Keep `main` healthy; deliver through feature branches and reviewable PRs.

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
