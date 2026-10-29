import test from "node:test";
import assert from "node:assert/strict";
import { dispatchMovement, dispatchConstruction } from "../spacetimedb/src/sim/world-command-dispatch.ts";
const faction = { matchId: 2n, slot: 1, controller: "human", eliminated: false };
const bot = { ...faction, controller: "bot" };
const ship = { id: 10n, matchId: 2n, ownerSlot: 1, radiusCells: .42,
  x: 2.5, y: 2.5, revision: 4n, velocityX: 0, velocityY: 0 };
const terrain = new Uint8Array(12*12);
const env = {mapCells:12,terrain,vessels:[{id:ship.id,x:ship.x,y:ship.y,radius:ship.radiusCells}]};
const move=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchMovement({faction:actor,ship,destination:{x:5.5,y:2.5},
   environment:env,destinationVisible:true,...change},{
   cancelHarvest:id=>writes.push(["cancelHarvest",id]),
   setRoute:route=>writes.push(["route",route]),
   updateShip:row=>writes.push(["update",row]),
   ensureMotionTick:()=>writes.push(["timer"]),
 });
 return {result,writes};
};
const structures=[
 {id:1n,ownerSlot:1,kind:"command_core",gridX:4,gridY:4,width:3,height:3,complete:true},
 {id:2n,ownerSlot:1,kind:"platform",gridX:4,gridY:7,width:1,height:1,complete:true},
 {id:3n,ownerSlot:1,kind:"platform",gridX:5,gridY:7,width:1,height:1,complete:true},
];
const build=(actor=faction,change={})=>{
 const writes=[];
 const result=dispatchConstruction({
   faction:actor,nowUs:100_000n,locationAllowed:true,
   request:{kind:"platform",ownerSlot:1,gridX:3,gridY:7,
      salvage:420,mapCells:12,terrain,structures,deposits:[],hulls:[]},...change
 },{
   setBalance:value=>writes.push(["balance",value]),
   insertStructure:row=>{writes.push(["structure",row]);return 55n},
   scheduleCompletion:(id,when)=>writes.push(["schedule",id,when]),
 });
 return {result,writes};
};
test("humans and bots share exactly the same movement transaction",()=>{
 const a=move(),b=move(bot);assert.deepEqual(a,b);
 assert.equal(a.result.ok,true);
 assert.deepEqual(a.writes.map(x=>x[0]),["cancelHarvest","route","update","timer"]);
 assert.equal(a.writes[1][1].revision,5n);
 assert.equal(a.writes[2][1].targetX,5.5);
});
test("foreign vessel, eliminated actor or invisible bot destination has zero writes",()=>{
 for(const change of [
   {ship:{...ship,ownerSlot:2}}, {faction:{...bot,eliminated:true}},
   {destinationVisible:false}
 ])assert.deepEqual(move(bot,change).writes,[]);
});
test("nonfinite and out-of-bounds destinations are rejected before any writes",()=>{
 for(const destination of [{x:NaN,y:2},{x:20,y:1},{x:-1,y:1}])
 assert.deepEqual(move(bot,{destination}).writes,[]);
});
test("blocked destination rejects movement before replacing existing harvest",()=>{
 const blocked=new Uint8Array(12*12);blocked[2*12+5]=2;
 assert.deepEqual(move(bot,{environment:{...env,terrain:blocked}}).writes,[]);
});
test("same-cell movement stops without scheduling a new timer",()=>{
 const output=move(bot,{destination:{x:2.5,y:2.5}});
 assert.equal(output.result.ok,true);
 assert.deepEqual(output.writes.map(x=>x[0]),["cancelHarvest","route","update"]);
 assert.equal(output.writes[1][1],null);
 assert.equal(output.writes[2][1].stopImmediately,true);
});
test("humans and bots build with identical charged schedule and footprint",()=>{
 const a=build(),b=build(bot);assert.deepEqual(a,b);
 assert.equal(a.result.ok,true);
 assert.deepEqual(a.writes.map(x=>x[0]),["balance","structure","schedule"]);
 assert.equal(a.writes[0][1],395);
 assert.equal(a.writes[1][1].ownerSlot,1);
 assert.equal(a.writes[2][1],55n);
 assert.equal(a.writes[2][2],1_600_000n);
});
test("bad faction or unapproved site rejects construction with zero writes",()=>{
 for(const change of [{faction:{...bot,slot:2}},
   {faction:{...bot,eliminated:true}},{locationAllowed:false}])
   assert.deepEqual(build(bot,change).writes,[]);
});
test("construction enforces support, cost, bounds and core protection before charging",()=>{
 for(const req of [{salvage:10},{gridX:0},{gridX:10},
   {kind:"command_core"},{gridX:9,gridY:9}]) {
   const result=build(bot,{request:{kind:"platform",ownerSlot:1,gridX:3,gridY:7,
       salvage:420,mapCells:12,terrain,structures,deposits:[],hulls:[],...req}});
   assert.deepEqual(result.writes,[]);
 }
});
test("building cannot occupy a vessel hull or a salvage deposit",()=>{
 const base={kind:"platform",ownerSlot:1,gridX:3,gridY:7,
      salvage:420,mapCells:12,terrain,structures,deposits:[],hulls:[]};
 for(const addition of [{hulls:[{x:3.5,y:7.5,radius:.42}]},
   {deposits:[{x:3,y:7}]}])
   assert.deepEqual(build(bot,{request:{...base,...addition}}).writes,[]);
});
