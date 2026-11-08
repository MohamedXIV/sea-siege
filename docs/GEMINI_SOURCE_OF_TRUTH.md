# Gemini is the canonical source for Sea Siege game presentation and gameplay

**Decision — 3 November 2026.** The complete original Gemini prototype in [`references/gemini/`](../references/gemini/README.md) is now the **source of truth** for the game's visual assets, map appearance, gameplay loop, balance baseline, controls and general UX. We are discarding our independently invented placeholder aesthetic and game presentation, not downgrading the real multiplayer architecture.

## Exact reference modules / targets

| Gemini prototype reference | Production adaptation | Status in `feat/gemini-art-world-parity` |
|---|---|---|
| `PixelAssetGenerator.getStructureCanvas` | `src/game/art/GeminiPixelArt.ts`: Phaser texture-generation, 40/80/120px original industrial structures and eight faction palettes | Initial direct pixel primitive port |
| `SeaSiegeBattlefieldRenderer.renderInteractiveOcean` | `SeaScene.redrawOcean`: quantized waves, dark ocean palette and faint tactical grid | Initial direct port |
| `renderTerrainAndNodes` | Member-scoped `my_gemini_world_chunks` + `my_gemini_salvage`; `SeaScene.syncMap` + `redrawDeposits` | Map and resource geometry direct port |
| `renderShips` | `SeaScene.drawVessel`: 24×14 scout, 32×20 gunboat, 42×26 siege, separate turret and hull rotation, simple wakes | Initial direct port; richer wake/health feedback later |
| `renderStructures` | Phaser image textures driven by `my_gemini_structures` (all human/bot factions) | Initial direct port; sprite interaction and damage feedback later |
| `renderMinimap` | `TacticalOverview`: live sea terrain, wrecks/pillars, salvage, colored structures and ships, click-to-pan | Initial real-data port |
| `generateDeterministicWorld` | Existing `spacetimedb/src/sim/worldgen.ts` already adapted from Gemini's reference algorithm (fair radial spawn, drowned megastructure ring, mirrored shoals, deposits). It stays authoritative in DB | Existing; now finally rendered |
| `STRUCTURE_DEFS` / `SHIP_DEFS` | Existing `sim/construction.ts` / `sim/economy.ts` and reducers | Server rules already adapted; rebalance against original if gameplay differs |
| Gemini Tactical Deployment Console | `src/App.tsx` and `DevControls.tsx` | First genuine reference-aligned menu, but no multi-bot presets yet |
| Gemini Build Menu and Selection Inspector | `GeminiCommandDock`: click-to-build, selected ship, nearest salvage and shipyard production | Real reducers wired; improve validation feedback/advanced orders next |
| `BOT_DIFFICULTIES`, naval tactics / targeting | Existing server `bot-policy.ts` and `bot-simulation.ts` | **NOT yet Gemini behavior parity.** Compare against original and prove real AI expands/fights |
| `renderProjectilesAndParticles`, impacts, audio | Existing authoritative combat rules, no full client VFX/audio | **NOT DONE**: next player-facing gameplay slice |
| Victory, rematch, options, polish | Existing server outcomes, not yet full UI | **NOT DONE** |

The original single-page renderer is Canvas 2D **only as a source example**. Rendering remains entirely under Phaser 4. The original `SpacetimeAuthorityServer` and fake `DbConnection` must never enter production. The existing real SpacetimeDB module/reducers and validated rules remain, even where the user-facing graphics/game-feel replace our own.

## Hard rules from the owner

- **No Fog of War:** reveal all static terrain, resources, rival ships/bases and faction colors throughout an active match to actual participants. No sensor-gated client world.
- Keep server ownership, anti-cheat, private tokens and other matches' isolation. Match member projections reveal visual state, **not** entire authoritative tables, private orders/AI plans.
- Match Gemini closely instead of inventing new sprites, HUD aesthetics, exploration mechanics or unrelated features. When something differs, favor Gemini's enjoyable proven behavior, and adapt to real server architecture.
- Treat all present changes as **Draft / NOT TESTED** until the owner runs Windows local SpacetimeDB + Vite checks and actually plays. Server table/view changes need **non-destructive** module publish and regenerated client bindings.
- Don't change the preserved archive's original hashes or ship its fake network implementation.

## Active gameplay control fixes (4 November 2026)

The owner playtested the Gemini world and requested these input / world-presence repairs. They are implemented as **unverified draft code** on `feat/gemini-box-selection-construction-ocean` (stacked after the prior gameplay fixes):

- **Esc or right-click** cancels active build mode, clears the preview and updates React and Phaser together.
- **Left-drag, no build selected:** selects all friendly ships whose hull intersects the marquee. Empty drag clears selection. Selected fleet may receive server-authoritative movement orders with loose spacing.
- **Left-drag, build selected:** previews a bounded rectangular batch. A start cell, end cell and every footprint must validate with the *existing server rules*; any gap, obstructing terrain/deposit/hull/building, insufficient Salvage, unsupported platform or misaligned 2×2 footprint rejects the **entire** batch. Max 64 structures. One authenticated SpacetimeDB reducer commits it atomically and schedules normal construction completion; no partial purchases and no fake client-side placement.
- **Continuous ocean:** view bounds now come from the actual camera inverse projection at every zoom; endless animated sea is rendered even beyond the finite authoritative map. The camera is no longer hard-clamped to the map edges; movement/building legality remains server-bounded.

The branch changes the server reducer API, not tables. Local tests require a **non-destructive** `spacetime publish --server local` and `npm run db:generate` before client typechecking. Browser acceptance remains mandatory; don't mark this complete based on source alone.

## Required parity acceptance

1. Open Quick Play: see both factions, their command cores and scouts; map matches real seeded server data.
2. Water, obstacles, shallow sea, salvage deposits, structures and ships visually match original pixel-art reference.
3. Click minimap to pan; right-drag camera; wheel zoom; select/command ships.
4. Build platforms, shipyard, extractor and defenses, charged only by server. Harvest real nodes, queue and launch ships.
5. Server-owned bots actually expand, gather, produce, attack and defend, and can win or lose.
6. Add Gemini's combat feedback, weapon rotation, projectile/impact particles, audio controls, victory screen and rematch.
7. Verify on two authentic client identities; no unrelated match data accessible.
8. Only after this loop is fun, discuss changes beyond Gemini.

**Implementation tracking:** [Epic #23](https://github.com/MohamedXIV/sea-siege/issues/23), [#25](https://github.com/MohamedXIV/sea-siege/issues/25), [#26](https://github.com/MohamedXIV/sea-siege/issues/26), [#27](https://github.com/MohamedXIV/sea-siege/issues/27), [#28](https://github.com/MohamedXIV/sea-siege/issues/28), [#29](https://github.com/MohamedXIV/sea-siege/issues/29). Current branch is stacked on pending [PR #32](https://github.com/MohamedXIV/sea-siege/pull/32), which is itself stacked on [PR #31](https://github.com/MohamedXIV/sea-siege/pull/31).
