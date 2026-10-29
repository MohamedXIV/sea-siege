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
