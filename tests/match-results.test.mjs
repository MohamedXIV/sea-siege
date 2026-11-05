import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFinalStandings, matchResultForSlot,
} from "../spacetimedb/src/sim/final-standings.ts";

test("final standings use surviving assets and exact original fifth-point weights", () => {
  const standings = calculateFinalStandings([
    { slot: 1, controller: "bot", eliminated: true, totalSalvageGathered: 17n },
    { slot: 0, controller: "human", eliminated: false, totalSalvageGathered: 9n },
  ], [
    { ownerSlot: 0, kind: "command_core", hp: 1000 },
    { ownerSlot: 0, kind: "workshop", hp: 300 },
    { ownerSlot: 1, kind: "command_core", hp: 0 },
  ], [{ ownerSlot: 0, hp: 210 }, { ownerSlot: 1, hp: 0 }], [
    { ownerSlot: 0, totalGathered: 11n },
    { ownerSlot: 0, totalGathered: 19n },
    { ownerSlot: 1, totalGathered: 5n },
  ]);
  assert.equal(standings.length, 2);
  assert.deepEqual(standings.map(row => row.slot), [0, 1]);
  assert.equal(standings[0].coreHp, 1000);
  assert.equal(standings[0].structures, 2);
  assert.equal(standings[0].ships, 1);
  assert.equal(standings[0].advancedGathered, 30n);
  assert.equal(standings[0].score5, 1000n * 5n + 2n * 400n + 500n + 9n);
  assert.equal(standings[1].eliminated, true);
  assert.equal(standings[1].score5, 17n);
  assert.equal(standings[1].advancedGathered, 5n);
});

test("results honor server phase/winner, not local rank calculations", () => {
  assert.equal(matchResultForSlot("active", 0, 0), "pending");
  assert.equal(matchResultForSlot("finished", 0, 0), "victory");
  assert.equal(matchResultForSlot("finished", 0, 1), "defeat");
  assert.equal(matchResultForSlot("finished", -1, 0), "draw");
  assert.equal(matchResultForSlot("finished", 2, null), "spectator");
});

test("duplicate or malformed faction slots cannot silently falsify standings", () => {
  assert.throws(() => calculateFinalStandings([
    { slot: 1, controller: "human", eliminated: false, totalSalvageGathered: 0n },
    { slot: 1, controller: "bot", eliminated: false, totalSalvageGathered: 0n },
  ], [], [], []), /duplicate/);
});
