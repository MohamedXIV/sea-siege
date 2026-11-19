# Strategic Bot Economy — first Oil/Alloy and Workshop Refit Slice

**Gameplay baseline:** the approved Sea Siege direction is Gemini-inspired open-battlefield RTS, now expanded to four material families, genuine hybrid harvesting/combat ships, and optional ship specialization. No Fog of War for anyone. Server authority remains mandatory.

## Previous gap

Existing Bots had a real match-level scheduler, production, platform expansion, Iron harvesting and combat intents, but considered ONLY Iron deposits. They did not collect Oil/Alloys or equip an engine/hull upgrade. Their old local sensor filtering also denied them public information that real players already have under the **No Fog of War** design.

## This slice: intentionally bounded strategic choices

- Bot policy receives **public enemy locations and public Iron/Oil/Alloy/Isotope deposit positions only for its match**, plus own Iron/advanced balances, own idle ships, structures and current refit state. No opposing private wallets, production orders, route commands or client identity spoofing.
- Scouts and Gunboats may **fight and mine**. Bots consider nearest Oil and Alloys when they have enough Iron reserve; they keep the old Iron choice when Iron is scarce. Isotope is intentionally not prioritized until a genuine spendable gameplay module exists.
- When a wallet has enough Oil for an engine or Alloys for a hull, a Bot can stop that material extraction task and switch to another resource, rather than mining one node indefinitely. Stable node-ID ordering prevents replay-permutation differences.
- Bots can construct a **Workshop** from normal validated 2x2 supported platforms once advanced gathering becomes relevant. A complete, connected Workshop and stationary own ship within the true tier radius can produce an optional High-Output Engine or Reinforced Hull refit.
- Refits cost **the SAME 75 Iron + 45 Oil / 60 Iron + 35 Alloys** as humans. Their real movement and HP effects already run in the server. A purchase credits nothing, debits the real faction ledgers and inserts/updates the same persistent refit table within one SpacetimeDB transaction.
- **Shared physical dispatch and validation:** `dispatchMaterialHarvest` handles both human and Bot assignments, replacing conflicting routes, Iron orders and attack orders. `validateRefitStation` handles human/Bot Workshop ownership, power, range, stopping and hull validity. `purchaseShipRefit` remains the single pricing/effect rule.
- Human and Bot must satisfy the same terrain LOS when actually harvesting Iron or advanced materials. Public information allows long-range goals, not shooting or harvesting through terrain.
- Existing difficulty limits remain: decisions every **4s Easy / 2s Normal / 1s Hard** with **max 1/2/3 strategic orders** per decision. One 1Hz scheduled reducer remains shared by all Bots in a match. No extra sockets or fake clients.
- Bot policies remain deterministic from server-owned seeds and stable input order; no speculative persistent global intelligence/behavior trees.

## No new DB schema

This branch changes policy, dispatch and server simulation only. The client generated bindings remain the same as PR #41. A **non-destructive** server publish is still necessary for live behavior changes.

## Tests authored, NOT EXECUTED yet

- `tests/bot-material-strategy.test.mjs`: Oil collection, Alloy switch, releasing fulfilled goals, bounded optional refit purchase, no-Fog public contacts, zero unauthorized side effects, common Workshop checks.
- `spacetimedb/src/index.test.ts`: an actual server-owned Bot starts extracting a finite Oil deposit, receives **7 Oil** from the real economy tick, and creates no extra member/socket; another Bot spends real Oil/Iron on the Engine and Alloys/Iron on the Hull at an operational Workshop.
- Existing bot policy, ownership, multiplayer, economy and refit tests must continue to pass.

## Windows local verification

Keep SpacetimeDB running in another PowerShell (`spacetime start`).

```powershell
git fetch origin
git switch --track origin/feat/bot-material-strategy-refits
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

**Do not use `--delete-data`.** If publish detects a breaking schema update inherited from an earlier stacked PR, stop and inspect instead of resetting. This particular Bot slice introduces no new tables/views.

### Manual acceptance

1. New Quick Play: Bot produces real units/buildings and moves a harvesting-capable ship toward Oil or Alloys, gathering actual wallet amounts via scheduled ticks. Keep Scout/Gunboat weapon interactions working.
2. Watch a Bot with enough advanced stock construct a valid connected Workshop and (when a ship is available in range) install Engine/Hull with **real** resource debits; no extra bot client.
3. Observe a Bot switch away from an Oil deposit after reaching the engine goal instead of camping forever. Iron-only production must remain valid.
4. Test low Iron: the Bot should continue Iron gathering/production rather than waste all decisions on distant materials.
5. Match completion, Victory/Defeat/Rematch, multi-resource extraction, Shipyard, Cannons and Workshop controls still work. One human vs up to 7 Bots is available as a lobby setup but dense-match performance needs measuring.

### Limitations / follow-up

This is a **first strategy slice**, not a complete tactical opponent:
- Bots do not yet explicitly route distant mining ships back to a Workshop for refitting. They purchase refits when an actual stationary owned ship is in range.
- No sophisticated contested-resource territory planning, utility-based fleet composition, or upgrade timing beyond rules above.
- Isotope reactors remain unimplemented; no fake Isotope spend.
- No verified Bot-only full headless game or complete 1-human/7-Bot endurance benchmark. Keep Issue #12 open.
- Pathfinding to very distant deposits and overproduction of Platforms/Cannons need observation and tuning using real matches. A stale invalid path returns no action, never free movement.

**Draft-only work:** code and tests authored on GitHub, not executed locally or browser-verified, no PR merges.
