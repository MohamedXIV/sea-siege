# Sea Siege — Foundation development guide

> This branch contains **source code only**. No successful build/publish or two-browser integration result is claimed. The current VM cannot reach npm/SpacetimeDB downloads, so validation requires a network-enabled environment. Cloud account credentials are **not** needed for local development.

## Stack
- Vite + TypeScript + React 19, Tailwind v4 + shadcn/ui component source code.
- Phaser 4 real Scene in a React-managed mount (only a decorative water grid for now).
- A separate **real SpacetimeDB 2.x TypeScript module** in `spacetimedb/src/index.ts`, using `spacetimedb/server` (schema, reducers, caller identity, private tables and per-identity views). **No pseudo-server runs in the browser**.

## Client setup

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Client UI explicitly says **Backend not connected**. That is intentional: generated bindings do not exist before CLI generation and no network subscription has yet been implemented. The visual foundation must not imply Quick Play or multiplayer is functional.

## SpacetimeDB local build/publish (follow current 2.x CLI)

With a network-enabled environment and the official `spacetime` CLI installed:

```bash
cd spacetimedb && npm install && cd ..
spacetime start                 # keep this running in another terminal
spacetime build --module-path ./spacetimedb
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
spacetime generate --lang typescript --module-path ./spacetimedb --out-dir ./src/module_bindings
```

Once the module actually builds, the next change (#3/#4) must import those **generated** bindings, connect with `DbConnection.builder()`, subscribe to `match`, `my_ships`, `my_memberships`, send reducer commands and display the **real** status. Nothing in this branch is a substitute for that integration.

## Security gates before multiplayer
- `ship` and `match_member` are **private**. Do not mark them public just to make prototyping easier.
- Views presently reveal only caller-owned ships and memberships, not enemies; future fog-of-war requires server-side authorized visibility (#13).
- The private match's public lobby metadata contains no hidden ship coordinates.
- Current reducer rules only prove basic caller ownership and 2–8 slot creation; combat, scheduled movement and game lifecycle remain future tasks.
- `issueShipOrder` stores a destination on the real server; it intentionally **does not move** the ship. Navigation and the simulation cadence come from #10 and ADR-0001.

## Testing policy
Prefer frequent inexpensive static/unit checks as features land; defer actual Cloud deployment and end-to-end multiplayer tests until we have a complete integration slice. Do not mark #2/#3/#4 as passing without executed typecheck/build/module publish and two independent browser sessions.

References: [official TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/), [table visibility](https://spacetimedb.com/docs/tables/access-permissions/), [React/Vite shadcn setup](https://ui.shadcn.com/docs/installation/vite/), [ADR-0001](adr/0001-multiplayer-motion-tickrate.md).

## World and navigation development status

The pure, tested world and navigation modules live in `spacetimedb/src/sim/`:

- `worldgen.ts`: Mulberry32 procedural layout and 16×16 terrain chunks, safe 2–8 slot starts and salvage nodes.
- `navigation.ts`: terrain reassembly and bounded deterministic A* (no diagonal corner cutting; accepts future dynamic occupancy callbacks).
- `index.ts`: server-only, transactionally persisted world state and authoritative ship order path validation.

Local tests:
```bash
npm run test:unit
# OR without dependencies in Node 22:
node --experimental-strip-types --test tests/*.test.mjs
```

The `ship_route` table stores the ordered grid cells for a move; **nothing advances the cursor/ship position yet**. Scheduled steering, collision with dynamic buildings and ship-specific radius constraints belong to #10. Visibility-aware views are mandatory before publishing hidden chunks or resource data to any clients (#13). The match seed is now server generated (not a `createMatch` input).

## Authoritative ship movement — scheduled reducer slice (#10)

- The private `ship_route` table holds the A* cell path/cursor and order revision. Only the authenticated ship owner may issue a path or `stopShip` command.
- `issueShipOrder` starts **one private `motion_schedule` timer per moving match**, using the official `ScheduleAt.interval(100_000n)` / `onSchedule` API. A stopped or completed match naturally drops the timer once there are no active routes. Idle matches do not consume 10 reducer transactions per second.
- `advanceMatchSimulation` explicitly rejects calls lacking `ctx.senderAuth.isInternal`; clients cannot force simulation ticks. The reducer steps all active routes, persists authoritative movement samples and velocities with `ctx.timestamp`, then deletes completed routes/timers.
- The pure `ship-motion.ts` uses 2 cells/sec, a 150°/sec hull-turn cap, and max 250ms elapsed-time catch-up per invocation, with headings stored in degrees. These values live in `SHIP_MOTION_RULES` and are **tuning defaults**, not guaranteed platform tickrates.
- Client rendering **does not set or own server positions**. The Phaser interpolation adapter in #5/#19 will read authorized ship snapshots from generated bindings. Scheduled frequency, subscription row-change frequency and Phaser FPS are separate (ADR-0001).
- No full ship sizes, fleet formation, dynamic building collision, fog-aware subscriptions or true sailing physics yet. Please do not characterize this as full naval movement or a multiplayer-ready implementation.

Pure TS smoke verification (no SpacetimeDB dependencies):
```bash
node --experimental-strip-types --test tests/ship-motion.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  spacetimedb/src/sim/ship-motion.ts
```

Real datastore/scheduler acceptance tests were prepared in `spacetimedb/src/index.test.ts`, but **remain unexecuted** until the actual SpacetimeDB module packages/runtime can run. The test harness invokes scheduled reducers as `TestAuth.internal()`; it does not run a wall-clock scheduler. It cannot prove deployment/subscriptions or security on a real server.
