# Sea Siege Accessibility and Cross-Device Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing genuine Sea Siege menus, HUD and input discoverable and readable across desktop and mobile without disrupting server-authoritative gameplay.

**Architecture:** Apply user-adjustable visual preferences from the shared Settings store to existing React components and presentation-only Phaser effects. Audit focus ownership, non-color-only feedback, hit targets and viewport behavior. Close the iteration with an evidence-based desktop/mobile test matrix.

**Tech Stack:** React 19, Tailwind 4, shadcn/ui, Phaser 4.2, Vitest, real desktop browser + Android WebView.

**Spec:** `docs/superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md`

## Global Constraints

- True 90° top-down; no Fog of War; no new water/art, backend schema, combat or economy.
- Respect built-in accessibility work in PR #43: command status roles, keyboard minimap navigation, dialog focus management and reduced-motion treatment.
- Settings are device-local, versioned and shared with React and Phaser; no fake or unwired settings.
- Accessible menu/hud does **not** imply full screen-reader access to spatial combat; document known gaps accurately.
- Android acceptance is NOT RUN until observed on a physical phone.

## Review Focus

1. High-contrast mode plus color-blindness: enemy/ally/selected/invalid states still discernible by text/outline/shape — Task 2.
2. UI scale 1.5x on short landscape: no clipped non-scrollable essential controls or inaccessible Close button — Task 2.
3. Dialog focus/keyboard shortcuts: Escape and Tab stay owned by dialog, not Phaser — Task 1.
4. Reduced-motion preference: gameplay still progresses; only display animations are affected — Task 3.
5. Disconnect/reconnect or fast selection updates: live announcements are helpful, not spammy; correct role/meaning — Task 1.

---

## Task 1: Semantic labels, focus ownership and world-input isolation

**Files:**
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/components/GeminiCommandDock.tsx`
- Modify: `src/components/CommandFeedback.tsx`
- Modify: `src/components/MatchResultOverlay.tsx` (only for actual deficiencies)
- Modify: `src/components/TacticalOverview.tsx`
- Modify: `src/components/GameSettingsDialog.tsx` (from Settings plan)
- Test: `tests/keyboard-shortcuts.test.ts` (focus and modal tests)

**Interfaces:**
- Consumes: existing `data-game-ui`/`data-game-hud` boundaries and `resolveWorldShortcut`.
- Produces: correctly labeled and focusable UI, proper `aria-expanded`/`aria-pressed` state, focus return on dialog close, and world-input suppression for UI-interaction events.

- [ ] **Step 1: Add tests** for focused text input, Settings dialog active, menu result dialog active, and shortcut rejection without world focus; expect FAIL for any uncovered case.
- [ ] **Step 2: Fix** event boundaries and labels with shadcn primitives, preserving PR #43 focus management.
- [ ] **Step 3: Verify manually** keyboard-only navigation, menu open/close, focus return, minimap pan and no click-through.
- [ ] **Step 4: Run** `npm run test:client` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `fix(a11y): protect keyboard focus and label controls`.

## Task 2: Effective UI scale, contrast and status clarity

**Files:**
- Modify: `src/index.css` (or actual global stylesheet)
- Modify: `src/App.tsx`
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/components/MaterialInventory.tsx`
- Modify: `src/components/TacticalOverview.tsx`
- Create: `src/components/hud/accessibility-theme.ts`
- Test: `tests/accessibility-theme.test.ts`

**Interfaces:**
- Consumes: `GameSettingsV1.accessibility`.
- Produces: `getAccessibilityClassNames(settings: GameSettingsV1): string[]` or equivalent documented pure selector, `uiScale` values `1`/`1.25`/`1.5`, and contrast flags; avoid applying CSS zoom to Phaser world camera.

- [ ] **Step 1: Write failing tests** for expected theme class selection and explicit text/label status mappings; avoid testing colors alone.
- [ ] **Step 2: Run** `npm run test:client -- tests/accessibility-theme.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** accessible themes applied to React UI only, with scrollable panels, non-color-only resource/connection/command indicators and no hidden important counters.
- [ ] **Step 4: Verify** normal/short/wide desktop and Android landscape at each UI scale; run `npm run test:client` and `npm run build`.
- [ ] **Step 5: Commit** `feat(a11y): add scale and contrast presentation controls`.

## Task 3: Reduced motion without gameplay side effects

**Files:**
- Modify: `src/index.css` (presentation animations)
- Modify: `src/game/SeaScene.ts` (only presentation-only effects already controlled from settings)
- Create: `src/settings/motion-preference.ts`
- Test: `tests/motion-preference.test.ts`

**Interfaces:**
- Produces: `shouldReduceMotion(preference: "system" | "on" | "off", systemPrefersReducedMotion: boolean): boolean`.
- Consumes: store's live preference; only HUD/CSS/camera cosmetic effects are gated, never server tick, navigation, projectile ownership or damage.

- [ ] **Step 1: Write failing tests** for all preference/OS combinations and unchanged gameplay command outputs.
- [ ] **Step 2: Run** `npm run test:client -- tests/motion-preference.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** pure policy and presentation-only integration; use `prefers-reduced-motion` from actual OS in UI layer and support explicit user override.
- [ ] **Step 4: Run** `npm run test:client`, `npm run test:unit`, `npm run typecheck` and `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(a11y): honor reduced-motion preference`.

## Task 4: Evidence-backed acceptance matrix

**Files:**
- Create: `docs/GUI_UX_ACCEPTANCE.md`
- Modify: `docs/GUI_UX_ROADMAP.md` (issue state only)

**Interfaces:**
- No runtime interface. Results must record device, browser/WebView, viewport, command attempted, expected outcome, observed outcome and PASS/FAIL/NOT RUN.

- [ ] **Step 1: Create test matrix** for desktop mouse/keyboard, narrow/short viewport, Android landscape touch, basic disconnect/reconnect, focus/dialog capture, large UI scale, contrast, reduced motion and command rejection.
- [ ] **Step 2: Run** pure tests, typecheck and production build with explicit command output/evidence.
- [ ] **Step 3: Execute** browser/physical-phone checks where available. Never conflate mock/pure tests with real-device observation.
- [ ] **Step 4: Record** remaining limitations; capture follow-up issues for real failures, avoiding scope creep.
- [ ] **Step 5: Commit** report and open final reviewable PR; do not merge without owner consent.
