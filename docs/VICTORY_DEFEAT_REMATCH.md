# Complete Skirmish — Victory / Defeat / Rematch

Owner-approved follow-up to playable naval combat, fixed Cannons and Workshop repairs. Keep the existing Gemini-inspired style and player-controlled resource economy; this is an **end-to-end match loop**, not a HUD redesign.

## Existing canonical rules (unchanged)

- Every match has a **12-minute authoritative server deadline**.
- **Domination:** when exactly one faction retains a living Command Core, that faction wins immediately.
- **Mutual destruction:** when no faction retains a living Command Core, the match is a draw (`winnerSlot=-1`).
- **Time limit:** among surviving Cores, choose the greatest exact integer-fifths Dominance score; tie breaks by ascending slot, as already defined by `resolveMatchOutcome`.
- Existing `match.phase`, `match.winnerSlot`, `match.victoryReason`, `match.winningScore5` and `match.endedAtUs` are **the only authority** for outcome. Clients never choose winners.
- After finishing, match gameplay schedulers and pending attack/projectile actions are stopped by their existing backend rules.

## Implemented in PR #41

### Durable private scoreboard

Add the **private** `match_final_standing` table and member-only `my_completed_standings` view. Both finalization paths — Core destruction (including mutual destruction) and time limit — snapshot **every faction**, human or Bot, once:

- faction slot, Human/Bot type, eliminated status
- surviving Core HP, ship count, building count
- lifetime **Iron** gathered from existing `faction_state.totalSalvageGathered`
- lifetime Oil/Alloy/Isotope gathered across the authenticated match's `material_balance` rows, reported **separately** from Iron scoring
- exact `dominanceScore5` (Original Gemini scoring retained)

Do not compute final scores in React after post-match world views disappear. Older already-finished matches lacking new rows still show the public verified winner/reason and state that detailed stats are unavailable. No destructive migration.

### Player-facing UX

- After a server finish event, a concise overlay shows **Victory / Defeat / Draw**, reason, elapsed match duration, and actual immutable standings for participants.
- In a multi-faction active game, a faction with destroyed Core sees **Eliminated** while the remaining opponents continue. This is **not** announced as a finished match before the server says so.
- Active HUD shows an **approximate display-only countdown** to the 12-minute deadline and indicates Core destruction/time-limit goals. Local clock cannot declare a winner: zero seconds says *Resolving…* until the authoritative server result.
- **Rematch vs AI:** if a completed two-seat match actually had a Bot participant, the action invokes the existing `quickPlay()` workflow to create a **fresh server-owned map, bot, match ID, economy and combat world**, then opens that new battle. Never reset the old finished match.
- **Multiplayer rematch:** a player can create a new lobby using the same slot capacity. Other humans join it voluntarily by its ID (copy button in host lobby); no unauthorized auto-seating or replay of other users' tokens. Host uses the existing Start flow.
- **Return to Deployment:** leaves the results screen for the existing match browser. Old records stay available.

### Scope intentionally NOT changed

No new timer authority, new victory rules, fog, replay system, global player ranking or speculative matchmaking. The multiplayer rematch is **a fresh voluntary lobby**, not an automatic requeue of every previous opponent; bot-specific one-click rematch is immediate. Do not conflate endgame UI with PvP matchmaking.

## Tests authored

- Pure score snapshot + slot result logic, ties/sorting and malformed faction slots in `tests/match-results.test.mjs`.
- Server integration: result snapshot on actual Core defeat, snapshot on scheduled 12-minute deadline matching the winning score, outsider view isolation, Bot vs Human rows, material totals, idempotent repeated deadline call.
- Existing server combat/economy tests must continue to pass. **No tests have been run by this GitHub authoring session.**

## Windows local acceptance

Keep local SpacetimeDB running in another PowerShell (`spacetime start`).

```powershell
git fetch origin
git switch --track origin/feat/victory-defeat-rematch
npm run db:build
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
npm run db:generate
npm run db:typecheck
npm run db:test
npm run typecheck
npm run build
npm run test:unit
npm run test:client
npm run dev
```

**NEVER use `--delete-data`.** This slice adds a private table and a view, so regenerate official bindings. Stop if SpacetimeDB reports an incompatible schema.

### Browser acceptance checklist

1. Start Quick Play, verify **~12:00** countdown, normal fleet commands and intact cannon/workshop/VFX features.
2. Destroy enemy Command Core: server sets `phase=finished`, `winnerSlot`, `victoryReason=domination`; winner sees **VICTORY**, loser **DEFEAT** in a second authenticated client, not generic Deployment.
3. The final standings show correct Human/Bot tags, surviving ships/buildings, Iron and advanced resources gathered, and the server-based time-limit score. Outsiders **cannot** query the scoreboard.
4. Press **Rematch vs AI**, see a **new match ID** and a live new match (old match result preserved). Repeat without creating duplicate bot seats.
5. Create/join a human match, play to deadline or use an internal test harness for the 12-minute boundary; confirm winning Dominance faction and exact same score snapshot; a true tie uses deterministic slot order.
6. Play a four-faction match to eliminate one member while two or more Cores survive: that member sees **ELIMINATED** without incorrectly declaring the overall match over.
7. From a finished human match select **New multiplayer lobby**, share the copied lobby ID and have the other human join voluntarily. Start a new game. The previous finished match remains readable.
8. Reload browser on a finished match: no missing-match crash, results are still rendered from the member-scoped view.

PR must remain Draft until Windows build/tests and browser checks pass; **no merge or destructive resets**.
