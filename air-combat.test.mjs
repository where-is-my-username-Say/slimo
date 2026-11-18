import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MeadowCombat} from './slimo-meadow-combat.js';
const A=globalThis.SlimoAirCombat,W=globalThis.SlimoWorld;
function setup(outside=false){
 const e=new MeadowCombat();e.now=1000;
 const make=(id,x,z)=>e.prepare({id,x,z,joined:true,active:true,ready:true,inputAt:1000,ranks:{},color:0,aim:0,r:0,vx:0,vz:0,kx:0,kz:0,ix:0,iz:0,air:0,vy:0,en:0,dash:0,dashTime:0,stun:0,attack:'',attackTime:0,emote:0,emoteAge:0,profile:{}});
 const p=make(1,outside?40:0,0),target=make(2,outside?40:0,1.4);e.players.set(1,p);e.players.set(2,target);
 const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.01)e.tick(.01,1000);};return {e,p,target,advance};
}
test('jump apex is three times the old height, with no mid-air double jump',()=>{
 const p={air:0,vy:0,hp:100};assert.equal(A.jump(p),true);assert.equal(A.jump(p),false);
 let top=0;for(let t=0;t<2;t+=.001){A.step(p,{},.001,[],{emit(){}});top=Math.max(top,p.air);}
 assert.ok(Math.abs((top-.04)/(6.4*6.4/34)-3)<.01);assert.equal(p.air,0);
});
test('Meadow air control matches grounded running speed',()=>{
 const grounded=setup(),airborne=setup();grounded.p.ix=airborne.p.ix=1;
 airborne.e.startMove(airborne.p,'jump');grounded.advance(.2);airborne.advance(.2);
 assert.ok(Math.abs(grounded.p.x-airborne.p.x)<1e-10);assert.ok(airborne.p.air>1);
});
test('charged air slam deals more damage than a tap and can hit only once',()=>{
 function slam(hold){const h=setup();h.p.air=2.5;h.e.startMove(h.p,'slap');h.p.slapHeld=true;h.advance(hold);h.p.slapHeld=false;h.advance(.5);return h;}
 const tap=slam(0),charged=slam(.8);assert.ok(tap.target.hp<100);assert.ok(charged.target.hp<tap.target.hp);
 const hp=charged.target.hp;charged.advance(.5);assert.equal(charged.target.hp,hp);
});
test('perfect dodge or timely slap reverses a jump attack into a suplex; late timing fails',()=>{
 for(const counter of ['dash','slap','late']){
  const h=setup();h.p.air=1.1;h.e.startMove(h.p,'slap');h.p.slapHeld=false;
  if(counter==='dash'){h.target.dashTime=.268;h.target.inv=.214;}
  else {h.target.attackAim=Math.PI;h.target.attack='slap';h.target.duration=.352;h.target.attackTime=counter==='late'?.05:.33;h.target.contactTime=.131;h.target.struck=true;}
  h.e.tick(.01,1000);
  if(counter==='late'){assert.equal(h.p.suplex,null);assert.ok(h.target.hp<100);}
  else {assert.ok(h.p.suplex);assert.equal(h.target.hp,100);h.advance(.8);assert.equal(h.p.hp,78);assert.equal(h.p.suplex,null);assert.ok(h.e.events.some(e=>e.type==='suplex'));}
 }
});
test('air slams and suplexes remain cosmetic outside the damage ring',()=>{
 const h=setup(true);h.p.air=1.1;h.e.startMove(h.p,'slap');h.target.dashTime=.268;h.target.inv=.214;h.advance(.6);
 assert.equal(h.p.hp,100);assert.equal(h.target.hp,100);assert.equal(h.p.suplex,null);
});
test('upward spit hits a charging airborne enemy and interrupts its charge',()=>{
 const h=setup();h.target.z=5;h.target.air=3;h.e.startMove(h.target,'slap');h.target.slapHeld=true;
 h.e.spawnBullet(h.p,0,11);assert.ok(h.e.bullets[0].vy>0);h.advance(.3);
 assert.ok(h.target.hp<100);assert.equal(h.target.airMove,0);
});
test('3D projectile collision misses a low shot beneath a jumping slime and sweeps fast upward hits',()=>{
 assert.equal(A.sphere(0,.83,0,0,.83,10,0,4,5,1),Infinity);
 assert.ok(Number.isFinite(A.sphere(0,.83,0,0,6,10,0,3.4,5,1)));
});
test('animation poses preserve volume, exaggerate charge/dive and honor reduced motion',()=>{
 const charge=A.pose({air:2,airMove:1,airCharge:A.maxCharge}),dive=A.pose({air:2,airMove:2});
 assert.ok(charge.stretch<1);assert.ok(dive.stretch>1);assert.ok(dive.tilt>0);
 assert.ok(A.pose({air:0},0).stretch<1);assert.ok(A.pose({air:0},.15).stretch>1);
 for(const p of [{air:2,vy:11},{air:3,airMove:1,airCharge:1},{air:0,suplexTime:.3}]){
  for(const v of Object.values(A.pose(p,.1)))assert.ok(Number.isFinite(v));assert.equal(A.pose(p,.1,true).stretch,1);assert.equal(A.pose(p,.1,true).tilt,0);
 }
});
test('actual Meadow codec carries height, charge, wrestling pose and upward projectile velocity',()=>{
 const src=readFileSync(new URL('./slimo-game.js',import.meta.url),'utf8');
 const c=vm.createContext({WORLD:W,ArrayBuffer,DataView,Math,Number,ROOM_EMOTES:['none','dance','sit','wave','spin','bounce'],actions:['slap','spit','dash','nova','jump']});
 vm.runInContext(src.slice(src.indexOf('const ROOM_CAP ='),src.indexOf('let renderer;')),c);
 c.players=[{id:1,x:0,z:0,r:0,air:3.6,vy:-18,airMove:1,airCharge:.9,suplexTime:.4,grabTime:.3,combo:0,hp:100,en:0}];c.bullets=[{id:2,owner:1,x:0,z:1,vx:0,vz:28,y:3.7,vy:19}];
 const state=vm.runInContext('decodeRoomState(encodeRoomState(1,1,players,bullets))',c);
 assert.equal(state.players[0].air,3.6);assert.equal(state.players[0].vy,-18);assert.equal(state.players[0].airMove,1);assert.equal(state.players[0].airCharge,.9);assert.equal(state.players[0].suplexTime,.4);assert.equal(state.bullets[0].y,3.7);assert.equal(state.bullets[0].vy,19);
 const input=vm.runInContext('decodeRoomInput(inputPacket({a:{},ready:true,x:0,z:0,aim:0,slapHeld:true},1))',c);assert.equal(input.slapHeld,true);
});

