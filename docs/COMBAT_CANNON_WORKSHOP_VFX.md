# Combat feel, fixed cannons and Workshop service — playable follow-up

This slice responds directly to owner playtest after Draft PR #39. **Do not redesign the overall HUD yet.** The original Gemini industrial RTS aesthetic remains the art/controls reference, with owner-approved multi-resource hybrid fleets intact.

## What changed

### Real projectile endpoints (server + client)

**Root cause:** Phaser previously spawned a splash at its last *interpolated visual projectile* position when a server projectile row was removed. The sprite could lag well behind the server's swept-hit position, producing a mid-flight splash while true damage correctly landed on the target.

- Private additive `combat_impact` rows store **exact server hit point** or **exact flight range-expiry endpoint**, with match, projectile ID, kind and timestamp.
- `my_battle_impacts` is a member-scoped live view, delivered only for their own active match; no exposed global raw data.
- The existing combat clock retains each event for about **850 ms**, then prunes it and sleeps once no combat, pending events or fixed Cannons remain. Match end clears the transient records.
- Phaser no longer creates a guessed splash on projectile disappearance. It draws `hit` / `splash` at the server-supplied coordinates, once per impact ID, and caps local projectile extrapolation by real remaining range.
- **Damage and collision remain 100% server-authoritative**, with no new client damage guesses. Existing automatic damaged-HP and destruction effects still play.

### Fixed Cannon defense, composed from ships' fire rules

- Completed living fixed Cannons automatically select a nearby hostile ship or structure with deterministic priority and actual `min(range, vision)` + terrain LOS. No Fog of War; ally fire is excluded.
- Both persistent ship Attack and fixed Cannon defense now call the **same authoritative `engageWeapon` adapter**, which calls the existing `dispatchAim` and `dispatchFire`, existing turret cadence, cooldowns, projectile caps, armor and damage. No second attack/physics implementation.
- One shared 10 Hz combat scheduler starts upon real Cannon construction completion; the 1 Hz economy scheduler also wakes it for pre-existing Cannons after additive module publication. The combat scheduler remains awake while any live, completed Cannon exists so it can detect incoming threats, even if no one issues a manual attack.
- Phaser shows the Cannon's real server turret angle as a visibly rotating barrel above its static Gemini pixel-art base; offline/incomplete defenses appear dim.

**Known tradeoff:** idle completed Cannons keep the combat schedule ticking at 10 Hz. Benchmark with large numbers of Cannons later and consider a lower-rate idle detection path if needed. This is one scheduler per match, never one per Cannon.

### Workshop is an actionable repair dock

- The Workshop inspector explains its radius, tiers and actual HP-per-Iron cost.
- Selecting your operational Workshop lists nearby damaged **owned ships and connected structures** with HP, one-transaction restore amount and Iron cost. `Repair` buttons call the **existing authenticated SpacetimeDB `repairShip` and `repairStructure` reducers**.
- Server revalidates ownership, range, online/not-upgrading state, real health, cost and tier. Reinforced Hull installed HP is included. Workshop upgrades and Oil/Alloy refits remain available.
- No invented auto-repair or fake client-side healing; these are manual repair actions.

### Range preview and wakes

- Build ghosts and selected buildings show circles for actual Salvage Extractor (4.5 cells), Workshop (4.5/6/8 by tier), and Defense Cannon (8.5 cells). Valid and invalid previews use the same real rule values.
- Moving vessels now render dynamic lightweight foam wake ribbons behind their actual interpolated movement velocity, with length/opacity tied to speed and a small visual phase. No network VFX state, no per-frame DB writes; wakes disappear on stop.

## Verification added, but NOT EXECUTED on owner machine yet

- `spacetimedb/src/index.test.ts`: exact swept collision point in member-scoped impact view, real cannon automatically firing using the shared scheduler, actual Cannon construction arming the combat clock, transient impact expiry, and previous tests updated for intentional short-lived impacts.
- `tests/cannon-vfx-range.test.mjs`: deterministic hostile targeting/LOS/ties, building radius rules, and procedural wakes stopping/direction.

### Windows local validation

Keep `spacetime start` running in another PowerShell.

```powershell
git fetch origin
git switch --track origin/fix/cannon-workshop-ranges-combat-vfx
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

**NEVER use `--delete-data`.** The new impact table/view requires module publication and regenerated bindings. If publish rejects the schema, stop and inspect the error instead of resetting data.

### In-game acceptance checklist

1. **Bullet VFX:** Fire Scout/Gunboat/Siege at enemy ships and structures; impacts/splashes should occur on the **actual impact/water endpoint**, not midway. Check missed shots too.
2. **Cannon:** Build one on connected completed Platforms, wait 4 seconds for completion, and bring a hostile ship within 8.5 cells. The barrel should rotate and fire without an explicit player Attack order. See real enemy HP loss and cooldown. Disconnect the Cannon and confirm it stops firing; reconnect support to resume.
3. **Workshop:** Build a connected Workshop, damage an allied ship or building, bring it inside Workshop radius, inspect the Workshop and click `Repair`; verify exact Iron debit and authentic HP restoration. Verify offline/upgrading Workshop blocks repair.
4. **Build Preview:** Pick Cannon, Extractor and Workshop; each shows its actual radius around the ghost before placement. Selected completed Workshop reflects its upgraded tier.
5. **Wake:** Sail and turn Scout/Gunboat/Siege; wake appears behind motion, follows turns, and disappears after stopping.
6. Confirm old Shipyard queue, mobile hybrid harvesting, advanced refits, and the persistent ship Attack orders still work.

**Status:** GitHub-only source authoring and test additions. Not yet run locally/browser-verified; no branch merge or production DB deployment.
