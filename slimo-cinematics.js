const SLIMO_ACCENTS = {mint:0x52f3c3,gold:0xffcc5e,violet:0xbb78ff,ice:0xb3e9ff};
let slimoFinish = null;
let slimoImpact = null;
let atomicRequested = -Infinity;
let ownerWave = null;

const IMPACT_FRAME_COOLDOWN = 300;
let lastImpactFrame = -Infinity;

function slimoImpactFrame(combo) {
  const now=performance.now();
  if(settings.reduced || now-lastImpactFrame<IMPACT_FRAME_COOLDOWN) return;
  lastImpactFrame=now;
  slimoImpact={since:now,heavy:combo>=3};
}
function drawSlimoImpact(now) {
  const element=$('slimoImpact');
  const impact=slimoImpact;
  const age=impact ? now-impact.since : Infinity;
  const hold=impact?.heavy ? 112 : 58;
  if(settings.reduced || age>=hold) {
    element.hidden=true;
    delete document.body.dataset.impactFrame;
    slimoImpact=null;
    return;
  }
  const frame=impact.heavy && age<36 ? 'negative' : 'ink';
  element.hidden=false;
  if(document.body.dataset.impactFrame!==frame) document.body.dataset.impactFrame=frame;
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
    slimoImpactFrame(3);
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
    slimoImpactFrame(3);
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
function slimoActivateEmote(key) {
  if(!slimoAccount?.username || !['fight','round','over'].includes(state.phase)) return;
  if(key==='atomic'&&!slimoAccount.atomic || key==='wave'&&!slimoAccount.owner) return;
  if(key==='atomic') {
    const now=performance.now();
    if(now-atomicRequested<20000)return;
    atomicRequested=now;
    if(mode==='public')publicRoom.ws?.send(JSON.stringify({t:'emote',key}));
    else if(mode==='guest')send({t:'slimoEmote',key});
    else if(mode==='host'){event('atomic',0,0,{i:0,color:chosen});broadcastState();}
    else startAtomic(localSlot);
  }else{
    if(mode==='guest')send({t:'slimoEmote',key});
    else if(mode==='host'){event('ownerWave',0,0,{i:0,color:chosen});broadcastState();}
    else ownerWave={slot:0,until:performance.now()+1600};
  }
}

