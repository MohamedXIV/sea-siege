import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBotEnemies } from '../spacetimedb/src/sim/bot-perception.ts';
const p=(x,y)=>({x,y});
const s=(id,x,y,radius=6)=>({id:BigInt(id),position:p(x,y),radius});
const c=(id,faction,x,y,entityType='ship',alive=true)=>
 ({id:BigInt(id),faction,entityType,position:p(x,y),alive});
const sea=()=>new Uint8Array(12*12);
test('only live foreign contacts within sensor range become visible',()=>{
 const seen=detectBotEnemies(0,42n,[s(1,2,2)],[c(1,0,3,2),c(2,1,4,2),c(3,1,10,2),c(4,1,5,2,'structure',false)],sea(),12);
 assert.deepEqual(seen,[{id:2n,entityType:'ship',position:p(4,2),observedAtUs:42n}]);
});
test('ruins block LoS despite an in-range contact',()=>{
 const terrain=sea();terrain[2*12+4]=2;
 assert.deepEqual(detectBotEnemies(0,42n,[s(1,2.5,2.5)],[c(2,1,6.5,2.5)],terrain,12),[]);
});
test('multi-sensor union is deterministic with no duplicate contact leak',()=>{
 const sensors=[s(5,5,5),s(1,2,2)];
 const contacts=[c(8,1,4,4),c(7,2,3,3),c(8,1,4,4)];
 const a=detectBotEnemies(0,40n,sensors,contacts,sea(),12);
 const b=detectBotEnemies(0,40n,[...sensors].reverse(),[...contacts].reverse(),sea(),12);
 assert.deepEqual(a,b);assert.deepEqual(a.map(e=>e.id),[7n,8n]);
});
test('zero sensors and mismatched terrain cannot expose enemies',()=>{
 assert.deepEqual(detectBotEnemies(0,0n,[],[c(7,1,3,3)],sea(),12),[]);
 assert.throws(()=>detectBotEnemies(0,0n,[s(1,2,2)],[c(7,1,3,3)],sea(),13),RangeError);
});
