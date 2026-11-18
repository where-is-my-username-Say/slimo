import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MeadowCombat} from './slimo-meadow-combat.js';
import './slimo-network.js';
const W=globalThis.SlimoWorld;
const source=readFileSync(new URL('./slimo-game.js',import.meta.url),'utf8');
const wire=source.slice(source.indexOf('const ROOM_CAP ='),source.indexOf('let renderer;'));
function codec() {
  const context=vm.createContext({WORLD:W,ArrayBuffer,DataView,Math,Number,ROOM_EMOTES:['none','dance','sit','wave','spin','bounce'],actions:['slap','spit','dash','nova','jump']});
  vm.runInContext(wire,context);return {run:code=>vm.runInContext(code,context),context};
}
function room() {
  let source=readFileSync(new URL('./worker.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'').replace(/^export \{[^\n]+\n/gm,'').replace('export class GameRoom','class GameRoom');
  source=source.slice(0,source.indexOf('export default'));
  const context=vm.createContext({console,MeadowCombat,globalThis:{SlimoWorld:W,SlimoNetwork:globalThis.SlimoNetwork},ArrayBuffer,DataView,Date,Math,Map,Set,Number,JSON,Blob,
    setInterval:()=>1,clearInterval(){},DurableObject:class{constructor(ctx){this.ctx=ctx;}}});
  const Room=vm.runInContext(source+'\nGameRoom',context);
  const r=new Room({getWebSockets:()=>[]},{}),sent=[];
  const ws={readyState:1,bufferedAmount:0,send:value=>sent.push(value),deserializeAttachment:()=>({id:1}),close(){}};
  const p=r.combat.prepare({id:1,joined:true,profile:{id:'test',username:'test'},name:'test',color:0,ranks:{},ready:true,inputAt:Date.now(),
    x:0,z:0,r:0,vx:0,vz:0,kx:0,kz:0,vy:0,air:0,en:0,dash:0,dashTime:0,stun:0,attack:'',attackTime:0,emote:0,emoteAge:0,seq:0,actions:[0,0,0,0,0],ws});
  r.players.set(1,p);return {r,p,ws,sent};
}
test('protocol 4 carries large-map coordinates, mana and projectile flags',()=>{
  const {run,context}=codec();
  context.players=[{id:1,x:175,z:-130,r:1,vx:1,vz:2,kx:0,kz:0,hp:89,en:70,mana:42,attack:'slap',combo:2,emote:0}];
  context.shots=[{id:9,owner:1,x:160,z:140,vx:28,vz:0,color:1,fire:0,frost:0,seeker:0,cannon:0,returns:0,fork:0,charged:true}];
  const packet=run('decodeRoomState(encodeRoomState(7,3,players,shots))');
  assert.equal(packet.players[0].x,175);assert.equal(packet.players[0].z,-130);assert.equal(packet.players[0].mana,42);
  assert.equal(packet.bullets[0].charged,true);assert.equal(packet.ack,3);
});
test('Worker snapshots decode with the actual browser codec',()=>{
  const {r,p,sent}=room();p.x=120;p.z=50;p.mana=37;r.tick();
  const {context,run}=codec();context.data=sent.find(x=>x instanceof ArrayBuffer);
  const state=run('decodeRoomState(data)');assert.ok(state);assert.equal(state.players.length,1);
  assert.equal(state.players[0].x,120);assert.equal(state.players[0].mana,37);
});
test('input packets carry charged spit while keeping their bounded fixed size',()=>{
  const {run}=codec();const value=run("decodeRoomInput(inputPacket({ready:true,assist:0,x:0,z:0,aim:0,spitCharge:1,a:{slap:0,spit:1,dash:0,nova:0,jump:0}},2))");
  assert.equal(value.spitCharge,1);assert.equal(value.seq,2);assert.equal(value.a.spit,1);
});
test('Worker ignores duplicate/out-of-order inputs and consumes initial action baselines',async()=>{
  const {r,p,ws}=room(),{run}=codec();
  const packet=seq=>run(`inputPacket({ready:true,assist:0,x:0,z:0,aim:0,a:{slap:${seq},spit:0,dash:0,nova:0,jump:0}},${seq})`);
  await r.webSocketMessage(ws,packet(1));assert.equal(p.attack,'');
  await r.webSocketMessage(ws,packet(2));assert.equal(p.attack,'slap');
  p.attack='';p.attackTime=0;await r.webSocketMessage(ws,packet(2));assert.equal(p.attack,'');
  await r.webSocketMessage(ws,packet(1));assert.equal(p.seq,2);
});
test('Worker rejects mid-ring build changes and clamps safe-zone builds',async()=>{
  const {r,p,ws,sent}=room();
  await r.webSocketMessage(ws,JSON.stringify({t:'build',ranks:{earthwall:3}}));assert.equal(p.ranks.earthwall,undefined);
  assert.equal(JSON.parse(sent.at(-1)).ok,false);
  p.x=30;await r.webSocketMessage(ws,JSON.stringify({t:'build',ranks:{earthwall:99,power:99,starfall:3,unknown:3}}));
  assert.equal(p.ranks.earthwall,undefined);assert.equal(p.ranks.power,3);assert.equal(p.ranks.unknown,undefined);
});
test('old clients are not accepted under a mismatched layout',()=>{
  const {run,context}=codec();const data=new ArrayBuffer(12);new DataView(data).setUint8(0,55);new DataView(data).setUint8(1,3);context.data=data;
  assert.equal(run('decodeRoomState(data)'),null);
});

test('real Worker emits five steady idle snapshots per second and still sends its first state immediately',()=>{
 const {r,sent}=room();for(let i=0;i<20;i++)r.tick();
 assert.equal(sent.filter(x=>x instanceof ArrayBuffer).length,6);
 assert.equal(r.tickNumber,20);assert.ok(Math.abs(r.combat.time-1)<1e-9);
});
test('real Worker keeps 20 Hz state delivery while movement is active',()=>{
 const {r,p,sent}=room();p.ix=1;for(let i=0;i<20;i++){p.inputAt=Date.now();r.tick();}
 assert.equal(sent.filter(x=>x instanceof ArrayBuffer).length,20);assert.ok(p.x>1);
});

test('Worker authorizes Atomic, enforces cooldown and broadcasts the same cast to all players without damage',async()=>{
 const {r,p,ws,sent}=room();p.atomicAt=0;
 const observer=[];r.players.set(2,{id:2,joined:true,ws:{send:value=>observer.push(value)}});
 const request=JSON.stringify({t:'emote',key:'atomic'});
 await r.webSocketMessage(ws,request);assert.equal(sent.length,0);assert.equal(observer.length,0);
 p.profile.atomic=true;const hp=p.hp;
 await r.webSocketMessage(ws,request);
 assert.deepEqual(JSON.parse(sent.at(-1)),{t:'atomic',i:1});assert.equal(observer.at(-1),sent.at(-1));assert.equal(p.hp,hp);
 const count=sent.length;await r.webSocketMessage(ws,request);assert.equal(sent.length,count);
 p.atomicAt-=20001;await r.webSocketMessage(ws,request);assert.equal(sent.length,count+1);
});
