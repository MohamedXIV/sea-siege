# Sea Siege — Usability & Accessibility Pass 1

**Base:** `feat/bot-material-strategy-refits` (stacked Draft PR #42). **Scope:** React/Phaser client only.

## Intent

Reduce battlefield obstruction, make command feedback visible, and correct keyboard/focus traps without changing combat, economy, bot policy, world data or the approved visual identity. This is an interaction/behavior pass, **not** the larger visual redesign held by Issue #15 pending owner art/UX direction.

## Changes

- **Mobile dock:** Keep resources and basic fleet counts visible; hide the long construction/tactical command panel by default below `sm`. A labeled, expanded-state-aware Commands button toggles it. Desktop keeps the original commands visible. The dock stays mounted to preserve selection/build state.
- **Command results:** Battle-scene feedback now surfaces in a non-blocking overlay with a distinct success/error indication and screen-reader role. Notices expire after 3.8 seconds. Movement reports that the order was **submitted**, not that the ships have arrived.
- **Keyboard ownership:** H/E world shortcuts act only while the playable HUD exists and world focus owns the keystroke; they no longer steal input from forms or menus. Escape can still cancel the active build tool even while its toolbar button holds focus.
- **Focusable viewport/minimap:** Clicking the battlefield focuses a keyboard-accessible region. The minimap supports arrows, Shift+arrows for larger steps, Home to center and Enter/Space for the focused location. Accessibility-triggered clicks no longer jump to the top-left of the sea because synthetic click coordinates are zero.
- **Result dialog:** Focus enters the result dialog, Tab stays inside it, and focus returns to the previously active element on dismissal. The wide scoreboard can be focused and horizontally scrolled with a keyboard.
- **Other cleanup:** Visible focus rings on native controls, reduced-motion support for UI transitions, labeled deployment controls, proper live error alerts, actual server-side lobby membership validation without a misleading manual confirmation checkbox, truthful connection labels, and no duplicated Iron counter.

## Windows acceptance checklist

Run from the new branch:

```powershell
npm run typecheck
npm run build
npm run test:client
npm run test:unit
```

1. Open Quick Play in a desktop browser: existing ships, orders, construction, combat and HUD work unchanged. Tab into the battle canvas; H goes home, E goes to an enemy. E/H typed in the deployment Join ID field do not change the camera.
2. On a narrow viewport: compact resource + fleet HUD remains visible. Commands opens/closes the dock without forgetting selection/build choice; scroll the panel without scrolling the battlefield behind it.
3. With minimap focused, use arrows, Shift+arrows and Home. Enter/Space must focus the shown navigation point, **not** coordinate (0,0). Mouse clicks on the map still work.
4. Place a valid structure and issue movement/attack orders: see non-blocking green feedback; intentionally issue a denied order: see readable red feedback. Server validation and resource checks are unchanged.
5. Select Build while its toolbar button is still focused and press Escape: build mode cancels. While typing into forms, game hotkeys do nothing.
6. Open a human lobby. Start with only one player: server rejects with a visible error. Join from a genuine second client, then Start succeeds without a fake manual membership checkbox.
7. Reach a result: focus moves into the dialog, Tab/Shift+Tab circulate among dialog controls, scroll the standings with keyboard, and return to deployment.
8. Enable OS/browser “reduce motion”: UI entry and status pulses stop or become effectively instantaneous. Check at 360px and 768px for clipping/overlap.

## Boundaries / follow-up

- No claims of WCAG conformance or fully screen-reader-playable RTS. Ship selection, build placement and many battlefield actions are still pointer-centric.
- No live browser, local Vite build, automated test, or deployed preview was run in this authoring session. Owner verification is required.
- Future visual design discussion (Issue #15): layout hierarchy, scalable type, panel priority, consistent shadcn primitives, visual motion language and UI theme.
- Future game-feel work (Issue #16): authoritative impact/hit differentiation, camera effects, sound, wake/weapon feedback, animation settings and low-end performance profiling. Keep effects locally derived and avoid new per-frame DB writes.
