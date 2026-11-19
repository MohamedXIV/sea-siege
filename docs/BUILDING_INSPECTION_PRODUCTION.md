# Building inspection and real Shipyard production

## Owner playtest — 4 Nov 2026

The player could build a Shipyard but couldn't select it to manufacture ships. This was an input selection error, **not** a missing authoritative production system: a mounted Shipyard sits directly on top of four Platform cells. The world click previously scanned `battleStructures.find(...)` in arbitrary table order, so it selected a supporting Platform first and never reached the Shipyard production UI.

## Implemented on this branch

- Pure, deterministic `selectStructureAt` prioritizes **superstructures** (Shipyard, Workshop, Extractor, Cannon) above same-cell Platforms. Still permits selecting free Platforms and any visible enemy building (read-only).
- Selected structure receives an outline. A selected Salvage Extractor shows its real **4.5-cell radius** in Phaser.
- All six building types have descriptive inspectors: purpose, health, construction/connectivity state, and location. Command Core shows Iron trickle, Platforms their support function, Salvage Extractors their actual Iron/advanced throughput limits and in-range nodes, Cannons their range/damage, Workshops their repair tier/radius/refit role and a real tier-upgrade action.
- **Shipyard production controls** now appear when you select an owned Shipyard. Scout/Gunboat/Siege buttons invoke the already-existing **server-authoritative `enqueueShip`** reducer. Real prices, build durations, operation/connection requirements and queue capacity are exposed.
- A new **member-owned-only** SpacetimeDB view `my_production_jobs` discloses the user's own job IDs, Shipyard IDs, hull kinds, remaining duration and start state. Never disclose other factions' production queues.
- The HUD shows actual queue order and progress from scheduled server updates; reports paused/offline and an already completed order waiting for clear launch water. Cancel invokes existing authorized `cancelShipProduction` reducer/refund.
- New pure selection tests and server integration test confirm actual Shipyard start/completion, queue privacy, ownership-protected cancellation/refund, and actual server-launched ship.

## Intentional boundaries

- The Gemini visual/game-feel reference remains canonical for the world and RTS UX; owner's approved Iron/Oil/Alloy/Isotope resource economy and Workshop ship refits remain intact.
- No new ship unit types or simulated client-side ship spawning.
- No Fog of War, and no exposure of private Bot queues or other-match information.
- Detailed attack/repair target interactions and audiovisual combat feedback are follow-up gameplay slices, not fictitiously completed here.

## Windows verification (must run on owner machine)

```powershell
git fetch origin
git switch --track origin/fix/gemini-building-inspector-shipyard-production
npm run db:build
spacetime publish sea-siege-dev --server local --module-path ./spacetimedb
npm run db:generate
npm run db:typecheck
npm run db:test
npm run typecheck
npm run build
npm run test:client
npm run dev
```

Start `spacetime start` in another PowerShell if needed. The **new view requires a non-destructive publish + regenerated bindings**. Do not use `--delete-data`.

### Browser checks

1. Start **Quick Play**, place a Shipyard on a completed **2×2** deck and wait 6 seconds for construction completion. Click directly on the Shipyard art: the inspector must say **Shipyard**, not **Platform**.
2. Click **Scout (70 Iron, 4s)**. Iron falls, live job queue shows it building, then a genuine new Scout appears in clear water. Queue becomes empty. Try Gunboat and Siege with available Iron.
3. Queue several ships, cancel an order and observe the authorized refund; ask another account to inspect the same Shipyard: it can inspect its *public visible structure*, but must never see the owner-only queue or have command buttons.
4. Click any Platform/Workshop/Cannon/Extractor/Command Core to inspect purpose, operational/offline state and HP. Clicking Extractor should draw its collection range circle; Workshop tier upgrade uses its real server reducer.
5. Verify no regressions to box selection/building, HUD click blocking, continuous ocean and existing multi-resource gathering.

**Status:** Authoring-only GitHub PR. No local tests or player browser verification have been executed for this branch. Keep stacked PR Draft, do not merge until owner confirms.
