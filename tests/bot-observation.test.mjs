import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleResources, orderedBuildOrigins } from '../spacetimedb/src/sim/bot-observation.ts';
const sensor=(x,y,radius)=>({position:{x,y},radius});
const node=(id,x,y,remaining=100)=>({id:BigInt(id),gridX:x,gridY:y,remaining});

test('resource detection applies range, occlusion and depletion before policy sees nodes',()=>{
 const input=[node(5,2,2),node(1,7,7),node(3,3,3),node(4,4,4,0)];
 const seen=visibleResources(input,[sensor(2.5,2.5,4)],(from,to)=>to.x!==3.5);
 assert.deepEqual(seen.map(row=>row.id),[5n]);
});
test('multiple sensors deduplicate and sort resources deterministically',()=>{
 const sources=[sensor(2.5,2.5,3),sensor(3.5,3.5,3)];
 const a=visibleResources([node(4,3,3),node(2,2,2)],sources,()=>true);
 const b=visibleResources([node(2,2,2),node(4,3,3)],sources.toReversed(),()=>true);
 assert.deepEqual(a,b);assert.deepEqual(a.map(v=>v.id),[2n,4n]);
});
test('no sensor produces no information, even if server has all deposits',()=>{
 assert.deepEqual(visibleResources([node(1,2,2)],[],()=>true),[]);
});
test('mounted construction starts at real owned connected platforms',()=>{
 const structures=[
 {kind:'command_core',channel:'surface',complete:true,gridX:7,gridY:7,width:3,height:3},
 {kind:'platform',channel:'surface',complete:true,gridX:7,gridY:10,width:1,height:1},
 {kind:'platform',channel:'surface',complete:true,gridX:8,gridY:10,width:1,height:1},
 ];
 const mounted=orderedBuildOrigins(structures,20,true);
 assert.deepEqual(mounted.slice(0,2),[{x:7,y:10},{x:8,y:10}]);
 const extension=orderedBuildOrigins(structures,20,false);
 assert.ok(extension.length>mounted.slice(0,2).length);
});
test('incomplete pads and unreachable bounds are not preferred',()=>{
 const pads=[{kind:'platform',channel:'surface',complete:false,gridX:1,gridY:1,width:1,height:1}];
 assert.deepEqual(orderedBuildOrigins(pads,10,true),[]);
 assert.throws(()=>orderedBuildOrigins(pads,1,true),RangeError);
});
