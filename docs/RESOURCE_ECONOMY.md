# Sea Siege — Typed Resource Economy

> **Owner direction, 4 Nov 2026:** The primary game is a resource-control naval RTS in a drowned post-apocalyptic scrappunk world. **Both station-based extraction and hybrid combat/harvesting fleets must remain viable**. Avoid one forced opening/build order. Entire battlefield and deposits are visible (no Fog of War). The archived Gemini game remains the art/map feel reference, **not a restriction against this approved new resource depth**.

## Material catalogue (initial tunable proposal)

| Key | Visible name | Geography and use | Initial implementation |
|---|---|---|---|
| `iron` | Iron Scrap | Common, 2 existing nearby salvage deposits per faction. Basic platforms, shipyards, cannons and all base ships | **Backed by existing `faction_state.salvage` and `salvage_node` during migration.** No destructive field rename. |
| `oil` | Recovered Oil | One additional 12-cell-ish deposit per spawn, beyond early Iron. Future engine/advanced weapon recipes | New seeded, finite `material_node`; independently owned `material_balance` |
| `alloy` | Pre-Collapse Alloys | Scarce centrally contested deposits. Future reinforced hull and heavy infrastructure choices | New finite material node and balance |
| `isotope` | Radioisotopes | One especially rare center prize. Future optional experimental power/weapons | New finite material node and balance |

Avoid giving rare-resource owners an automatic victory. Every faction can always build and fight using common Iron, while advanced resources create **different options** (not a compulsory linear tech ladder). These material names, quantities, recipes and rates are tunable — not final balance.

## Phase 1 — implemented on `feat/material-economy-first-slice`

- Add **private** `material_node`, `material_balance` and `material_harvest_order` tables. Existing tables are retained; no reset or bulk rewrite of existing match rows.
- New matches deterministically generate advanced deposits from their existing authenticated Gemini map seed; never overwrite original Iron cells or bases.
- Every real human and bot seat receives a separate typed wallet; deleting an unstarted bot cleans up its balance rows.
- Authorized match members see **all** material deposit coordinates/quantities; only an actual human owner sees their own advanced balances.
- Connected `salvage_rig` Extractors draw from **multiple** material nodes inside existing 4.5-cell range, up to **8 total per second**, up to **4 per source per second**. Extraction shares live, finite node stock across rigs and ships. Older legacy Iron income rules still run during migration.
- Scout and Gunboat remain **combat-harvest hybrids**. `orderMaterialHarvest` validates own ship, active match, range and line of sight; ship collects at half its current Iron harvesting throughput. Siege remains specialized unless separately approved. Starting movement or Stop cancels material harvest, and starting a legacy Iron harvest cancels material harvest; never two resource debits from one vessel.
- HUD inventories and minimap/battlefield markers show actual material balances and deposits. Ship inspector can choose a material and approach/harvest it, using server reducers. At this phase the player needs to press the harvest command again after arrival at a distant node, like the existing Iron control.
- Pure data-driven `RESOURCE_RECIPES` includes **proposed** reinforced hull, engine and experimental power combinations, with validated credit/debit helpers. **These upgrade recipes are not yet purchasable/active**.

## Phase 2 — next coherent vertical slice (not implemented yet)

1. Make **Iron** the explicit first-class material currency in all reducers and UI, preserving/migrating current `salvage` balances safely.
2. Add meaningful, server-validated **multi-material production/upgrade consumers**; tune direct hull/engine/armor effects and refund paths, including bot policy and UI affordability.
3. Improve mobile gathering to approach, arrive and gather automatically with one authoritative mission, rather than needing a second button click.
4. Optimize/balance extractor specialization and multi-node allocation; show range circles, rate projections and depletion warnings, not just a numerical ledger.
5. Update bots to value Oil/Alloy/Isotopes, choose between stationary expansion and hybrid naval gathering/raiding, and actually purchase advanced upgrades; ensure no deterministic single winning build path.
6. Play-test two honest players or a human vs active bot in a full skirmish before adjusting map scarcity and yields.

## Compatibility and verification

**Additive module migration:** existing `faction_state.salvage`, `salvage_node`, structure, ship and match schemas are left unchanged. Older matches simply lack the newly generated advanced nodes and remain playable. All new types are server-owned/private. This PR adds views and a reducer, so the official generated TypeScript client bindings **must be regenerated** after non-destructive publish.

On Windows, with `spacetime start` in a separate PowerShell:

```powershell
git fetch origin
git switch --track origin/feat/material-economy-first-slice
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

**Never use `--delete-data`.** If pre-publish rejects the schema, stop and inspect exact error; do not wipe the database.

**Browser acceptance:** new Quick Play shows Iron/Oil/Alloy/Isotope, finds all colored nodes on map/minimap, advances owned Scout/Gunboat toward Oil and successfully extracts it, increases owned balance and lowers node stock, and allows normal fleet movement/combat afterward. Place a connected Extractor within range of Oil/Alloy and observe actual split income and depletion. The opponent still operates and cannot access your private wallet. Typecheck/DB tests plus live browser proof are both required before merging.

**Status:** Source changes and regression tests authored on GitHub; **not yet executed locally** and no merge authorized.
