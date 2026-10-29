import test from "node:test";
import assert from "node:assert/strict";
import { dispatchWorkshopRepair, dispatchWorkshopUpgrade }
  from "../spacetimedb/src/sim/workshop-command-dispatch.ts";
const faction={matchId:8n,slot:2,controller:"human",eliminated:false};
const bot={...faction,controller:"bot"};
const workshop={id:3n,matchId:8n,ownerSlot:2,kind:"workshop",
  complete:true,connected:true,hp:680,level:1,upgradeRemainingUs:0n,
  gridX:3,gridY:3,width:2,height:2};
const target={id:6n,matchId:8n,ownerSlot:2,type:"ship",kind:"scout",
  hp:150,level:1,complete:true,connected:true,x:5,y:4};
const repair=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchWorkshopRepair({
  faction:actor,workshop,target,requestedHp:100,salvage:420,...change
 },{
  setBalance:n=>writes.push(["balance",n]),
  setTargetHp:(id,hp)=>writes.push(["hp",id,hp]),
 });
 return {result,writes};
};
const upgrade=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchWorkshopUpgrade({
  faction:actor,workshop,salvage:420,nowUs:100_000n,...change,
 },{
  setBalance:n=>writes.push(["balance",n]),
  setUpgrade:(time,started)=>writes.push(["upgrade",time,started]),
 });
 return {result,writes};
};
test("identical human and bot ship repairs restore only actual bounded HP",()=>{
 const a=repair(),b=repair(bot);
 assert.deepEqual(a,b);assert.equal(a.result.ok,true);
 assert.deepEqual(a.writes,[["balance",390],["hp",6n,210]]);
});
test("repair a complete connected structure using authoritative max HP",()=>{
 const structure={...target,type:"structure",kind:"platform",hp:200};
 const r=repair(bot,{target:structure,requestedHp:40});
 assert.deepEqual(r.writes,[["balance",400],["hp",6n,240]]);
});
test("foreign ownership, different match and eliminated factions make no writes",()=>{
 for(const change of [
  {target:{...target,ownerSlot:1}},{target:{...target,matchId:9n}},
  {workshop:{...workshop,ownerSlot:1}},
  {faction:{...bot,eliminated:true}}
 ])assert.deepEqual(repair(bot,change).writes,[]);
});
test("unavailable or upgrading workshop cannot repair",()=>{
 for(const wk of [{...workshop,hp:0},{...workshop,connected:false},
  {...workshop,complete:false},{...workshop,upgradeRemainingUs:100n}])
  assert.deepEqual(repair(bot,{workshop:wk}).writes,[]);
});
test("out-of-range or damaged unfinished structure cannot be repaired",()=>{
 for(const tgt of [{...target,x:100},
  {...target,type:"structure",kind:"platform",complete:false},
  {...target,hp:0}])assert.deepEqual(repair(bot,{target:tgt}).writes,[]);
});
test("no repair at full health, invalid requested HP or insufficient resources",()=>{
 for(const change of [{target:{...target,hp:210}},
  {requestedHp:0},{requestedHp:-1},{salvage:10}])
  assert.deepEqual(repair(bot,change).writes,[]);
});
test("both controllers pay and schedule the same tier-2 upgrade",()=>{
 const a=upgrade(),b=upgrade(bot);
 assert.deepEqual(a,b);assert.equal(a.result.ok,true);
 assert.deepEqual(a.writes,[["balance",220],["upgrade",6_000_000n,100_000n]]);
});
test("tier upgrades reject already upgrading, max level and low balance",()=>{
 for(const change of [
  {workshop:{...workshop,upgradeRemainingUs:1n}},
  {workshop:{...workshop,level:3}},
  {salvage:199},{nowUs:-1n},
 ])assert.deepEqual(upgrade(bot,change).writes,[]);
});
test("destroyed workshop and invalid faction cannot upgrade with side effects",()=>{
 for(const change of [
  {workshop:{...workshop,hp:0}},{workshop:{...workshop,kind:"shipyard"}},
  {faction:{...bot,slot:3}},{faction:{...bot,eliminated:true}},
 ])assert.deepEqual(upgrade(bot,change).writes,[]);
});
