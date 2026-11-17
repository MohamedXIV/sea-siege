# Sea Siege — device-local Settings and keyboard controls

**Rebuilt:** 2026-11-17. **Source baseline:** PR #44 (`feat/capacitor-android-lan-prototype`, `9f3f73d`).  
**Design and plan:** PR #55 (`docs/gui-ux-accessibility-roadmap-2026-11-17`).  
**Feature branch:** `feat/local-settings-and-keybindings`.

## Delivered

- Versioned validated Settings saved under `sea-siege:game-settings:v1` on this device only, with defensive defaults and independent field recovery.
- Semantic live world keys: Home (`H`), Enemy (`E`), Cancel (`Esc`). Keys can be changed using physical `KeyboardEvent.code` and optional Shift. Escape remains a cancellation fallback.
- Rebinding collision/reserved-key checks, individual and all-default reset, and dynamic hints in HUD/battlefield accessibility text.
- React and Phaser share the same current snapshot; world keyboard input does not take over modal/text ownership.
- Settings dialog available from deployment and live match, using official shadcn Dialog conventions, with explicit focus return to its opener on close.
- Android LAN server connection settings remain separate; reset touches only the game settings key.

The typed schema reserves zoom sensitivity, UI scale, contrast and reduced-motion preferences, but these are deliberately not exposed until their actual runtime behavior is developed in the corresponding accessibility milestone. No fake audio, graphics, water, or gameplay controls were added.

## Validation and known limits

| Gate | Status |
| --- | --- |
| Focused settings, keybinding, routing, store and SSR/focus-helper tests | **PASS** — 30 tests |
| Simulation unit tests (`npm run test:unit`) | **PASS** — 178 tests |
| Full client tests (`npm run test:client`) | **BLOCKED overall:** 54 collected tests pass; two preexisting suites fail before collection without generated `src/module_bindings` |
| Project TypeScript and build (`npm run typecheck`, `npm run build`) | **BLOCKED** by absent SpacetimeDB generated bindings and cascading dependent types |
| Isolated strict TypeScript over new pure Settings modules | **PASS** |
| Live desktop browser, focus trap, refresh, in-match remapping | **NOT RUN**; app needs generated bindings/runtime |
| Android device/WebView smoke | **NOT RUN** |

`src/module_bindings` is git-ignored/generated and absent in the fresh clone; this blocker existed before work started. No stubs or backend changes were introduced to hide it.

Independent final review also verified two additional cases: only universal Escape may cancel build from a focused HUD button (remapped keys must not steal Space/Enter activation); and if a match ends while Settings is open, focus can return to the match-result dialog when the opener has unmounted. Pure regressions cover these rules; live browser verification is still required.

## Acceptance before merging

- [ ] Install the compatible SpacetimeDB CLI and run `npm run db:generate`, followed by all verification commands.
- [ ] Open and close Settings with Tab, Shift+Tab, Escape, Done and the close icon from deployment and active match; confirm focus returns to the launcher.
- [ ] Rebind Enemy to `J`, then Home to the freed `E`; confirm both survive refresh and work without changing the Phaser scene.
- [ ] Confirm collisions/reserved keys preserve the old binding; reset individual and all mappings.
- [ ] Test keyboard capture, typing in UI/modal, existing construction cancel, and universal Escape without dispatching unintended world commands.
- [ ] Confirm unrelated Android LAN connection key persists through Settings reset.
- [ ] Verify landscape phone rendering/touch targets and menu scrolling.

**Delivery:** Draft PR targeting PR #44's branch. Do not merge or close Issues #46–#48 until the blocked gates and manual acceptance checks are reviewed.
