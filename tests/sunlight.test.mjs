import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness(supported=true){
 const c=vm.createContext({console,performance});for(const f of ['vendor/three-r128.min.js','slimo-sunlight.js'])vm.runInContext(readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 c.supported=supported;vm.runInContext(`const T=THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(55,1,.13,720),sun=new T.DirectionalLight(0xffffff,1);scene.add(sun);camera.updateMatrixWorld();sun.shadow.map={texture:new T.Texture()};
 const calls=[],renderer={capabilities:{isWebGL2:supported},extensions:{has:()=>supported},shadowMap:{needsUpdate:false},autoClear:false,target:null,width:1280,height:720,
 getDrawingBufferSize(out){return out.set(this.width,this.height);},getRenderTarget(){return this.target;},setRenderTarget(t){this.target=t;},render(s,c){calls.push({scene:s,target:this.target,material:s.children.find(x=>x.isMesh)?.material});}};
 const light=SlimoSunlight.create(T,renderer,scene,camera,sun);const options={meadow:true,player:{x:101,z:-51},sunOffset:new T.Vector3(-31,49,-27),quality:1,reduced:false};`,c);return {run:s=>vm.runInContext(s,c),c};
}
test('volumetric sunlight uses scene depth and the directional shadow map in a quarter-resolution pass',()=>{
 const {run}=harness();run('light.render(options)');assert.equal(run('calls.length'),3);assert.equal(run('calls[1].target.width'),320);assert.equal(run('calls[1].target.height'),180);
 assert.equal(run('calls[1].material.uniforms.sceneDepth.value'),run('calls[0].target.depthTexture'));
 assert.equal(run('calls[1].material.uniforms.shadowDepth.value'),run('sun.shadow.map.texture'));
 assert.match(run('calls[1].material.fragmentShader'),/unpackRGBAToDepth/);assert.match(run('calls[2].material.fragmentShader'),/perspectiveDepthToViewZ/);
 assert.equal(run('renderer.target'),null);assert.equal(run('renderer.autoClear'),false);
 assert.equal(run('sun.target.position.x'),102);assert.equal(run('sun.position.x-sun.target.position.x'),-31);
});
test('low quality, reduced motion and unsupported depth textures render normal lighting directly',()=>{
 for(const unsupported of [false,true]){const {run}=harness(!unsupported);if(!unsupported)run('options.quality=0');run('light.render(options)');assert.equal(run('calls.length'),1);assert.equal(run('calls[0].target'),null);}
 const {run}=harness();run('options.reduced=true;light.render(options)');assert.equal(run('calls.length'),1);
});
test('resizing frees old render targets and leaving Meadow restores the light target',()=>{
 const {run}=harness();run('light.render(options);let disposed=0;calls[0].target.addEventListener("dispose",()=>disposed++);calls[1].target.addEventListener("dispose",()=>disposed++);renderer.width=800;light.render(options)');assert.equal(run('disposed'),2);
 run('options.meadow=false;light.render(options)');assert.equal(run('sun.target.position.length()'),0);
 run('light.dispose();const count=calls.length;light.render(options)');assert.equal(run('calls.length-count'),0);
});
