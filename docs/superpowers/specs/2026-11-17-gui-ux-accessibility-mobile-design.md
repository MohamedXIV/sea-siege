# Sea Siege — GUI, UX, Accessibility & Mobile Controls Design

**Status:** Owner-approved design direction, 17 November 2026. **Scope:** planning only; no gameplay/UI implementation in this document.
**Approach:** Simple pixel-art UI with a centralized, typed, client-local Settings system and action-based input routing.
**Source baseline:** Review against the latest stacked draft `feat/capacitor-android-lan-prototype` (PR #44); `main` does not yet contain that stack.

## 1. Immutable product decisions

- Sea Siege remains a **true 90° top-down** naval RTS. UI must never suggest or silently drive an isometric/oblique camera.
- **Ocean/water rendering, game art, shaders and final VFX** are separate work (#16); use current visuals as placeholders.
- The owner likes the **clean simple-pixel-art** HUD mockup as a visual direction, not a mandate to copy another game's HUD or implement imaginary systems.
- Desktop browser and mobile **landscape** must share game semantics, not identical screen layouts.
- **No Fog of War.** All existing exposed world terrain, deposits and opposing live asset positions remain visible to authorized match participants; preserve private orders, server ownership, reducer permissions and match isolation.
- The server remains authoritative. React/Phaser are presentation and intent capture; do not implement combat, production, economy, visibility or victory in client state.
- UI must represent the **actual gameplay code**, not placeholders masquerading as functional controls. A future feature appears only with an explicit feature issue; unsupported settings remain hidden or marked as future work.
- Use existing React + Tailwind + shadcn/ui components first, customize theme/tokens for a subtle pixel-art presentation. Preserve Phaser rendering and React's ownership of overlays. Avoid bespoke recreations of common form/modal primitives.
- Do not introduce any backend schema or SpacetimeDB migration for player preferences.

## 2. Current code inventory (PR #44, not a verified release)

| Concern | Real source | Present behavior |
|---|---|---|
| Game shell and match menu | `src/App.tsx` | React shell, deployment, match overlay, menu; no general Settings page |
| Current HUD | `src/components/MatchHud.tsx` | Match clock, live status, four materials, fleet/structure/enemy counts, minimap, command dock |
| Action dock | `src/components/GeminiCommandDock.tsx` | Selection-aware build/orders; uses existing authorized command dispatch |
| Context panels | `src/components/BuildingInspector.tsx`, `src/components/WorkshopServices.tsx`, `src/components/ShipRefitPanel.tsx` | Actual construction/production/repair/refit mechanics when valid |
| Battlefield | `src/game/SeaScene.ts` | Desktop click/drag/box select, right-click contextual orders, wheel zoom, keyboard H/E/Escape, camera; React events |
| Pure command intent | `src/game/input/command-target.ts` | Deterministic move/attack/harvest targeting; server remains authoritative |
| Mobile first slice | `src/game/SeaScene.ts` + `src/components/MatchHud.tsx` | Tap selection; one-finger pan; Order then tap target; zoom +/−; collapsible command dock |
| Android LAN setup | `src/AndroidApp.tsx` | Separate local server connection configuration, not general game settings |

**Reality check:** PRs #41–#44 are stacked draft PRs, not merged. PR #44 reports no physical-device verification. The tracked Android project/dependencies have evolved since its description; verify actual branch/phone again before claiming it works.

### Existing real gameplay the HUD may expose

- Resource wallet: **Iron, Oil, Alloy, Isotope**. Iron retains migration-era `salvage` storage semantics. Read the server-authorized wallet rather than invent resource balances.
- Naval vessels: **Scout, Gunboat, Siege**. Existing selection, movement, combat and eligible harvesting use current rules; don't assume every ship harvests.
- Construction: **Platform, Shipyard, Workshop, Cannon, Salvage Rig** and existing build constraints.
- Selected-asset panels may show actual health/status, connectivity, build feasibility, production queue, repairs/refits, order status and server errors when those values are available.
- Minimap shows the known world and rival assets, with an accessible pan mechanism; no fog/shroud treatment.
- Match clock, result and rematch reflect authoritative match state, including the actual 12-minute limit.

## 3. Intended UX information hierarchy

### Desktop

1. **Persistent, glanceable:** top resource strip + match clock/status, compact minimap and ownership/fleet signals.
2. **Contextual, not permanently sprawling:** selection inspector and legal actions for selected units/buildings; construction/production dock collapsible or scoped to an obvious region.
3. **Modal only when needed:** settings, game menu, results; no interaction leakage from modals to battlefield.
4. **Combat clarity:** selected entity and target, command sent/denied feedback, hit/health state if server emits it; do not promise arrival or success when a reducer merely accepted an order.
5. Keep the center battlefield unobstructed. HUD layout obeys safe areas and zoom/UI scale.

### Mobile landscape

1. Persistent essentials remain visible even with command dock collapsed: resources (compact but legible), match clock, active selection feedback, clear menu/command access.
2. One-finger tap selects, drag on open sea pans; **Order → tap destination/enemy** dispatches the same contextual action as desktop RMB, and visibly arms/disarms.
3. Zoom ± from PR #44 stays as reliable fallback; **pinch zoom** and other multi-pointer gestures are separately scoped and require real-device validation before replacement.
4. Contextual commands appear in a compact expandable bottom/side sheet as permitted by viewport width. Avoid tiny dense desktop panels scaled down.
5. Avoid hidden gesture-only features: give explicit buttons/labels for essential actions. Mobile touch targets aim for **at least 44 × 44 CSS px**, including hit area, with safe-area insets and landscape viewport checks.
6. Preserve cancellation, drag threshold and no accidental orders while touching UI; target-arming must clear predictably.

## 4. Settings architecture (approved)

**Storage:** local per browser/device using `localStorage`. No accounts/profile sync, no SpacetimeDB changes. Android's LAN server key is **not** moved into gameplay preferences.

**Recommended organization (to be validated when implementing):**
- `src/settings/game-settings.ts` — typed `GameSettingsV1`, exact defaults, validation, version/migration contract.
- `src/settings/settings-storage.ts` — safe load/save/reset, tolerant of unavailable storage/corrupt JSON, and explicit namespaced key `sea-siege:game-settings:v1`.
- `src/settings/settings-store.ts` — single observable in-memory source for React UI and Phaser scene; subscribe/unsubscribe without leaks and persist only real user changes.
- `src/settings/input-actions.ts` — stable semantic `GameActionId` identifiers, visible labels, default binding registry, per-context eligibility.
- `src/settings/keybindings.ts` — key normalization/reserved browser shortcuts/conflict detection and rebind validation.
- `src/components/GameSettingsDialog.tsx` + `src/components/KeybindingEditor.tsx` — shadcn-based UI; Settings accessible from deployment/menu and active match.

**Input routing:** Phaser and React invoke semantic actions; keymapping is an adapter rather than hard-coded branching in `SeaScene`. Base keyboard defaults are `KeyH` → Focus Home, `KeyE` → Focus Enemy, `Escape` → Cancel build/selection. `Escape` remains a universal fallback to close/cancel menus/modes and should not be captured in ways that trap players. Preserve existing desktop LMB select/box-select, RMB contextual order, middle/RMB pan and wheel zoom unless a separate accepted issue changes mouse semantics.

**Rebinding:** show the assigned key, capture a new key, reject collisions inside the same gameplay context, reject dangerous reserved/system/browser shortcuts, allow restoring one action/all defaults, and persist valid mappings immediately. Gameplay shortcuts are disabled while typing or operating menus/dialogs. The input registry must update live without tearing down the Phaser scene. UI hints display the user's **effective** bindings, not hard-coded H/E labels.

**Settings sections / delivery rules:**
- **Controls (P1):** keyboard remapping, reset/defaults, camera scroll/pan and zoom preferences when actually wired; mobile touch size/left-handed options in mobile slice when implemented.
- **Accessibility (P1/P2):** UI scale, high contrast, reduced motion, non-color-only status/feedback, readable text/hit areas, proper labels/focus. Do not promise complete canvas screen-reader gameplay without implementing equivalent navigation.
- **Graphics (later only if real options exist):** limited effects/detail controls backed by actual Phaser settings; never display cosmetic switches that do nothing.
- **Audio (defer to #16):** master/SFX/music settings only after corresponding audio buses/events exist; a Mute toggle can be added with real sound.
- **Gameplay (only after researched):** optional selection/command behavior if supported by the actual reducer/input semantics.

**Persistence robustness:** defaults on first load; schema validation and partial recovery on old/corrupt data; no crash if localStorage is blocked; scoped versioned migration strategy; reset to defaults without deleting unrelated preferences or Android LAN settings. Preferences never change server game balance.

## 5. Accessibility acceptance contract

- All interactive elements have accessible names, visible focus, keyboard navigation and focus return for modals. Modal focus blocks world hotkeys and pointer orders.
- Critical status and errors are communicated by text/icon/shape in addition to color. High-contrast modes cannot conceal selected/enemy markers or error messages.
- Text/UI scale is adjustable without clipping essentials at common desktop sizes and narrow landscape mobile viewports; allow scrolling contextual panels without scrolling the battlefield inadvertently.
- Reduced motion respects OS preference by default and user override when implemented; suppress only presentation animations, not server gameplay.
- Keyboard use must work without touch/mouse for menus and UI controls; spatial RTS gameplay limitations should be documented honestly rather than declared WCAG-complete without testing.
- Test real Android landscape in Capacitor WebView, mobile browsers, desktop mouse+keyboard, touch cancellation, low viewport height, focus/overlay transitions and disconnect/reconnect states. Report PASS/FAIL/NOT RUN with environment and evidence.

## 6. Architecture and integration rules

- Source-of-truth for match data: existing `SpacetimeClientState` and authorized server subscriptions. Local settings influence view/input only.
- Do not change generated SpacetimeDB bindings, reducers, resource rules or bot behavior for this UX initiative.
- Keep `SeaScene` events stable for existing React controls; introduce typed adapters gradually rather than rewriting all pointer behavior at once.
- Move hard-coded presentation constants to named, tested configuration only when exposed through Settings or needed for responsive behavior. No arbitrary magic numbers.
- Prefer existing tests: `npm run test:client`, `npm run test:unit`, `npm run typecheck`, `npm run build`. Manual device gates remain separate.
- All implementation issues depend on current stacked PR #44 being integrated or an explicit, reviewed alternative base. Do not claim a plan derived from draft code applies unchanged to older `main`.
- Deliver changes in small reviewable PRs; no auto-merge without owner approval.

## 7. Scope exclusions and superseded instructions

- Do not rebuild water, ocean, character/ship/terrain art, lighting, shadow systems or game-camera projection in this initiative.
- Do not add Fog of War merely because older `ROADMAP.md`/#13 still mention it: the later owner decision in #23 explicitly cancels it.
- Do not copy the Gemini reference or the inspiration screenshot wholesale; these inform gameplay/visual rhythm, while current owner-approved HUD direction is **new simple pixel art**.
- Do not invent new ship classes, building types, resource classes, or unimplemented settings just to fill UI.
- The older owner visual-review gate in #15 is satisfied **for this scoped design direction** as of 17 Nov 2026; future material art/UI departures still require review.

## 8. Delivery, dependencies, and traceability

- **Epic:** a focused GUI/UX/Accessibility/Mobile Controls Epic linked to #15, #23, #43 and #44; not a replacement for the broad feature issue #15.
- **Roadmap:** `docs/GUI_UX_ROADMAP.md` with milestones, order, acceptance gates and explicit known/unverified status.
- **Implementation plans:** separate Superpowers plans for (1) settings/input, (2) contextual/responsive HUD, (3) mobile touch, and (4) accessibility/verification. Each produces testable, reviewable increments.
- First product implementation only after owner reviews the documentation and its execution approach.
