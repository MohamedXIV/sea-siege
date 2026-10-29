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
  expect(first.x).toBe(spawn0.gridX - 1.5); // scout launches outside the core
  expect(first.y).toBe(spawn0.gridY + 1.5);
  expect([...test.db.structure.matchId.filter(matchId)].filter(row => row.ownerSlot === 0)).toHaveLength(7);
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  const ships = [...test.db.ship.iter()];
  expect(ships).toHaveLength(2);
  const guestSpawn = [...test.db.worldSpawn.iter()].find(row => row.slot === 1)!;
  expect(ships[1]!.x).toBe(guestSpawn.gridX - 1.5);
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
  const vessel = [...test.db.ship.iter()].find(row => row.ownerSlot === 0)!;

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

it("atomically charges owned salvage for a platform and rejects invalid placement", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const member = [...test.db.factionState.matchId.filter(lobby.id)].find(row => row.slot === 0)!;
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  const request = { matchId: lobby.id, kind: "platform", gridX: core.gridX + 3, gridY: core.gridY + 1 };
  expect(() => test.withReducerTx(bob, ctx => moduleExports.placeStructure(ctx, request)))
    .toThrow("touch connected territory"); // Bob cannot extend Alice's deck.
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.placeStructure(ctx, { ...request, kind: "command_core" })
  )).toThrow("protected");
  expect(test.db.factionState.id.find(member.id)?.salvage).toBe(420);
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, request));
  expect(test.db.factionState.id.find(member.id)?.salvage).toBe(395);
  const placed = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "platform" && row.gridX === request.gridX && row.gridY === request.gridY
  )!;
  expect(placed.complete).toBe(false);
  expect(test.db.constructionSchedule.count()).toBe(1n);
  expect(() => test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, request)))
    .toThrow("Surface cell occupied");
  expect(test.db.factionState.id.find(member.id)?.salvage).toBe(395);
});

it("scheduled completion activates connected platform; only internal scheduler may complete it", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row => row.ownerSlot === 0 && row.kind === "command_core")!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: lobby.id, kind: "platform", gridX: core.gridX + 3, gridY: core.gridY + 1,
  }));
  const placed = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.kind === "platform" && row.gridX === core.gridX + 3 && row.gridY === core.gridY + 1
  )!;
  const timer = [...test.db.constructionSchedule.iter()][0]!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.completeConstruction(ctx, { arg: timer })
  )).toThrow("internal-only");
  test.clock.advance(TimeDuration.fromMillis(1500));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, { arg: timer })
  );
  expect(test.db.structure.id.find(placed.id)?.complete).toBe(true);
  expect(test.db.structure.id.find(placed.id)?.connected).toBe(true);
});

it("demolition refunds exactly once, protects Command Core and preserves other players", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row => row.ownerSlot === 0 && row.kind === "command_core")!;
  const pad = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "platform"
  )!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: core.id })
  )).toThrow("Command Core");
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: pad.id })
  )).toThrow("another faction");
  const balance = [...test.db.factionState.matchId.filter(lobby.id)].find(row => row.slot === 0)!.salvage;
  test.withReducerTx(alice, ctx => moduleExports.demolishStructure(ctx, { structureId: pad.id }));
  expect(test.db.structure.id.find(pad.id)).toBeUndefined();
  expect([...test.db.factionState.matchId.filter(lobby.id)].find(row => row.slot === 0)!.salvage)
    .toBe(balance + 12);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: pad.id })
  )).toThrow("unavailable");
});

it("demolishing support collapses a mounted workshop and cancels its construction timer", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: lobby.id, kind: "workshop", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const workshop = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "workshop"
  )!;
  const support = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "platform" &&
    row.gridX === core.gridX && row.gridY === core.gridY + 3
  )!;
  expect(test.db.constructionSchedule.count()).toBe(1n);
  test.withReducerTx(alice, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: support.id })
  );
  expect(test.db.structure.id.find(support.id)).toBeUndefined();
  expect(test.db.structure.id.find(workshop.id)).toBeUndefined();
  expect(test.db.constructionSchedule.count()).toBe(0n);
  const member = [...test.db.factionState.matchId.filter(lobby.id)].find(row => row.slot === 0)!;
  expect(member.salvage).toBe(420 - 120 + 12);
});


