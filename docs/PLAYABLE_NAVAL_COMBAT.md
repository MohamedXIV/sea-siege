# Playable naval combat — Attack Target

## What ships now do

Select one or more owned ships, then **right-click an enemy ship or building**.
Every selected ship receives one **persistent, server-authoritative attack
order**. The server re-evaluates it on the existing 10 Hz combat tick:

1. Read the live target row (never a stale client position).
2. Check weapon range and authoritative terrain line of sight.
3. Out of range: request a throttled A* approach route through the existing
   `dispatchMovement` validator; the motion schedule sails the ship.
4. In range and visible: stop cleanly, aim through `dispatchAim`, and fire once
   through `dispatchFire`. Turret slew, cooldown, range, LOS, projectile cap and
   ownership remain enforced by the existing shared dispatchers.
5. Target destroyed, match ended, Move, Stop, a new Attack, or a harvest order
   clears the order. No client-side damage or fake projectiles exist.

Right-clicking water still issues formation Move orders, right-clicking a
salvage node still harvests or approaches it, and right-clicking a friendly
object is treated as a move. Only hostile entities produce Attack.

## Server design

- `spacetimedb/src/schema.ts` — one private `attack_order` row per `shipId`
  (`matchId`, target type/id, issue time, next chase time).
- `spacetimedb/src/sim/attack-order.ts` — pure approach geometry,
  `planAttackStep` (`cancel` / `chase` / `engage`) and the shared
  `dispatchAttackOrder` authorization used by humans and bots.
- `spacetimedb/src/combat-reducers.ts` — `issueAttackOrder` reducer and the
  attack loop inside `advanceCombat`. It reuses movement, aim and fire
  validators; denied shots simply wait for the next valid tick.
- `spacetimedb/src/combat-views.ts` — member-scoped `my_attack_orders` (own
  ships only) and `my_battle_projectiles` (all projectiles in the caller's
  active matches) for presentation. There is still no Fog of War.
- `spacetimedb/src/bot-simulation.ts` + `sim/bot-policy.ts` — bots emit the same
  attack intent and pass through the same dispatcher; no separate combat rules.
- Cancellation hooks live in `index.ts`, `economy-reducers.ts`,
  `match-reducers.ts` and the destruction helpers.

## Client presentation

- `src/game/input/command-target.ts` — pure right-click priority resolution
  (hostile ship → hostile structure → salvage → water), unit-tested.
- `src/network/spacetime-client.ts` — subscribes to the two new views and
  exposes `issueAttackOrder`.
- `src/game/SeaScene.ts` — red target line/reticle for active orders,
  authoritative projectile interpolation with muzzle flashes, water splashes,
  hit sparks, destruction explosions, damaged HP bars, and success/rejection
  feedback through the existing command dock channel.
- `src/components/GeminiCommandDock.tsx` — shows the current attack target for a
  selected ship or fleet and states that Stop cancels the order.

The Phaser scene still never simulates damage, cooldown, range or targeting.

## Verification actually run

```text
npm run db:build      # success
npm run db:typecheck  # success
npm run db:test       # 57/57 module tests pass
npm run typecheck     # success
npm run build         # success
npm run test:unit     # 164/164 pure tests pass (includes new attack-order/command-target tests)
npm run test:client   # 45/45 pass against a local SpacetimeDB 2.14 server
```

The client suite was run with `spacetime start` plus a fresh local
`sea-siege-dev` publish, so the real reducer/view/subscription path was
exercised. No `--delete-data` or database reset was used.

New focused regressions:

- `spacetimedb/src/index.test.ts`
  - foreign identity cannot command another player's ship;
  - self/friendly/bad-type targets are rejected;
  - Attack replaces harvest/move, one row per ship;
  - Stop and Move cancel the order;
  - in-range orders aim, fire once per cooldown and apply real damage;
  - out-of-range orders chase and re-path after target movement;
  - multiple ships keep independent orders and do not duplicate projectiles;
  - destroying a target clears orders and stops fire;
  - harvesting, ownership and member-scoped combat views still work.
- `tests/attack-order.test.mjs` — pure planning, LOS-blocked approach, clamp,
  dispatcher authorization and side-effect ordering.
- `tests/command-target.test.mjs` — right-click intent priority and friendly
  fall-through.

## Windows Quick Play

```powershell
git fetch origin
git switch --track origin/feat/playable-naval-combat
npm install
npm run db:build
spacetime start          # separate terminal, if not already running
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
npm run db:generate
npm run typecheck
npm run dev
```

The publish is additive/non-destructive and regenerates the two new views.

In the browser:

1. **Quick Play**, let the live match start, then select one owned Scout
   (click it or drag a box over it).
2. Right-click a visible enemy ship. The dock should show
   `Attacking ship #…`, a red line/reticle should connect the ships, the Scout
   should close range if needed, its turret should rotate, and real projectile
   streaks should leave the hull.
3. Observe enemy HP bars and impact flashes; wait for the 950 ms Scout cooldown
   between shots.
4. Right-click water or press **Stop**: the attack line disappears and the ship
   stops. Re-issuing Attack or a harvest order replaces the previous task.
5. Select two or more ships and right-click an enemy: each should receive its
   own order and independently aim/fire.

## Known limitations / next steps

- The attack loop fires from the ship center along the target bearing. It does
  not lead a moving target; projectiles are intentionally frozen at launch
  (existing server rule).
- Approach uses the existing grid A*; very congested formations may require a
  later repath (throttled to one every 600 ms).
- No audio, damage numbers, or per-weapon animation variations yet.
- Attack orders are one target per ship; sequential/queued targets are not
  implemented.
- Browser visual verification is still the owner's manual step; the automated
  suites cover server rules, pure geometry and live client transport.
