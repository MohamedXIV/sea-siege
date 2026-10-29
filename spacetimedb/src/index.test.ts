import { expect, it } from "vitest";
import { ConnectionId } from "spacetimedb";
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

  test.withReducerTx(alice, ctx => moduleExports.issueShipOrder(ctx, { shipId: ownShip.id, targetX: 32, targetY: 30 }));
  expect(test.db.ship.id.find(ownShip.id)?.targetX).toBe(32);
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
