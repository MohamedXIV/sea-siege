import test from "node:test";
import assert from "node:assert/strict";
import { dispatchAim, dispatchFire } from "../spacetimedb/src/sim/combat-command-dispatch.ts";
const faction={matchId:2n,slot:0,controller:"human",eliminated:false};
const bot={...faction,controller:"bot"};
const source={id:1n,matchId:2n,ownerSlot:0,type:"ship",kind:"scout",
 x:1.5,y:2.5,hp:210,complete:true,connected:true,
 turretAngleDeg:0,lastFiredAtUs:-1n};
const target={id:9n,matchId:2n,ownerSlot:1,type:"ship",x:4.5,y:2.5,hp:210};
const sea=new Uint8Array(12*12);
const fire=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchFire({faction:actor,source,target,nowUs:2_000_000n,
   terrain:sea,mapCells:12,projectileCount:0,targetVisible:true,...change},{
   markFired:(s,at)=>writes.push(["fire",s.id,at]),
   insertProjectile:p=>writes.push(["projectile",p]),
   ensureCombatTick:()=>writes.push(["timer"]),
 });
 return {result,writes};
};
const aim=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchAim({faction:actor,source,desiredAngleDeg:90,...change},{
   clearAim:(type,id)=>writes.push(["clear",type,id]),
   upsertAim:(type,id,angle)=>writes.push(["aim",type,id,angle]),
   ensureCombatTick:()=>writes.push(["timer"]),
 });
 return {result,writes};
};
test("human and bot identical aim state and 1-match timer",()=>{
 const a=aim(),b=aim(bot);assert.deepEqual(a,b);
 assert.deepEqual(a.writes,[["aim","ship",1n,90],["timer"]]);
});
test("current desired angle cancels pending aim without combat timer",()=>{
 const r=aim(bot,{desiredAngleDeg:0});
 assert.deepEqual(r.writes,[["clear","ship",1n]]);
});
test("cannot aim foreign, dead or offline cannon, or invalid angle",()=>{
 for(const change of [
  {source:{...source,ownerSlot:1}},{source:{...source,hp:0}},
  {source:{...source,type:"structure",kind:"shipyard"}},
  {source:{...source,type:"structure",kind:"cannon",connected:false}},
  {desiredAngleDeg:360},{desiredAngleDeg:NaN},
  {faction:{...bot,eliminated:true}}
 ])assert.deepEqual(aim(bot,change).writes,[]);
});
test("human and bot create same non-homing authoritative projectile",()=>{
 const a=fire(),b=fire(bot);assert.deepEqual(a,b);
 assert.equal(a.result.ok,true);
 assert.deepEqual(a.writes.map(x=>x[0]),["fire","projectile","timer"]);
 assert.equal(a.writes[1][1].sourceFaction,0);
 assert.equal(a.writes[1][1].remainingRange,3);
});
test("invisible, foreign match and friendly targets cannot create projectile",()=>{
 for(const change of [
   {targetVisible:false},{target:{...target,matchId:3n}},
   {target:{...target,ownerSlot:0}},{target:{...target,hp:0}},
   {faction:{...bot,eliminated:true}},
 ])assert.deepEqual(fire(bot,change).writes,[]);
});
test("turret misalignment and cooldown suppress fire without writes",()=>{
 for(const change of [{source:{...source,turretAngleDeg:90}},
   {source:{...source,lastFiredAtUs:1_999_500n}}])
   assert.deepEqual(fire(bot,change).writes,[]);
});
test("bad terrain LoS, long range and exhausted projectile cap are rejected",()=>{
 const blocked=new Uint8Array(sea);blocked[2*12+3]=2;
 for(const change of [{terrain:blocked},{target:{...target,x:11.5}},
   {projectileCount:512}])
   assert.deepEqual(fire(bot,change).writes,[]);
});
test("server can fire after cooldown but cannot forge a projectile at an arbitrary position",()=>{
 const r=fire(bot,{source:{...source,lastFiredAtUs:0n},nowUs:2_000_000n});
 assert.equal(r.result.ok,true);
 const p=r.writes[1][1];
 assert.equal(p.x,1.5);assert.equal(p.y,2.5);
 assert.equal(p.sourceId,1n);assert.equal(p.sourceType,"ship");
});
