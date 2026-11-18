# Sea Siege Settings and Keybindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide robust device-local Game Settings, configurable desktop shortcuts, and a single live settings source consumed by React and Phaser.

**Architecture:** A versioned typed settings schema, safe localStorage adapter, and single observable settings store supply a semantic action registry. Phaser resolves keys through the registry while React offers shadcn Settings and rebinding controls. No SpacetimeDB schema or gameplay logic changes.

**Tech Stack:** TypeScript 5.9, React 19, Phaser 4.2, Tailwind 4, shadcn/ui, localStorage, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md`

## Global Constraints

- Remain true 90° top-down; preserve no-Fog and server authoritative state.
- Preferences persist per device with `sea-siege:game-settings:v1`; keep Android LAN configuration separate.
- Default current world actions: `KeyH` home, `KeyE` enemy, `Escape` cancel build/selection; Escape remains a universal cancel fallback.
- Desktop mouse actions remain LMB select/box, RMB contextual order, wheel zoom, existing pan. Preserve React-UI vs world-input focus gates.
- Do not expose settings that lack behavior, including unsupported audio/graphics.
- Implement against PR #44 after base integration/revalidation; source paths here refer to that draft.
- Focused PR, tests/build/manual checks, no speculative backend or gameplay changes, no auto-merge.

## Review Focus

1. Malformed, stale-version or disabled localStorage: game loads safe defaults without crashing — Test Task 1.
2. Duplicate bindings or blocked system/browser shortcuts: reject and preserve previous valid mapping — Test Task 2.
3. Typing in Settings or a dialog while game is active: must not move camera, cancel construction or fire orders — Test Task 3.
4. Remap while live Phaser scene remains mounted: new binding takes effect immediately and previous one stops — Test Task 4.
5. Unmount/reopen Settings, refresh, or reset: state remains in sync; unrelated Android LAN config persists — Test Task 5.

---

## Task 1: Versioned schema and robust device-local persistence

**Files:**
- Create: `src/settings/input-actions.ts`
- Create: `src/settings/game-settings.ts`
- Create: `src/settings/settings-storage.ts`
- Test: `tests/game-settings.test.ts`

**Interfaces:**
- Produces: `type GameActionId = "focusHome" | "focusEnemy" | "cancelWorldAction"`, `type KeyBinding = { code: string; shift: boolean }`, `DEFAULT_KEYBINDINGS: Record<GameActionId, KeyBinding>` in `input-actions.ts`.
- Produces: `GameSettingsV1` type with `version: 1`, `controls.keybindings`, `controls.zoomSensitivity`, `accessibility.uiScale`, `accessibility.highContrast`, `accessibility.reducedMotion`; `DEFAULT_GAME_SETTINGS: Readonly<GameSettingsV1>`; `sanitizeGameSettings(raw: unknown): GameSettingsV1`.
- Produces: `readGameSettings(storage: Pick<Storage,"getItem"> | null): GameSettingsV1`; `saveGameSettings(storage: Pick<Storage,"setItem"> | null, settings: GameSettingsV1): boolean`; `removeGameSettings(storage: Pick<Storage,"removeItem"> | null): void`.
- Values: localStorage key `sea-siege:game-settings:v1`, scale choices `1`/`1.25`/`1.5`, reduced-motion `system`/`on`/`off`; sensitivity is validated/clamped to finite positive values (exact UI range set in a named constant).

- [ ] **Step 1: Write failing Vitest tests** `tests/game-settings.test.ts` for fresh defaults; valid round trip; malformed JSON; unknown version; wrong primitive; missing keys; denied storage; and reset not deleting unrelated keys. Assert default `KeyH`/`KeyE`/`Escape` bindings.
- [ ] **Step 2: Run** `npm run test:client -- tests/game-settings.test.ts`; expect new tests FAIL on absent exports.
- [ ] **Step 3: Implement** the interfaces in the three focused files, including stable action identifiers, validating every persisted field, without throwing on storage failures.
- [ ] **Step 4: Run** `npm run test:client` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(settings): add validated device-local preferences`.

## Task 2: Rebinding, capture and conflict rules

**Files:**
- Modify: `src/settings/input-actions.ts`
- Create: `src/settings/keybindings.ts`
- Test: `tests/keybindings.test.ts`

**Interfaces:**
- Consumes: action IDs, `KeyBinding` and default mappings from Task 1 (Ctrl/Alt/Meta chords excluded in v1).
- Produces: `formatKeyBinding(binding: KeyBinding): string`; `rebindAction(current: GameSettingsV1, action: GameActionId, requested: KeyBinding): { ok: true; settings: GameSettingsV1 } | { ok: false; reason: "reserved" | "conflict" | "invalid" }`.
- Existing actions only; Escape always remains a hard cancel fallback. Rebind denial must not mutate prior settings.

