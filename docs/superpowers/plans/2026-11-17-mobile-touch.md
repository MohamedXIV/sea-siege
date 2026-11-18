# Sea Siege Mobile Touch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete usable Android/mobile-landscape RTS input on top of the PR #44 first-touch prototype, with reliable gesture cancellation, safe controls and real-device acceptance.

**Architecture:** Isolate touch gesture classification in a pure, testable module; feed its outcomes into the existing `SeaScene` camera/selection/`pointerCommand` pathways. Reuse current mobile Order-mode React events and ± zoom fallback. Mobile ergonomic preferences use the shared Settings store once available.

**Tech Stack:** TypeScript, Phaser 4.2 pointer events, React 19, Capacitor 8 (draft), Vitest, Android WebView.

**Spec:** `docs/superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md`

## Global Constraints

- Keep true 90° top-down and authoritative server command dispatch; touch gestures never compute game outcomes.
- PR #44 currently supports tap select, single-touch pan, Order→tap target, zoom ±; **do not recreate them**.
- Maintain current click/box/build rules; pinch must not inadvertently select/command/build.
- Android LAN configuration remains separate from gameplay Settings. No native release/HTTPS promises in this UX task.
- Real Android phone acceptance is mandatory before declaring this milestone complete; report NOT RUN until executed.

## Review Focus

1. Second finger arrives while one-finger pan/order is pending: cancel single-touch tap/order, not an accidental action — Task 1.
2. Fingers lift in either order: no ghost click, no stranded drag/order state — Task 1.
3. Pinch starts over React panel or outside world: no camera gesture or underlying order — Task 2.
4. Extreme pinch/zoom: clamp zoom to existing camera bounds and avoid drift near anchor — Task 2.
5. Low landscape height, notch/safe area, rotated phone or large touch preference: buttons remain usable — Task 3.

---

## Task 1: Pure gesture recognition and cancellation semantics

**Files:**
- Create: `src/game/input/touch-gestures.ts`
- Test: `tests/touch-gestures.test.ts`

**Interfaces:**
- Produces: `type TouchOutcome = { kind: "tap"; x: number; y: number } | { kind: "pan"; dx: number; dy: number } | { kind: "pinch"; anchorX: number; anchorY: number; scale: number } | { kind: "cancel" } | { kind: "none" }`.
- Produces: `class TouchGestureTracker` with `down(pointerId: number, x: number, y: number): TouchOutcome`, `move(pointerId: number, x: number, y: number): TouchOutcome`, `up(pointerId: number): TouchOutcome`, `cancel(): void`.
- Named constants for threshold and finite scaling; handling two active pointers cancels pending one-pointer tap; no mouse regressions.

- [ ] **Step 1: Write failing tests** for stationary tap, movement pan threshold, pinch two-pointer distance and anchor, second-finger suppression, reverse lift order, canceled pointer and invalid coordinates.
- [ ] **Step 2: Run** `npm run test:client -- tests/touch-gestures.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** tracker as pure state machine, no Phaser or DOM dependencies.
- [ ] **Step 4: Run** `npm run test:client` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(touch): classify pan pinch tap and cancellation`.

## Task 2: Integrate gestures with existing world controls

**Files:**
- Modify: `src/game/SeaScene.ts`
- Modify: `src/game/PhaserViewport.tsx`
- Test: `tests/touch-gestures.test.ts` (add state transition assertions)

**Interfaces:**
- Consumes: `TouchGestureTracker` and existing `MOBILE_ORDER_MODE_EVENT`, `MOBILE_ZOOM_EVENT`, `isWorldPointer` and `pointerCommand`.
- Produces: pinch zoom respecting existing `0.45`–`2.4` clamp and anchored camera behavior; tap/Order remain same reducer dispatch semantics. Keep ± fallback.

- [ ] **Step 1: Add failing tests** for multiple active pointers suppressing current `leftDrag`/`drag` completion and no `pointerCommand` invocation on canceled gesture.
- [ ] **Step 2: Run** `npm run test:client -- tests/touch-gestures.test.ts`; expect FAIL.
- [ ] **Step 3: Wire** pointer down/move/up/cancel lifecycle, pointer-count handling and pinch-to-zoom in `SeaScene`. Reuse existing camera APIs; do not rewrite contextual command resolver or change mouse routes.
- [ ] **Step 4: Run** `npm run test:client`, `npm run test:unit`, `npm run typecheck` and `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(touch): add bounded pinch without accidental world orders`.

## Task 3: Mobile ergonomics and explicit controls

**Files:**
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/index.css` (confirm actual Tailwind file)
- Modify: `src/components/GameSettingsDialog.tsx` when the Settings plan is integrated
- Modify: `src/settings/game-settings.ts` only for approved touch preferences

**Interfaces:**
- Consumes: shared Game Settings and current mobile controls.
- Produces: accessible Order/Cancel, Zoom+/−, Commands and Settings touch controls with ≥44×44 CSS px effective hit area. Optional persisted touch size/left-handed preference only once implemented; no inactive toggles.

- [ ] **Step 1: Specify** screen-size matrix including narrow Android landscape, notch insets, 1.25x UI scale, and tap-target measurement.
- [ ] **Step 2: Apply** safe-area-aware responsive arrangement; clear Order armed state on cancel/mode changes; display text alongside ambiguous icons when space allows.
- [ ] **Step 3: If actual controls implement it, add** touch target size/left-handed options with targeted store tests; otherwise keep option deferred in Issue and Settings hidden.
- [ ] **Step 4: Run** `npm run test:client`, `npm run typecheck` and `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(touch): make landscape controls legible and safe`.

## Task 4: Real-device and desktop-regression gate

**Files:**
- Modify: `docs/GUI_UX_ROADMAP.md` (test observations only)
- Reference: `docs/ANDROID_CAPACITOR_LAN.md`

**Interfaces:**
- No new runtime interface. Do not change the server or publish an APK without separate authorization.

- [ ] **Step 1: Run** the owner Windows SpacetimeDB + LAN Android procedure using the existing draft instructions; verify Android build installs and Quick Play connects.
- [ ] **Step 2: On real phone verify** tap select, pan, pinch, ± zoom, Order→move/attack, build/selection cancellation, UI shielding, orientation and reconnect after app restart.
- [ ] **Step 3: On desktop verify** LMB select/box, RMB move/attack/pan, wheel zoom, Escape/H/E rebindings; detect no pointer regressions.
- [ ] **Step 4: Run** all client/unit/typecheck/build checks; mark device/browser checks PASS/FAIL/NOT RUN with evidence.
- [ ] **Step 5: Commit** documentation and open draft PR for owner physical-device review; do not merge until acceptance.