test('friend-duel fast inputs carry held attack state and reject the old protocol',()=>{
 const src=readFileSync(new URL('./slimo-game.js',import.meta.url),'utf8');
 const fn=name=>{const a=src.indexOf('function '+name+'(');return src.slice(a,src.indexOf('\n}',a)+2);};
 const c=vm.createContext({ArrayBuffer,DataView,performance,protocolTag:W.duelProtocol,inputTag:73,actions:['slap','spit','dash','nova','jump'],clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),lastRemoteSequence:0,lastRemote:0,lastFast:0,remoteReady:true,inputs:[{},{}]});
 vm.runInContext(fn('encodeInput')+'\n'+fn('readFastInput'),c);
 vm.runInContext('const input={ready:true,assist:0,x:0,z:0,aim:0,a:{slap:1,spit:0,dash:0,nova:0,jump:1},slapHeld:true};readFastInput(encodeInput(input,1))',c);assert.equal(c.inputs[1].slapHeld,true);
 vm.runInContext('input.slapHeld=false;readFastInput(encodeInput(input,2))',c);assert.equal(c.inputs[1].slapHeld,false);
 vm.runInContext('const old=encodeInput(input,3);new DataView(old).setUint8(1,7);readFastInput(old)',c);assert.equal(c.lastRemoteSequence,2);
});

test('empty-ground dive clamps impact height before publishing a valid landing event',()=>{
 const events=[],p={id:0,x:0,z:0,air:.02,vy:-22,airMove:2,airCharge:1,hp:100,stun:0};
 A.step(p,{},.05,[],{emit:(type,x,z,data)=>events.push({type,...data}),hit(){},canHarm:()=>false});
 assert.equal(p.air,0);assert.equal(events.find(e=>e.type==='airSlam').height,0);assert.equal(p.airMove,0);
});
