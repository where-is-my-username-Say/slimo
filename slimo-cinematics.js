const SLIMO_ACCENTS = {mint:0x52f3c3,gold:0xffcc5e,violet:0xbb78ff,ice:0xb3e9ff};
let slimoFinish = null;
let slimoImpact = null;
let atomicStarted = 0;
let atomicScene = null;
let atomicCue = 0;
let atomicRequested = -Infinity;
let ownerWave = null;

function slimoImpactFrame(combo, tint) {
  if(settings.reduced) return;
  slimoImpact = {since:performance.now(),combo,tint};
}
function drawSlimoImpact(now) {
  const element=$('slimoImpact');
  const c=slimoImpact;
  const age=c ? (now-c.since)/1000 : Infinity;
  const length=c?.combo===3 ? .25 : .13;
  if(age>=length||settings.reduced){element.style.opacity='0';return;}
  element.style.setProperty('--impact-color',c.tint);
  element.style.opacity=String(Math.max(0,(1-age/length)*(c.combo===3?.78:.46)));
}
function slimoSmoke(x,y,z,color,count=18) {
  particles(x,y,z,count,color,7.1,2.6,.72,'dust');
  particles(x,y/2,z,Math.round(count*.65),0xe5c7b6,5.4,1.4,.89,'dust');
}
function startSlimoFinish(q) {
  if(settings.reduced || !settings.cinema || state.phase!=='round' || state.winner<0) return false;
  const attacker=state.p[1-q.i], victim=state.p[q.i];
  const dx=victim.x-attacker.x, dz=victim.z-attacker.z, length=Math.hypot(dx,dz);
  const nx=length>.1?dx/length:Math.sin(attacker.r);
  const nz=length>.1?dz/length:Math.cos(attacker.r);
  const kind=(state.roundKey+2)%3;
  const bounds=arenaSize();
  const edgeX=bounds.x-.62, edgeZ=bounds.z-.62;
  const a=(nx/edgeX)**2+(nz/edgeZ)**2;
  const b=2*(victim.x*nx/(edgeX**2)+victim.z*nz/(edgeZ**2));
  const c=(victim.x/edgeX)**2+(victim.z/edgeZ)**2-1;
  const distance=Math.max(2,(-b+Math.sqrt(Math.max(0,b*b-4*a*c)))/(2*a));
  slimoFinish={q,kind,nx,nz,ax:attacker.x,az:attacker.z,vx:victim.x,vz:victim.z,
    wx:victim.x+nx*distance,wz:victim.z+nz*distance,rk:state.roundKey,
    start:performance.now(),length:kind===0?2.08:1.94,beats:0};
  return true;
}
function drawSlimoFinish(now) {
  const f=slimoFinish;
  if(!f) return;
  if(state.phase!=='round'||state.roundKey!==f.rk||settings.reduced){slimoFinish=null;return;}
  const age=Math.min(f.length,(now-f.start)/1000);
  const a=fighters[1-f.q.i], v=fighters[f.q.i];
  const hit=f.kind===0?1.04:f.kind===1?.65:.72;
  const turn=Math.atan2(f.nx,f.nz);
  let ax=f.ax, az=f.az, ay=0, yaw=turn;
  if(f.kind===0) {
    const crossed=age>=.36;
    if(crossed){ax=f.vx+f.nx*1.65;az=f.vz+f.nz*1.65;}
    yaw=turn+(crossed?Math.PI:0);
    if(age>=.34 && f.beats===0) {
      slimoSmoke(f.ax,.6,f.az,0xbe9aff);
      slimoSmoke(ax,.8,az,0xd9b8ff);
      shockRing(ax,.035,az,.35,3.6,0xd0a1ff,.44,.82);
      callout('Backstep', 'Slow-motion finish',1.4);
      f.beats=1;
    }
  } else if(f.kind===1) {
    const t=smooth(0,hit,age);
    ax=lerp(f.ax,f.vx-f.nx*1.17,t);
    az=lerp(f.az,f.vz-f.nz*1.17,t);
    ay=Math.sin(t*Math.PI)*2.65;
    if(f.beats===0){callout('Skyhook','Aerial finish',1.3);f.beats=1;}
  } else {
    const t=smooth(0,hit,age);
    ax=lerp(f.ax,f.vx-f.nx*1.2,t);
    az=lerp(f.az,f.vz-f.nz*1.2,t);
    yaw+=Math.sin(t*Math.PI)*TAU;
    if(f.beats===0){callout('Whirlwind','Spinning finish',1.3);f.beats=1;}
  }
  if(age>=hit&&f.beats===1){
    slimoImpactFrame(3,f.kind===0?'#d9a6ff':f.kind===1?'#a4edff':'#ffc579');
    playSound('smack',f.vx,f.vz,true);
    swipe({x:f.vx,z:f.vz,angle:yaw,side:f.kind===1?-1:1,heavy:true},0xffefa8);
    shockRing(f.vx,.08,f.vz,.46,4.8,0xffe0a0,.45,.89);
    slimoSmoke(f.vx,.63,f.vz,0xffd8bd,25);
    f.beats=2;
  }
  const travel=smooth(hit,f.length,age);
  const vx=lerp(f.vx,f.wx,travel), vz=lerp(f.vz,f.wz,travel);
  const vy=Math.sin(travel*Math.PI)*(f.kind===1?5.5:2.8);
  a.root.position.set(ax,ay,az);
  a.tilt.rotation.y=yaw;
  a.jelly.rotation.z=-Math.sin(smooth(hit-.22,hit+.35,age)*Math.PI)*.51;
  v.root.position.set(vx,vy,vz);
  v.tilt.rotation.z=travel*7.7;
  v.shadow.position.set(vx,.032,vz);
  const close=smooth(0,hit,age);
  const follow=travel*.55;
  const cx=lerp(f.vx,vx,follow), cz=lerp(f.vz,vz,follow);
  camera.position.set(cx-f.nz*(5.6-close*1.35)+f.nx*(3.4-travel*2.9),2.7+vy*.43,cz+f.nx*(5.6-close*1.35)+f.nz*(3.4-travel*2.9));
  camera.lookAt(cx,1.1+vy*.42,cz);
  if(age>=f.length){
    slimoFinish=null;
    slimoSmoke(f.wx,.55,f.wz,0xe6cbb8,28);
    impactDebris(f.wx,f.wz,-f.nx,-f.nz);
    slimoImpactFrame(3,'#ffe3c1');
    beginKnockout({...f.q,x:f.wx,z:f.wz,nx:-f.nx*.54,nz:-f.nz*.54,height:.24},v,false);
  }
}
let slimoLookAssets;
function slimoLook(m,p,time) {
  slimoLookAssets ||= {
    halo:new T.TorusGeometry(.68,.032,8,35),
    horn:new T.ConeGeometry(.18,.62,12),
    aura:new T.TorusGeometry(1.25,.035,8,48),
    auraMaterial:new T.MeshBasicMaterial({color:0xffda7e,transparent:true,opacity:.69}),
    accents:Object.fromEntries(Object.entries(SLIMO_ACCENTS).map(([key,color])=>[key,
      new T.MeshStandardMaterial({color,emissive:color,metalness:.35,roughness:.24,emissiveIntensity:.75})]))
  };
  const assets=slimoLookAssets, sheen=assets.accents[p.accent]||assets.accents.mint;
  if(!m.slimoAccessories){
    const group=new T.Group();
    const halo=new T.Mesh(assets.halo,sheen);
    halo.rotation.x=Math.PI/2;
    halo.position.y=2.03;
    group.add(halo);
    const horns=new T.Group();
    for(const side of [-1,1]){
      const tip=new T.Mesh(assets.horn,sheen);
      tip.position.set(side*.59,1.53,.1);
      tip.rotation.z=-side*.39;
      horns.add(tip);
    }
    group.add(horns);
    (m.tilt||m.jelly).add(group);
    const aura=new T.Mesh(assets.aura,assets.auraMaterial);
    aura.rotation.x=Math.PI/2;
    aura.position.y=.12;
    m.root.add(aura);
    m.slimoAccessories={halo,horns,aura};
  }
  const {halo,horns,aura}=m.slimoAccessories;
  const hat=p.hat||'none';
  m.crown.visible=hat==='crown'||p.hat===undefined;
  halo.visible=hat==='halo';horns.visible=hat==='horns';aura.visible=!!p.owner;
  halo.material=sheen;
  for(const horn of horns.children) horn.material=sheen;
  halo.position.y=2.03+Math.sin(time*2.2)*.075;
  aura.scale.setScalar(1+Math.sin(time*3)*.082);
  assets.auraMaterial.opacity=.54+Math.sin(time*4)*.14;
}
function slimoSpeak(line) {
  if(!('speechSynthesis' in window)||!settings.vol||!settings.sfx) return;
  const utterance=new SpeechSynthesisUtterance(line);
  utterance.pitch=.6;utterance.rate=.72;utterance.volume=settings.vol*settings.sfx;
  try { window.speechSynthesis.speak(utterance); } catch {}
}
function buildAtomicScene() {
  const world=new T.Scene(), city=new T.Scene();
  world.background=new T.Color(0x080514);world.fog=new T.FogExp2(0x0e0923,.057);
  city.background=new T.Color(0x140c2e);city.fog=new T.FogExp2(0x21133b,.012);
  const cam=new T.PerspectiveCamera(52,1,.1,360);
  function mesh(scene,geometry,color,x,y,z,emissive=false){
    const material=emissive ? new T.MeshBasicMaterial({color,transparent:true,depthWrite:false}) :
      new T.MeshStandardMaterial({color,roughness:.86});
    const m=new T.Mesh(geometry,material);m.position.set(x,y,z);scene.add(m);return m;
  }
  const floor=mesh(world,new T.PlaneGeometry(20,68),0x30273c,0,0,-7);
  floor.rotation.x=-Math.PI/2;
  mesh(world,new T.BoxGeometry(1,8,68),0x343042,-5.2,3.8,-7);
  mesh(world,new T.BoxGeometry(1,8,68),0x343042,5.2,3.8,-7);
  for(let z=-24;z<=18;z+=5) for(const x of [-4.55,4.55]) mesh(world,new T.BoxGeometry(.65,6.8,.75),0x3e3656,x,3.4,z);
  const shadow=new T.Group();world.add(shadow);
  mesh(shadow,new T.ConeGeometry(1.17,2.85,18),0x171320,0,1.38,0);
  mesh(shadow,new T.SphereGeometry(.58,18,12),0x1a1429,0,2.85,.04);
  mesh(shadow,new T.SphereGeometry(.33,16,12),0x15131f,0,2.78,.38);
  for(const x of [-.11,.11]) mesh(shadow,new T.BoxGeometry(.10,.027,.04),0xc818ff,x,2.82,.68,true);
  mesh(world,new T.CylinderGeometry(.34,.46,1.24,14),0x1f253d,0,.69,7.4);
  mesh(world,new T.SphereGeometry(.32,14,10),0x1f253d,0,1.49,7.4);
  const blade=mesh(shadow,new T.BoxGeometry(.10,2.34,.14),0xe4bcff,.91,1.58,.35,true);
  blade.rotation.z=-.35;
  const light=new T.PointLight(0xa755ff,1,30,1.6);light.position.set(.2,2,1.2);world.add(light);
  world.add(new T.HemisphereLight(0x957bea,0x110714,.36),new T.AmbientLight(0x625384,.18));
  const lines=[];
  for(let i=0;i<30;i++){
    const side=i%2===0?-1:1;
    const start=-9+i*.64;
    const line=mesh(world,new T.BoxGeometry(.05,.013,1),i%4===0?0xffffff:0xb96dff,side*(.46+i%6*.53),.026,start,true);
    line.rotation.y=side*(i%3===0?1.05:.32);
    lines.push(line);
  }
  const vertices=new Float32Array(64*3);
  const dust=new T.BufferGeometry();dust.setAttribute('position',new T.BufferAttribute(vertices,3));
  const sparks=new T.Points(dust,new T.PointsMaterial({color:0xe6b4ff,size:.075,transparent:true,opacity:.78,depthWrite:false,blending:T.AdditiveBlending}));world.add(sparks);
  city.add(new T.HemisphereLight(0xceadff,0x241831,.49));
  const ground=mesh(city,new T.PlaneGeometry(180,180),0x29203b,0,0,0);ground.rotation.x=-Math.PI/2;
  for(let x=-42;x<=42;x+=7) for(let z=-45;z<=30;z+=7){
    if(Math.hypot(x,z)<6)continue;
    const h=2.3+Math.abs(Math.sin(x*.73+z*.37))*5.6;
    mesh(city,new T.BoxGeometry(4.7,h,4.5),0x392b53,x,h*.5,z);
    const roof=mesh(city,new T.ConeGeometry(3.8,2.25,4),0x42315d,x,h+1,z);roof.rotation.y=Math.PI/4;
  }
  const pillar=mesh(city,new T.CylinderGeometry(.55,2.5,90,24),0xe2aaff,0,42,0,true);
  const shell=mesh(city,new T.CylinderGeometry(1.9,6,90,28,1,true),0x8e48ff,0,42,0,true);
  const wave=mesh(city,new T.RingGeometry(.89,1,72),0xd5aeff,0,.29,0,true);wave.rotation.x=-Math.PI/2;
  const townLight=new T.PointLight(0xaa52ff,1,85,1.45);townLight.position.set(0,8,0);city.add(townLight);
  return {world,city,cam,blade,light,lines,sparks,vertices,pillar,shell,wave,townLight};
}
function startAtomic() {
  if(atomicStarted) return;
  atomicScene ||= buildAtomicScene();
  atomicStarted=performance.now();atomicCue=0;
  $('atomicCaption').hidden=false;
}
function drawAtomic(now) {
  if(!atomicStarted)return false;
  const t=(now-atomicStarted)/1000;
  const caption=$('atomicCaption');
  const flash=$('atomicFlash');
  if(t>=16||mode==='lobby'){
    atomicStarted=0;caption.hidden=true;flash.style.opacity='0';
    return false;
  }
  const a=atomicScene, c=a.cam;
  c.aspect=innerWidth/Math.max(1,innerHeight);c.updateProjectionMatrix();
  const spread=smooth(1.1,5.8,t), gather=smooth(4.7,8.9,t);
  a.lines.forEach((line,i)=>{
    const part=smooth(1.35+i*.098,3.35+i*.098,t);
    line.scale.z=5.2*part+.001;line.material.opacity=part*(.62+.31*Math.sin(t*5+i*.4));
  });
  a.light.intensity=.38+spread*3.9+gather*3.7;
  a.blade.material.opacity=.15+gather*.85;
  a.blade.scale.x=1+gather*2.2;
  for(let i=0;i<64;i++){
    const angle=i*2.399+t*(.16+gather*.65), radius=(1+i%13*.29)*(1-gather*.88);
    a.vertices[i*3]=Math.cos(angle)*radius+.63*gather;
    a.vertices[i*3+1]=.45+(i%17)*.19;
    a.vertices[i*3+2]=Math.sin(angle)*radius;
  }
  a.sparks.geometry.attributes.position.needsUpdate=true;
  if(t>=7.45&&atomicCue===0){atomicCue=1;slimoSpeak('I am');}
  if(t>=9.8&&atomicCue===1){atomicCue=2;slimoSpeak('Atomic');playSound('nova');}
  caption.textContent=t<7.45?'':t<9.8?'I am…':t<13.4?'ATOMIC':'';
  const burst=smooth(9.78,9.83,t)*(1-smooth(9.89,10.22,t));
  flash.style.opacity=String(burst*(settings.reduced?.20:.86));
  if(t<9.94){
    const close=smooth(5.2,7.55,t), push=1+spread*2.5;
    c.position.set(lerp(-1.4,.30,close),lerp(1.36,2.79,close),lerp(11-push,2.55,close));
    c.lookAt(0,lerp(1.32,2.76,close),0);
    renderer.render(a.world,c);
  }else{
    const release=smooth(9.94,15.85,t), glow=1-smooth(10.19,15.75,t);
    a.pillar.scale.x=a.pillar.scale.z=.84+release*1.46;a.pillar.material.opacity=glow*.89;
    a.shell.scale.x=a.shell.scale.z=1+release*1.65;a.shell.material.opacity=glow*.31;
    a.wave.scale.setScalar(3+release*68);a.wave.material.opacity=glow*.86;
    a.townLight.intensity=glow*19;
    c.position.set(29+17*release,15+8*release,44+11*release);
    c.lookAt(0,8,0);renderer.render(a.city,c);
  }
  return true;
}
function slimoActivateEmote(key) {
  if(!slimoAccount?.username || !['fight','round','over'].includes(state.phase)) return;
  if(key==='atomic'&&!slimoAccount.atomic || key==='wave'&&!slimoAccount.owner) return;
  if(key==='atomic') {
    const now=performance.now();
    if(now-atomicRequested<20000||atomicStarted)return;
    atomicRequested=now;
    if(mode==='public')publicRoom.ws?.send(JSON.stringify({t:'emote',key}));
    else if(mode==='guest')send({t:'slimoEmote',key});
    else if(mode==='host'){event('atomic',0,0,{i:0,color:chosen});broadcastState();}
    else startAtomic();
  }else{
    if(mode==='guest')send({t:'slimoEmote',key});
    else if(mode==='host'){event('ownerWave',0,0,{i:0,color:chosen});broadcastState();}
    else ownerWave={slot:0,until:performance.now()+1600};
  }
}

