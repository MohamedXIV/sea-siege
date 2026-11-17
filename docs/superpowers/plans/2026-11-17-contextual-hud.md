# Sea Siege Contextual and Responsive HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a clean, readable simple-pixel-art HUD with real server data and legal contextual commands on desktop and compact mobile landscape.

**Architecture:** Retain the existing React HUD components and event/reducer integration. Introduce a narrow, tested view-model for display only; restyle shadcn primitives through cohesive tokens and responsive layouts, retaining mounted command/selection state. Do not duplicate SpacetimeDB business rules in UI.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 4, shadcn/ui, Phaser 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md`

## Global Constraints

- True 90° top-down, no Fog of War, authoritative SpacetimeDB data; no ocean/art/lighting changes.
- Four resources Iron/Oil/Alloy/Isotope; three ship classes; five existing build kinds; only currently supported queue/repair/refit actions.
- New pixel-art UI must be original, not a copy of the provided inspiration; preserve battlefield visibility.
- Base implementation requires validated PR #44 stack. Settings/UI scaling integration consumes the separately planned Settings store once present.
- Use official shadcn primitives before custom controls. Do not invent fake statistics, actions or settings.

## Review Focus

1. Missing material wallet/reconnecting match: show actual known values and appropriate loading status, never invented balances — Task 1.
2. Unsupported selected entity/action: show disabled/explained controls or no control, not a live-looking broken button — Task 2.
3. Mobile landscape has low available height: panels scroll internally and do not block world tapping — Task 3.
4. Command dock toggled during selection/build state changes: underlying state remains mounted and consistent — Task 3.
5. HUD focus and pointer interactions: never trigger a world click/order behind menus/panels — Task 4.

---

## Task 1: Define real-data HUD view contracts

**Files:**
- Create: `src/components/hud/hud-view-model.ts`
- Test: `tests/hud-view-model.test.ts`
- Reference (do not rewrite): `src/network/spacetime-client.ts`, `src/components/MaterialInventory.tsx`, `src/components/MatchHud.tsx`, `src/components/GeminiCommandDock.tsx`

**Interfaces:**
- Produces: `type HudSummary = Readonly<{ connected: boolean; fleetCount: number; structureCount: number; enemyAssetCount: number; materials: Readonly<Record<"iron"|"oil"|"alloy"|"isotope", number>> }>`.
- Produces: `getHudSummary(state: SpacetimeClientState): HudSummary`. Reuse current wallet mapping: `myFaction.salvage` for Iron and authorized `materialBalances` for advanced materials. Preserve existing match clock/result components.

- [ ] **Step 1: Add failing tests** for empty/partial state, disconnected state, exact count mapping, and server-owned resource mapping without fabricated numbers; use real typed fixtures.
- [ ] **Step 2: Run** `npm run test:client -- tests/hud-view-model.test.ts`; expect FAIL on absent module.
- [ ] **Step 3: Implement** pure summary mapper; do not add client caching of authoritative facts.
- [ ] **Step 4: Run** `npm run test:client` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `refactor(hud): centralize display-only live summary`.

## Task 2: Coherent simple-pixel visual tokens and desktop hierarchy

**Files:**
- Modify: `src/index.css` (or current global Tailwind entry; confirm path before work)
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/components/MaterialInventory.tsx`
- Modify: `src/components/TacticalOverview.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `HudSummary` and existing `MatchClock`, `TacticalOverview`, `GeminiCommandDock`.
- Produces: reusable CSS theme tokens for panel fills, borders, status/highlight colors, size/spacing variables without new game-art assets.

- [ ] **Step 1: Capture** before-state screenshots at desktop baseline and reduced-height viewport; record overlap/readability and current keyboard/focus behavior.
- [ ] **Step 2: Implement** readable compact resource/clock/minimap layout and shadcn-styled pixel-border/panel treatment; all numbers and statuses sourced from existing components.
- [ ] **Step 3: Check** desktop normal/short/wide viewports, resource digit growth, reconnecting state, HUD scaling; no overflow or false statuses.
- [ ] **Step 4: Run** `npm run test:client`, `npm run typecheck` and `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(hud): add original simple pixel-art hierarchy`.

## Task 3: Selection-aware contextual dock and compact landscape modes

**Files:**
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/components/GeminiCommandDock.tsx`
- Modify: `src/components/BuildingInspector.tsx` (only if layout needs adjustment)
- Modify: `src/components/WorkshopServices.tsx` (only if layout needs adjustment)
- Modify: `src/components/ShipRefitPanel.tsx` (only if layout needs adjustment)

**Interfaces:**
- Consumes: selection and build-mode events already emitted by `SeaScene`; existing authorized command dispatch.
- Produces: responsive panels and collapse state, without new reducers/commands.

- [ ] **Step 1: Document checkable behavior** for no selection, one ship, multi-ship, enemy, building, Shipyard queue and Workshop repair/refit; compare enabled commands to current code.
- [ ] **Step 2: Implement** desktop contextual layout and mobile landscape expandable command surface, maintaining mounted command dock state while collapsed.
- [ ] **Step 3: Manually verify** touch target/button legibility, internal panel scrolling and UI pointer shielding; no order is dispatched through a panel.
- [ ] **Step 4: Run** `npm run test:client`, `npm run typecheck` and `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(hud): adapt contextual dock to desktop and mobile landscape`.

## Task 4: Existing menus, feedback and regression acceptance

**Files:**
- Modify: `src/App.tsx` (menu layout only)
- Modify: `src/components/CommandFeedback.tsx` (presentation only if needed)
- Modify: `docs/GUI_UX_ROADMAP.md` (status and evidence)

**Interfaces:**
- Keep outcome/rematch and feedback semantics unchanged; use Settings entry provided by the settings/input plan.

- [ ] **Step 1: Verify** menu/Quick Play/reconnect/result/rematch states plus no text-only misleading submission confirmation.
- [ ] **Step 2: Verify** keyboard focus, responsive UI/landscape manual smoke and disabled commands; record PASS/FAIL/NOT RUN for real browser/device.
- [ ] **Step 3: Run** `npm run test:client`, `npm run test:unit`, `npm run typecheck` and `npm run build`.
- [ ] **Step 4: Commit** acceptance notes and open focused PR; do not merge without owner review.
