# Sea Siege — Implementation Status

**As of 30 October 2026.** Canonical concise issue triage for the experimental real-stack foundation. This is an implementation matrix, **not** a release declaration.

## What is genuinely present in source

The feature branch introduces a real Vite/React/Phaser 4 scaffold and SpacetimeDB TypeScript source for world generation, 2–8 lobby factions, construction/support, salvage economy, naval movement, workshop, turret/projectile combat, outcome and server-owned bot controllers/strategic scheduler. Dedicated pure, deterministic command dispatchers cover harvesting, production, movement, construction, aiming, firing, repairs and upgrades. Private tables and human identity-scoped views are defined; early sensor-limited enemy contacts are proposed.

**Critically: the browser scene is still a presentation scaffold — it is not connected to SpacetimeDB, and the generated client bindings are absent.** The full SpacetimeDB module has **not** been built, published or executed, and the newly added view/subscription and scheduled reducers have **not** been validated under the real SDK. Pure unit checks (including 47 focused command/motion checks with simplified dependency fixtures) are not substitutes for server integration or multiplayer evidence.

## Backlog decision matrix

| Issue | State of actual work | Why open / next acceptance gate |
|---|---|---|
| #1 Main epic | In progress | Fully playable 2–8-player RTS does not exist yet |
| #2 Frontend toolchain | Source scaffold | Install/typecheck/build and browser inspection not yet verified |
| #3 SpacetimeDB module | Extensive source, unverified | SDK compilation, module deployment and generated client bindings missing |
| #4 Two-client multiplayer | Not demonstrated | Two actual authenticated browsers and reconnect |
| #5 Phaser real game scene | Visual scaffold only | Authorized world entity subscriptions / input / real motion renderer |
| #6 Quality gates | Pure checks exist | Actual module tests, builds, integration and browser smoke |
| #7 Deterministic world | Pure generator/chunk/spawn implementation | Reconnect/client-map reconstruction and end-to-end fairness proof |
| #8 Floating construction | Strong server-source implementation | Matching in-game previews, bounded occupancy performance, SDK testing |
| #9 Salvage economy | Strong server-source implementation | Scheduled real-runtime timing, reconnect/client verification |
| #10 Naval units | Partial source | Formations, attack-move, UI selection and actual synchronized interpolation |
| #11 Turret/projectile combat | Strong server-source implementation | Two-client HP/death agreement, full FoW enforcement and visual events |
| #12 Strategic bots | Server-owned controller/strategy source | Live autonomous play, headless bot-only tests and 1-human/7-bot validation |
| #13 Fog of war | Preliminary identity/sensor views | Negative subscription tests, discovered terrain, spectator access, performance |
| #14 Lobby/late join | Basic host/join/bot seats | Quick Play, codes, readiness, reconnect/leave and late-join policies |
| #15 RTS UI/HUD | Intentionally gated | **Owner-led visual design review required before UI/HUD/menus implementation** |
| #16 Art/ocean/VFX/audio | Unstarted | Production art/audio and effects after authorized render |
| #17 E2E/security/performance | Unstarted | Actual 2–8 player/browser and 8-bot validation with measured results |
| #18 Release packaging | Unstarted | Real deployed playable game, docs/credentials/license verification |
| #19 Ship interpolation | Pure snapshot buffer work | Actual subscription wiring, jitter and 5/10/20Hz measurements |

## Integration acceptance gate — before declaring playable

1. Install official dependency versions and run both frontend `npm run typecheck && npm run build` and SpacetimeDB `npm run typecheck && npm test`/official CLI module build. **Current environment cannot reach npm registry**, and no published module was verified.
2. Generate the official SpacetimeDB client bindings; connect a Phaser 4 Scene to authorized subscriptions; validate identity persistence and all permissioned commands with two separate browsers.
3. Run real scheduled simulation/command tests, including negative subscription probes, transaction rollback and reconnect/late joining.
4. Run server-owned 1-human/7-bot and headless bot-only matches under deterministic seeds. Verify actual outcomes, memory/CPU budgets and fog read-set performance.
5. Design #15 UI/HUD collaboratively **before implementing visual changes**.

## Merge policy

A GitHub merge of the experimental foundation means **source/history consolidation only**, not completion of the above issues and not production readiness. Keep release and acceptance work open. Avoid GitHub Actions unless genuinely necessary.