it("harvest orders require the owner and actual node range; economy credits only drawn salvage", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const vessel = [...test.db.ship.iter()].find(row => row.ownerSlot === 0)!;
  const node = [...test.db.salvageNode.matchId.filter(lobby.id)][0]!;
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.orderHarvest(ctx, { shipId: vessel.id, nodeId: node.id })
  )).toThrow("Cannot command another");
  // Test-only authoritative repositioning, not a user-exposed teleport reducer.
  test.withReducerTx(TestAuth.internal(), ctx =>
    ctx.db.ship.id.update({ ...vessel, x: node.gridX + 0.5, y: node.gridY + 0.5 })
  );
  test.withReducerTx(alice, ctx => moduleExports.orderHarvest(ctx, {
    shipId: vessel.id, nodeId: node.id,
  }));
  expect(test.db.harvestOrder.count()).toBe(1n);
  const previous = [...test.db.factionState.matchId.filter(lobby.id)].find(m => m.slot === 0)!;
  test.clock.advance(TimeDuration.fromMillis(1000));
  const timer = [...test.db.economySchedule.iter()][0]!;
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.advanceEconomy(ctx, { arg: timer })
  )).toThrow("internal-only");
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceEconomy(ctx, { arg: timer })
  );
  const current = test.db.factionState.id.find(previous.id)!;
  expect(current.salvage).toBe(previous.salvage + 4 + 14);
  expect(test.db.salvageNode.id.find(node.id)!.remaining).toBe(node.capacity - 14);
  test.withReducerTx(alice, ctx => moduleExports.stopShip(ctx, { shipId: vessel.id }));
  expect(test.db.harvestOrder.count()).toBe(0n);
});

it("shipyard charges once, respects FIFO, then produces only after time and a safe berth", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: lobby.id, kind: "shipyard", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const yard = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "shipyard"
  )!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.enqueueShip(ctx, { shipyardId: yard.id, kind: "scout" })
  )).toThrow("offline");
  test.clock.advance(TimeDuration.fromMillis(6000));
  const completion = [...test.db.constructionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, { arg: completion })
  );
  test.withReducerTx(alice, ctx =>
    moduleExports.enqueueShip(ctx, { shipyardId: yard.id, kind: "scout" })
  );
  const member = [...test.db.factionState.matchId.filter(lobby.id)].find(m => m.slot === 0)!;
  expect(member.salvage).toBe(420 - 150 - 70);
  expect(test.db.productionOrder.count()).toBe(1n);
  expect([...test.db.productionOrder.iter()][0]!.remainingUs).toBe(4_000_000n);
  // Earlier unprocessed economy elapsed time must NOT make a new job instant.
  test.clock.advance(TimeDuration.fromMillis(1000));
  let timer = [...test.db.economySchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceEconomy(ctx, { arg: timer }));
  expect(test.db.productionOrder.count()).toBe(1n);
  expect([...test.db.productionOrder.iter()][0]!.remainingUs).toBe(4_000_000n);
  for (let i = 0; i < 4; i++) {
    test.clock.advance(TimeDuration.fromMillis(1000));
    timer = [...test.db.economySchedule.iter()][0]!;
    test.withReducerTx(TestAuth.internal(), ctx =>
      moduleExports.advanceEconomy(ctx, { arg: timer })
    );
  }
  expect(test.db.productionOrder.count()).toBe(0n);
  const ships = [...test.db.ship.matchId.filter(lobby.id)].filter(row => row.ownerSlot === 0);
  expect(ships).toHaveLength(2);
  expect(ships.some(row => row.kind === "scout" && row.hp === 210)).toBe(true);
});

it("demolition cancels paid ship queues and refunds exactly once", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: lobby.id, kind: "shipyard", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const yard = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "shipyard"
  )!;
  test.clock.advance(TimeDuration.fromMillis(6000));
  const completion = [...test.db.constructionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, { arg: completion })
  );
  test.withReducerTx(alice, ctx => moduleExports.enqueueShip(ctx, {
    shipyardId: yard.id, kind: "gunboat",
  }));
  const production = [...test.db.productionOrder.iter()][0]!;
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.cancelShipProduction(ctx, { orderId: production.id })
  )).toThrow("Not your");
  test.withReducerTx(alice, ctx => moduleExports.demolishStructure(ctx, { structureId: yard.id }));
  expect(test.db.productionOrder.count()).toBe(0n);
  expect([...test.db.factionState.matchId.filter(lobby.id)].find(m => m.slot === 0)!.salvage)
    .toBe(420 - 150 - 130 + 75 + 130);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.cancelShipProduction(ctx, { orderId: production.id })
  )).toThrow("unavailable");
});

