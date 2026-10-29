# ADR-0001 — Server-authoritative motion with smooth Phaser rendering

- **Status:** Accepted as a design direction; **rates and thresholds are provisional until measured**.
- **Date:** 2026-10-29
- **Owner:** Sea Siege engineering
- **Implements:** [#19 — Ship motion smoothing & benchmarks](https://github.com/MohamedXIV/sea-siege/issues/19)
- **Related:** [#3 SpacetimeDB module](https://github.com/MohamedXIV/sea-siege/issues/3), [#5 Phaser scene](https://github.com/MohamedXIV/sea-siege/issues/5), [#6 quality gates](https://github.com/MohamedXIV/sea-siege/issues/6), [#10 naval orders](https://github.com/MohamedXIV/sea-siege/issues/10), [#11 combat](https://github.com/MohamedXIV/sea-siege/issues/11), [#17 E2E/perf](https://github.com/MohamedXIV/sea-siege/issues/17)
- **Scope:** Browser-based top-down naval RTS (2–8 factions) using **real SpacetimeDB** for authoritative simulation, **Phaser 4** for rendering.

## Context

An earlier Sea Siege/SpacetimeDB experiment visibly **jumped ships from one received position to the next**. The likely immediate cause is applying subscribed coordinates directly to sprites. This is a presentation problem and, on its own, does **not** establish a hard SpacetimeDB tickrate limit.

The server must remain authoritative for movement, steering, collision, firing, damage, ownership, resource changes and victory. Ships are slow/inertial enough that smooth client reconstruction is feasible without sending their rendered coordinates 60 times per second.

### Three independent rates (do not conflate)

1. **Server simulation frequency:** how often authoritative movement/collisions are evaluated (scheduled reducer or equivalent server workflow). Suggested initial **10–20 Hz**, subject to measurement; also test **5 Hz**.
2. **Published motion-state / observable subscription updates:** how frequently changed motion rows/projections actually reach clients. An initial **5–10 observable updates/sec** is an experiment, **not a guaranteed SpacetimeDB setting**. Subscriptions automatically replicate matching row changes; reducing outgoing motion update frequency requires deliberately choosing which authoritative state to materialize/publish, or expressing suitable movement as timestamped trajectory parameters. It is **not** achieved by simply setting Phaser FPS or a hypothetical subscription throttle.
3. **Client visual frame rate:** Phaser scene update/render loop, **60 FPS target** on capable machines (with adaptive performance). It does not write each frame to SpacetimeDB.

These rates may legitimately differ. Run real benchmarks to choose actual values.

## Decision

Build a reusable **ShipMotionPresentationSystem** (testable separately from Phaser) between generated SpacetimeDB bindings and the Phaser 4 ship views. **Never position a visible ship directly on every subscribed row update.**

### Authoritative contract

Design a small, typed motion representation sufficient to reconstruct state:

| Field / concept | Purpose |
|---|---|
| `matchId`, `shipId`, `factionId` | Scope and stable entity identity |
| `x`, `y` | Authoritative sample position |
| `vx`, `vy` or speed/heading | First-order motion estimate |
| `hullAngle`, `turretAngle` (+ turn-rate if useful) | Independent orientations |
| `serverTime` or tick + authoritative time mapping | Sample timestamp, not client receipt time |
| `motionRevision` / order sequence | Detect direction/path/ownership/teleport changes |
| `status` (spawn, normal, stop, removed) | Reset or transition presentation appropriately |

This is a conceptual schema, **not a mandate to create a high-write-per-frame public table**. Select storage/projection details after verifying the actual SpacetimeDB TypeScript API and visibility model. Preserve server-only sensitive state; do not publish unseen enemies because a smoother needs motion data.

### Presentation pipeline

```text
SpacetimeDB authoritative commands + simulation
    └── changed, authorized motion state and timestamps
          └── official generated TS bindings / subscriptions
                └── per-entity bounded snapshot buffer + clock estimator
                      └── interpolate at estimatedServerNow - renderDelay
                            └── bounded extrapolation only for brief gaps
                                  └── Phaser 4 sprites / hull and turret rotations
```

1. **Receive**: on insert/update, capture an immutable motion snapshot with authoritative timestamp and revision into a small bounded buffer ordered by server time (deduplicate stale/reordered rows). Callback updates data **only**, not sprites.
2. **Clock alignment**: maintain an estimated server-now using authoritative timestamps and observed timing/RTT where available. Use a monotonic client clock for elapsed time; handle drift, tab suspension and reconnection. Never assume local `Date.now()` equals the server's clock.
3. **Buffered interpolation**: for remote ships render at `estimatedServerNow - interpolationDelay` between snapshots `A`, `B` whose server times enclose the target render time. Use time-normalized interpolation `alpha = (targetTime - A.t) / (B.t - A.t)`; account for variable spacing and `B.t === A.t`.
4. **Angles**: interpolate hull/turret through the **shortest angular arc**, not naive linear degrees. Example: 359° to 1° should rotate ~2°, not 358° backward. A more advanced curve is optional only if measured visibly better.
5. **Brief update gaps**: if `B` has not arrived, use last known velocity/heading for **strictly bounded** dead reckoning (illustrative cap: 100–200 ms; tune with data); avoid extrapolating through impassable terrain or beyond plausible turn/acceleration constraints. Optionally hold/fade when confidence expires.
6. **Authoritative correction**: converge visual state smoothly toward new authoritative samples when small. Snap immediately when error is large, the simulation announces teleport/respawn, the ship was unknown/hidden, or a correction would otherwise cross obstacles. No visual smoothing may alter authoritative collision/combat.
7. **Lifecycle**: reset/flush on spawn, despawn, fog-of-war reveal/hide, match change, identity/faction control transfer, order discontinuities and reconnect. In particular, if a ship disappears from an **authorized** subscription due to fog, do not keep rendering/extrapolating its last known movement as current intel.
8. **Local orders**: show immediate click/path/order-ack UI feedback; don't claim a ship has moved or hit before the server approves. Full client prediction of owned units is **optional, deferred** until input latency proves problematic.

### What NOT to do

```ts
// Bad: makes the ship jump whenever a row change arrives
shipRow.onUpdate((newRow) => sprite.setPosition(newRow.x, newRow.y));
```

The callback should update the snapshot buffer; Phaser obtains current **presentation** state per frame. The exact API registration depends on generated bindings.

### Other moving/animated elements

| Element | Responsibility / rendering approach |
|---|---|
| Ship hull movement | Buffered interpolation + brief, bounded dead reckoning |
| Ship hull rotation | Shortest-arc orientation interpolation; steering rules stay on server |
| Turret rotation | Independent orientation presentation; server validates aim/fire |
| Projectiles | Timestamped launch + trajectory for **visual** position; server evaluates impact/collision and damage. Do not guarantee a hit solely by target ID. |
| Ship wakes, splashes, rain, ocean shader | Local Phaser/GPU effects triggered by visible authoritative events; no per-ripple replication |
| Construction/production timers | Server-authoritative start/end times; client derives smooth progress UI |
| Bots | Server-owned decisions at strategic intervals, no fake bot client connections |

## Initial experiments and tunables

All values below are **starting hypotheses**, not documented SpacetimeDB hard limits or performance promises.

| Dimension | Test candidates |
|---|---|
| Server movement evaluation | **5 / 10 / 20 Hz** |
| Published/observed ship state | Measure actual row updates; try **5 / 10 Hz** projections if beneficial |
| Phaser frame target | 60 FPS |
| Interpolation render delay | **100 / 150 / 200 / 250 ms** |
| No-update extrapolation cap | Start with **100 / 150 / 200 ms** |
| Fleet count | **20 and 50** moving ships, then scale in 2–8 faction matches |
| Network conditions | Local baseline; 50/100ms artificial jitter, delayed/missing updates, reconnect, tab suspension |
| Scenarios | Straight cruise; accel/decel; sharp turn; stop/start; clustered fleets; obstacles; enemy reveal/hide; high action combat |

**Caution:** SpacetimeDB uses a reliable realtime transport; simulated missing snapshots or temporarily disconnected clients represent observable gaps in state delivery, not an assertion of UDP-like packet loss.

Collect evidence: observed tick interval and reducer work duration/overruns; subscription update intervals, counts and bytes/sec; client FPS and p95/p99 frame-time; position/angle error against server truth; visual snaps/corrections; battery/CPU if mobile targets; time-to-recover after reconnection.

Choose defaults based on the trade-off of **smoothness, added viewing delay, gameplay feel, bandwidth, server work and correctness**. Quality should gracefully degrade if arrivals are irregular.

## Invariants and acceptance gates

- State changes, collisions, combat and victory are **never** decided by interpolation.
- No ship-position database writes for each rendered frame; avoid unnecessary writes for unchanged motion.
- Two independently connected browsers see a coherent shared movement state; FPS can differ without divergence.
- Unauthorized, unseen enemy motion data is not exposed merely to enable rendering (see #13).
- Idle/active ships, teleports, fog transitions, reconnect and late joins reconstruct correctly.
- Unit tests cover duplicate/stale snapshots, jitter, clock offset/drift, 359°→1° angle, extrapolation caps, corrections and lifecycle reset.
- Benchmarks in #19 and #17 record **real measurements**, not assumed 60 FPS or 20Hz performance.

## Dependencies / sequencing

- **P0 (#3, #5):** introduce the typed motion timestamps/sequence and a **minimal** buffer-based Phaser adapter with a real subscription and basic interpolation. The proof-of-stack must not depend on building the fully tuned smoothing layer.
- **P1 (#10):** implement real authoritative navigation, orders and independent rotations, exposing useful motion-state changes.
- **P1 (#19):** harden the presentation system, gap/reconnect/fog behavior and benchmark candidates. This closes the quality gap seen in the earlier implementation.
- **P1/P2 (#11, #16):** visual projectile trajectories and local wakes/effects driven by authoritative events. No rendered-frame replication.
- **P3 (#17):** integrate the same test matrix into the genuine browser/SpacetimeDB release gate.

## Official technical references

- [SpacetimeDB schedule tables / scheduled reducers](https://spacetimedb.com/docs/tables/schedule-tables/)
- [SpacetimeDB subscriptions and local cache](https://spacetimedb.com/docs/clients/subscriptions/)
- [SpacetimeDB TypeScript client reference and reconnect behavior](https://spacetimedb.com/docs/clients/typescript/)
- [SpacetimeDB reducer context timestamps](https://spacetimedb.com/docs/functions/reducers/reducer-context/)
- [Phaser 4 documentation](https://docs.phaser.io/)

These document SpacetimeDB scheduling, replication and client callbacks; the proposed 5/10/20Hz matrix and interpolation buffer are **our design choices to verify**, not promises made by the providers.

## Non-goals

No lockstep RTS architecture, custom network transport, speculative client combat, per-ripple replication, 60Hz server writes per ship, blanket increase of scheduled reducer frequency, or premature optimization based on a synthetic benchmark alone.
