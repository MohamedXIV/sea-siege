# Sea Siege — Playable Gemini Parity Roadmap

> **Active gameplay priority (2 November 2026).** This is the short, player-first recovery plan **on top of** the real Phaser 4 / SpacetimeDB implementation merged in [PR #21](https://github.com/MohamedXIV/sea-siege/pull/21) and [PR #22](https://github.com/MohamedXIV/sea-siege/pull/22). It supplements the long-term [ROADMAP.md](../ROADMAP.md) and [master Epic #1](https://github.com/MohamedXIV/sea-siege/issues/1); it does not erase their future requirements.

**Active tracking:** [Playable Gemini Parity Epic #23](https://github.com/MohamedXIV/sea-siege/issues/23).

## The promise — restore the experience, not the fake runtime

A player chooses **Quick Play**, immediately faces a server-owned bot, sees a complete attractive sea map, extends their floating base, gathers salvage, creates ships, fights, wins or loses, and can **Rematch**. The experience should feel as directly enjoyable and approachable as the original Gemini prototype, but execute with **real authorized server state** rather than a local demo.

- Keep actual **Phaser 4** rendering, official **SpacetimeDB 2.x TypeScript** server/SDK and **React/shadcn** UI.
- Do not port the Gemini HTML's in-memory `SpacetimeAuthorityServer`, fake `DbConnection`, client simulation or Canvas 2D renderer into runtime.
- Do selectively port/look to its game-feel, timing, color, framing, compact HUD, sound cues and core loop. Treat numeric balance as a starting point, not automatically correct.
- **Rule: playability wins over infrastructure expansion.** If it doesn't help the next real player action, don't build it now.

## Frozen primary reference — already in repository

| Reference | Use | Original SHA-256 |
|---|---|---|
| [Single-file playable HTML](../references/gemini/sea_siege_drowned_industrial_naval_rts_spacetimedb_phaser_4_architecture.html) | Visual rhythm, menus, RTS controls, VFX, audio and complete battle feel | `3329db56570cfd575d71fa704fa720830906e76751f5f84ba6fbed153b6e753f` |
| [Original 18-file ZIP](../references/gemini/sea_siege_project.zip) | Gameplay source and rule comparison | `a674e76e9bb1e716e5745fd76bc9439b2c0ea80df87ff833d05383eec951ef3a` |
| [Original artifact manifest](../references/gemini/README.md) | Provenance and preservation | — |

The user-supplied HTML matches the existing archived file hash **exactly**; this plan branch does not duplicate or modify the frozen originals. The reference says “SpacetimeDB + Phaser 4”, but its playable single-page implementation uses Canvas 2D plus an embedded simulated authority. Production must remain genuinely server-backed.

## Baseline as of 2 November 2026 — avoid rebuilding working foundations

| Already present in current `main` | Still missing from **player-facing** loop |
|---|---|
| Official SDK, authenticated connection, reconnect, private tables / identity-filtered views; live Codespaces two-human match launch verified by owner | One-click solo Quick Play vs a **real** server-owned bot |
| Seeded world, 16×16 chunk generator, server obstacles and spawns | Render **real** map, static terrain, known deposits and minimap to player |
| Server-side movement/orders and Phaser own-ship interpolation | Normal RTS interaction, coherent selection/commands and unit feedback |
| Server construction / connectivity, harvesting / salvage economy and shipyard queues | In-game build, salvage, queue/production buttons and render states |
| Server combat/projectile/outcome rules and bot policy/reducers | Real bot challenge, visible combat, damage, destruction, victory/defeat and rematch |

**Status is capability-specific.** “Server implementation exists” ≠ “browser gameplay proven”. Older `README.md`, `docs/STATUS.md` and issue text may describe the **pre-PR #21/#22** state; use merged source and executed evidence, not those obsolete claims, for current foundation status. Existing issues #7–#16 and #19 remain reference acceptance work; **do not automatically close them** due to this epic.

## Deliberate simplifications

- **Entire static map visible from match start.** No persistent exploration fog, explored-cell storage, unseen-chunk masks, special discovery state or terrain visibility schedule.
- **Tactical enemy information stays authorized.** Seeing terrain is not permission to inspect hidden enemy ships, orders, hidden faction balances, private resources or other matches. Serve match-scoped *authorized* static map information, not globally public world tables.
- A single human vs one bot is the *first* required repeatable match; 2–8 real/bot players remain the long-term game scope.
- Keep the original focused content: one Salvage resource; Command Core, Platform, Shipyard, Workshop, Cannon, Extractor; Scout, Gunboat, Siege vessel.
- No extra currencies, unit trees, ranking, matchmaking infrastructure, MMO/open-ocean scale, expensive shaders or optimization project before measurable need.
- Bots must run on server under existing valid commands; **never fabricate a second browser human**.
- UI should restore the reference's practical controls, **not** preempt owner-led full HUD sign-off (existing issue #15).

## Ordered vertical gameplay slices

| Slice / issue | What the player gains | Integration to reuse | Exit proof |
|---|---|---|---|
| [1 — Quick Play #24](https://github.com/MohamedXIV/sea-siege/issues/24) | Enter 1 human vs 1 real bot in one click | #12 / #14, P0 connection | Actual match is `active` in Codespaces |
| [2 — Known Sea #25](https://github.com/MohamedXIV/sea-siege/issues/25) | Actual water/ruins/shoals/deposits, minimap | #7, #5, #13 security | Visual map matches server, no private data leak |
| [3 — Build & Orders #26](https://github.com/MohamedXIV/sea-siege/issues/26) | Select, move, extend platforms, place structures | #8 / #10 / #15 | Legitimate build and command function in live match |
| [4 — Salvage & Ships #27](https://github.com/MohamedXIV/sea-siege/issues/27) | Gather salvage, construct shipyard, produce vessels | #9 / #10 | Economy changes & new ship happen on real server |
| [5 — Bots & Battle #28](https://github.com/MohamedXIV/sea-siege/issues/28) | Opponent builds/fights; shots, damage and wrecks | #11 / #12 / #16 | Real human-bot combat and Core destruction work |
| [6 — Results & Rematch #29](https://github.com/MohamedXIV/sea-siege/issues/29) | End-to-end skirmish and play again | #15 / #16 / #17 | Owner plays full repeatable match; winner verified |

Each step is a **reviewable PR with an in-browser checkpoint**, not a broad isolated backend infrastructure phase. Make minimal rule fixes where real interaction exposes defects. Keep performance improvements evidence-driven.

### Completion checklist for the entire epic

- [ ] Single-click Quick Play runs **without** incognito, manual lobby checkboxes or local fake players.
- [ ] One full known map renders correctly and is navigable; static map visible, enemy intel still protected.
- [ ] Player visibly builds platforms/structures, gathers salvage and queues ships using actual reducers.
- [ ] A server-owned bot takes meaningful actions and can fight, damage and lose/win.
- [ ] Player can finish a match and rematch, with a legible HUD, feedback, and no silent errors.
- [ ] Reconnect restores correct identity, authorized units and current match; invalid actions stay clean SenderErrors.
- [ ] Owner performs a full **private GitHub Codespaces port 5173** browser acceptance and confirms fun/readability.
- [ ] Backend privacy and integration tests remain passing; any NOT RUN result is explicit.

## Working arrangement

1. Branch from **current `main`** for each issue. Keep this `plan/playable-gemini-parity` branch as the *planning/documentation PR*, not the long-running implementation integration branch.
2. One coherent playable feature per PR; integrate with existing reducers and Phaser, then verify in browser. Do not reintroduce WebSocket mock transports.
3. For each change: small targeted tests, `npm run typecheck`, `npm run build`, applicable `npm run test:client` / backend tests. Record live Codespaces demo proof separately.
4. Never auto-merge. Have the owner actually play before declaring a slice accepted.
5. Only after this core loop is fun should we revisit [Fog #13](https://github.com/MohamedXIV/sea-siege/issues/13), expanded modes/late joining, substantial art/shader work or further optimization.

## What we will not mistake for progress

- Hundreds of passing tests that do not enable a single new player action.
- Protected private tables without a playable UI (security is mandatory, but not the game loop).
- New persistent world systems or finely engineered exploration fog before a playable battle.
- Large renderer/physics/server refactors merely because the original prototype was simulated.

**Next implementation PR:** start with [#24 — One-click Quick Play vs bot](https://github.com/MohamedXIV/sea-siege/issues/24), then #25. The final goal is the **repeatable experience**, not theoretical feature completeness.
