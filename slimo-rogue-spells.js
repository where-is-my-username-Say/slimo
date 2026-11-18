'use strict';

// Roguelike upgrades trigger from the existing combat moves. No extra ability
// buttons, mana resource, or input packets are needed; only the host simulates.
globalThis.SlimoRogueSpells=(()=>{
  const W=globalThis.SlimoWorld,coverCache=new WeakMap();
  const triggers=Object.freeze({earthwall:'dash',mending:'dash',embertrail:'slap',stormcoil:'slap',stoneburst:'spit',starfall:'spit',frostbloom:'nova',vortex:'nova'});
  const alive=p=>p?.active&&p.hp>0;
  function trigger(state,owner,action,notice=()=>{},aimOverride) {
    const p=state.p?.[owner];if(state.format!=='rogue'||state.phase!=='fight'||!state.run||!alive(p))return [];
    const effects=state.run.spellEffects||=([]),created=[];p.spellCooldowns||={};
    for(const [key,move]of Object.entries(triggers)){
      const rank=p.ranks?.[key];if(move!==action||![1,2,3].includes(rank)||(p.spellCooldowns[key]||0)>0||effects.length>=32)continue;
      const level=W.spells[key].levels[rank-1],aim=Number.isFinite(aimOverride)?aimOverride:p.attackAim??p.r??0,distance=key==='earthwall'?3:key==='starfall'?4:key==='vortex'?3:0;
      const e={id:++state.serial,key,rank,owner,age:0,duration:level.duration,x:p.x+Math.sin(aim)*distance,z:p.z+Math.cos(aim)*distance,aim,hit:false,pulse:-1,armed:true};
      if(key==='stoneburst')e.orbs=Array.from({length:level.shots},(_,i)=>{
        const a=aim+(i/(level.shots-1)-.5)*.95;return {x:p.x+Math.sin(a)*1.2,z:p.z+Math.cos(a)*1.2,vx:Math.sin(a)*16,vz:Math.cos(a)*16,live:true};
      });
      p.spellCooldowns[key]=level.cooldown;effects.push(e);created.push(e);notice(e);
    }
    if(created.length)state.run.spellRevision=(state.run.spellRevision||0)+1;
    return created;
  }
  function segmentHit(x,z,nx,nz,p,radius){const dx=nx-x,dz=nz-z,length=dx*dx+dz*dz;
    const t=length?Math.max(0,Math.min(1,((p.x-x)*dx+(p.z-z)*dz)/length)):0;return Math.hypot(x+dx*t-p.x,z+dz*t-p.z)<=radius;}
  function tick(state,dt,{damage,blocked=()=>false}={}) {
    if(state.format!=='rogue'||state.phase!=='fight'||state.paused||!state.run)return;
    for(const p of state.p)for(const key of Object.keys(p.spellCooldowns||{}))p.spellCooldowns[key]=Math.max(0,p.spellCooldowns[key]-dt);
    const effects=state.run.spellEffects||=[];
    for(const e of effects){
      e.age+=dt;const p=state.p[e.owner],target=state.p[1-e.owner],level=W.spells[e.key].levels[e.rank-1];
      if(!alive(p)||!alive(target)||e.key==='earthwall')continue;
      const hit=(x,z,amount)=>{const dx=target.x-x,dz=target.z-z,d=Math.hypot(dx,dz)||1;
        return damage?.(1-e.owner,amount,dx/d,dz/d,{source:'spell',power:e.key==='vortex'?0:2,stun:.08})===true;};
      if(e.key==='stoneburst'){
        for(const orb of e.orbs||[]){if(!orb.live)continue;const x=orb.x+orb.vx*dt,z=orb.z+orb.vz*dt;
          if(blocked(orb.x,orb.z,x,z)){orb.live=false;continue;}
          if(!e.hit&&target.air<1.7&&segmentHit(orb.x,orb.z,x,z,target,.83*target.size+.26)){e.hit=true;orb.live=false;hit(x,z,level.damage);}
          orb.x=x;orb.z=z;
        }continue;
      }
      if(e.age<(level.delay||0))continue;
      const pulse=e.key==='vortex'?Math.floor((e.age-level.delay)/.4):0;if(e.pulse===pulse)continue;e.pulse=pulse;
      if(e.key==='mending'){p.hp=Math.min(p.maxHp,p.hp+level.heal);continue;}
      let inRange=Math.hypot(target.x-e.x,target.z-e.z)<=level.radius;
      if(e.key==='embertrail')inRange=Array.from({length:3+e.rank},(_,i)=>2+i*1.25).some(d=>Math.hypot(target.x-e.x-Math.sin(e.aim)*d,target.z-e.z-Math.cos(e.aim)*d)<=level.radius);
      if(e.key==='stormcoil')e.links=inRange?[{x:target.x,z:target.z}]:[];
      if(!inRange||target.air>1.7||e.key!=='vortex'&&e.hit)continue;e.hit=true;
      if(hit(e.x,e.z,level.damage)){
        if(e.key==='frostbloom'){target.chill=2;target.chillAmount=level.slow;}
        if(e.key==='vortex'){const d=Math.hypot(e.x-target.x,e.z-target.z)||1;target.kx+=(e.x-target.x)/d*2.5;target.kz+=(e.z-target.z)/d*2.5;}
      }
    }
    state.run.spellEffects=effects.filter(e=>e.age<e.duration&&alive(state.p[e.owner]));
    state.run.spellRevision=(state.run.spellRevision||0)+1;
  }
  function walls(state){return (state.run?.spellEffects||[]).filter(e=>e.key==='earthwall'&&e.age>=.48&&e.age<e.duration-.35&&alive(state.p[e.owner])).flatMap(W.wallSegments);}
  function cover(state,base){
    if(state.format!=='rogue'||!state.run)return base;
    const cached=coverCache.get(state.run),revision=state.run.spellRevision||0;if(cached?.revision===revision&&cached.base===base)return cached.cover;
    const extra=walls(state),result=extra.length?base.concat(extra):base;coverCache.set(state.run,{revision,base,cover:result});return result;
  }
  function validEffects(effects){return effects===undefined||Array.isArray(effects)&&effects.length<=32&&effects.every(e=>e&&Object.hasOwn(W.spells,e.key)&&[0,1].includes(e.owner)&&[1,2,3].includes(e.rank)&&
    Number.isSafeInteger(e.id)&&[e.x,e.z,e.aim,e.age,e.duration].every(Number.isFinite)&&Math.abs(e.x)<200&&Math.abs(e.z)<200&&e.age>=0&&e.duration>0&&e.duration<=10&&
    (!e.links||Array.isArray(e.links)&&e.links.length<=1&&e.links.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<200&&Math.abs(p.z)<200))&&
    (!e.orbs||Array.isArray(e.orbs)&&e.orbs.length<=9&&e.orbs.every(q=>q&&[q.x,q.z,q.vx,q.vz].every(Number.isFinite)&&Math.abs(q.x)<200&&Math.abs(q.z)<200&&Math.hypot(q.vx,q.vz)<=32&&typeof q.live==='boolean')));}
  return Object.freeze({triggers,trigger,tick,walls,cover,validEffects});
})();
