import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness() {
  const c=vm.createContext({console,performance});
  for(const path of ['three-r128.min.js','slimo-world.js','slimo-meadow-map.js','slimo-magic-vfx.js'])vm.runInContext(readFileSync(new URL('./'+path,import.meta.url),'utf8'),c);
  const run=code=>vm.runInContext(code,c);return {c,run};
}
test('expanded map builds four landmarks and distance-culls low-poly forest chunks',()=>{
  const {run}=harness();
  run('const scene=new THREE.Scene();const map=SlimoMeadowMap.create(THREE,scene,SlimoWorld);map.update({x:0,z:0},1,{quality:0,reduced:false})');
  assert.equal(run('map.userData.landmarkCount'),4);assert.ok(run('map.userData.chunkCount')>20);
  assert.ok(run('map.children.some(c=>c.visible===false)'));
  assert.equal(run('THREE.REVISION'),'128');
});
test('all spell ranks construct and animate finite transforms using the actual pinned Three.js',()=>{
  const {run}=harness();
  const result=run(`(()=>{
    const scene=new THREE.Scene(),view=SlimoMagicVfx.create(THREE,scene,SlimoWorld);
    const effects=Object.keys(SlimoWorld.spells).flatMap((key,i)=>[1,2,3].map(rank=>({id:i*3+rank,key,rank,x:i-4,z:0,age:.7,duration:SlimoWorld.spells[key].levels[rank-1].duration,aim:.7,armed:true})));
    for(const reduced of [false,true])view.update({effects,receivedAt:1000},1050,{x:0,z:0},{reduced,quality:1});
    let bad=false;scene.traverse(o=>{for(const n of [...o.position.toArray(),...o.scale.toArray(),...o.rotation.toArray().slice(0,3)])if(!Number.isFinite(n))bad=true;});
    const count=view.count;view.clear();return {count,bad,remaining:scene.children.length};
  })()`);
  assert.equal(result.count,24);assert.equal(result.bad,false);assert.equal(result.remaining,0);
});
test('expired spell meshes are removed instead of accumulating across casts',()=>{
  const {run}=harness();
  assert.equal(run(`(()=>{const scene=new THREE.Scene(),view=SlimoMagicVfx.create(THREE,scene,SlimoWorld);
    for(let i=1;i<=100;i++){view.update({receivedAt:0,effects:[{id:i,key:'earthwall',rank:3,x:0,z:0,aim:0,age:.5,duration:7.1}]},0,{x:0,z:0},{reduced:false});view.update(null,10000,{x:0,z:0},{reduced:false});}
    return scene.children.length;})()`),0);
});
