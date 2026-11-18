import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,performance});
for(const file of ['three-r128.min.js','slimo-sunlight.js'])vm.runInContext(fs.readFileSync(new URL('./'+file,import.meta.url),'utf8'),context);
const shaders=vm.runInContext(`(()=>{
 const T=THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(),sun=new T.DirectionalLight();sun.shadow.map={texture:new T.Texture()};scene.add(sun);
 const out=[],renderer={capabilities:{isWebGL2:true},extensions:{has:()=>true},shadowMap:{},getDrawingBufferSize:v=>v.set(100,100),getRenderTarget:()=>null,setRenderTarget(){},render(s){for(const o of s.children)if(o.material?.isShaderMaterial)out.push({vertex:o.material.vertexShader,fragment:o.material.fragmentShader});}};
 SlimoSunlight.create(T,renderer,scene,camera,sun).render({meadow:true,player:{x:0,z:0},sunOffset:new T.Vector3(-31,49,-27),quality:1,reduced:false});return out;
})()`,context);
const json=JSON.stringify(shaders);if(process.argv[2])fs.writeFileSync(process.argv[2],json);else process.stdout.write(json);
