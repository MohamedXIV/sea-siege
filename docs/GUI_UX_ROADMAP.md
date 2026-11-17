# Sea Siege — GUI, UX, Accessibility & Mobile Controls Roadmap

**Owner decision:** Approved 17 November 2026. **Current status:** DOCUMENTATION / PLANNED, **not implemented**.
**Epic:** [#45 — GUI/UX, Accessibility, Local Settings & Mobile Controls](https://github.com/MohamedXIV/sea-siege/issues/45).
**Design:** [Owner-approved source-mapped spec](superpowers/specs/2026-11-17-gui-ux-accessibility-mobile-design.md).
**Delivery:** Small independent PRs with test + owner-review gates; do not merge without owner approval.

## Non-negotiables

- **True Top-Down 90°**, pixel-art game world, original clean/simple-pixel-art UI.
- Prioritize readability on **desktop** and **mobile landscape**, clear context and accessible controls; no copying another game's HUD.
- **No Fog of War** in the live game. Older root roadmap/#13 wording predates the newer owner decision; see #23.
- No water/ocean/game art/shaders/lighting in this initiative; see #16.
- Every displayed item and usable action must be backed by existing Sea Siege state/mechanics. Do not create dead settings panels, decorative resources or phantom buttons.
- React/shadcn owns menus and overlay HUD; Phaser 4 owns the world; SpacetimeDB owns actual gameplay.
- Player preferences stay **device-local** under a versioned localStorage key; account/cloud sync is deferred.

## Real source baseline and dependencies

The design was audited against **Draft PR #44** (base chain #41 → #42 → #43 → #44), not merged to main. Existing work includes:
- React `App` and `MatchHud`; live Iron/Oil/Alloy/Isotope inventory; clock, minimap, construction/selection/production/repair/refit panels.
- Phaser `SeaScene` desktop H/E/Escape, mouse controls, contextual orders, and current scene events.
- PR #43 command feedback, keyboard/focus and initial accessible HUD behavior.
- PR #44 first mobile touch: tap to select, one-finger drag to pan, Order→tap target, zoom ±, collapsible commands, Capacitor LAN prototype. **No proven physical-device acceptance yet.**
- No general Game Settings or rebind service. Android's locally stored LAN endpoint is **not** the Game Settings store.

**Before coding:** Integrate/rebase on the actual latest tested PR stack, review source paths/behavior and resolve any open draft acceptance gates. Planning does not imply those draft PRs are merged or functional on a real phone.

## Phases, issues and exit gates

| Phase | Issue | Workstream | Exit gate | Status |
|---|---|---|---|---|
| M0 | [#45](https://github.com/MohamedXIV/sea-siege/issues/45) | Spec, code inventory, Roadmap and Epic | Approved design + linked implementation plans and focused issues | Docs review |
| M1 | [#46](https://github.com/MohamedXIV/sea-siege/issues/46) | Typed local preferences, persistence, reset | Valid/stale/corrupt/blocked storage tested; no backend changes | Planned |
| M1 | [#47](https://github.com/MohamedXIV/sea-siege/issues/47) | Configurable desktop keybindings | H/E remap live; conflicts and reserved keys rejected; Esc safe; UI focus protected | Planned |
| M1 | [#48](https://github.com/MohamedXIV/sea-siege/issues/48) | Accessible Settings dialog/editor | Pre-match and in-match access, persistence, effective hotkey hints; no inactive settings | Planned |
| M2 | [#49](https://github.com/MohamedXIV/sea-siege/issues/49) | Simple pixel-art HUD hierarchy | Server-backed resource, fleet, minimap, clock, status; original responsive visual direction | Planned |
| M2 | [#50](https://github.com/MohamedXIV/sea-siege/issues/50) | Contextual and responsive command panels | Legal selection/build/repair/refit; no UI pass-through or dock state loss | Planned |
| M3 | [#51](https://github.com/MohamedXIV/sea-siege/issues/51) | Mobile gesture safety/pinch | No ghost orders; robust multi-touch/pointercancel; ± zoom fallback; desktop unchanged | Planned |
| M3 | [#52](https://github.com/MohamedXIV/sea-siege/issues/52) | Mobile landscape controls and ergonomics | ≥44px touch hit areas, safe areas, clear Order/Cancel; real-device observation | Planned |
| M4 | [#53](https://github.com/MohamedXIV/sea-siege/issues/53) | Accessibility scale/contrast/motion | UI scale & contrast actually wired; no color-only status; focus/motion validated | Planned |
| M4 | [#54](https://github.com/MohamedXIV/sea-siege/issues/54) | End-to-end accessibility/mobile acceptance | Tests + owner desktop + physical Android playthrough documented PASS/FAIL/NOT RUN | Planned |

### Dependency ordering (recommended, not a single huge PR)

1. **Base validation first:** stacked draft PR #44 and its prerequisites; do not bypass its owner Windows/Android checks.
2. **Settings foundation:** #46 → #47 → #48. Existing keyboard events and command dispatch remain stable.
3. **Desktop HUD:** #49 → #50. This can be planned/tested alongside Settings, but integrate shared scale/hints once #48 exists.
4. **Mobile:** #51 (on #44) + #52 (after #50, #46 and #51). Do not replicate first-touch controls.
5. **Accessibility:** #53 after the Settings UI and HUD foundations; regression test PR #43 behaviors.
6. **Release gate:** #54 after all above, dependent also on actual authoritative gameplay smoke (#29).

Suggested PRs: each issue or a small naturally coupled slice, with clear acceptance results; no epic-sized monolith. Keep existing Draft PR chain visible in the PR description.

## Four independent Superpowers implementation plans

- [Settings storage, semantic input and rebinding](superpowers/plans/2026-11-17-settings-and-keybindings.md) — Issues #46–#48.
- [Contextual desktop + responsive pixel HUD](superpowers/plans/2026-11-17-contextual-hud.md) — Issues #49–#50.
- [Mobile touch gesture hardening and ergonomic landscape controls](superpowers/plans/2026-11-17-mobile-touch.md) — Issues #51–#52.
- [Accessibility and evidence-based acceptance](superpowers/plans/2026-11-17-accessibility-verification.md) — Issues #53–#54.

### Settings delivery policy

**Phase M1 (implement):**
- Device-local `sea-siege:game-settings:v1` with defaults, validation, selective reset, graceful fallback and forward migration.
- Semantic world action IDs; configurable desktop keyboard defaults H/E/Escape, collision detection/reserved-key rejection and safe Escape fallback.
- Readable control hint labels from effective bindings; Settings available inside and outside a match.
- Accessibility UI scale (1 / 1.25 / 1.5), high contrast and reduced-motion settings **only as actual behavior is wired**.

**Later / issue-specific (no fake controls):**
- Camera sensitivity, pan speed, touch target sizes and handedness if actual scene/layout behavior supports them, with appropriate tests.
- Sound volume/master/SFX/music only when #16 provides real audio.
- Graphics quality options only when presentation effects expose meaningful adjustable levels.
- Cloud settings sync only if accounts/profile support is later approved.

## UX data-to-control matrix

| UI | Authoritative/present source | User-visible action |
|---|---|---|
| Four materials | `MaterialInventory` / existing wallet and material balances | Read current amounts, display real costs/errors |
| Fleet and selection | `SpacetimeClientState` / `SeaScene` selection | Select and multi-select actual vessels |
| Contextual target orders | `src/game/input/command-target.ts` and server dispatch | Move, attack or supported harvest depending on actual target and selected ships |
| Build dock | `GeminiCommandDock` | Platform, Shipyard, Workshop, Cannon, Salvage Rig |
| Inspector | `BuildingInspector` + `WorkshopServices` + `ShipRefitPanel` | Actual structure status, ship production, repair and refits |
| Map and time | `TacticalOverview` + `MatchClock` | All live world assets visible (no FoW); pan camera |
| Match menu/result | `App` + `MatchResultOverlay` | Quick Play/menu, authoritative end state and rematch |
| Mobile world input | `SeaScene` / `MatchHud` in PR #44 | Tap, pan, armed contextual order, ± zoom (pinch pending #51) |

## Verification policy

At each implementation issue: `npm run test:client`, `npm run test:unit`, `npm run typecheck`, `npm run build`, plus focused tests where available.

Manual gates must explicitly list **PASS / FAIL / NOT RUN**, device/browser/WebView build, viewport/orientation, actual authoritative server connection and outcome. Final acceptance requires a **real Android landscape device**, desktop keyboard/mouse and a repeatable match including reconnect and results. Synthetic tests alone do not close #54.

## Adjacent issue references

- [#15 — Complete React/shadcn menus and HUD](https://github.com/MohamedXIV/sea-siege/issues/15): broader UX scope; owner direction now approved for this specific visual slice.
- [#23 — Playable Parity Epic](https://github.com/MohamedXIV/sea-siege/issues/23): required authoritative playable game loop and no-FoW decision.
- [#16 — Art, ocean, VFX and audio](https://github.com/MohamedXIV/sea-siege/issues/16): excluded/deferred here.
- [Draft PR #43](https://github.com/MohamedXIV/sea-siege/pull/43): existing UX/focus/feedback baseline.
- [Draft PR #44](https://github.com/MohamedXIV/sea-siege/pull/44): existing Android LAN/touch baseline, currently unverified on phone.
