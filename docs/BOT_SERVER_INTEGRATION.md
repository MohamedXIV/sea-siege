# Server-Owned Bots — Integration Contract (draft, 29 October 2026)

Status: **pure policy and pure sensor filter implemented and tested; no playable bot factions yet**.
Related: #12 (bots), #13 (fog), #8/#9/#10/#11 (authoritative action rules), Draft PR #20.

## What is implemented today

- `spacetimedb/src/sim/bot-policy.ts` exposes `decideBot(observation, difficulty)`.
  It returns at most 1/2/3 intents on a strategic 4s/2s/1s interval for easy/normal/hard.
  Difficulty changes policy parameters, **not resource amounts, unit statistics, or vision cheats**.
- Supported initial intents: `aim`, `fire`, `harvest`, `move`, `build`, and `enqueue`.
  All are *suggestions*, not trusted mutations or guaranteed-valid actions.
- `spacetimedb/src/sim/bot-perception.ts` exposes `detectBotEnemies`.
  The caller provides **server-owned** sensors, enemy candidates, static terrain and a server timestamp.
  The helper returns only live foreign contacts passing range + terrain LoS, with a stable order.
- The policy reads only the explicitly supplied **visible enemies**, **discovered deposits**,
  **server-vetted legal build candidates** and **authorized exploration frontiers**.
  It never queries SpacetimeDB, uses a browser/websocket, or reads hidden world chunks.
- Pure tests check stable determinism under reordered inputs, bounded work, stale intel denial,
  anti-overdraft reservation, class-based tactical reactions, sensing, occlusion, and no sensors.
  They **do not** constitute a headless match simulation.

## Ownership migration required BEFORE bot commands are connected

The current live module schema has `ship.owner: Identity` and a `match_member.identity`
for every playing seat. This is suitable for humans, **not** bot-only seats. Assigning
host identity to bot ships would falsely make those ships player-owned and could allow
the host to control them; inventing fake bot identities would also violate #12.

1. Introduce a canonical *match-scoped faction slot* on ships (`ownerSlot`),
   or equivalent authoritative faction membership. Structures already use `ownerSlot`.
2. Store human account ownership separately from server-owned bot controllers:
   a human seat has its real `Identity`; a bot seat has a server-owned bot controller row
   and **no user Identity**. Do not repurpose the host's Identity as a bot owner.
3. Refactor **every** human reducer (move/stop/aim/fire/harvest/build/demolish/repair/
   upgrade/queue/cancel) to resolve `ctx.sender` to a human seat and validate its
   faction slot, rather than allowing a matching `ship.owner` as sole authority.
4. Refactor combat faction lookup and economy/production/score aggregation to use the
   canonical slot, without `Identity` lookups for bot-owned vessels. Migration must
   include all inserts, destructors, tests, spawned ships and victory counting.
5. Only then create `bot_faction` rows with stored difficulty, deterministic seed,
   next decision time, observation/discovery state and no client ownership.
6. A **single bounded per-match strategic scheduler** should process due bots in slot
   order. The server constructs the observation (never passing all enemies to policy),
   gets bounded intents and applies them through the **same reusable authoritative
   validators** used by human reducers. Do **not** have a scheduled reducer pretend
   to be a player, forge a connection, or directly bypass ownership/placement/combat.
7. The server must revalidate every proposed action (terrain path, range, cooldown,
   costs, completed structures, actual visibility, congestion, match phase and deadline).
   Rejected proposals must be safe no-ops or explicit logged outcomes, not rollbacks
   of other bots' successful commands in the strategic batch.
8. **Bot-only headless matches** need internal/test-authorized match initialization
   without any player-controlled slot, no browser connections, and deterministic
   final match digest at seed/time cutoff. The current public `createMatch` creates a
   human host, so it cannot represent a bot-only match as-is.

## Required tests before claiming Issue #12 is complete

- One human + seven independent server-owned bots; zero extra socket connections.
- Bot-only headless full match reaches a deterministic result/deadline; same seed gives
  identical ordered digest, regardless of table iteration order and reconnects.
- Unauthorized human attempts to control bot units, claim bot resources or read bot
  private plan rows fail; unknown/spectator identities get no access.
- Bots only act on server-visible enemies and actually discovered nodes/frontiers;
  obscured/out-of-range enemy positions cannot influence actions. Run real #13
  negative subscription and reducer probes.
- Concurrent build/queue intents remain cost-correct and occupancy-safe; bots obey
  normal cooldown, pathfinding and collision rules.
- Profile 2–8 seats, strategic transaction budgets and 12-minute completion in an
  actual SpacetimeDB runtime. Save GitHub Actions minutes; prefer local execution.

## Explicit boundaries

No `bot_faction` table, scheduler, real bot command adapter, bot-only match runner or
identity-to-faction migration is merged by this slice. Private tables and server-side
intent signatures are **not** proof of fog security or actual playability. The new policy's
difficulty/priority choices are initial tuning defaults. No UI or HUD work begins before
the owner reviews its visual direction (Issue #15).