it("rig income is server-owned and incomplete rigs never produce salvage", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const lobby = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: lobby.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: lobby.id }));
  const core = [...test.db.structure.matchId.filter(lobby.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: lobby.id, kind: "salvage_rig", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const initial = [...test.db.factionState.matchId.filter(lobby.id)].find(m => m.slot === 0)!;
  test.clock.advance(TimeDuration.fromMillis(1000));
  let timer = [...test.db.economySchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceEconomy(ctx, { arg: timer }));
  expect(test.db.factionState.id.find(initial.id)!.salvage).toBe(initial.salvage + 4);
  test.clock.advance(TimeDuration.fromMillis(4500));
  const construction = [...test.db.constructionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, { arg: construction })
  );
  const before = test.db.factionState.id.find(initial.id)!;
  timer = [...test.db.economySchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceEconomy(ctx, { arg: timer }));
  expect(test.db.factionState.id.find(initial.id)!.salvage).toBeGreaterThanOrEqual(before.salvage + 4 + 9);
});

it("workshop repairs owned hulls and structures only at range with exact salvage charges", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const match = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: match.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: match.id }));
  const core = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: match.id, kind: "workshop", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const workshop = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "workshop"
  )!;
  expect(() => test.withReducerTx(alice, ctx => moduleExports.repairStructure(ctx, {
    workshopId: workshop.id, structureId: core.id, requestedHp: 60,
  }))).toThrow("offline");
  test.clock.advance(TimeDuration.fromMillis(5000));
  const completion = [...test.db.constructionSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, { arg: completion })
  );
  const vessel = [...test.db.ship.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0
  )!;
  test.withReducerTx(TestAuth.internal(), ctx => {
    ctx.db.structure.id.update({ ...core, hp: 2100 });
    ctx.db.ship.id.update({ ...vessel, hp: 160 });
  });
  expect(() => test.withReducerTx(bob, ctx => moduleExports.repairStructure(ctx, {
    workshopId: workshop.id, structureId: core.id, requestedHp: 60,
  }))).toThrow("Not your workshop");
  test.withReducerTx(alice, ctx => moduleExports.repairStructure(ctx, {
    workshopId: workshop.id, structureId: core.id, requestedHp: 60,
  }));
  expect(test.db.structure.id.find(core.id)?.hp).toBe(2160);
  test.withReducerTx(alice, ctx => moduleExports.repairShip(ctx, {
    workshopId: workshop.id, shipId: vessel.id, requestedHp: 50,
  }));
  expect(test.db.ship.id.find(vessel.id)?.hp).toBe(210);
  const member = [...test.db.factionState.matchId.filter(match.id)].find(row =>
    row.slot === 0
  )!;
  expect(member.salvage).toBe(420 - 120 - 30 - 25);
  expect(() => test.withReducerTx(alice, ctx => moduleExports.repairShip(ctx, {
    workshopId: workshop.id, shipId: vessel.id, requestedHp: 50,
  }))).toThrow("full health");
});

it("paid workshop upgrade pauses while offline and progresses only under internal economy ticks", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const match = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: match.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: match.id }));
  const core = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: match.id, kind: "workshop", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const workshop = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "workshop"
  )!;
  test.clock.advance(TimeDuration.fromMillis(5000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, {
      arg: [...test.db.constructionSchedule.iter()][0]!,
    })
  );
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.upgradeWorkshop(ctx, { workshopId: workshop.id })
  )).toThrow("Not your");
  test.withReducerTx(alice, ctx =>
    moduleExports.upgradeWorkshop(ctx, { workshopId: workshop.id })
  );
  expect(test.db.structure.id.find(workshop.id)?.upgradeRemainingUs).toBe(6_000_000n);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.upgradeWorkshop(ctx, { workshopId: workshop.id })
  )).toThrow("already upgrading");
  test.withReducerTx(TestAuth.internal(), ctx => {
    const row = ctx.db.structure.id.find(workshop.id)!;
    ctx.db.structure.id.update({ ...row, connected: false });
  });
  test.clock.advance(TimeDuration.fromMillis(1000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceEconomy(ctx, { arg: [...test.db.economySchedule.iter()][0]! })
  );
  expect(test.db.structure.id.find(workshop.id)?.upgradeRemainingUs).toBe(6_000_000n);
  test.withReducerTx(TestAuth.internal(), ctx => {
    const row = ctx.db.structure.id.find(workshop.id)!;
    ctx.db.structure.id.update({ ...row, connected: true });
  });
  for (let i = 0; i < 6; i++) {
    test.clock.advance(TimeDuration.fromMillis(1000));
    test.withReducerTx(TestAuth.internal(), ctx =>
      moduleExports.advanceEconomy(ctx, { arg: [...test.db.economySchedule.iter()][0]! })
    );
  }
  expect(test.db.structure.id.find(workshop.id)?.level).toBe(2);
  expect(test.db.structure.id.find(workshop.id)?.upgradeRemainingUs).toBe(0n);
});

