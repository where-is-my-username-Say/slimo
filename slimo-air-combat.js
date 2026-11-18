'use strict';
// One airborne combat implementation for practice, the duel host and Meadow.
globalThis.SlimoAirCombat=(()=>{
 const gravity=17, jumpSpeed=6.4*Math.sqrt(3), maxCharge=1.05;
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:0));
 function cancel(p){p.airMove=0;p.airCharge=0;}
 function jump(p,emit=()=>{}){if(p.air>.01||p.vy>0||p.suplex||p.airMove)return false;p.vy=jumpSpeed;p.air=.04;emit('jump',p.x,p.z,{i:p.id,color:p.color,height:0});return true;}
 function begin(p,emit){
  if(!(p.air>.1||p.vy>0)||p.hp<=0||p.stun>0||p.airMove||p.suplex)return false;
  p.attack='';p.attackTime=0;p.airMove=1;p.airCharge=0;p.airStruck=false;
  emit('airCharge',p.x,p.z,{i:p.id,color:p.color,height:p.air});return true;
 }
 function counterReady(p){return (p.dashTime>0&&.268-p.dashTime<.154+(p.ranks?.phase?[.02,.04,.06][p.ranks.phase-1]:0))||
  (p.attack==='slap'&&p.attackTime>0&&p.duration-p.attackTime<=.16);}
 function strike(p,targets,api){
  if(p.airStruck)return;p.airStruck=true;
  const charge=clamp(p.airCharge/maxCharge,0,1),radius=2.7+charge*1.4;
  const nearby=targets.filter(t=>t!==p&&t.hp>0&&t.active!==false&&!t.respawnAt&&Math.abs((t.air||0)-p.air)<1.6&&Math.hypot(t.x-p.x,t.z-p.z)<=radius);
  const counter=nearby.filter(t=>api.canHarm(p,t)&&counterReady(t)&&(t.dashTime>0||(Math.sin(t.attackAim??t.r??0)*(p.x-t.x)+Math.cos(t.attackAim??t.r??0)*(p.z-t.z))/(Math.hypot(p.x-t.x,p.z-t.z)||1)>.25)).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  if(counter){
   const dx=p.x-counter.x,dz=p.z-counter.z,d=Math.hypot(dx,dz)||1;
   p.airMove=0;p.attack='';p.attackTime=0;p.stun=Math.max(p.stun,.8);p.kx=p.kz=p.vx=p.vz=0;
   p.suplex={by:counter.id,age:0,x:p.x,z:p.z,y:p.air,endX:counter.x-dx/d*1.8,endZ:counter.z-dz/d*1.8};p.suplexTime=.65;counter.grabTime=.65;counter.attack='';counter.attackTime=0;
   api.emit('suplex',counter.x,counter.z,{i:p.id,j:counter.id,color:counter.color,height:p.air});return;
  }
  api.emit('airSlam',p.x,p.z,{i:p.id,color:p.color,charge,radius,height:p.air});
  for(const target of nearby)api.hit(p,target,12+Math.round(charge*16),{type:'airSlam',power:5+charge*5,stun:.2+charge*.15,armed:p.airArmed!==false});
 }
 function step(p,input,dt,targets,api){
  p.grabTime=Math.max(0,(p.grabTime||0)-dt);
  if(p.suplexTime>0&&!p.suplex){p.suplexTime=Math.max(0,p.suplexTime-dt);return;}
  if(p.hp<=0){cancel(p);p.suplex=null;p.suplexTime=0;return;}
  if(p.suplex){
   const s=p.suplex;s.age+=dt;const t=clamp(s.age/.65,0,1);
   p.x=s.x+(s.endX-s.x)*t;p.z=s.z+(s.endZ-s.z)*t;p.air=Math.max(0,s.y*(1-t)+Math.sin(t*Math.PI)*2.4);p.vy=0;p.suplexTime=.65-s.age;
   if(t>=1){const owner=targets.find(t=>t.id===s.by);p.suplex=null;p.suplexTime=0;cancel(p);if(owner)api.hit(owner,p,22,{type:'suplex',power:9,stun:.55,armed:true});api.emit('airSlam',p.x,p.z,{i:p.id,color:p.color,radius:3,height:0,charge:1});}return;
  }
  if((p.stun>0||input.ready===false)&&p.airMove)cancel(p);
  if(p.airMove===1){
   p.airCharge=clamp(p.airCharge+dt,0,maxCharge);
   // Brief hover while charging, without invulnerability or lost horizontal speed.
   if(input.slapHeld&&p.airCharge<maxCharge)p.vy=Math.max(p.vy,-.7);
   else {p.airMove=2;p.vy=-14-8*p.airCharge/maxCharge;api.emit('airDive',p.x,p.z,{i:p.id,color:p.color,height:p.air});}
  }
  if(p.air>0||p.vy>0){
   const before=p.air;p.vy-=gravity*dt;p.air=Math.max(0,p.air+p.vy*dt);
   if(p.airMove===2&&!p.airStruck&&p.vy<0){
    const closest=targets.some(t=>t!==p&&t.hp>0&&Math.hypot(t.x-p.x,t.z-p.z)<4.1&&p.air<=(t.air||0)+1.15&&before>=(t.air||0)-.4);
    if(closest||p.air<=0)strike(p,targets,api);
   }
   if(p.air<=0&&!p.suplex){p.air=p.vy=0;cancel(p);api.emit('land',p.x,p.z,{i:p.id,color:p.color});}
  }
 }
 function aimSpit(q,p,target){
  q.y=(p.air||0)+.83;q.vy=0;
  if(!target)return;
  const dx=target.x-q.x,dz=target.z-q.z,d=Math.hypot(dx,dz),speed=Math.hypot(q.vx,q.vz);
  if(d<.1||speed<1||(dx*q.vx+dz*q.vz)/(d*speed)<.65)return;
  const flight=d/speed,lead=target.airMove===1?0:(target.vy||0)*Math.min(flight,.35)*.7;
  q.vy=clamp(((target.air||0)+.83+lead-q.y)/Math.max(.06,flight),-45,45);
 }
 function sphere(x,y,z,nx,ny,nz,cx,cy,cz,r){
  const dx=nx-x,dy=ny-y,dz=nz-z,ox=x-cx,oy=y-cy,oz=z-cz,c=ox*ox+oy*oy+oz*oz-r*r;
  if(c<=0)return 0;const a=dx*dx+dy*dy+dz*dz;if(a<1e-9)return Infinity;
  const b=ox*dx+oy*dy+oz*dz,delta=b*b-a*c;if(delta<0)return Infinity;const t=(-b-Math.sqrt(delta))/a;return t>=0&&t<=1?t:Infinity;
 }
 function pose(p,landingAge=99,reduced=false){
  const charge=clamp((p.airCharge||0)/maxCharge,0,1),airborne=p.air>0;
  const stretch=reduced?1:airborne?(p.airMove===1?1-.24*charge:p.airMove===2?1.28:p.vy>jumpSpeed*.86&&p.air<.5?.82+p.air*.8:.97+.23*Math.abs(Math.tanh((p.vy||0)/7))):1-.3*Math.exp(-Math.max(0,landingAge)*9)*Math.cos(Math.max(0,landingAge)*20);
  const flip=p.suplexTime>0?(1-p.suplexTime/.65)*Math.PI*2:0;
  return {stretch,tilt:reduced?0:flip||(p.airMove===2?.5:0),arms:p.grabTime>0?1.2:p.airMove===1?.6+charge*.5:p.airMove===2?1.3:airborne?.35:0};
 }
 function valid(p){return (p.grabTime===undefined||Number.isFinite(p.grabTime)&&p.grabTime>=0&&p.grabTime<=.65)&&(p.airMove===undefined||[0,1,2].includes(p.airMove))&&(p.airCharge===undefined||Number.isFinite(p.airCharge)&&p.airCharge>=0&&p.airCharge<=maxCharge)&&
  (p.suplexTime===undefined||Number.isFinite(p.suplexTime)&&p.suplexTime>=0&&p.suplexTime<=.65);}
 return Object.freeze({gravity,jumpSpeed,maxCharge,jump,begin,step,cancel,counterReady,aimSpit,sphere,pose,valid});
})();
