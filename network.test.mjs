import test from 'node:test';
import assert from 'node:assert/strict';
import './slimo-network.js';
const N=globalThis.SlimoNetwork;
const input=()=>({ready:true,x:0,z:0,aim:0,assist:0,spitCharge:0,a:{slap:0,spit:0,dash:0,nova:0,jump:0}});
function packet(players,bullets){const data=new ArrayBuffer(12+players.length*34+bullets.length*22),v=new DataView(data);v.setUint8(0,55);v.setUint8(1,4);v.setUint32(2,99);v.setUint8(10,players.length);v.setUint8(11,bullets.length);
 players.forEach((p,i)=>{v.setUint16(12+i*34,p.id);v.setInt16(14+i*34,Math.round(p.x*100));v.setInt16(16+i*34,Math.round(p.z*100));});
 bullets.forEach((q,i)=>{const o=12+players.length*34+i*22;v.setUint32(o,q.id);v.setUint16(o+4,q.owner);});return data;}
test('interest packets preserve the local player, nearby actors, own projectiles and input acknowledgement',()=>{
 const players=[{id:1,x:0,z:0},{id:2,x:30,z:0},{id:3,x:170,z:0}],bullets=[{id:10,owner:2,x:170,z:0},{id:11,owner:3,x:170,z:0},{id:12,owner:1,x:31,z:0}];
 const source=packet(players,bullets),receiver={...players[1],seq:123},out=N.interestSnapshot(source,players,bullets,receiver),v=new DataView(out);
 assert.equal(v.getUint32(6),123);assert.equal(v.getUint8(10),2);assert.equal(v.getUint8(11),2);assert.equal(out.byteLength,12+2*34+2*22);
 assert.equal(v.getUint16(12),1);assert.equal(v.getUint16(46),2);assert.equal(v.getUint32(80),10);assert.equal(v.getUint32(102),12);
 assert.equal(new DataView(source).getUint32(6),0,'shared source must stay unchanged');
});
test('interest boundaries are exact and dense rings retain every combatant',()=>{
 const players=[{id:1,x:0,z:0},{id:2,x:80,z:0},{id:3,x:80.001,z:0}],out=N.interestSnapshot(packet(players,[]),players,[],{...players[0],seq:9});assert.equal(new DataView(out).getUint8(10),2);
 const dense=Array.from({length:50},(_,i)=>({id:i+1,x:i/10,z:0})),original=packet(dense,[]),full=N.interestSnapshot(original,dense,[],{...dense[0],seq:99});
 assert.equal(new DataView(full).getUint8(10),50);assert.equal(full.byteLength,original.byteLength);assert.notEqual(full,original);
});
test('idle input falls to a heartbeat while moving input and forced actions stay responsive',()=>{
 const i=input(),key=N.inputKey(i),p={vx:0,vz:0,kx:0,kz:0};
 assert.equal(N.inputDue(33,0,key,key,i,p),false);assert.equal(N.inputDue(179,0,key,key,i,p),false);assert.equal(N.inputDue(180,0,key,key,i,p),true);
 i.x=1;assert.equal(N.inputDue(33,0,N.inputKey(i),key,i,p),true);assert.equal(N.stationary(i,p),false);
 i.x=0;i.a.slap++;assert.equal(N.inputDue(1,0,N.inputKey(i),key,i,p,true),true);
 assert.equal(N.stationary(input(),{air:.1}),false);assert.equal(N.stationary(input(),{kx:1}),false);assert.equal(N.stationary(input(),{attackTime:.2}),false);
});
test('idle rooms reduce only network snapshots, never moving-player simulation classification',()=>{
 assert.equal(!!N.movingPlayer({vx:0,vz:0}),false);for(const p of [{vx:1},{air:.1},{vy:1},{attack:'slap'},{stun:.1},{dashTime:.1},{emote:1}])assert.equal(!!N.movingPlayer(p),true);
});

test('a congested fast channel does not grow a larger reliable-input backlog',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');const source=readFileSync(new URL('./slimo-game.js',import.meta.url),'utf8'),sent=[];
 const context=vm.createContext({link:{open:true,dataChannel:{bufferedAmount:1500},send:p=>sent.push(p)}});
 vm.runInContext(source.slice(source.indexOf('function send(packet)'),source.indexOf('function clearPeer()')),context);
 assert.equal(context.send({t:'input'}),false);assert.equal(context.send({t:'leave'}),true);assert.equal(sent.length,1);
});