it("demolition refunds a paid but unfinished workshop upgrade only once", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const match = [...test.db.match.iter()][0]!;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: match.id }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: match.id }));
  const core = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "command_core"
  )!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId: match.id, kind: "workshop", gridX: core.gridX, gridY: core.gridY + 3,
  }));
  const workshop = [...test.db.structure.matchId.filter(match.id)].find(row =>
    row.ownerSlot === 0 && row.kind === "workshop"
  )!;
  test.clock.advance(TimeDuration.fromMillis(5000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.completeConstruction(ctx, {
      arg: [...test.db.constructionSchedule.iter()][0]!,
    })
  );
  test.withReducerTx(alice, ctx =>
    moduleExports.upgradeWorkshop(ctx, { workshopId: workshop.id })
  );
  test.withReducerTx(alice, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: workshop.id })
  );
  const member = [...test.db.factionState.matchId.filter(match.id)]
    .find(row => row.slot === 0)!;
  expect(member.salvage).toBe(420 - 120 - 200 + 60 + 200);
  expect(test.db.structure.id.find(workshop.id)).toBeUndefined();
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.demolishStructure(ctx, { structureId: workshop.id })
  )).toThrow("unavailable");
});


it("fire authorization rejects foreign weapons, friendly targets, and cooldown bypass", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const host = [...test.db.factionState.matchId.filter(matchId)].find(row => row.slot === 0)!;
  const attacker = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot === host.slot)!;
  const defender = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot !== host.slot)!;
  // Internal test authority moves the defender into visible fire range only.
  test.withReducerTx(TestAuth.internal(), ctx => {
    ctx.db.ship.id.update({
      ...defender, x: attacker.x + 3, y: attacker.y, hp: 210,
    });
  });
  expect(() => test.withReducerTx(bob, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: attacker.id, targetType: "ship", targetId: defender.id,
  }))).toThrow("Weapon unavailable");
  expect(() => test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: attacker.id, targetType: "ship", targetId: attacker.id,
  }))).toThrow("Target not visible");
  test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: attacker.id, targetType: "ship", targetId: defender.id,
  }));
  expect(test.db.projectile.count()).toBe(1n);
  expect(test.db.combatSchedule.count()).toBe(1n);
  expect(() => test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: attacker.id, targetType: "ship", targetId: defender.id,
  }))).toThrow("cooldown");
});

it("moving defender dodges the fired trajectory; only internal scheduler can advance it", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const first = [...test.db.ship.matchId.filter(matchId)][0]!;
  const second = [...test.db.ship.matchId.filter(matchId)][1]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    ctx.db.ship.id.update({ ...second, x: first.x + 3, y: first.y })
  );
  test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: first.id, targetType: "ship", targetId: second.id,
  }));
  const initial = test.db.ship.id.find(second.id)!.hp;
  test.withReducerTx(TestAuth.internal(), ctx => {
    const row = ctx.db.ship.id.find(second.id)!;
    ctx.db.ship.id.update({ ...row, y: row.y + 4 });
  });
  const timer = [...test.db.combatSchedule.iter()][0]!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.advanceCombat(ctx, { arg: timer })
  )).toThrow("internal-only");
  for (let i = 0; i < 2; i++) {
    test.clock.advance(TimeDuration.fromMillis(100));
    const current = [...test.db.combatSchedule.iter()][0]!;
    test.withReducerTx(TestAuth.internal(), ctx =>
      moduleExports.advanceCombat(ctx, { arg: current })
    );
  }
  expect(test.db.ship.id.find(second.id)!.hp).toBe(initial);
  expect(test.db.projectile.count()).toBe(0n);
  expect(test.db.combatSchedule.count()).toBe(0n);
});

it("a resolved projectile inflicts armor-reduced damage and cannot hit twice", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const own = [...test.db.ship.matchId.filter(matchId)][0]!;
  const enemy = [...test.db.ship.matchId.filter(matchId)][1]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    ctx.db.ship.id.update({ ...enemy, x: own.x + 2, y: own.y })
  );
  test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: own.id, targetType: "ship", targetId: enemy.id,
  }));
  test.clock.advance(TimeDuration.fromMillis(100));
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceCombat(ctx, {
    arg: [...test.db.combatSchedule.iter()][0]!,
  }));
  expect(test.db.ship.id.find(enemy.id)!.hp).toBe(210 - 16); // Scout 18 minus Scout armor 2
  expect(test.db.projectile.count()).toBe(0n);
  expect(test.db.combatSchedule.count()).toBe(0n);
});

