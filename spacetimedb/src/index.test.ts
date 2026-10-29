import { expect, it } from "vitest";
import { ConnectionId, TimeDuration } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, * as moduleExports from "./index";
import { generateDeterministicWorld } from "./sim/worldgen.ts";

const auth = (subject: string, connectionId: bigint) =>
  TestAuth.fromJwtPayload(
    JSON.stringify({ iss: "https://test.sea-siege.invalid", sub: subject }),
    new ConnectionId(connectionId)
  );

it("accepts only 2-8 slots and rolls back invalid creation", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  expect(() => test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 1 })))
    .toThrow("2–8");
  expect(test.db.match.count()).toBe(0n);

  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  expect(test.db.match.count()).toBe(1n);
  expect(test.db.ship.count()).toBe(1n);
  expect(test.db.worldChunk.count()).toBe(16n); // 56 cells => 4x4 chunks
  expect(test.db.worldSpawn.count()).toBe(2n);
  expect(test.db.salvageNode.count()).toBe(8n);
  const match = [...test.db.match.iter()][0]!;
  expect(Object.prototype.hasOwnProperty.call(match, "seed")).toBe(false);
  expect(test.db.worldConfig.matchId.find(match.id)?.mapCells).toBe(56);
});

it("prevents guest start and unauthorized ship orders", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);

  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  const ownShip = [...test.db.ship.iter()][0]!;

  expect(() => test.withReducerTx(bob, ctx => moduleExports.startMatch(ctx, { matchId })))
    .toThrow("Only the host");
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(() => test.withReducerTx(bob, ctx => moduleExports.issueShipOrder(ctx, { shipId: ownShip.id, targetX: 32, targetY: 30 })))
    .toThrow("Cannot command another");
  expect(() => test.withReducerTx(alice, ctx => moduleExports.issueShipOrder(ctx, { shipId: ownShip.id, targetX: -5, targetY: 30 })))
    .toThrow("out of bounds");

  // Other players now count as navigational hull blockers: pick a clear cell
  // next to the host's protected 3x3 spawn instead of targeting the guest hull.
  test.withReducerTx(alice, ctx => moduleExports.issueShipOrder(ctx, {
    shipId: ownShip.id, targetX: ownShip.x + 1, targetY: ownShip.y,
  }));
  expect(test.db.ship.id.find(ownShip.id)?.targetX).toBe(ownShip.x + 1);
  expect(test.db.shipRoute.shipId.find(ownShip.id)?.cellPath.length).toBeGreaterThan(0);
});

it("identity-filtered views do not reveal another faction's ships or slots", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));

  const aliceShips = test.runQuery(moduleExports.myShips(test.viewContext(alice)));
  const bobShips = test.runQuery(moduleExports.myShips(test.viewContext(bob)));
  expect(aliceShips).toHaveLength(1);
  expect(bobShips).toHaveLength(1);
  expect(aliceShips[0]?.id).not.toBe(bobShips[0]?.id);
  expect(test.runQuery(moduleExports.myMemberships(test.viewContext(alice)))).toHaveLength(1);
});

it("persists consistent seeded terrain and assigns guest to another valid spawn", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 6 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  const config = test.db.worldConfig.matchId.find(matchId)!;
  expect(config.seed).toBeGreaterThanOrEqual(0);
  expect(config.seed).toBeLessThanOrEqual(0xffffffff);
  expect(config.mapCells).toBe(72);
  const expectedWorld = generateDeterministicWorld(config.seed, 6);
  const firstChunk = [...test.db.worldChunk.iter()].find(row => row.chunkX === 0 && row.chunkY === 0)!;
  expect([...firstChunk.terrain]).toEqual(expectedWorld.chunks[0]!.terrain);
  expect(test.db.worldChunk.count()).toBe(25n);
  expect(test.db.worldSpawn.count()).toBe(6n);
  expect(test.db.salvageNode.count()).toBe(18n);
  const first = [...test.db.ship.iter()][0]!;
  const spawn0 = [...test.db.worldSpawn.iter()].find(row => row.slot === 0)!;
  expect(first.x).toBe(spawn0.gridX + 1.5);
  expect(first.y).toBe(spawn0.gridY + 1.5);
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  const ships = [...test.db.ship.iter()];
  expect(ships).toHaveLength(2);
  const guestSpawn = [...test.db.worldSpawn.iter()].find(row => row.slot === 1)!;
  expect(ships[1]!.x).toBe(guestSpawn.gridX + 1.5);
  expect(ships[1]!.y).toBe(guestSpawn.gridY + 1.5);
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  expect(test.db.ship.count()).toBe(2n);
  expect(test.db.matchMember.count()).toBe(2n);
});

it("rejects destinations outside each match's actual map size", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const ownShip = [...test.db.ship.iter()][0]!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, { shipId: ownShip.id, targetX: 64, targetY: 20 })
  )).toThrow("Destination out of bounds");
});

