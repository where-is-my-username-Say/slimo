import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
// Canvas drawing is stubbed here; these tests exercise real Three r128 objects,
// animation state, GPU buffers and disposal. They do not verify rendered pixels.
function harness(reduced=false){
 const noop=()=>{},gradient={addColorStop:noop};
 const canvas=()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:(_,key)=>key==='createRadialGradient'?()=>gradient:noop,set:()=>true})});
 const c=vm.createContext({console,document:{createElement:canvas},window:{innerHeight:720,devicePixelRatio:2},performance:{now:()=>1000},mode:'bot',settings:{reduced},smooth:(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}});
 vm.runInContext(read('three-r128.min.js'),c);
 vm.runInContext(`const T=THREE,scene=new T.Scene(),fighters=[{root:new T.Group()},{root:new T.Group()}];fighters[0].root.position.set(2,.1,3);const pose={active:true,size:1.2,x:2,z:3,air:.1};const publicRoom={id:1,roster:new Map([[1,{}]]),models:new Map()};function renderedPose(){return pose;}function publicPose(){return pose;}function interpolatePublic(){return pose;}`,c);
 vm.runInContext(read('slimo-atomic.js'),c);return {c,run:code=>vm.runInContext(code,c)};
}
function assertFinite(h){
 const values=JSON.parse(h.run(`JSON.stringify((()=>{const out=[];scene.traverse(o=>{out.push(...o.position.toArray(),...o.scale.toArray(),...o.rotation.toArray().slice(0,3));if(o.geometry)for(const a of Object.values(o.geometry.attributes))out.push(...a.array);if(o.instanceMatrix)out.push(...o.instanceMatrix.array);if(o.material){if(o.material.opacity!==undefined)out.push(o.material.opacity);for(const u of Object.values(o.material.uniforms||{}))if(typeof u.value==='number')out.push(u.value);}});return out;})())`));
 assert.ok(values.length>0);for(const value of values)assert.ok(Number.isFinite(value));
}
test('cinematic Atomic animates all phases on the game Three r128 in normal and reduced modes',()=>{
 for(const reduced of [false,true]){
  const h=harness(reduced),duration=h.run('ATOMIC_CONFIG.durationSeconds');h.run('startAtomic(0)');
  for(const fraction of [0,.2,.45,.52,.6,.85,.999]){h.run(`drawAtomic(${1000+duration*fraction*1000})`);assert.equal(h.run('atomicEffects.size'),1);assertFinite(h);}
  h.run(`drawAtomic(${1000+duration*1000})`);assert.equal(h.run('atomicEffects.size'),0);assert.equal(h.run('atomicAssets.refs'),0);assert.equal(h.run('atomicAssets.tex'),null);
 }
});
test('cinematic stages show charge, implosion, blast and aftermath without affecting combat',()=>{
 const h=harness();h.run('startAtomic(0);const effect=[...atomicEffects.values()][0];drawAtomic(5000)');
 assert.ok(h.run('effect.coreShell.material.uniforms.uOpacity.value')>0);assert.equal(h.run('effect.pillar.visible'),false);
 h.run('drawAtomic(8500)');assert.ok(h.run('effect.coreShell.material.uniforms.uHeat.value')>0);
 h.run('drawAtomic(9700)');assert.equal(h.run('effect.pillar.visible'),true);assert.equal(h.run('effect.domes[0].visible'),true);assert.equal(h.run('effect.embers.visible'),true);
 h.run('drawAtomic(15000)');assert.equal(h.run('effect.coreGroup.visible'),false);assert.equal(h.run('effect.embers.visible'),true);
 assert.equal(h.run('pose.size'),1.2);assert.equal(h.run('fighters[0].root.position.x'),2);
});
test('Atomic config edits control duration, seal colors, GPU particles and reduced detail',()=>{
 const h=harness();h.run('ATOMIC_CONFIG.durationSeconds=32;ATOMIC_CONFIG.colors.seal=0x55ff00;ATOMIC_CONFIG.detail.inflowParticles=8;startAtomic(0);const effect=[...atomicEffects.values()][0]');
 assert.equal(h.run('effect.inflow.geometry.attributes.aSeed.count'),8);assert.equal(h.run('effect.gOuter.material.color.getHex()'),0x55ff00);
 h.run('drawAtomic(17000)');assert.equal(h.run('atomicEffects.size'),1);h.run('drawAtomic(33000)');assert.equal(h.run('atomicEffects.size'),0);
 const normal=harness(),low=harness(true);normal.run('startAtomic(0)');low.run('startAtomic(0)');
 assert.ok(low.run('[...atomicEffects.values()][0].inflow.geometry.attributes.aSeed.count')<normal.run('[...atomicEffects.values()][0].inflow.geometry.attributes.aSeed.count'));
 assert.equal(low.run('[...atomicEffects.values()][0].aerial'),null);
});
test('overlapping casts share textures until the last cast ends and reject duplicate starts',()=>{
 const h=harness();h.run('startAtomic(0);startAtomic(1);startAtomic(0);let textureDisposals=0;Object.values(atomicAssets.tex).forEach(t=>t.addEventListener("dispose",()=>textureDisposals++));const first=[...atomicEffects.entries()][0];clearAtomicEffect(...first)');
 assert.equal(h.run('atomicEffects.size'),1);assert.equal(h.run('atomicAssets.refs'),1);assert.equal(h.run('textureDisposals'),0);
 h.run('drawAtomic(17000)');assert.equal(h.run('atomicAssets.refs'),0);assert.equal(h.run('textureDisposals'),5);assert.equal(h.run('scene.children.length'),0);
});
test('Atomic releases geometry/materials on expiry, mode change and a Meadow caster leaving',()=>{
 const h=harness();h.run(`startAtomic(0);let disposed=0;const resources=new Set();[...atomicEffects.values()][0].group.traverse(o=>{if(o.geometry&&!o.isSprite)resources.add(o.geometry);if(o.material)resources.add(o.material);});for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);drawAtomic(17000)`);
 assert.ok(h.run('disposed>=resources.size'));assert.equal(h.run('atomicEffects.size'),0);
 h.run("startAtomic(0);mode='host';drawAtomic(1200)");assert.equal(h.run('atomicEffects.size'),0);
 h.run("mode='public';startAtomic(1);publicRoom.roster.delete(1);drawAtomic(1200)");assert.equal(h.run('atomicEffects.size'),0);assert.equal(h.run('atomicAssets.refs'),0);
});
test('only the standalone Atomic implementation loads and both multiplayer event paths invoke it',()=>{
 const html=read('index.html'),game=read('slimo-game.js'),cinematics=read('slimo-cinematics.js');
 assert.equal([...html.matchAll(/src="\.\/slimo-atomic.js"/g)].length,1);assert.ok(html.indexOf('./slimo-atomic.js')<html.indexOf('./slimo-game.js'));
 assert.doesNotMatch(cinematics,/function (makeAtomicEffect|drawAtomic|startAtomic|clearAtomicEffect)\(/);
 assert.match(game,/packet.t === 'atomic'[\s\S]{0,100}startAtomic\(packet.i\)/);
 assert.match(game,/case 'atomic':[\s\S]{0,220}startAtomic\(q.i\)/);
 assert.match(cinematics,/mode==='public'\)publicRoom.ws\?\.send/);assert.match(cinematics,/mode==='guest'\)send\(\{t:'slimoEmote',key\}\)/);
});