it("destroying the last hostile Command Core eliminates its faction and ends the match", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const own = [...test.db.ship.matchId.filter(matchId)][0]!;
  const enemyCore = [...test.db.structure.matchId.filter(matchId)]
    .find(row => row.ownerSlot === 1 && row.kind === "command_core")!;
  test.withReducerTx(TestAuth.internal(), ctx => {
    ctx.db.structure.id.update({
      ...enemyCore, gridX: Math.floor(own.x + 2),
      gridY: Math.floor(own.y - 1), hp: 5,
    });
  });
  test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, {
    sourceType: "ship", sourceId: own.id, targetType: "structure", targetId: enemyCore.id,
  }));
  for (let i = 0; i < 3 && test.db.combatSchedule.count() > 0n; i++) {
    test.clock.advance(TimeDuration.fromMillis(100));
    test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceCombat(ctx, {
      arg: [...test.db.combatSchedule.iter()][0]!,
    }));
  }
  expect(test.db.structure.id.find(enemyCore.id)).toBeUndefined();
  expect(test.db.match.id.find(matchId)?.phase).toBe("finished");
  expect(test.db.match.id.find(matchId)?.winnerSlot).toBe(0);
  expect([...test.db.factionState.matchId.filter(matchId)].find(row => row.slot === 1)?.eliminated).toBe(true);
});

it("turrets slew gradually under internal authority; premature fire and foreign aim fail", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const attacker = [...test.db.ship.matchId.filter(matchId)]
    .find(row => row.ownerSlot === 0)!;
  const defender = [...test.db.ship.matchId.filter(matchId)]
    .find(row => row.ownerSlot !== attacker.ownerSlot)!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    ctx.db.ship.id.update({ ...defender, x: attacker.x, y: attacker.y + 2 })
  );
  const fire = { sourceType: "ship", sourceId: attacker.id,
    targetType: "ship", targetId: defender.id };
  const aim = { sourceType: "ship", sourceId: attacker.id, desiredAngleDeg: 90 };

  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.fireWeapon(ctx, fire)
  )).toThrow("Weapon not aligned");
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.aimWeapon(ctx, aim)
  )).toThrow("Weapon unavailable");
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.aimWeapon(ctx, { ...aim, desiredAngleDeg: 360 })
  )).toThrow("Invalid aim bearing");
  test.withReducerTx(alice, ctx => moduleExports.aimWeapon(ctx, aim));
  expect(test.db.turretAim.count()).toBe(1n);
  expect(test.db.combatSchedule.count()).toBe(1n);
  test.clock.advance(TimeDuration.fromMillis(100));
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceCombat(ctx, {
    arg: [...test.db.combatSchedule.iter()][0]!,
  }));
  expect(test.db.ship.id.find(attacker.id)?.turretAngleDeg).toBe(18);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.fireWeapon(ctx, fire)
  )).toThrow("Weapon not aligned");
  for (let step = 0; step < 4; step++) {
    test.clock.advance(TimeDuration.fromMillis(100));
    test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceCombat(ctx, {
      arg: [...test.db.combatSchedule.iter()][0]!,
    }));
  }
  expect(test.db.ship.id.find(attacker.id)?.turretAngleDeg).toBe(90);
  expect(test.db.turretAim.count()).toBe(0n);
  expect(test.db.combatSchedule.count()).toBe(0n);
  test.withReducerTx(alice, ctx => moduleExports.fireWeapon(ctx, fire));
  expect(test.db.projectile.count()).toBe(1n);
  expect(test.db.combatSchedule.count()).toBe(1n);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.fireWeapon(ctx, fire)
  )).toThrow("cooldown");
});

it("a destroyed weapon loses its pending aim and releases its lazy timer", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const host = test.db.match.id.find(matchId)!.host;
  const attacker = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot === 0)!;
  test.withReducerTx(alice, ctx => moduleExports.aimWeapon(ctx, {
    sourceType: "ship", sourceId: attacker.id, desiredAngleDeg: 180,
  }));
  expect(test.db.turretAim.count()).toBe(1n);
  test.withReducerTx(TestAuth.internal(), ctx => ctx.db.ship.id.delete(attacker.id));
  test.clock.advance(TimeDuration.fromMillis(100));
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceCombat(ctx, {
    arg: [...test.db.combatSchedule.iter()][0]!,
  }));
  expect(test.db.turretAim.count()).toBe(0n);
  expect(test.db.combatSchedule.count()).toBe(0n);
});


