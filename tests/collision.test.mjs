import test from 'node:test';
import assert from 'node:assert/strict';
import { canSweepVessel, COLLISION_RULES, createVesselBodies, isNavigationCellBlocked } from '../spacetimedb/src/sim/collision.ts';
import { TERRAIN } from '../spacetimedb/src/sim/worldgen.ts';
const size=12;
const sea=() => new Uint8Array(size*size);
const p=(x,y)=>({x,y});
const R=COLLISION_RULES.scoutRadiusCells;

test('blocks a high-speed sweep through impassable terrain despite clear destination',()=>{
 const terrain=sea(); terrain[5*size+5]=TERRAIN.RUINED_PILLAR;
 assert.equal(canSweepVessel(p(3.5,5.5),p(8.5,5.5),R,{mapCells:size,terrain}),false);
 assert.equal(canSweepVessel(p(3.5,4.5),p(8.5,4.5),R,{mapCells:size,terrain}),true);
});
test('blocks a newly constructed 3x2 footprint, including diagonal crossing',()=>{
 const env={mapCells:size,terrain:sea(),footprints:[{x:5,y:4,width:3,height:2}]};
 assert.equal(canSweepVessel(p(3.5,4.5),p(9.5,4.5),R,env),false);
 assert.equal(canSweepVessel(p(3.5,2.5),p(9.5,2.5),R,env),true);
 assert.equal(canSweepVessel(p(4.5,3.5),p(8.5,6.5),R,env),false);
});
test('ships block each other using combined hull radii, self is excluded',()=>{
 const vessels=createVesselBodies([{id:1n,x:5.5,y:5.5},{id:2n,x:8.5,y:5.5}]);
 const env={mapCells:size,terrain:sea(),vessels};
 assert.equal(canSweepVessel(p(4.5,5.5),p(6.5,5.5),R,env,1n),true);
 assert.equal(canSweepVessel(p(4.5,5.5),p(6.5,5.5),R,env,2n),false);
 assert.equal(canSweepVessel(p(2.5,5.5),p(9.5,5.5),R,env),false);
 assert.equal(canSweepVessel(p(2.5,4.5),p(9.5,4.5),R,env),true);
});
test('prevents boundary escape, NaN coordinates, malformed bodies',()=>{
 const env={mapCells:size,terrain:sea()};
 assert.equal(canSweepVessel(p(1.5,1.5),p(-1,1),R,env),false);
 assert.equal(canSweepVessel(p(1.5,1.5),p(NaN,1),R,env),false);
 assert.throws(()=>canSweepVessel(p(1,1),p(2,2),R,{...env,footprints:[{x:1,y:1,width:-2,height:2}]}),RangeError);
});
test('handles same-position idle motion without inventing velocity or other changes',()=>{
 const env={mapCells:size,terrain:sea()};
 assert.equal(canSweepVessel(p(3.5,3.5),p(3.5,3.5),R,env),true);
 const obs={mapCells:size,terrain:sea(),vessels:createVesselBodies([{id:3n,x:3.5,y:3.5}])};
 assert.equal(canSweepVessel(p(3.5,3.5),p(3.5,3.5),R,obs,3n),true);
});

test('navigation cell gate includes ship hulls and rectangular future structures',()=>{
 const env={mapCells:size,terrain:sea(),footprints:[{x:6,y:6,width:2,height:2}],
   vessels:createVesselBodies([{id:1n,x:3.5,y:3.5}])};
 assert.equal(isNavigationCellBlocked(3,3,R,env),true);
 assert.equal(isNavigationCellBlocked(3,3,R,env,1n),false);
 assert.equal(isNavigationCellBlocked(6,6,R,env),true);
 assert.equal(isNavigationCellBlocked(8,8,R,env),false);
});