- [ ] **Step 1: Write failing tests** for distinct valid rebinding, reserved `Tab`/`F5`/`F11`/modifier chords, same-context collision, invalid empty code, and Esc fallback.
- [ ] **Step 2: Run** `npm run test:client -- tests/keybindings.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** formatting and pure validation/capture helpers; use `KeyboardEvent.code` for layout-stable physical bindings, with human-readable labels.
- [ ] **Step 4: Run** `npm run test:client` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(controls): model configurable world actions`.

## Task 3: Shared observable store and world-shortcut routing

**Files:**
- Create: `src/settings/settings-store.ts`
- Create: `src/game/input/keyboard-shortcuts.ts`
- Modify: `src/game/SeaScene.ts`
- Test: `tests/keyboard-shortcuts.test.ts`
- Test: `tests/settings-store.test.ts`

**Interfaces:**
- Consumes: `readGameSettings`, `saveGameSettings`, `rebindAction`, `GameSettingsV1`.
- Produces: `gameSettingsStore.getSnapshot(): GameSettingsV1`, `gameSettingsStore.subscribe(listener: () => void): () => void`, `gameSettingsStore.update(next: GameSettingsV1): void`, `gameSettingsStore.reset(): void`.
- Produces: `resolveWorldShortcut(event: KeyboardEvent, settings: GameSettingsV1, worldHotkeysAllowed: boolean): GameActionId | null`.
- React/Phaser both read this singleton. Keep existing `SeaScene.canUseWorldHotkey` ownership logic and `onEscape` cancellation order; world must ignore UI focus and modal typing. Unsubscribe on Phaser cleanup.

- [ ] **Step 1: Write failing tests** that a store update notifies once, unsubscribe stops notifications, invalid shortcut/UI focus returns null, Escape cancels build, and remap affects next key event.
- [ ] **Step 2: Run** `npm run test:client -- tests/keyboard-shortcuts.test.ts tests/settings-store.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** observable store and pure resolver, then integrate into `SeaScene.onNavigationHotkey` and `onEscape` with an explicit semantic-action switch. Do not alter pointer command targeting.
- [ ] **Step 4: Run** `npm run test:client`, `npm run test:unit` and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(controls): route Phaser hotkeys through live settings`.

## Task 4: React Settings UI and effective shortcut hints

**Files:**
- Create: `src/components/GameSettingsDialog.tsx`
- Create: `src/components/KeybindingEditor.tsx`
- Add official shadcn primitives as needed under `src/components/ui/` (Dialog, Tabs, Slider, Switch; use `npm run ui:add`).
- Modify: `src/App.tsx`
- Modify: `src/components/MatchHud.tsx`
- Modify: `src/game/PhaserViewport.tsx`

**Interfaces:**
- Consumes: `gameSettingsStore` and the action registry.
- Produces: controlled `GameSettingsDialog({ open, onOpenChange }: {open: boolean; onOpenChange: (open: boolean) => void})`, with input-capture state isolated from gameplay; descriptive conflict errors, individual/all reset and clear close behavior.
- Existing menu and active HUD provide Settings entry. Update shortcut hints and battlefield aria text using effective bindings; do not keep misleading `H`/`E` hints after rebinding.

- [ ] **Step 1: Define verifiable UI checks:** open from deployment and active match; Tab/Shift+Tab focus; Escape closes Settings without issuing world actions; rebinding conflict displays error and retains old key; reset updates labels.
- [ ] **Step 2: Verify previous UI lacks these affordances** in a browser (NOT RUN if no browser; record honestly); start UI implementation with a checkable regression scenario.
- [ ] **Step 3: Add official shadcn primitives and two focused components**; wire to store and existing menu, maintaining HUD pointer-event boundaries and focus return.
- [ ] **Step 4: Run** `npm run test:client`, `npm run typecheck`, `npm run build`; execute the UI checks in desktop browser and record PASS/FAIL/NOT RUN.
- [ ] **Step 5: Commit** `feat(settings): expose accessible controls preferences UI`.

## Task 5: Acceptance and documentation

**Files:**
- Modify: `docs/GUI_UX_ROADMAP.md` (status only)
- Modify: `docs/superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md` (only if reviewed owner changes require it)

**Interfaces:**
- No new runtime interfaces. Validation covers both deployment and live matches using actual PR #44 stack after rebasing appropriately.

- [ ] **Step 1: Test** local settings round trip across refresh, in-match remapping, partial/corrupt storage, overlay focus, keyboard-only menu use and Android LAN key survival.
- [ ] **Step 2: Run** `npm run test:client`, `npm run test:unit`, `npm run typecheck` and `npm run build`; record exact outcomes and environment.
- [ ] **Step 3: Perform** desktop browser smoke and, if available, mobile WebView smoke; explicitly report NOT RUN for unavailable gates.
- [ ] **Step 4: Commit** focused docs status update, then open a reviewable PR; do not merge without owner approval.
