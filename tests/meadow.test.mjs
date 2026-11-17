import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MeadowCombat } from '../slimo-meadow-combat.js';
const W = globalThis.SlimoWorld;

function setup(a = {x:0,z:0}, b = {x:0,z:2.5}, ranks = {}) {
  const engine = new MeadowCombat(); engine.now = 1000;
  const player = (id, at, build = {}) => engine.prepare({id,...at,joined:true,ready:true,inputAt:1000,ranks:build,
    color:id%4,aim:0,r:0,vx:0,vz:0,kx:0,kz:0,ix:0,iz:0,air:0,vy:0,en:100,dash:0,dashTime:0,
    stun:0,attack:'',attackTime:0,emote:0,emoteAge:0,wins:0});
  const p = player(1,a,ranks), target = player(2,b);
  engine.players.set(p.id,p);engine.players.set(target.id,target);
  return {engine,p,target};
}
function advance(e, seconds) { for (let t=0;t<seconds-1e-6;t+=.05)e.tick(.05,1000); }

test('Meadow bounds are doubled in both dimensions and both runtimes share the ring', () => {
  assert.equal(W.x*W.z/(90*82),4);
  assert.equal(W.insideRing(0,8.8),true);assert.equal(W.insideRing(0,8.801),false);
  assert.equal(W.insideRing(NaN,0),false);
});
test('all eight spells have three actual upgrade ranks and a valid starter build', () => {
  assert.equal(Object.keys(W.spells).length,8);
  for(const definition of Object.values(W.spells)){
    assert.equal(definition.levels.length,3);
    assert.ok(definition.levels[2].cooldown<definition.levels[0].cooldown);
    assert.ok(definition.levels.every(l=>l.cost>0&&l.duration>0));
  }
  assert.equal(Object.keys(W.cleanBuild(W.starterBuild)).filter(k=>W.spells[k]).length,8);
  assert.ok(Object.values(W.cleanBuild(W.starterBuild)).reduce((a,b)=>a+b,0)<=18);
});
test('normal slaps outside the ring produce tap feedback without damage or knockback', () => {
  const {engine,p,target}=setup({x:30,z:0},{x:30,z:2.5});
  assert.ok(engine.startMove(p,'slap'));advance(engine,.25);
  assert.equal(target.hp,100);assert.equal(target.kx,0);assert.equal(target.kz,0);
  assert.ok(engine.events.some(q=>q.type==='slap'));
  assert.ok(engine.events.some(q=>q.type==='playTap'&&q.j===p.id));
});
test('a slap damages inside the ring using the existing first-slap damage', () => {
  const {engine,p,target}=setup();engine.startMove(p,'slap');advance(engine,.2);
  assert.equal(target.hp,89);
  assert.ok(engine.events.some(q=>q.type==='hit'&&q.damage===11));
});
test('boundary slaps never damage a safe-zone target', () => {
  const {engine,p,target}=setup({x:0,z:7},{x:0,z:9});
  engine.startMove(p,'slap');advance(engine,.2);assert.equal(target.hp,100);
});
test('a spit fired outside remains harmless even if its caster enters the ring', () => {
  const {engine,p,target}=setup({x:0,z:-9.2},{x:0,z:-6});
  engine.startMove(p,'spit');p.z=-8;advance(engine,.5);
  assert.equal(target.hp,100);assert.ok(engine.events.some(q=>q.type==='spit'));
});
test('inside-ring spits use swept collision and deal damage', () => {
  const {engine,p,target}=setup({x:0,z:-2},{x:0,z:3});
  engine.startMove(p,'spit');advance(engine,.5);
  assert.equal(target.hp,89);assert.ok(engine.events.some(q=>q.type==='splat'));
});
test('shots lose damage permission when the shooter leaves the ring', () => {
  const {engine,p,target}=setup({x:0,z:-2},{x:0,z:3});
  engine.spawnBullet(p,0,30);p.x=20;advance(engine,.3);assert.equal(target.hp,100);
});
test('burn and slow cannot follow a target into the safe zone', () => {
  const {engine,p,target}=setup({x:0,z:0},{x:0,z:9});
  Object.assign(target,{hp:70,burnOwner:p.id,burnArmed:true,burnTicks:4,burnClock:0,burnDamage:10,chill:2,chillAmount:.5,lastHit:0});
  advance(engine,.1);assert.equal(target.hp,70);assert.equal(target.burnTicks,0);assert.equal(target.chill,0);
});
test('every spell cast in the hangout is cosmetic, including casts near the ring edge', () => {
  for(const key of Object.keys(W.spells)){
    const {engine,p,target}=setup({x:0,z:-9.2},{x:0,z:-6},{[key]:3});
    assert.equal(engine.cast(p,key).ok,true,key);p.z=-8;
    advance(engine,4);assert.equal(target.hp,100,key);
  }
});
test('wall ranks increase width, height and lifetime; safe-zone walls never collide', () => {
  const {engine,p}=setup({x:30,z:0},{x:35,z:0},{earthwall:3});
  engine.cast(p,'earthwall');advance(engine,.5);assert.equal(engine.walls().length,0);
  const levels=W.spells.earthwall.levels;
  assert.ok(levels[2].width>levels[0].width&&levels[2].height>levels[0].height&&levels[2].duration>levels[0].duration);
  assert.equal(W.wallSegments({x:0,z:0,aim:0,rank:3}).length,7);
});
test('an animated wall is real cover in the ring and expires', () => {
  const {engine,p}=setup({x:0,z:-4},{x:6,z:0},{earthwall:1});
  engine.cast(p,'earthwall');advance(engine,.5);assert.equal(engine.walls().length,1);
  assert.ok(engine.coverNear(0,0,true).some(c=>c.x===0&&Math.abs(c.z+1)<.01));
  advance(engine,6);assert.equal(engine.walls().length,0);
});
test('spell casts enforce learned ranks, cooldowns, mana and global cast rate', () => {
  const {engine,p}=setup(undefined,undefined,{earthwall:1,starfall:1});
  assert.equal(engine.cast(p,'not-a-spell').ok,false);
  assert.equal(engine.cast(p,'mending').ok,false);
  assert.equal(engine.cast(p,'earthwall').ok,true);
  assert.equal(engine.cast(p,'earthwall').ok,false);
  assert.equal(engine.cast(p,'starfall').ok,false);
  advance(engine,.4);p.mana=1;assert.equal(engine.cast(p,'starfall').ok,false);
});
test('Starfall is telegraphed before its impact and uses upgraded damage', () => {
  const {engine,p,target}=setup({x:0,z:0},{x:0,z:4},{starfall:3});
  engine.cast(p,'starfall');advance(engine,.8);assert.equal(target.hp,100);
  advance(engine,.2);assert.equal(target.hp,68);
});
test('Mending Spring heals without exceeding max health and does not revive', () => {
  const {engine,p}=setup(undefined,undefined,{mending:3});p.hp=90;
  engine.cast(p,'mending');advance(engine,.4);assert.equal(p.hp,100);
  p.hp=0;assert.equal(engine.cast(p,'mending').ok,false);
});
test('knockout counts once and respawns in the safe spawn area', () => {
  const {engine,p,target}=setup();engine.hit(p,target,200,{type:'slap'});
  assert.equal(target.hp,0);assert.equal(p.wins,1);assert.ok(target.respawnAt>0);
  engine.hit(p,target,200);assert.equal(p.wins,1);
  advance(engine,3.8);assert.equal(target.hp,target.maxHp);assert.equal(W.insideRing(target.x,target.z),false);
  assert.ok(engine.events.some(q=>q.type==='spawn'));
});
test('build validation caps ranks and budget and ignores forged/unknown keys', () => {
  const clean=W.cleanBuild({earthwall:99,starfall:3,mending:3,power:3,armor:3,wide:3,phase:3,constructor:3,unknown:3,frost:NaN});
  assert.ok(Object.values(clean).every(v=>Number.isInteger(v)&&v>0&&v<=3));
  assert.ok(Object.values(clean).reduce((a,b)=>a+b,0)<=18);
  assert.equal(Object.hasOwn(clean,'constructor'),false);assert.equal(Object.hasOwn(clean,'unknown'),false);
});
test('world state is bounded and serializable without internal hit sets', () => {
  const {engine,p}=setup(undefined,undefined,{earthwall:3});engine.cast(p,'earthwall');
  const data=engine.snapshot(p);assert.ok(data.effects.length<=64);
  assert.equal(Object.hasOwn(data.effects[0],'hit'),false);assert.doesNotThrow(()=>JSON.stringify(data));
});


