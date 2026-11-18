# Sea Siege — Contextual HUD M2 acceptance checkpoint

**Worktree branch:** `feat/contextual-hud-m2` (local, stacked on Settings PR #56).

**Source design/plan:** [GUI/UX design and HUD implementation plan in Draft PR #55](https://github.com/MohamedXIV/sea-siege/pull/55).
**Scope:** Issue #49's first reviewable HUD slice; not a player-accepted release.

## Implemented

- A presentation-only HUD summary derives the actual four owned material balances, owned fleet/structure counts and visible enemy-asset count from the current authorized subscription.
- Missing wallet rows, absent membership/faction or reconnecting subscriptions show unavailable values (`—`) rather than fabricated zeroes. A known server value of zero remains zero.
- Persistent compact resource/count strip, server connection state, match clock, accessible minimap, contextual dock, existing Settings/menu actions and command feedback.
- Selection status remains visible while the mobile command dock is collapsed. It resolves the current selection against authoritative owned ships or visible structures, distinguishes enemy structures, and stops showing stale selection on disconnect.
- The command dock stays mounted while collapsed, so construction/selection state is not intentionally reset on toggle. Existing ship, construction, Shipyard, Workshop, refit, and repair controls continue to invoke existing server reducers.
- Token-based simple pixel-border panel styling, 44px mobile action hit targets, scrollable command panel and an intentionally narrower panel at short landscape heights to preserve a battlefield area.

## Deliberate implementation rulings

1. **Unknown is not zero.** The HUD summary exposes `number | null` where the plan's initial interface proposed `number`. This prevents implying missing private subscription rows are genuine zero balances; consumers render `null` as unavailable. Cost if wrong: downstream consumers must handle `null` explicitly.
2. **One selection listener in MatchHud.** Selection state moved from the still-mounted command dock to its owner so the collapsed mobile HUD can show a truthful selection caption. Cost if wrong: a selection event arriving in an unmounted match is intentionally discarded; a new match starts with no selection.
3. **No visual acceptance claim from automated tests.** Layout rules are present but require real screenshot/manual checks; neither test count nor build success proves that the minimap, panels and battlefield avoid overlap on actual devices.
4. **Opening Menu ends transient world interaction.** The previous Phaser selection, build preview and armed touch order are cleared before the menu replaces the HUD, avoiding an invisible queued action on Resume. Cost if wrong: a player must reselect ships/re-enter build mode after closing Menu; simply collapsing Commands does **not** reset them.

## Independent review and fix pass

- The painted overview and full-screen menu/result layers now receive pointer input; Phaser also requires a visible match HUD and a genuine unobstructed canvas hit for all world gestures and construction context-menu cancellation.
- Mobile Order arming is shared between the React affordance and the Phaser handler: live owned ship selection, an applied subscription and no active construction mode are required. Selection/build/session invalidation clears an armed order.
- Menu transitions explicitly reset transient world interaction; enemy Workshops without authorized tier information no longer show an invented maximum HP.
- Missing match membership no longer renders owned counts as zero or guesses whether a selected structure is an enemy.
- Review regressions were each demonstrated failing before the implementation changes, then passing. Browser-level pointer/focus and device checks remain pending.

### Deferred minor items

- Mobile text still describes dragging empty sea as deselecting; touch drag pans, while a tap deselects. Requires copy cleanup with mobile manual review.
- Dock/minimap edge offsets are not yet safe-area-aware for every notched landscape device. Validate and tune using an actual device before acceptance.

## Verification ledger

| Gate | Result |
| --- | --- |
| Pure HUD summary, selection and SSR overview tests | PASS — RED→GREEN cases, including reconnect/unavailable values |
| Live two-human and client lifecycle integration with local SpacetimeDB 2.12 | PASS — `npm run test:client` with locally published module, **101/101**, 20 suites |
| Authoritative simulation unit suite | PASS — `npm run test:unit` (178/178) |
| TypeScript and production bundling | PASS — `npm run typecheck`, `npm run build` |
| Desktop normal/short/wide browser visual, pointer/focus and modal flows | **NOT RUN** — local Chromium sandbox socket error; remote browser could not access isolated `127.0.0.1` service |
| Landscape phone browser and Android Capacitor WebView | **NOT RUN** — no reachable device/session |
| Owner play/readability/controls sign-off | **PENDING** — required before merge / issue acceptance |

## Owner visual and interaction checklist (not yet accepted)

- [ ] Desktop 1280×720 and short 1024×600: persistent counters/clock/minimap readable; center battlefield accessible; no panel overlap over critical ships.
- [ ] Short landscape 800×360 and 640×360, with safe-area insets: tap Order, zoom ±, Commands and menu; each has a practical hit area; open command panel scrolls independently; collapsed panel preserves an adequate play area.
- [ ] Select single/multiple ships, enemy and owned buildings. With Commands closed, the live selection caption remains visible; with Commands open, only allowed controls are actionable. Confirm Shipyard queue and Workshop repair/refit states.
- [ ] Begin a platform/structure build, close/reopen Commands, verify placement state remains intact, then cancel; confirm no accidental order reaches the world through a panel.
- [ ] Disconnect/reconnect and refresh: stale values do not appear as current, match and selected entities recover sensibly, and duplicate or unauthorized rows never surface.
- [ ] Open Settings and Menu via keyboard and touch; confirm focus return, modal world-input shielding, useful error feedback and result/rematch flows.

**Delivery decision:** Keep the branch local and reviewable. Do not merge or mark #49 accepted until the manual gates above are examined with the owner.