it("match deadline rejects external/early calls and resolves the reference tiebreaker", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(test.db.matchDeadline.count()).toBe(1n);
  const deadline = [...test.db.matchDeadline.iter()][0]!;
  expect(deadline.deadlineUs - test.db.match.id.find(matchId)!.startedAtUs)
    .toBe(720_000_000n);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.finishMatchAtDeadline(ctx, { arg: deadline })
  )).toThrow("internal-only");
  expect(() => test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.finishMatchAtDeadline(ctx, { arg: deadline })
  )).toThrow("has not elapsed");

  // Test-only damage creates an unambiguous ranking, with no real combat API.
  const hostCore = [...test.db.structure.matchId.filter(matchId)]
    .find(row => row.ownerSlot === 0 && row.kind === "command_core")!;
  test.withReducerTx(TestAuth.internal(), ctx => ctx.db.structure.id.update({
    ...hostCore, hp: 2100,
  }));
  test.clock.advance(TimeDuration.fromMillis(720_000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.finishMatchAtDeadline(ctx, { arg: deadline })
  );
  const finished = test.db.match.id.find(matchId)!;
  expect(finished.phase).toBe("finished");
  expect(finished.winnerSlot).toBe(1);
  expect(finished.victoryReason).toBe("time_limit");
  expect(finished.winningScore5).toBeGreaterThan(0n);
  expect(test.db.economySchedule.count()).toBe(0n);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.startMatch(ctx, { matchId })
  )).toThrow("Lobby unavailable");
});

it("lifetime salvage is credited by server production even when balance is spent", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const host = [...test.db.factionState.matchId.filter(matchId)].find(row => row.slot === 0)!;
  expect(host.totalSalvageGathered).toBe(0n);
  test.clock.advance(TimeDuration.fromMillis(1000));
  test.withReducerTx(TestAuth.internal(), ctx => moduleExports.advanceEconomy(ctx, {
    arg: [...test.db.economySchedule.iter()][0]!,
  }));
  const earned = test.db.factionState.id.find(host.id)!;
  expect(earned.totalSalvageGathered).toBe(4n);
  expect(earned.salvage).toBe(424);
  const core = [...test.db.structure.matchId.filter(matchId)]
    .find(row => row.ownerSlot === 0 && row.kind === "command_core")!;
  test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId, kind: "platform", gridX: core.gridX + 3, gridY: core.gridY + 1,
  }));
  const after = test.db.factionState.id.find(host.id)!;
  expect(after.salvage).toBe(399);
  expect(after.totalSalvageGathered).toBe(4n);
});


it("late commands cannot alter dominance scores before a delayed timeout reducer executes", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const core = [...test.db.structure.matchId.filter(matchId)]
    .find(row => row.ownerSlot === 0 && row.kind === "command_core")!;
  const member = [...test.db.factionState.matchId.filter(matchId)]
    .find(row => row.slot === 0)!;
  test.clock.advance(TimeDuration.fromMillis(720_000));
  expect(test.db.match.id.find(matchId)?.phase).toBe("active"); // Deadline reducer not manually triggered yet.
  expect(() => test.withReducerTx(alice, ctx => moduleExports.placeStructure(ctx, {
    matchId, kind: "platform", gridX: core.gridX + 3, gridY: core.gridY + 1,
  }))).toThrow("Match is not active");
  const after = test.db.factionState.id.find(member.id)!;
  expect(after.salvage).toBe(member.salvage);
  expect(after.totalSalvageGathered).toBe(member.totalSalvageGathered);
  const deadline = [...test.db.matchDeadline.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.finishMatchAtDeadline(ctx, { arg: deadline })
  );
  expect(test.db.match.id.find(matchId)?.phase).toBe("finished");
});


it("indexed faction ship views do not leak matching slots from other matches", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n), eve = auth("eve", 3n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const firstMatch = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const secondMatch = [...test.db.match.iter()].find(row => row.id !== firstMatch)!.id;
  const aliceSeat = [...test.db.matchMember.matchId.filter(firstMatch)][0]!;
  const bobSeat = [...test.db.matchMember.matchId.filter(secondMatch)][0]!;
  expect(aliceSeat.slot).toBe(0);
  expect(bobSeat.slot).toBe(0);
  expect(aliceSeat.factionKey).not.toBe(bobSeat.factionKey);

  const aliceVisible = test.runQuery(moduleExports.myShips(test.viewContext(alice)));
  const bobVisible = test.runQuery(moduleExports.myShips(test.viewContext(bob)));
  const eveVisible = test.runQuery(moduleExports.myShips(test.viewContext(eve)));
  expect(aliceVisible).toHaveLength(1);
  expect(bobVisible).toHaveLength(1);
  expect(eveVisible).toHaveLength(0);
  expect(aliceVisible[0]!.matchId).toBe(firstMatch);
  expect(bobVisible[0]!.matchId).toBe(secondMatch);

  // Bob is slot zero in his own lobby, but cannot command Alice's ship.
  test.withReducerTx(eve, ctx => moduleExports.joinMatch(ctx, { matchId: firstMatch }));
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.startMatch(ctx, { matchId: secondMatch })
  )).toThrow("Need at least two");
});

