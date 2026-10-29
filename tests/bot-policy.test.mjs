import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBot, BOT_RULES } from '../spacetimedb/src/sim/bot-policy.ts';
const p=(x,y)=>({x,y});
const ship=(id,kind='scout',position=p(2,2),angle=0,busy=false)=>({id:BigInt(id),kind,position,hp:210,turretAngleDeg:angle,busy});
const obs=(changes={})=>({slot:0,seed:42,nowUs:10_000_000n,salvage:420,
 ships:[ship(1)],structures:[],visibleEnemies:[],knownDeposits:[],
 legalBuildCandidates:[],explorationFrontiers:[],...changes});

test('all difficulties are bounded and have strategic cadence, no frame ticks',()=>{
 for(const difficulty of ['easy','normal','hard']){
   const result=decideBot(obs(),difficulty);
   assert.ok(result.intents.length<=BOT_RULES.difficulties[difficulty].maxOrders);
   assert.equal(result.nextDecisionUs-10_000_000n,BOT_RULES.difficulties[difficulty].intervalUs);
 }
});
test('observed enemy triggers aim then fire, not a snap, and no hidden target',()=>{
 const enemy={id:6n,entityType:'ship',position:p(2,5),observedAtUs:10_000_000n};
 assert.deepEqual(decideBot(obs({visibleEnemies:[enemy]}),'easy').intents,
   [{type:'aim',shipId:1n,angleDeg:90}]);
 assert.deepEqual(decideBot(obs({ships:[ship(1,'scout',p(2,2),90)],visibleEnemies:[enemy]}),'easy').intents,
   [{type:'fire',shipId:1n,targetType:'ship',targetId:6n}]);
 assert.deepEqual(decideBot(obs({hiddenEnemies:[enemy]}),'easy').intents,[]);
});
test('stale enemy observations cannot produce attack orders',()=>{
 const enemy={id:6n,entityType:'ship',position:p(2,5),observedAtUs:7_000_000n};
 assert.deepEqual(decideBot(obs({visibleEnemies:[enemy]}),'normal').intents,[]);
});
test('newly discovered salvage can be harvested or approached only with a nonbusy ship',()=>{
 const deposit={id:3n,position:p(3,2),remaining:8};
 assert.deepEqual(decideBot(obs({knownDeposits:[deposit]}),'easy').intents,
   [{type:'harvest',shipId:1n,nodeId:3n}]);
 assert.deepEqual(decideBot(obs({knownDeposits:[{...deposit,position:p(10,2)}]}),'easy').intents,
   [{type:'move',shipId:1n,destination:p(10,2)}]);
 assert.deepEqual(decideBot(obs({ships:[ship(1,'siege')],knownDeposits:[deposit]}),'easy').intents,[]);
 assert.deepEqual(decideBot(obs({ships:[ship(1,'scout',p(2,2),0,true)],knownDeposits:[deposit]}),'easy').intents,[]);
});
test('builds only from explicit legal placements; does not invent map cells',()=>{
 assert.deepEqual(decideBot(obs({salvage:420,legalBuildCandidates:[{kind:'shipyard',gridX:4,gridY:6}]}),'easy').intents,
   [{type:'build',kind:'shipyard',gridX:4,gridY:6}]);
 assert.deepEqual(decideBot(obs({salvage:140,legalBuildCandidates:[{kind:'shipyard',gridX:4,gridY:6}]}),'easy').intents,[]);
});
test('existing operational yards produce with difficulty-specific policy and budget',()=>{
 const yard={id:10n,kind:'shipyard',position:p(5,5),complete:true,connected:true,queueLength:0};
 const rigs={id:12n,kind:'salvage_rig',position:p(6,6),complete:true,connected:true,queueLength:0};
 const x=obs({structures:[yard,rigs],ships:[ship(1),ship(2),ship(3)],salvage:240});
 assert.ok(decideBot(x,'hard').intents.some(i=>i.type==='enqueue' && i.shipKind==='siege'));
 assert.ok(decideBot(x,'easy').intents.some(i=>i.type==='enqueue' && i.shipKind==='scout'));
 assert.deepEqual(decideBot(obs({structures:[{...yard,connected:false}]}),'easy').intents,[]);
});
test('reserves salvage across multiple proposals in a single decision batch',()=>{
 const yard={id:10n,kind:'shipyard',position:p(5,5),complete:true,connected:true,queueLength:0};
 const result=decideBot(obs({salvage:160,structures:[yard],legalBuildCandidates:[{kind:'salvage_rig',gridX:6,gridY:7}]}),'hard');
 assert.ok(result.intents.some(i=>i.type==='build'));
 assert.ok(!result.intents.some(i=>i.type==='enqueue')); // 160 - 110 < 220
});
test('permuting server-projected rows never changes deterministic choices',()=>{
 const enemies=[{id:9n,entityType:'ship',position:p(3,4),observedAtUs:10_000_000n},
 {id:8n,entityType:'ship',position:p(4,3),observedAtUs:10_000_000n}];
 const a=obs({ships:[ship(2,'gunboat'),ship(1)],visibleEnemies:enemies});
 const b=obs({ships:[...a.ships].reverse(),visibleEnemies:[...enemies].reverse()});
 assert.deepEqual(decideBot(a,'hard'),decideBot(b,'hard'));
 assert.deepEqual(decideBot(a,'hard'),decideBot(a,'hard'));
});
test('exploration uses only exposed frontier points and stable seeded selection',()=>{
 const x=obs({explorationFrontiers:[p(8,8),p(9,9)]});
 const result=decideBot(x,'easy');
 assert.equal(result.intents.length,1);
 assert.equal(result.intents[0].type,'move');
 assert.ok(x.explorationFrontiers.some(p=>p.x===result.intents[0].destination.x));
});
test('rejects negative salvage, future observations, invalid ship positions and unknown difficulty',()=>{
 assert.throws(()=>decideBot(obs({salvage:-1}),'easy'),RangeError);
 assert.throws(()=>decideBot(obs({visibleEnemies:[{id:2n,entityType:'ship',position:p(4,4),observedAtUs:11_000_000n}]}),'easy'),RangeError);
 assert.throws(()=>decideBot(obs({ships:[ship(1,'scout',p(Infinity,2))]}),'easy'),RangeError);
 assert.throws(()=>decideBot(obs(),'unlimited'),RangeError);
});