it("rejects impassable terrain and keeps an existing ship route unchanged", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const own = [...test.db.ship.iter()][0]!;
  test.withReducerTx(alice, ctx => moduleExports.issueShipOrder(ctx, {
    shipId: own.id, targetX: own.x + 1, targetY: own.y,
  }));
  const routeBefore = test.db.shipRoute.shipId.find(own.id)!;
  const seed = test.db.worldConfig.matchId.find(matchId)!.seed;
  const world = generateDeterministicWorld(seed, 2);
  const blocked = world.cells.findIndex(value => value >= 2);
  expect(blocked).toBeGreaterThanOrEqual(0);
  const blockedX = blocked % world.mapCells + 0.5;
  const blockedY = Math.floor(blocked / world.mapCells) + 0.5;
  expect(() => test.withReducerTx(alice, ctx => moduleExports.issueShipOrder(ctx, {
    shipId: own.id, targetX: blockedX, targetY: blockedY,
  }))).toThrow("Destination unreachable");
  expect(test.db.shipRoute.shipId.find(own.id)).toEqual(routeBefore);
});

it("scheduled ship movement advances only under internal authority and expires when idle", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const vessel = [...test.db.ship.iter()].find(row => row.owner.isEqual(
    [...test.db.match.iter()][0]!.host
  ))!;

  // A spawn's 3x3 area is clear by construction, so the adjacent cell is legal.
  const targetX = vessel.x + 1;
  const targetY = vessel.y;
  test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, { shipId: vessel.id, targetX, targetY })
  );
  expect(test.db.motionSchedule.count()).toBe(1n);
  // Reissuing an order in the same match must not create a second timer.
  test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, { shipId: vessel.id, targetX, targetY })
  );
  expect(test.db.motionSchedule.count()).toBe(1n);
  const timer = [...test.db.motionSchedule.iter()][0]!;
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.advanceMatchSimulation(ctx, { arg: timer })
  )).toThrow("internal-only");
  expect(test.db.ship.id.find(vessel.id)?.x).toBe(vessel.x);

  test.clock.advance(TimeDuration.fromMillis(100));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceMatchSimulation(ctx, { arg: timer })
  );
  const moved = test.db.ship.id.find(vessel.id)!;
  expect(moved.x).toBeGreaterThan(vessel.x);
  expect(moved.x).toBeLessThanOrEqual(vessel.x + 0.2 + 1e-8);
  expect(moved.updatedAt.microsSinceUnixEpoch)
    .toBeGreaterThan(vessel.updatedAt.microsSinceUnixEpoch);

  for (let i = 0; i < 30 && test.db.motionSchedule.count() > 0n; i++) {
    test.clock.advance(TimeDuration.fromMillis(100));
    const nextTimer = [...test.db.motionSchedule.iter()][0]!;
    test.withReducerTx(TestAuth.internal(), ctx =>
      moduleExports.advanceMatchSimulation(ctx, { arg: nextTimer })
    );
  }
  const arrived = test.db.ship.id.find(vessel.id)!;
  expect(arrived.x).toBe(targetX);
  expect(arrived.y).toBe(targetY);
  expect(arrived.velocityX).toBe(0);
  expect(test.db.shipRoute.count()).toBe(0n);
  expect(test.db.motionSchedule.count()).toBe(0n);
});

it("stop orders are authorized, halt movement, and let the lazy timer expire", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const vessel = [...test.db.ship.iter()][0]!;
  test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, {
      shipId: vessel.id, targetX: vessel.x + 1, targetY: vessel.y,
    })
  );
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.stopShip(ctx, { shipId: vessel.id })
  )).toThrow("Cannot command another");
  test.withReducerTx(alice, ctx =>
    moduleExports.stopShip(ctx, { shipId: vessel.id })
  );
  expect(test.db.shipRoute.count()).toBe(0n);
  const stopped = test.db.ship.id.find(vessel.id)!;
  expect(stopped.targetX).toBe(stopped.x);
  expect(stopped.velocityX).toBe(0);
  test.clock.advance(TimeDuration.fromMillis(100));
  const timer = [...test.db.motionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceMatchSimulation(ctx, { arg: timer })
  );
  expect(test.db.motionSchedule.count()).toBe(0n);
  expect(test.db.ship.id.find(vessel.id)?.x).toBe(stopped.x);
});

it("never accepts a destination occupied by another ship", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const vessels = [...test.db.ship.iter()];
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, {
      shipId: vessels[0]!.id, targetX: vessels[1]!.x, targetY: vessels[1]!.y,
    })
  )).toThrow("Destination unreachable");
  expect(test.db.shipRoute.shipId.find(vessels[0]!.id)).toBeUndefined();
});

it("scheduler holds a vessel if a new dynamic ship blocks its planned segment", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const [own, other] = [...test.db.ship.iter()];
  test.withReducerTx(alice, ctx =>
    moduleExports.issueShipOrder(ctx, {
      shipId: own!.id, targetX: own!.x + 1, targetY: own!.y,
    })
  );
  const original = test.db.ship.id.find(own!.id)!;
  // A trusted test-only DB mutation simulates another ship arriving in the
  // route AFTER issuance but BEFORE the authoritative scheduled tick.
  test.withReducerTx(TestAuth.internal(), ctx => {
    const current = ctx.db.ship.id.find(other!.id)!;
    ctx.db.ship.id.update({ ...current, x: original.x + 0.3, y: original.y });
  });
  test.clock.advance(TimeDuration.fromMillis(100));
  const schedule = [...test.db.motionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceMatchSimulation(ctx, { arg: schedule })
  );
  const after = test.db.ship.id.find(own!.id)!;
  expect(after.x).toBe(original.x);
  expect(after.y).toBe(original.y);
  expect(after.velocityX).toBe(0);
  expect(test.db.shipRoute.shipId.find(own!.id)).toBeDefined();
});