it("human commands cannot control a same-numbered faction in a different active match", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  const c = auth("charlie", 3n), d = auth("diana", 4n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const firstMatch = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId: firstMatch }));
  test.withReducerTx(c, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const secondMatch = [...test.db.match.iter()].find(row => row.id !== firstMatch)!.id;
  test.withReducerTx(d, ctx => moduleExports.joinMatch(ctx, { matchId: secondMatch }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId: firstMatch }));
  test.withReducerTx(c, ctx => moduleExports.startMatch(ctx, { matchId: secondMatch }));
  const foreign = [...test.db.ship.matchId.filter(secondMatch)].find(row => row.ownerSlot === 0)!;
  expect(() => test.withReducerTx(alice, ctx => moduleExports.stopShip(ctx, { shipId: foreign.id })))
    .toThrow("Cannot command another");
  const myShip = [...test.db.ship.matchId.filter(firstMatch)].find(row => row.ownerSlot === 0)!;
  expect(myShip.factionKey).not.toBe(foreign.factionKey);
  test.withReducerTx(alice, ctx => moduleExports.stopShip(ctx, { shipId: myShip.id }));
});


it("server-owned bot seats have independent faction funds without human Identities", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n), eve = auth("eve", 3n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 4 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "normal" })
  )).toThrow("Only the host");
  test.withReducerTx(alice, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "easy" })
  );
  test.withReducerTx(alice, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "hard" })
  );
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  expect([...test.db.matchMember.matchId.filter(matchId)]).toHaveLength(2);
  const factions = [...test.db.factionState.matchId.filter(matchId)];
  expect(factions).toHaveLength(4);
  expect(factions.map(row => row.slot).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  expect(factions.filter(row => row.controller === "bot")).toHaveLength(2);
  expect(factions.every(row => row.salvage === 420 && row.totalSalvageGathered === 0n)).toBe(true);
  expect([...test.db.botController.matchId.filter(matchId)].map(row => row.slot).sort((a, b) => a - b)).toEqual([1, 2]);
  expect([...test.db.ship.matchId.filter(matchId)]).toHaveLength(4);
  expect(test.runQuery(moduleExports.myShips(test.viewContext(alice)))).toHaveLength(1);
  expect(test.runQuery(moduleExports.myShips(test.viewContext(bob)))).toHaveLength(1);
  expect(test.runQuery(moduleExports.myShips(test.viewContext(eve)))).toHaveLength(0);
  expect(test.runQuery(moduleExports.myFactionStates(test.viewContext(alice)))).toHaveLength(1);
  expect(test.runQuery(moduleExports.myFactionStates(test.viewContext(bob)))).toHaveLength(1);
  expect(test.runQuery(moduleExports.myFactionStates(test.viewContext(eve)))).toHaveLength(0);
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "normal" })
  )).toThrow("Lobby full");
});

it("bot ships remain inaccessible to host even when the host created them", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(alice, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "normal" })
  );
  const bot = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot === 1)!;
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(test.db.match.id.find(matchId)?.phase).toBe("active");
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.stopShip(ctx, { shipId: bot.id })
  )).toThrow("Cannot command another");
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.stopShip(ctx, { shipId: bot.id })
  )).toThrow("Cannot command another");
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.removeBot(ctx, { matchId, slot: 1 })
  )).toThrow("Lobby unavailable");
  expect([...test.db.factionState.matchId.filter(matchId)].find(row => row.slot === 1)?.salvage)
    .toBe(420);
});

it("only host can remove a bot in lobby; its entire seat is recycled atomically", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), bob = auth("bob", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 3 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(alice, ctx => moduleExports.addBot(ctx, { matchId, difficulty: "hard" }));
  expect(() => test.withReducerTx(bob, ctx =>
    moduleExports.removeBot(ctx, { matchId, slot: 1 })
  )).toThrow("Only the host");
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.addBot(ctx, { matchId, difficulty: "cheat" })
  )).toThrow("Invalid bot difficulty");
  test.withReducerTx(alice, ctx => moduleExports.removeBot(ctx, { matchId, slot: 1 }));
  expect(test.db.botController.count()).toBe(0n);
  expect([...test.db.factionState.matchId.filter(matchId)]).toHaveLength(1);
  expect([...test.db.ship.matchId.filter(matchId)]).toHaveLength(1);
  expect([...test.db.structure.matchId.filter(matchId)]).toHaveLength(7);
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  expect([...test.db.factionState.matchId.filter(matchId)].find(row => row.slot === 1)?.controller)
    .toBe("human");
});


