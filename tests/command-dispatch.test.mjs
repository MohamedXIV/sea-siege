import test from "node:test";
import assert from "node:assert/strict";
import { dispatchHarvest, dispatchProduction } from "../spacetimedb/src/sim/command-dispatch.ts";

const human = { matchId: 11n, slot: 0, controller: "human", eliminated: false };
const bot = { ...human, controller: "bot" };
const ship = { id: 2n, matchId: 11n, ownerSlot: 0, kind: "scout",
  x: 4.5, y: 5.5, revision: 3n };
const node = { id: 9n, matchId: 11n, gridX: 5, gridY: 5, remaining: 100 };
const yard = { id: 7n, matchId: 11n, ownerSlot: 0, kind: "shipyard",
  complete: true, connected: true, hp: 800 };

function harvesting(faction = human, changes = {}) {
  const writes = [];
  const result = dispatchHarvest({
    faction, ship, node, nowUs: 123n, observable: true, ...changes,
  }, {
    clearRoute: id => writes.push(["route-deleted", id]),
    upsertOrder: order => writes.push(["order-upserted", order]),
    stopForHarvest: (id,revision) => writes.push(["ship-stopped", id, revision]),
  });
  return { result, writes };
}
function producing(faction = human, changes = {}) {
  const writes = [];
  const result = dispatchProduction({
    faction, yard, kind: "scout", salvage: 420, queued: 0, nowUs: 123n,
    ...changes,
  }, {
    setBalance: amount => writes.push(["balance", amount]),
    enqueue: order => writes.push(["enqueue", order]),
  });
  return { result, writes };
}

test("human and bot harvest use byte-for-byte identical mutation contract", () => {
  const a = harvesting(human), b = harvesting(bot);
  assert.deepEqual(a, b);
  assert.equal(a.result.ok, true);
  assert.deepEqual(a.writes.map(w=>w[0]),
    ["route-deleted","order-upserted","ship-stopped"]);
  assert.deepEqual(a.writes[1][1], {
    shipId: 2n, matchId: 11n, nodeId: 9n, assignedAtUs: 123n,
  });
  assert.equal(a.writes[2][2], 4n);
});
test("harvest rejects wrong owner or cross-match node with zero side effects", () => {
  assert.deepEqual(harvesting(human, {ship: {...ship, ownerSlot: 1}}).writes,[]);
  assert.deepEqual(harvesting(bot, {node: {...node, matchId: 12n}}).writes,[]);
  assert.deepEqual(harvesting(bot, {ship: {...ship, matchId: 12n}}).writes,[]);
});
test("harvest respects server visibility, depletion and real distance", () => {
  assert.deepEqual(harvesting(bot, {observable:false}).writes,[]);
  assert.deepEqual(harvesting(human, {node: {...node, remaining:0}}).writes,[]);
  assert.deepEqual(harvesting(human, {node: {...node, gridX:40}}).writes,[]);
});
test("eliminated faction cannot mutate harvest orders", () => {
  const output=harvesting({...bot,eliminated:true});
  assert.equal(output.result.ok,false);
  assert.deepEqual(output.writes,[]);
});
test("a non-harvester cannot begin gathering", () => {
  assert.deepEqual(harvesting(bot, {ship: {...ship,kind:"siege"}}).writes,[]);
});

test("both controllers pay precisely the same ship cost and FIFO enqueue", () => {
  const a=producing(human), b=producing(bot);
  assert.deepEqual(a,b);
  assert.equal(a.result.ok,true);
  assert.deepEqual(a.writes.map(w=>w[0]),["balance","enqueue"]);
  assert.equal(a.writes[0][1],350);
  assert.deepEqual(a.writes[1][1],{
    matchId: 11n, yardId: 7n, ownerSlot: 0, shipKind: "scout",
    remainingUs: 4_000_000n, queuedAtUs: 123n, startedAtUs: 0n,
  });
});
test("unaffordable or full-queue production makes ZERO writes", () => {
  for(const changes of [{salvage:69},{queued:5},{queued:2,queueCap:2},
    {queued:-1},{kind:"secret_ship"},{nowUs:-1n}]) {
    const result=producing(bot,changes);
    assert.equal(result.result.ok,false);
    assert.deepEqual(result.writes,[]);
  }
});
test("production cannot use foreign yard, wrong match or destroyed yard", () => {
  for(const changes of [{yard:{...yard,ownerSlot:3}},
    {yard:{...yard,matchId:999n}},{yard:{...yard,hp:0}},
    {yard:{...yard,complete:false}},{yard:{...yard,connected:false}},
    {faction:{...bot,eliminated:true}}]){
    assert.deepEqual(producing(bot,changes).writes,[]);
  }
});
test("invalid queue cap cannot waive global maximum or enable negative slots", () => {
  for(const queueCap of [0,6,-1,1.2,Infinity]){
    const output=producing(bot,{queueCap});
    assert.equal(output.result.ok,false);
    assert.deepEqual(output.writes,[]);
  }
});
test("two sequential paid orders require fresh authoritative balance", () => {
  let balance=130, orders=0;
  const dispatch=()=>dispatchProduction({
    faction:bot,yard,kind:"gunboat",salvage:balance,queued:orders,nowUs:456n,
  },{
    setBalance:x=>{balance=x},
    enqueue:()=>{orders++},
  });
  assert.equal(dispatch().ok,true);
  assert.equal(balance,0);assert.equal(orders,1);
  assert.equal(dispatch().ok,false);
  assert.equal(balance,0);assert.equal(orders,1);
});
