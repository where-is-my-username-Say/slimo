'use strict';

// Single-scattering sunlight integrated through the actual directional shadow
// map. Scene depth stops the integration at foreground geometry. No ray meshes.
globalThis.SlimoSunlight=(()=>{
  function create(T,renderer,scene,camera,sun) {
    const supported=renderer.capabilities.isWebGL2||renderer.extensions.has('WEBGL_depth_texture');
    const size=new T.Vector2(),oldSize=new T.Vector2(),focus=new T.Vector3(),direction=new T.Vector3();
    const quadScene=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
    const quad=new T.Mesh(new T.PlaneGeometry(2,2));quad.frustumCulled=false;quadScene.add(quad);
    if(!sun.target.parent)scene.add(sun.target);
    let sceneTarget=null,lightTarget=null,wasMeadow=false,disposed=false;
    const vertex='varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
    const volume=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{
      sceneDepth:{value:null},shadowDepth:{value:null},inverseProjection:{value:new T.Matrix4()},cameraWorld:{value:new T.Matrix4()},
      shadowMatrix:{value:new T.Matrix4()},eye:{value:new T.Vector3()},sunDirection:{value:new T.Vector3()},sunColor:{value:new T.Color()},shadowTexel:{value:new T.Vector2()},steps:{value:12}
    },vertexShader:vertex,fragmentShader:T.ShaderChunk.packing+`
      varying vec2 vUv;
      uniform sampler2D sceneDepth,shadowDepth;
      uniform mat4 inverseProjection,cameraWorld,shadowMatrix;
      uniform vec3 eye,sunDirection,sunColor;
      uniform vec2 shadowTexel;
      uniform int steps;
      float visibility(vec3 p){
        vec4 projected=shadowMatrix*vec4(p,1.);vec3 q=projected.xyz/projected.w;
        if(q.x<0.||q.x>1.||q.y<0.||q.y>1.||q.z<0.||q.z>1.)return 1.;
        float a=unpackRGBAToDepth(texture2D(shadowDepth,q.xy+shadowTexel*vec2(-.5,-.5)));
        float b=unpackRGBAToDepth(texture2D(shadowDepth,q.xy+shadowTexel*vec2(.5,.5)));
        float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));
        return mix(1.,.5*(step(q.z-.0003,a)+step(q.z-.0003,b)),smoothstep(0.,.04,edge));
      }
      void main(){
        float depth=texture2D(sceneDepth,vUv).x;
        vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);view/=view.w;
        vec3 end=(cameraWorld*view).xyz;vec3 ray=end-eye;
        float lengthRay=min(length(ray),72.);ray=normalize(ray);
        float ds=lengthRay/float(steps),transmittance=1.,scatter=0.;
        float jitter=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
        float mu=dot(ray,sunDirection),g=.42;
        float phase=(1.-g*g)/(12.56637*pow(max(.05,1.+g*g-2.*g*mu),1.5));
        for(int i=0;i<20;i++){
          if(i>=steps)break;
          vec3 p=eye+ray*((float(i)+jitter)*ds);
          float density=.0045*exp(-max(p.y,0.)*.075);
          float attenuation=exp(-density*ds);
          scatter+=transmittance*(1.-attenuation)*visibility(p)*phase;
          transmittance*=attenuation;
        }
        gl_FragColor=vec4(sqrt(max(sunColor*scatter*2.4,vec3(0.))),clamp(-view.z/120.,0.,1.));
      }
    `});
    const composite=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{
      sceneColor:{value:null},sceneDepth:{value:null},lightColor:{value:null},lightTexel:{value:new T.Vector2()},nearFar:{value:new T.Vector2()}
    },vertexShader:vertex,fragmentShader:T.ShaderChunk.packing+`
      varying vec2 vUv;uniform sampler2D sceneColor,sceneDepth,lightColor;
      uniform vec2 lightTexel,nearFar;
      vec4 tap(vec2 uv,float z,float weight){
        vec4 s=texture2D(lightColor,uv);float w=weight*exp(-abs(s.a*120.-z)*.55);
        return vec4(s.rgb*s.rgb*w,w);
      }
      void main(){
        float depth=texture2D(sceneDepth,vUv).x;
        float z=min(120.,-perspectiveDepthToViewZ(depth,nearFar.x,nearFar.y));
        vec2 p=vUv/lightTexel-.5,f=fract(p),b=(floor(p)+.5)*lightTexel;
        vec4 light=tap(b,z,(1.-f.x)*(1.-f.y))+tap(b+vec2(lightTexel.x,0.),z,f.x*(1.-f.y))
          +tap(b+vec2(0.,lightTexel.y),z,(1.-f.x)*f.y)+tap(b+lightTexel,z,f.x*f.y);
        vec3 base=texture2D(sceneColor,vUv).rgb;
        vec3 linear=pow(max(base,vec3(0.)),vec3(2.2));
        vec3 rays=light.a>.0001?light.rgb/light.a:vec3(0.);
        gl_FragColor=vec4(pow(max(linear+rays,vec3(0.)),vec3(1./2.2)),1.);
      }
    `});
    function resize(){
      renderer.getDrawingBufferSize(size);if(sceneTarget&&size.equals(oldSize))return;
      oldSize.copy(size);sceneTarget?.dispose();lightTarget?.dispose();
      sceneTarget=new T.WebGLRenderTarget(size.x,size.y,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true,stencilBuffer:false});
      sceneTarget.texture.encoding=T.sRGBEncoding;sceneTarget.depthTexture=new T.DepthTexture(size.x,size.y,T.UnsignedShortType);
      lightTarget=new T.WebGLRenderTarget(Math.max(1,Math.ceil(size.x/4)),Math.max(1,Math.ceil(size.y/4)),{minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false,stencilBuffer:false});
    }
    function render({meadow,player,sunOffset,quality,reduced}){
      if(disposed)return;
      if(meadow){
        focus.set(Math.round(player.x/2)*2,0,Math.round(player.z/2)*2);
        if(!sun.target.position.equals(focus))renderer.shadowMap.needsUpdate=true;
        sun.target.position.copy(focus);sun.position.copy(sunOffset).add(focus);sun.target.updateMatrixWorld();
      }else if(wasMeadow){sun.target.position.set(0,0,0);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true;}
      wasMeadow=meadow;
      if(!supported||!meadow||quality===0||reduced){renderer.render(scene,camera);return;}
      resize();const prior=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      try{
        renderer.autoClear=true;renderer.setRenderTarget(sceneTarget);renderer.render(scene,camera);
        if(!sun.shadow.map){renderer.setRenderTarget(prior);renderer.render(scene,camera);return;}
        const u=volume.uniforms;u.sceneDepth.value=sceneTarget.depthTexture;u.shadowDepth.value=sun.shadow.map.texture;
        u.inverseProjection.value.copy(camera.projectionMatrixInverse);u.cameraWorld.value.copy(camera.matrixWorld);
        u.shadowMatrix.value.copy(sun.shadow.matrix);u.eye.value.setFromMatrixPosition(camera.matrixWorld);
        direction.copy(sun.position).sub(sun.target.position).normalize();u.sunDirection.value.copy(direction);u.sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
        u.shadowTexel.value.set(1/sun.shadow.mapSize.x,1/sun.shadow.mapSize.y);u.steps.value=quality===2?20:12;
        quad.material=volume;renderer.setRenderTarget(lightTarget);renderer.render(quadScene,quadCamera);
        const c=composite.uniforms;c.sceneColor.value=sceneTarget.texture;c.sceneDepth.value=sceneTarget.depthTexture;c.lightColor.value=lightTarget.texture;
        c.lightTexel.value.set(1/lightTarget.width,1/lightTarget.height);c.nearFar.value.set(camera.near,camera.far);
        quad.material=composite;renderer.setRenderTarget(prior);renderer.render(quadScene,quadCamera);
      }finally{renderer.setRenderTarget(prior);renderer.autoClear=autoClear;}
    }
    return {render,get supported(){return supported;},dispose(){disposed=true;sceneTarget?.dispose();lightTarget?.dispose();quad.geometry.dispose();volume.dispose();composite.dispose();}};
  }
  return Object.freeze({create});
})();
