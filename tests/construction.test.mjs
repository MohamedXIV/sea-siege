import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTRUCTION_RULES, connectedSurfaceCells, initialStructures, occupancyIndex, structureOnline, validateStructurePlacement } from '../spacetimedb/src/sim/construction.ts';
import { TERRAIN } from '../spacetimedb/src/sim/worldgen.ts';
const size = 32;
const terrain=()=>new Uint8Array(size*size);
const initial=()=>initialStructures(0,4,4).map((s,i)=>({...s,id:BigInt(i+1)}));
const request=(kind,gridX,gridY,structures=initial(),other={})=>({kind,gridX,gridY,ownerSlot:0,salvage:420,mapCells:size,terrain:terrain(),structures,deposits:[],hulls:[],...other});

test('Gemini 3x3 core plus six platforms is connected and preserves separate layers',()=>{
 const structs=initial();
 const con=connectedSurfaceCells(size,structs,0);
 assert.equal(con.size,15);
 assert.equal(occupancyIndex(size,structs).surface.size,15);
 assert.equal(validateStructurePlacement(request('workshop',4,7)),null);
 assert.equal(validateStructurePlacement(request('shipyard',4,7)),null);
 const mounted={id:100n,kind:'workshop',ownerSlot:0,gridX:4,gridY:7,width:2,height:2,complete:true};
 const idx=occupancyIndex(size,[...structs,mounted]);
 assert.equal(idx.surface.size,15);
 assert.equal(idx.mounted.size,4);
 assert.equal(structureOnline(mounted,[...structs,mounted],size),true);
});

test('platform expansion must touch completed connected friendly surface orthogonally',()=>{
 const structs=initial();
 assert.equal(validateStructurePlacement(request('platform',3,4,structs)),null);
 assert.match(validateStructurePlacement(request('platform',0,4,structs)),/Invalid/);
 assert.match(validateStructurePlacement(request('platform',13,13,structs)),/touch/);
 assert.match(validateStructurePlacement(request('platform',5,7,structs)),/occupied/);
 const incomplete=[...structs,{id:99n,kind:'platform',ownerSlot:0,gridX:11,gridY:11,width:1,height:1,complete:false}];
 assert.match(validateStructurePlacement(request('platform',12,11,incomplete)),/touch/);
 const enemy=initialStructures(1,14,14).map((s,i)=>({...s,id:BigInt(100+i)}));
 assert.match(validateStructurePlacement(request('platform',13,14,enemy)),/touch/);
});

test('multi-cell mounts need four distinct connected completed platforms, not a core',()=>{
 const structs=initial();
 assert.match(validateStructurePlacement(request('workshop',4,4,structs)),/Requires/);
 const less=structs.filter(st=>!(st.kind==='platform'&&st.gridX===5&&st.gridY===8));
 assert.match(validateStructurePlacement(request('workshop',4,7,less)),/Requires/);
 const incomplete=structs.map(st=>st.kind==='platform'&&st.gridX===5&&st.gridY===8?{...st,complete:false}:st);
 assert.match(validateStructurePlacement(request('workshop',4,7,incomplete)),/Requires/);
 const otherMount={id:90n,ownerSlot:0,kind:'workshop',gridX:4,gridY:7,width:2,height:2,complete:true};
 assert.match(validateStructurePlacement(request('shipyard',4,7,[...structs,otherMount])),/occupied/);
});

test('a bridge demolition disconnects distant decks and makes their mount offline',()=>{
 const core=initial();
 const bridge={id:30n,ownerSlot:0,kind:'platform',gridX:7,gridY:5,width:1,height:1,complete:true};
 const far={id:31n,ownerSlot:0,kind:'platform',gridX:8,gridY:5,width:1,height:1,complete:true};
 const all=[...core,bridge,far];
 assert.equal(connectedSurfaceCells(size,all,0).has(5*size+8),true);
 assert.equal(connectedSurfaceCells(size,all.filter(st=>st.id!==30n),0).has(5*size+8),false);
});

test('rejects salvage deposits, insufficient salvage, terrain blockers and hull overlap',()=>{
 assert.match(validateStructurePlacement(request('platform',3,5,initial(),{salvage:24})),/Insufficient/);
 assert.match(validateStructurePlacement(request('platform',3,5,initial(),{deposits:[{x:3,y:5}]})),/deposit/);
 const blocked=terrain();blocked[5*size+3]=TERRAIN.RUINED_PILLAR;
 assert.match(validateStructurePlacement(request('platform',3,5,initial(),{terrain:blocked})),/Impassable/);
 assert.match(validateStructurePlacement(request('platform',3,5,initial(),{hulls:[{x:3.5,y:5.5,radius:.3}]})),/ship/);
 assert.equal(validateStructurePlacement(request('platform',3,5,initial(),{hulls:[{x:2.5,y:5.5,radius:.28}]})),null);
});

test('supports cross-chunk 2x2 placement, protects source anchor and checks costs',()=>{
 const base=[{id:1n,kind:'command_core',ownerSlot:0,gridX:12,gridY:12,width:3,height:3,complete:true},{id:2n,kind:'platform',ownerSlot:0,gridX:15,gridY:14,width:1,height:1,complete:true}];
 for(let y=15;y<=16;y++)for(let x=15;x<=16;x++)base.push({id:BigInt(base.length+1),kind:'platform',ownerSlot:0,gridX:x,gridY:y,width:1,height:1,complete:true});
 assert.equal(validateStructurePlacement(request('workshop',15,15,base)),null);
 assert.equal(CONSTRUCTION_RULES.definitions.workshop.width,2);
 assert.equal(CONSTRUCTION_RULES.startingSalvage,420);
 assert.match(validateStructurePlacement(request('command_core',5,5,base)),/Cannot manually/);
});