it("one active match with bots gets one bounded internal strategic timer and no extra members", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n), outsider = auth("outsider", 2n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 4 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(alice, ctx => moduleExports.addBot(ctx, { matchId, difficulty: "easy" }));
  test.withReducerTx(alice, ctx => moduleExports.addBot(ctx, { matchId, difficulty: "hard" }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(test.db.botSchedule.count()).toBe(1n);
  expect([...test.db.matchMember.matchId.filter(matchId)]).toHaveLength(1);
  expect([...test.db.botController.matchId.filter(matchId)]).toHaveLength(2);
  const schedule = [...test.db.botSchedule.iter()][0]!;
  expect(() => test.withReducerTx(outsider, ctx =>
    moduleExports.advanceBots(ctx, { arg: schedule })
  )).toThrow("internal-only");

  test.clock.advance(TimeDuration.fromMillis(1000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceBots(ctx, { arg: schedule })
  );
  const bots = [...test.db.botController.matchId.filter(matchId)];
  expect(bots.every(row => row.nextDecisionUs > 0n)).toBe(true);
  expect(test.db.botSchedule.count()).toBe(1n);
  expect([...test.db.matchMember.matchId.filter(matchId)]).toHaveLength(1);
  expect([...test.db.factionState.matchId.filter(matchId)].filter(row => row.controller === "bot"))
    .toHaveLength(2);
  // No Bot is authorized as a client; even the host cannot control its fleet.
  const enemy = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot === 1)!;
  expect(() => test.withReducerTx(alice, ctx =>
    moduleExports.stopShip(ctx, { shipId: enemy.id })
  )).toThrow("Cannot command another");
});

it("the bot sensor filters hidden enemies before autonomous aiming or firing", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(alice, ctx => moduleExports.addBot(ctx, { matchId, difficulty: "normal" }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  const own = [...test.db.ship.matchId.filter(matchId)].find(row => row.ownerSlot === 0)!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    ctx.db.ship.id.update({ ...own, x: 1.5, y: 1.5 })
  );
  test.clock.advance(TimeDuration.fromMillis(1000));
  const timer = [...test.db.botSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceBots(ctx, { arg: timer })
  );
  // Bot has no visibility of the deliberately relocated far-away human ship.
  expect(test.db.projectile.count()).toBe(0n);
  expect([...test.db.turretAim.matchId.filter(matchId)]
    .filter(row => row.sourceType === "ship" &&
      [...test.db.ship.matchId.filter(matchId)].some(ship =>
        ship.ownerSlot === 1 && ship.id === row.sourceId))).toHaveLength(0);
});

it("finalizing the match cancels all strategic bots and preserves the outcome", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(alice, ctx => moduleExports.addBot(ctx, { matchId, difficulty: "hard" }));
  test.withReducerTx(alice, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(test.db.botSchedule.count()).toBe(1n);
  test.clock.advance(TimeDuration.fromMillis(720_000));
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.finishMatchAtDeadline(ctx, { arg: [...test.db.matchDeadline.iter()][0]! })
  );
  expect(test.db.match.id.find(matchId)?.phase).toBe("finished");
  expect(test.db.botSchedule.count()).toBe(0n);
});


it("one human can own a real eight-faction lobby with seven identity-free strategic bots", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const host = auth("host", 1n);
  test.withReducerTx(host, ctx => moduleExports.createMatch(ctx, { maxSlots: 8 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  for (let i = 0; i < 7; i++) {
    const difficulty = (["easy", "normal", "hard"] as const)[i % 3]!;
    test.withReducerTx(host, ctx => moduleExports.addBot(ctx, { matchId, difficulty }));
  }
  const factions = [...test.db.factionState.matchId.filter(matchId)]
    .sort((a,b)=>a.slot-b.slot);
  expect(factions).toHaveLength(8);
  expect(factions.map(row => row.slot)).toEqual([0,1,2,3,4,5,6,7]);
  expect(factions.filter(row=>row.controller === "bot")).toHaveLength(7);
  expect([...test.db.matchMember.matchId.filter(matchId)]).toHaveLength(1);
  expect([...test.db.botController.matchId.filter(matchId)]).toHaveLength(7);
  expect([...test.db.ship.matchId.filter(matchId)]).toHaveLength(8);
  test.withReducerTx(host, ctx => moduleExports.startMatch(ctx, { matchId }));
  expect(test.db.botSchedule.count()).toBe(1n);
  test.clock.advance(TimeDuration.fromMillis(1000));
  const schedule = [...test.db.botSchedule.iter()][0]!;
  test.withReducerTx(TestAuth.internal(), ctx =>
    moduleExports.advanceBots(ctx, { arg: schedule }));
  expect([...test.db.botController.matchId.filter(matchId)]
    .every(row=>row.nextDecisionUs>0n)).toBe(true);
  expect([...test.db.matchMember.matchId.filter(matchId)]).toHaveLength(1);
});
