# Advanced ship refits — first spendable Oil/Alloy recipes

**Source-of-truth:** the owner wants several viable RTS strategies. Basic ships and structures always remain buyable with Iron, while rare materials open genuinely different options. Hybrids keep gathering and fighting.

## Active refits in this slice

| Optional Workshop purchase | Price | Real effect |
|---|---|---|
| High-Output Engine | 75 Iron + 45 Oil | +20% authoritative ship movement speed along existing A* routes; turn rate and collision rules unchanged |
| Reinforced Hull | 60 Iron + 35 Alloys | +120 real HP and +120 repairable max HP, persists until ship sinks |

These recipes are optional and one-time **per ship**; a ship may equip both. Neither replaces the base hull, and isotope experimental upgrades remain explicitly deferred. The values are initial game-balance proposals, not final.

The player selects a ship **within operating range of an owned completed connected Workshop** and stops it, then chooses a refit in the Tactical Command inspector. The server validates membership, ownership of both ship and Workshop, active match, Workshop operational status, range, ship stopping, recipe and duplicate upgrade. **All debits and the permanent effect happen in one SpacetimeDB transaction.** Failed requests do not charge anything.

- Additive private `ship_refit` table; no change to old `ship` or currency rows.
- Owner-only `my_ship_refits` projection, subscribed by the client.
- Movement scheduler reads real installed engine data and passes a validated multiplier to the pure movement step.
- Reinforced hull HP added on purchase, repair max updated through the existing Workshop repair validator.
- Combat death cleans up refit records and stale advanced material harvest orders.
- UI displays installed state, costs, real affordability and nearby Workshop requirement; it does not synthesize ship stats locally.
- Regression tests cover composite billing, duplicate rejection, owner isolation, repaired upgraded HP, and faster physical server motion.

## Follow-on, NOT implemented here

- Bots **do not yet** strategically gather/consume Oil/Alloys for these upgrades.
- Isotopes currently stockpile; radiothermal/experimental modules need distinct server effects and economy balancing.
- Refining automatic approach-and-harvest and extractor range UI; completing visible combat VFX and match victory.
- Avoid imposing a mandatory tech path. Observe full matches before rebalancing recipes.

## Local Windows test (SpacetimeDB already running)

```powershell
git fetch origin
git switch --track origin/feat/advanced-ship-refits
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

Publish **without `--delete-data`**. Stop and inspect any incompatibility warning. The new server view/reducer requires regeneration. Inspect browser Quick Play: get enough Oil/Alloy, place a Workshop, bring Scout within range and Stop, purchase one refit, verify balance debit and visible effect. Try buying twice and refitting beyond range: server must reject without charge. Basic ships/bots should continue normally. Older matches without material nodes remain compatible but won't be able to earn advanced materials.

**Verification status:** changes and tests authored on GitHub; Windows tests, module publication and gameplay acceptance remain **NOT RUN**. Keep PR Draft and do not merge automatically.
