import './slimo-world.js';

const W = globalThis.SlimoWorld;
const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : 0));
const rank = (p, key) => clamp(p.ranks?.[key], 0, 3);
const stat = W.stat;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export function segmentCircle(x, z, nx, nz, cx, cz, radius) {
  const dx = nx - x, dz = nz - z, ox = x - cx, oz = z - cz;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return Infinity;
  const b = ox * dx + oz * dz, delta = b * b - a * c;
  if (delta < 0) return Infinity;
  const t = (-b - Math.sqrt(delta)) / a;
  return t >= 0 && t <= 1 ? t : Infinity;
}

export class MeadowCombat {
  constructor(players = new Map()) {
    this.players = players; this.time = 0; this.serial = 0; this.now = Date.now(); this.waves = [];
    this.events = []; this.bullets = []; this.effects = []; this.rosterDirty = false;
    this.coverGrid = new Map();
    for (const c of W.cover) {
      const key = Math.floor(c.x / 16) + ':' + Math.floor(c.z / 16);
      if (!this.coverGrid.has(key)) this.coverGrid.set(key, []);
      this.coverGrid.get(key).push(c);
    }
  }
  prepare(p) {
    Object.assign(p, { maxHp: 100 + stat(p,'colossus','hp'), size: 1 + stat(p,'colossus','size'),
      mana: p.mana ?? 100, cooldowns: p.cooldowns || {}, castAt: p.castAt ?? -Infinity,
      burnTicks: 0, burnClock: 0, chill: 0, chillAmount: 0, hit: 0, shield: 0,
      respawnAt: 0, guarded: false, secondUsed: false, combo: 0, chainUntil: 0, counterUntil: 0 });
    p.hp = p.maxHp;
    return p;
  }
  emit(type, x, z, data = {}) {
    this.events.push({ id: ++this.serial, type, x, z, ...data });
    if (this.events.length > 180) this.events.shift();
  }
  alive(p) { return !!p?.joined && p.hp > 0 && !p.respawnAt; }
  active(p) { return this.alive(p) && p.ready && this.now - p.inputAt < 1000; }
  canHarm(p, target, armed = true) {
    return armed && this.alive(p) && this.alive(target) && p.id !== target.id && W.insideRing(p.x,p.z) && W.insideRing(target.x,target.z);
  }
  walls() {
    return this.effects.filter(e => e.key === 'earthwall' && e.armed && e.age >= .48 && e.age < e.duration - .35 &&
      this.alive(this.players.get(e.owner)));
  }
  coverNear(x, z, includeWalls = false) {
    const list = [], gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) list.push(...(this.coverGrid.get((gx+a)+':'+(gz+b)) || []));
    if (includeWalls) for (const wall of this.walls()) list.push(...W.wallSegments(wall).filter(c => W.insideRing(c.x,c.z)));
    return list;
  }
  startMove(p, name) {
    if (!this.active(p) || p.stun > 0 || p.respawnAt || p.dashTime > 0) return false;
    if (name === 'jump') {
      if (p.air > .01 || p.attack) return false;
      p.vy = 6.4; p.air = .04; return true;
    }
    if (name === 'dash') {
      if (p.dash > 0 || p.attack && (!p.struck || p.duration-p.attackTime < .20)) return false;
      const length = Math.hypot(p.ix || 0,p.iz || 0);
      p.attack='';p.attackTime=0;
      p.dashTime = .268; p.dash = stat(p,'swift','cooldown') || .98;
      p.kx = (length > .12 ? p.ix/length : -Math.sin(p.aim || 0)) * 23;
      p.kz = (length > .12 ? p.iz/length : -Math.cos(p.aim || 0)) * 23;
      this.emit('dash',p.x,p.z,{i:p.id,color:p.color,angle:p.r}); return true;
    }
    if (p.attack || p.air > .1 || !['slap','spit','nova'].includes(name)) return false;
    if (name === 'nova' && (!W.insideRing(p.x,p.z) || p.en < 100)) return false;
    if (name === 'slap') p.combo = this.time < p.chainUntil ? (p.combo+1)%3 : 0;
    const duration = name === 'slap' ? [.352,.378,.58][p.combo] : name === 'spit' ? .441 : .690;
    const contact = name === 'slap' ? [.131,.151,.270][p.combo] : name === 'spit' ? .176 : .352;
    const speed = name === 'slap' ? (stat(p,'tempo','time') || 1) : 1;
    Object.assign(p,{attack:name,attackTime:duration*speed,duration:duration*speed,contactTime:contact*speed,
      reflected:false,attackAim:p.aim || 0,attackArmed:W.insideRing(p.x,p.z),struck:false,emote:0});
    if (name === 'nova') { p.en = 0; this.emit('chargeNova',p.x,p.z,{i:p.id,color:p.color}); }
    if (name === 'spit') this.emit('chargeSpit',p.x,p.z,{i:p.id,color:p.color});
    return true;
  }
  hit(source, target, amount, options = {}) {
    const { armed = true, type = 'spell', power = 2, chain = 0 } = options;
    if (!this.alive(target)) return false;
    if (!this.canHarm(source,target,armed)) {
      this.emit('playTap',target.x,target.z,{i:target.id,j:source.id,color:source.color,source:type,height:target.air || 0});
      return false;
    }
    if (target.dashTime > 0 && .268-target.dashTime < .214+stat(target,'phase','inv')) {
      if (.268-target.dashTime < .154 && target.counterUntil <= this.time) {
        target.counterUntil = this.time + stat(target,'counter','time',1.65);
        this.emit('perfect',target.x,target.z,{i:target.id,color:target.color});
      }
      return false;
    }
    let damage = Math.max(1,Math.round(amount*(1-stat(target,'armor','cut'))));
    if (!target.guarded && rank(target,'guard')) { damage = Math.max(1,Math.round(damage*(1-stat(target,'guard','cut')))); target.guarded = true; }
    const dx = target.x-source.x, dz = target.z-source.z, distance = Math.hypot(dx,dz) || 1;
    target.hp = Math.max(0,target.hp-damage); target.hit = .27; target.stun = Math.max(target.stun || 0,options.stun ?? .1);
    const shove = power*(1-stat(target,'anchor','cut'));
    target.kx += dx/distance*shove; target.kz += dz/distance*shove;
    target.lastHit = this.time; source.lastHit = this.time;
    if (options.heavy) { target.vy = options.launch || 4.8; target.air = Math.max(.04,target.air); }
    target.en = clamp(target.en+7*stat(target,'battery','energy',1),0,100); source.en = clamp(source.en+(type==='slap'?19:13)*stat(source,'battery','energy',1),0,100);
    const rescue = stat(target,'second','heal');
    if (rescue && !target.secondUsed && target.hp > 0 && target.hp < target.maxHp*.34) { target.hp += rescue; target.secondUsed = true; }
    if (type === 'slap') source.hp = Math.min(source.maxHp,source.hp+stat(source,'leech','heal'));
    this.emit('hit',target.x,target.z,{i:target.id,j:source.id,color:target.color,nx:dx/distance,nz:dz/distance,
      damage,source:type,chain,heavy:!!options.heavy,height:target.air || 0});
    if (target.hp <= 0) {
      target.respawnAt = this.time+3.6; target.attack = ''; target.attackTime = 0; target.burnTicks = 0;
      source.wins = (source.wins || 0)+1; this.rosterDirty = true;
      this.emit('ko',target.x,target.z,{i:target.id,j:source.id,color:target.color,nx:dx/distance,nz:dz/distance,source:type,height:target.air || 0});
    }
    return true;
  }
  spawnBullet(p, angle, damage, extra = {}) {
    if (this.bullets.length >= 120) return;
    const nx = Math.sin(angle), nz = Math.cos(angle);
    this.bullets.push({id:++this.serial,owner:p.id,x:p.x+nx*1.25,z:p.z+nz*1.25,vx:nx*(28+stat(p,'speed','speed')),
      vz:nz*(28+stat(p,'speed','speed')),life:2.1,damage,color:p.color,fire:rank(p,'fire'),frost:rank(p,'frost'),
      seeker:rank(p,'seeker'),returns:0,cannon:rank(p,'speed'),fork:0,banks:stat(p,'boomer','banks'),
      charged:p.spitCharge>=.99,armed:W.insideRing(p.x,p.z),...extra});
  }
  resolve(p) {
    if (!p.attack || p.struck || p.duration-p.attackTime+1e-6 < p.contactTime) return;
    p.struck = true;
    const type = p.attack, nx = Math.sin(p.attackAim), nz = Math.cos(p.attackAim);
    if (type === 'spit') {
      const hitTargets = new Set();
      this.emit('spit',p.x,p.z,{i:p.id,color:p.color,angle:p.attackAim});
      this.spawnBullet(p,p.attackAim,11+stat(p,'speed','damage'),{armed:p.attackArmed,hitTargets});
      if (stat(p,'fork','count')) {
        const spread = stat(p,'fork','spread'), damage = stat(p,'fork','sideDamage');
        this.spawnBullet(p,p.attackAim+spread,damage,{armed:p.attackArmed,fork:rank(p,'fork'),hitTargets});
        if (stat(p,'fork','count') > 1) this.spawnBullet(p,p.attackAim-spread,damage,{armed:p.attackArmed,fork:rank(p,'fork'),hitTargets});
      }
      return;
    }
    const heavy = type === 'slap' && (p.combo===2 || p.counterUntil>this.time);
    if(type==='slap' && p.combo===2)this.queueWave(p,'echo',p.x+nx*2.25,p.z+nz*2.25,.43);
    if(type==='nova')this.queueWave(p,'after',p.x,p.z,.7);
    const radius = type==='nova' ? 6.6+stat(p,'wide','radius') : [3.26,3.45,3.83][p.combo]+stat(p,'reach','reach');
    this.emit(type,p.x,p.z,{i:p.id,color:p.color,angle:p.attackAim,side:p.combo===1?-1:1,heavy,radius,playful:!p.attackArmed});
    for (const target of this.players.values()) {
      if (target.id===p.id || !this.alive(target)) continue;
      const distance = Math.hypot(target.x-p.x,target.z-p.z);
      if (distance > radius+(target.size-1)*.76 || target.air > 1.7) continue;
      if (type==='slap' && Math.abs(wrap(Math.atan2(target.x-p.x,target.z-p.z)-p.attackAim)) > (p.combo===2?1.04:.91)) continue;
      if (this.coverNear(p.x,p.z,p.attackArmed).some(c => segmentCircle(p.x,p.z,target.x,target.z,c.x,c.z,c.r) !== Infinity)) continue;
      const damage = type==='nova' ? 26 : [11,13,20][p.combo]+stat(p,'power','damage')+(p.counterUntil>this.time?7+stat(p,'counter','damage'):0)+(p.combo===2?stat(p,'finisher','damage'):0);
      this.hit(p,target,damage,{armed:p.attackArmed,type,power:heavy?14.4:5.8,stun:heavy?.44:.18,heavy,launch:4.8+(p.combo===2?stat(p,'finisher','lift'):0),chain:p.combo+1});
    }
    if (type==='slap') { p.chainUntil = this.time+.79; p.counterUntil = 0; }
  }
  queueWave(p, key, x, z, delay) {
    const level = W.passives[key].levels[rank(p,key)-1];
    if (!level || this.waves.length >= 64) return;
    this.waves.push({owner:p.id,key,x,z,delay,armed:W.insideRing(p.x,p.z),radius:level.radius,damage:level.damage});
    this.emit('waveCue',x,z,{i:p.id,color:p.color,skill:key,rank:rank(p,key),radius:level.radius,delay});
  }
  tickWaves(dt) {
    for (const wave of this.waves) {
      wave.delay -= dt; if(wave.delay>0)continue;
      const p = this.players.get(wave.owner); if(!this.alive(p))continue;
      this.emit('wave',wave.x,wave.z,{i:p.id,color:p.color,skill:wave.key,rank:rank(p,wave.key),radius:wave.radius});
      for(const target of this.players.values())if(target.id!==p.id&&Math.hypot(target.x-wave.x,target.z-wave.z)<=wave.radius)
        this.hit(p,target,wave.damage,{type:wave.key,armed:wave.armed,power:2});
    }
    this.waves=this.waves.filter(w=>w.delay>0&&this.alive(this.players.get(w.owner)));
  }
  reflect(p) {
    if(p.attack!=='slap'||p.reflected)return;
    const age=p.duration-p.attackTime, window=stat(p,'return','window');
    if(age<p.contactTime-.105-window||age>p.contactTime+.14+window)return;
    const q=this.bullets.find(q=>q.owner!==p.id&&q.returns<3&&Math.hypot(q.x-p.x,q.z-p.z)<4.55&&
      (q.x-p.x)*q.vx+(q.z-p.z)*q.vz<0&&Math.abs(wrap(Math.atan2(q.x-p.x,q.z-p.z)-p.attackAim))<1.36);
    if(!q)return;
    q.owner=p.id;q.color=p.color;q.returns++;q.damage=15+q.returns+stat(p,'return','damage');q.life=1.45;
    q.armed=q.armed&&W.insideRing(p.x,p.z);q.vx=Math.sin(p.attackAim)*(34+q.returns*2);q.vz=Math.cos(p.attackAim)*(34+q.returns*2);
    q.hitTargets=new Set();p.reflected=true;p.en=clamp(p.en+19*stat(p,'battery','energy',1),0,100);
    this.emit('return',q.x,q.z,{i:p.id,color:p.color,angle:p.attackAim});
  }
  cast(p, key) {
    const definition = W.spells[key], learned = rank(p,key);
    if (!definition || !learned) return {ok:false,message:'Equip a rank of that spell in Meadow build.'};
    const level = definition.levels[learned-1];
    if (!this.active(p) || p.stun > 0) return {ok:false,message:'Your slime cannot cast right now.'};
    if ((p.cooldowns[key] || 0)>this.time || this.time-p.castAt<.32) return {ok:false,message:'Spell is cooling down.'};
    if (p.mana<level.cost) return {ok:false,message:'Not enough mana. It restores over time.'};
    if (this.effects.length>=64) return {ok:false,message:'Too much magic nearby. Try again shortly.'};
    p.mana -= level.cost; p.castAt = this.time; p.cooldowns[key] = this.time+level.cooldown;
    const aim = p.aim || 0, distance = key==='earthwall'?3:key==='starfall'?4:key==='vortex'?3:0;
    const effect = {id:++this.serial,key,owner:p.id,rank:learned,age:0,duration:level.duration,x:p.x+Math.sin(aim)*distance,
      z:p.z+Math.cos(aim)*distance,aim,armed:W.insideRing(p.x,p.z),hit:new Set(),pulse:-1,originX:p.x,originZ:p.z};
    this.effects.push(effect);
    this.emit('spell',effect.x,effect.z,{i:p.id,key,rank:learned,color:p.color});
    if (key==='stoneburst') for (let i=0;i<level.shots;i++) {
      const angle=aim+(i/(level.shots-1)-.5)*.95;
      this.spawnBullet(p,angle,level.damage,{life:.9,hitTargets:effect.hit,fire:0,frost:0,seeker:0,cannon:2,rock:true,charged:false,
        vx:Math.sin(angle)*16,vz:Math.cos(angle)*16,spellCast:effect.id,armed:effect.armed});
    }
    return {ok:true,key,cooldown:level.cooldown,mana:p.mana};
  }
  tickEffects(dt) {
    for (const e of this.effects) {
      e.age += dt;
      const p = this.players.get(e.owner), level = W.spells[e.key].levels[e.rank-1];
      if (!this.alive(p) || e.key==='earthwall' || e.key==='stoneburst' || e.age < (level.delay || 0)) continue;
      const pulse = e.key==='vortex' ? Math.floor((e.age-level.delay)/.4) : 0;
      if (e.pulse===pulse) continue;
      e.pulse = pulse;
      if (e.key==='mending') {
        if (e.armed && W.insideRing(p.x,p.z)) { p.hp = Math.min(p.maxHp,p.hp+level.heal); this.emit('pickup',p.x,p.z,{i:p.id,color:p.color,hp:true}); }
        continue;
      }
      let targets = [...this.players.values()].filter(t => this.alive(t) && t.id!==p.id);
      if (e.key==='stormcoil') {
        targets = targets.filter(t => Math.hypot(t.x-e.x,t.z-e.z)<=level.radius)
          .sort((a,b) => Math.hypot(a.x-e.x,a.z-e.z)-Math.hypot(b.x-e.x,b.z-e.z)).slice(0,level.targets);
        e.links=targets.map(t=>({x:t.x,z:t.z}));
      }
      for (const target of targets) {
        let inRange = Math.hypot(target.x-e.x,target.z-e.z)<=level.radius;
        if (e.key==='embertrail') inRange = Array.from({length:3+e.rank},(_,i)=>2+i*1.25).some(d =>
          Math.hypot(target.x-e.x-Math.sin(e.aim)*d,target.z-e.z-Math.cos(e.aim)*d)<=level.radius);
        if (!inRange || e.key!=='vortex' && e.hit.has(target.id)) continue;
        e.hit.add(target.id);
        if (e.key==='vortex' && this.canHarm(p,target,e.armed)) {
          const d = Math.hypot(target.x-e.x,target.z-e.z) || 1;
          target.kx += (e.x-target.x)/d*2.5; target.kz += (e.z-target.z)/d*2.5;
        }
        if (this.hit(p,target,level.damage,{armed:e.armed,type:'spell',power:e.key==='vortex'?0:2}) && e.key==='frostbloom') {
          target.chill = 2; target.chillAmount = level.slow;
        }
      }
    }
    this.effects = this.effects.filter(e => e.age<e.duration && this.alive(this.players.get(e.owner)));
  }
  tickBullets(dt) {
    for (const q of this.bullets) {
      q.life -= dt;
      const p = this.players.get(q.owner);
      if (!this.alive(p)) { q.life = 0; continue; }
      if (q.seeker || q.charged) {
        const target = [...this.players.values()].filter(t => this.alive(t) && t.id!==p.id).sort((a,b) =>
          Math.hypot(a.x-q.x,a.z-q.z)-Math.hypot(b.x-q.x,b.z-q.z))[0];
        if (target) { const a=Math.atan2(q.vx,q.vz), turn=wrap(Math.atan2(target.x-q.x,target.z-q.z)-a),
          rate=q.charged?2.5:stat(p,'seeker','turn')*Math.PI/180,
          heading=a+clamp(turn,-rate*dt,rate*dt), speed=Math.hypot(q.vx,q.vz); q.vx=Math.sin(heading)*speed;q.vz=Math.cos(heading)*speed; }
      }
      const nx=q.x+q.vx*dt,nz=q.z+q.vz*dt;
      let best=Infinity, target=null, obstacle=null;
      for (const c of this.coverNear(q.x,q.z,q.armed && W.insideRing(p.x,p.z))) {
        if(q.charged)continue;
        const t=segmentCircle(q.x,q.z,nx,nz,c.x,c.z,c.r+.2); if(t<best){best=t;target=null;obstacle=c;}
      }
      for (const t of this.players.values()) {
        if(t.id===p.id||!this.alive(t)||t.air>1.65||q.hitTargets?.has(t.id))continue;
        const hit=segmentCircle(q.x,q.z,nx,nz,t.x,t.z,.85*t.size+.22);
        if(hit<best){best=hit;target=t;obstacle=null;}
      }
      if(best!==Infinity){
        q.x+=(nx-q.x)*best;q.z+=(nz-q.z)*best;q.life=0;
        const cast = q.hitTargets ? {hit:q.hitTargets} : null;
        if(target && (!cast || !cast.hit.has(target.id))) {
          if(cast)cast.hit.add(target.id);
          const landed=this.hit(p,target,q.damage,{armed:q.armed,type:'spit',power:4});
          if(landed && q.frost){target.chill=1.45;target.chillAmount=stat(p,'frost','slow');}
          if(landed && q.fire){target.burnTicks=4;target.burnClock=.6;target.burnDamage=stat(p,'fire','burn')/4;target.burnOwner=p.id;target.burnArmed=q.armed;}
        }
        this.emit('splat',q.x,q.z,{i:p.id,color:q.color,fire:q.fire,frost:q.frost});
        if(!target&&obstacle&&q.banks>0){
          q.banks--;const dx=q.x-obstacle.x,dz=q.z-obstacle.z,d=Math.hypot(dx,dz)||1,nx=dx/d,nz=dz/d,dot=q.vx*nx+q.vz*nz;
          q.vx-=2*dot*nx;q.vz-=2*dot*nz;q.x+=nx*.08;q.z+=nz*.08;q.life=.8;
        }
      }else{q.x=nx;q.z=nz;}
      if(Math.hypot(q.x/W.x,q.z/W.z)>1.08)q.life=0;
    }
    this.bullets=this.bullets.filter(q=>q.life>0);
  }
  tick(dt, now = Date.now()) {
    dt = clamp(dt,0,.05); if(!dt)return;
    this.time += dt; this.now = now;
    for(const p of this.players.values()) {
      if(!p.joined)continue;
      if(p.respawnAt){
        if(this.time>=p.respawnAt){Object.assign(p,{x:W.spawn.x,z:W.spawn.z,vx:0,vz:0,kx:0,kz:0,air:0,vy:0,hp:p.maxHp,respawnAt:0,
          stun:0,chill:0,burnTicks:0,en:0,guarded:false,secondUsed:false});this.emit('spawn',p.x,p.z,{i:p.id,color:p.color});}
        else continue;
      }
      for(const key of ['dash','dashTime','stun','hit','chill'])p[key]=Math.max(0,(p[key]||0)-dt);
      p.mana=Math.min(100,p.mana+dt*9); p.en=Math.min(100,p.en+dt*1.5);
      if(!W.insideRing(p.x,p.z)){p.chill=p.chillAmount=p.burnTicks=0;if(this.time-(p.lastHit??-10)>3)p.hp=Math.min(p.maxHp,p.hp+dt*14);}
      if(p.burnTicks){p.burnClock-=dt;if(p.burnClock<=0){p.burnClock+=.6;p.burnTicks--;const owner=this.players.get(p.burnOwner);
        if(this.canHarm(owner,p,p.burnArmed))this.hit(owner,p,p.burnDamage,{type:'fire',power:0,stun:0});}}
      if(p.attack){p.attackTime=Math.max(0,p.attackTime-dt);this.reflect(p);this.resolve(p);if(!p.attackTime)p.attack='';}
      if(p.air>0||p.vy>0){p.vy-=17*dt;p.air+=p.vy*dt;if(p.air<=0){p.air=p.vy=0;this.emit('land',p.x,p.z,{i:p.id,color:p.color});}}
      const active=this.active(p),ix=active?p.ix||0:0,iz=active?p.iz||0:0,len=Math.max(1,Math.hypot(ix,iz));
      const air=p.air>0||p.vy>0,base=p.stun>0?1.15:p.attack?(p.attack==='nova'?.5:3.9):p.dashTime>0?.54:7.35;
      const speed=base*(p.chill>0?1-p.chillAmount:1)*(air?.32:1),factor=1-Math.exp(-(p.dashTime>0?28:19)*dt);
      p.vx+=(ix/len*speed-p.vx)*factor;p.vz+=(iz/len*speed-p.vz)*factor;
      p.x+=(p.vx+p.kx)*dt;p.z+=(p.vz+p.kz)*dt;
      const drag=Math.exp(-dt*(p.dashTime>0?2.4:air?4.1:12.5));p.kx*=drag;p.kz*=drag;
      const edge=Math.hypot(p.x/W.x,p.z/W.z);if(edge>1){p.x/=edge;p.z/=edge;p.kx*=.45;p.kz*=.45;}
      for(const c of this.coverNear(p.x,p.z,W.insideRing(p.x,p.z))){
        if(p.air>c.height+.2)continue;const dx=p.x-c.x,dz=p.z-c.z,d=Math.hypot(dx,dz),limit=c.r+.83*p.size;
        if(d<limit){p.x=c.x+(d>0?dx/d:1)*limit;p.z=c.z+(d>0?dz/d:0)*limit;p.kx*=.72;p.kz*=.72;}
      }
      if(p.ready&&!p.attack)p.r=p.aim||0;
      if(p.emote){p.emoteAge+=dt;if((p.emoteUntil&&now>=p.emoteUntil)||Math.hypot(ix,iz)>.1){p.emote=0;p.emoteAge=0;}}
    }
    const bodies=[...this.players.values()].filter(p=>this.alive(p)&&W.insideRing(p.x,p.z));
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
      const a=bodies[i],b=bodies[j],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz),minimum=.975*(a.size+b.size);
      if(d>=minimum||Math.abs(a.air-b.air)>=.8)continue;
      const push=(minimum-d)*.5,nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
      a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;
    }
    this.tickEffects(dt); this.tickWaves(dt); this.tickBullets(dt);
  }
  snapshot(receiver) {
    return {t:'magic',time:this.time,mana:receiver.mana,cooldowns:Object.fromEntries(Object.entries(receiver.cooldowns).map(([k,v])=>[k,Math.max(0,v-this.time)])),
      effects:this.effects.filter(e=>Math.hypot(e.x-receiver.x,e.z-receiver.z)<75).map(({hit,pulse,originX,originZ,...e})=>e)};
  }
}
