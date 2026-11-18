import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../slimo-world.js';
import '../slimo-rogue-spells.js';
const W=globalThis.SlimoWorld,S=globalThis.SlimoRogueSpells;
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function setup(ranks={},at={x:0,z:2.5}){
 const p=(ranks,x,z)=>({active:true,hp:100,maxHp:100,x,z,r:0,attackAim:0,ranks,air:0,size:1,kx:0,kz:0,chill:0,inv:0});
 const state={format:'rogue',phase:'fight',paused:false,serial:0,p:[p(ranks,0,0),p({},at.x,at.z)],run:{spellEffects:[]}},hits=[];
 const callbacks={damage(i,amount,nx,nz,options){if(state.p[i].inv)return false;hits.push({i,amount,options});state.p[i].hp=Math.max(0,state.p[i].hp-amount);return true;},blocked:()=>false};
 const step=(seconds)=>{for(let t=0;t<seconds-1e-8;t+=.05)S.tick(state,.05,callbacks);};return {state,hits,callbacks,step};
}
test('all spells are in the real roguelike draft pool and the screen has no separate spell panel',()=>{
 const source=read('slimo-game.js'),context=vm.createContext({SlimoWorld:W,Math,console,performance});
 const a=source.indexOf('function skill('),b=source.indexOf('const stages =');vm.runInContext(source.slice(a,b),context);
 assert.equal(vm.runInContext('skillIds.length',context),32);assert.equal(vm.runInContext("skillIds.filter(k=>skills[k].group==='Arcane').length",context),8);
 context.state={round:2};context.skillRank=(p,k)=>p.ranks[k]||0;
 vm.runInContext(source.match(/function seeded\([^]*?\n}/)[0],context);
 vm.runInContext(source.slice(source.indexOf('function shuffledSkills('),source.indexOf('function startDraft(')),context);
 const seen=new Set();for(let seed=1;seed<200;seed++)for(const key of context.offerSkills({ranks:{}},3,seed))seen.add(key);
 for(const key of Object.keys(W.spells))assert.ok(seen.has(key),key+' must be selectable');
 const html=read('index.html');assert.doesNotMatch(html,/id="(?:meadowMagic|spellSlots|manaMeter|spellBuild)"/);assert.doesNotMatch(source,/castMeadowSpell\(/);
});
test('spell choices upgrade through the existing draft completion flow',()=>{
 const source=read('slimo-game.js'),state={phase:'draft',round:2,p:[{ranks:{earthwall:2}},{ranks:{}}],run:{draft:{picks:['earthwall','starfall'],offers:[['earthwall'],['starfall']]}}};let started=false;
 const c=vm.createContext({state,skillRank:(p,k)=>p.ranks[k]||0,startRound:()=>{started=true;}});
 vm.runInContext(source.slice(source.indexOf('function finishDraft()'),source.indexOf('function updateDraft(')),c);c.finishDraft();
 assert.equal(state.p[0].ranks.earthwall,3);assert.equal(state.p[1].ranks.starfall,1);assert.equal(state.run.draft,null);assert.equal(started,true);
});
test('only learned roguelike upgrades proc from existing moves, with no mana and enforced cooldowns',()=>{
 const {state,step}=setup({earthwall:1,mending:1});
 for(const format of ['classic','sandbox']){state.format=format;assert.equal(S.trigger(state,0,'dash').length,0);}
 state.format='rogue';assert.equal(S.trigger(state,0,'slap').length,0);assert.equal(S.trigger(state,0,'dash').length,2);
 assert.equal(state.p[0].mana,undefined);assert.equal(S.trigger(state,0,'dash').length,0);step(14.1);assert.ok(S.trigger(state,0,'dash').some(e=>e.key==='earthwall'));
});
test('Earthwake rises into real cover, respects cast direction, scales with rank and expires',()=>{
 for(const rank of [1,2,3]){const {state,step}=setup({earthwall:rank});S.trigger(state,0,'dash',()=>{},Math.PI/2);
  assert.equal(S.walls(state).length,0);step(.5);const walls=S.walls(state);assert.equal(walls.length,4+rank);assert.ok(walls.every(w=>Math.abs(w.x-3)<1e-6));
  const base=[{x:12,z:12,r:1}];assert.equal(S.cover(state,base).length,base.length+walls.length);assert.equal(S.cover(state,base),S.cover(state,base));
  step(8);assert.equal(S.walls(state).length,0);assert.equal(S.cover(state,base),base);
 }
});
test('spell impact timing and rank damage use one hit per eruption, not damage every frame',()=>{
 for(const rank of [1,2,3]){const {state,hits,step}=setup({embertrail:rank});S.trigger(state,0,'slap');step(.4);assert.equal(hits.length,0);step(.2);
  assert.equal(hits.length,1);assert.equal(hits[0].amount,W.spells.embertrail.levels[rank-1].damage);step(.7);assert.equal(hits.length,1);
 }
});
test('Frost only slows landed hits and vortex pull is toward its center',()=>{
 const {state,step}=setup({frostbloom:2,vortex:2});state.p[1].inv=1;S.trigger(state,0,'nova');step(.7);assert.equal(state.p[1].chill,0);
 const next=setup({frostbloom:2,vortex:2});S.trigger(next.state,0,'nova');next.step(.7);assert.equal(next.state.p[1].chill,2);assert.ok(next.state.p[1].kz>0);
});
test('Pebble volley moves with swept hits, shares its hit budget, and stops at cover',()=>{
 const {state,hits,step}=setup({stoneburst:3});S.trigger(state,0,'spit');step(.4);assert.equal(hits.length,1);assert.equal(hits[0].amount,W.spells.stoneburst.levels[2].damage);
 const blocked=setup({stoneburst:3});blocked.callbacks.blocked=()=>true;S.trigger(blocked.state,0,'spit');blocked.step(.4);assert.equal(blocked.hits.length,0);
});
test('Starfall telegraphs its impact and Mending clamps health without reviving',()=>{
 const {state,hits,step}=setup({starfall:3,mending:3},{x:0,z:4});S.trigger(state,0,'spit');step(.9);assert.equal(hits.length,0);step(.1);assert.equal(hits.length,1);
 state.p[0].hp=99;S.trigger(state,0,'dash');step(.3);assert.equal(state.p[0].hp,100);
 state.p[0].hp=0;state.p[0].spellCooldowns={};assert.equal(S.trigger(state,0,'dash').length,0);step(.3);assert.equal(state.p[0].hp,0);
});
test('spell state is bounded, survives host snapshots and rejects malformed visuals',()=>{
 const {state,step}=setup(Object.fromEntries(Object.keys(W.spells).map(k=>[k,3])));
 for(const action of ['dash','slap','spit','nova'])S.trigger(state,0,action);
 assert.equal(state.run.spellEffects.length,8);assert.ok(S.validEffects(JSON.parse(JSON.stringify(state.run.spellEffects))));
 assert.equal(S.validEffects([{...state.run.spellEffects[0],x:NaN}]),false);
 assert.equal(S.validEffects(Array(33).fill(state.run.spellEffects[0])),false);
 step(10);assert.equal(state.run.spellEffects.length,0);
});

test('real friend-duel snapshot validation accepts upgraded spells and rejects malformed spell projectiles',()=>{
 const source=read('slimo-game.js'),c=vm.createContext({SlimoWorld:W,SlimoRogueSpells:S,Math,performance,profile:{name:'test'},chosen:0,palette:[{},{},{},{}],ROUND_SECONDS:90});
 vm.runInContext(source.slice(source.indexOf('function skill('),source.indexOf('const stages =')),c);
 vm.runInContext(source.slice(source.indexOf('function skillRank('),source.indexOf('const BUILD_POINTS')),c);
 vm.runInContext(source.match(/function newRun\([^]*?\n}/)[0],c);
 vm.runInContext(source.slice(source.indexOf('function freshPlayer('),source.indexOf('let state = freshMatch()')),c);
 vm.runInContext(source.slice(source.indexOf('const phases ='),source.indexOf('function tickNetwork()')),c);
 const state=c.freshMatch('rogue');state.duelMatch=1;state.phase='fight';state.p[0].ranks={stoneburst:3};state.p[0].active=state.p[1].active=true;
 S.trigger(state,0,'spit',e=>state.fx.push({type:'spell',id:++state.serial,i:0,key:e.key,rank:e.rank,color:0,x:e.x,z:e.z}));
 assert.equal(c.validSnapshot(JSON.parse(JSON.stringify(state))),true);
 state.run.spellEffects[0].orbs[0].vx=Infinity;assert.equal(c.validSnapshot(state),false);
});
