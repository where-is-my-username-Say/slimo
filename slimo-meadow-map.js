'use strict';

const SlimoMeadowMap = (() => {
  function create(T, parent, world) {
    const root=new T.Group();root.name='Meadow expansion';parent.add(root);
    const box=new T.BoxGeometry(1,1,1),trunk=new T.CylinderGeometry(.6,.9,1,6),leaf=new T.IcosahedronGeometry(1,0);
    const stone=new T.CylinderGeometry(1,1,1,7),crystal=new T.OctahedronGeometry(1,0);
    const wood=new T.MeshStandardMaterial({color:0x78634d,roughness:1});
    const foliage=new T.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
    const masonry=new T.MeshStandardMaterial({color:0xc4b79c,roughness:.95});
    const roof=new T.MeshStandardMaterial({color:0x5c7860,roughness:1});
    const magic=new T.MeshStandardMaterial({color:0xab8cff,emissive:0x6e35b6,emissiveIntensity:.65,roughness:.22,metalness:.2});
    const gold=new T.MeshBasicMaterial({color:0xffd18b});
    const matrix=new T.Object3D(),color=new T.Color(),chunks=[],landmarks=[],beacons=[];
    function mesh(geometry,material,group,x,y,z,sx=1,sy=1,sz=1) {
      const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);group.add(m);return m;
    }
    function batch(geometry,material,group,items) {
      const m=new T.InstancedMesh(geometry,material,items.length);
      items.forEach((p,i)=>{matrix.position.set(p.x,p.y,p.z);matrix.rotation.set(0,p.angle||0,0);matrix.scale.set(p.sx,p.sy,p.sz);matrix.updateMatrix();m.setMatrixAt(i,matrix.matrix);if(p.color!==undefined)m.setColorAt(i,color.setHex(p.color));});
      m.frustumCulled=false;group.add(m);return m;
    }
    // Outer trees use low-poly clustered canopies; the original central trees stay intact.
    const buckets=new Map();
    for(const t of world.trees.slice(21)){
      const bx=Math.floor(t.x/36)*36+18,bz=Math.floor(t.z/36)*36+18,key=bx+':'+bz;
      if(!buckets.has(key))buckets.set(key,{x:bx,z:bz,trees:[]});buckets.get(key).trees.push(t);
    }
    for(const bucket of buckets.values()){
      const group=new T.Group();group.position.set(bucket.x,0,bucket.z);root.add(group);
      const trunks=[],leaves=[];
      for(const t of bucket.trees){
        const x=t.x-bucket.x,z=t.z-bucket.z,s=t.s;
        trunks.push({x,y:2*s,z,sx:.7*s,sy:4*s,sz:.7*s});
        for(let k=0;k<4;k++){const a=k*2.4;leaves.push({x:x+Math.sin(a)*s,y:(4.4+k*.45)*s,z:z+Math.cos(a)*s,sx:2.2*s,sy:1.35*s,sz:2*s,color:[0x497c5e,0x72a374,0x608e65,0x89aa78][k]});}
      }
      batch(trunk,wood,group,trunks);batch(leaf,foliage,group,leaves);chunks.push(group);
    }
    const path=new T.MeshStandardMaterial({color:0xc9bf91,roughness:1});
    for(const place of world.landmarks.filter(p=>p.id!=='ring')){
      const count=Math.ceil(Math.hypot(place.x,place.z)/1.8),steps=[];
      for(let i=7;i<count;i++){
        const t=i/count,curve=Math.sin(t*Math.PI)*8,normal=Math.atan2(place.x,place.z);
        steps.push({x:place.x*t+Math.cos(normal)*curve,y:.025,z:place.z*t-Math.sin(normal)*curve,angle:normal+(i%3)*.17,sx:.70+(i%3)*.12,sy:.075,sz:.48});
      }
      batch(stone,path,root,steps);
      const group=new T.Group();group.position.set(place.x,0,place.z);root.add(group);landmarks.push(group);
      const base=new T.MeshStandardMaterial({color:place.id==='crystals'?0x776b83:place.id==='ruins'?0x918c72:0x647c55,roughness:1});
      mesh(new T.CylinderGeometry(15,16,.12,48),base,group,0,-.005,0);
      const halo=mesh(new T.TorusGeometry(2.7,.055,6,48),new T.MeshBasicMaterial({color:place.color,transparent:true,opacity:.65}),group,0,3.5,0);
      halo.rotation.x=Math.PI/2;beacons.push(halo);
      if(place.id==='ruins'){
        for(const z of [-8,0,8]){mesh(box,masonry,group,0,5.15,z,13.8,.65,1.8);mesh(box,roof,group,0,5.55,z,14.2,.18,2);}
        const fountain=mesh(new T.TorusGeometry(2,.36,8,32),masonry,group,0,.25,0);fountain.rotation.x=Math.PI/2;
      }
      if(place.id==='crystals'){
        const shard=mesh(crystal,magic,group,0,3,0,1.4,3,1.4);shard.rotation.z=.13;
        for(let i=0;i<6;i++){const a=i*Math.PI/3;mesh(leaf,gold,group,Math.sin(a)*3.3,.22,Math.cos(a)*3.3,.14,.14,.14);}
      }
      if(place.id==='village'){
        for(const dx of [-4,4]){
          mesh(trunk,wood,group,dx,1.6,0,.15,3.2,.15);
          mesh(new T.IcosahedronGeometry(.35,1),gold,group,dx,3.1,0);
        }
        const garden=new T.MeshStandardMaterial({color:0xd8a4b6,roughness:.8});
        for(let i=0;i<12;i++){const a=i*Math.PI/6;mesh(leaf,garden,group,Math.sin(a)*4.3,.3,Math.cos(a)*4.3,.3,.3,.3);}
      }
    }
    for(const structure of world.structures){
      const place=world.landmarks.find(p=>p.id===(structure.kind==='ruin'?'ruins':structure.kind==='crystal'?'crystals':'village'));
      const group=landmarks[world.landmarks.filter(p=>p.id!=='ring').indexOf(place)];
      const x=structure.x-place.x,z=structure.z-place.z;
      if(structure.kind==='ruin'){
        mesh(new T.CylinderGeometry(.8,1,structure.height,8),masonry,group,x,structure.height/2,z);
        mesh(box,masonry,group,x,.15,z,2.4,.3,2.4);
      }else if(structure.kind==='crystal'){
        const m=mesh(crystal,magic,group,x,structure.height*.48,z,1.2,structure.height*.55,1.2);m.rotation.z=Math.sin(x)*.16;
      }else{
        mesh(box,wood,group,x,1.25,z,3.5,2.5,3.3);
        const m=mesh(new T.ConeGeometry(3.05,2,4),roof,group,x,3.3,z);m.rotation.y=Math.PI/4;
        mesh(box,gold,group,x,1.35,z+1.67,.6,.65,.04);
      }
    }
    const time={value:0};
    const water=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uTime:time},
      vertexShader:'varying vec2 vUv;uniform float uTime;void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*.8+uTime)*.018;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader:'varying vec2 vUv;uniform float uTime;void main(){float d=length(vUv-.5);float ripple=sin(d*135.-uTime*1.8)*.5+.5;float glint=pow(ripple,14.)*.15;vec3 c=mix(vec3(.13,.40,.43),vec3(.30,.65,.64),ripple*.35);gl_FragColor=vec4(c+glint,.88);}' });
    const lake=world.landmarks.find(p=>p.id==='lake'),lakeGroup=landmarks[2];
    const pool=mesh(new T.CircleGeometry(12.8,64),water,lakeGroup,0,.09,0);pool.rotation.x=-Math.PI/2;pool.scale.x=1.12;
    const stones=[];for(let i=0;i<42;i++){const a=i*Math.PI*2/42;stones.push({x:Math.sin(a)*14.8,y:.14,z:Math.cos(a)*13.4,sx:.7,sy:.35,sz:.6,color:i%2?0x8caa95:0xa3b29a});}
    batch(leaf,foliage,lakeGroup,stones);
    root.update=(player,seconds,settings)=>{
      time.value=settings.reduced?0:seconds;
      const distance=settings.quality===0?85:125;
      for(const group of chunks)group.visible=Math.hypot(group.position.x-player.x,group.position.z-player.z)<distance;
      for(const group of landmarks)group.visible=Math.hypot(group.position.x-player.x,group.position.z-player.z)<155;
      for(const [i,m]of beacons.entries()){m.position.y=3.5+(settings.reduced?0:Math.sin(seconds*1.2+i)*.15);m.rotation.z=settings.reduced?0:seconds*.18;}
      magic.emissiveIntensity=settings.reduced?.65:.65+Math.sin(seconds*1.8)*.18;
    };
    root.userData.chunkCount=chunks.length;root.userData.landmarkCount=landmarks.length;
    return root;
  }
  return Object.freeze({create});
})();