test('server movement agrees with actual browser prediction for walking, attacks, dash and air', () => {
  const source=readFileSync(new URL('../slimo-game.js',import.meta.url),'utf8');
  const drive=source.slice(source.indexOf('function drivePlayer('),source.indexOf('function advancePlayer('));
  const context=vm.createContext({state:{run:false},stageIndex:()=>0,damp:(rate,dt)=>1-Math.exp(-rate*dt),lerp:(a,b,t)=>a+(b-a)*t,contain:()=>{}});
  vm.runInContext(drive,context);
  for(const extra of [{},{attack:'slap',attackTime:.3,duration:.352,contactTime:.15,attackDone:true},{dashTime:.2},{stun:.3},{air:1,vy:2}]) {
    const {engine,p}=setup({x:50,z:30},{x:-50,z:-30});
    assert.ok(W.cover.every(c=>Math.hypot(c.x-p.x,c.z-p.z)>c.r+3));
    Object.assign(p,{ix:.6,iz:.8,vx:1,vz:-1,kx:2,kz:3},extra);
    const expected={...p};
    for(const key of ['dashTime','stun'])expected[key]=Math.max(0,(expected[key]||0)-.05);
    if(expected.air>0||expected.vy>0){expected.vy-=17*.05;expected.air+=expected.vy*.05;}
    context.p=expected;vm.runInContext('drivePlayer(p,{x:.6,z:.8},.05)',context);
    engine.tick(.05,1000);
    for(const key of ['x','z','vx','vz','kx','kz'])assert.ok(Math.abs(p[key]-expected[key])<1e-10,key+' '+JSON.stringify(extra));
  }
});
