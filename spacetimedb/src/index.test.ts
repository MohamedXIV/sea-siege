import { expect, it } from "vitest";
import { ConnectionId } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, * as moduleExports from "./index";

const auth = (subject: string, connectionId: bigint) =>
  TestAuth.fromJwtPayload(
    JSON.stringify({ iss: "https://test.sea-siege.invalid", sub: subject }),
    new ConnectionId(connectionId)
  );

it("accepts only 2-8 slots and rolls back invalid creation", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  expect(() => test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { seed: 42, maxSlots: 1 })))
    .toThrow("2–8");
  expect(test.db.match.count()).toBe(0n);

  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { seed: 42, maxSlots: 2 }));
  expect(test.db.match.count()).toBe(1n);
  expect(test.db.ship.count()).toBe(1n);
});

it("prevents guest start and unauthorized ship orders", () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);

  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { seed: 7, maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));
  const ownShip = [...test.db.ship.iter()].find(s => s.x === 8)!;

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
  test.withReducerTx(alice, ctx => moduleExports.createMatch(ctx, { seed: 3, maxSlots: 2 }));
  const matchId = [...test.db.match.iter()][0]!.id;
  test.withReducerTx(bob, ctx => moduleExports.joinMatch(ctx, { matchId }));

  const aliceShips = test.runQuery(moduleExports.myShips(test.viewContext(alice)));
  const bobShips = test.runQuery(moduleExports.myShips(test.viewContext(bob)));
  expect(aliceShips).toHaveLength(1);
  expect(bobShips).toHaveLength(1);
  expect(aliceShips[0]?.id).not.toBe(bobShips[0]?.id);
  expect(test.runQuery(moduleExports.myMemberships(test.viewContext(alice)))).toHaveLength(1);
});
