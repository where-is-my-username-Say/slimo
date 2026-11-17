'use strict';

let meadowMapOpen = false, meadowGuide = false, meadowMapAt = -Infinity, meadowSpellKey = '';
const meadowSpellButtons = new Map();
function roomBuild() { return cleanBuild(readStore('slimeMeadowRoomBuild', WORLD.starterBuild)); }
function toggleMeadowMap() { meadowMapOpen = !meadowMapOpen; }
function castMeadowSpell(key) {
  if(mode!=='public'||!gameReady()||publicRoom.ws?.readyState!==1||state.p[0].hp<=0)return;
  const definition=WORLD.spells[key], rank=publicRoom.roster.get(publicRoom.id)?.ranks?.[key]||0;
  if(!definition||!rank){toast('Equip this spell in Meadow build. Try the Spell starter preset.');return;}
  publicRoom.spellPending ||= new Map();
  if((publicRoom.spellPending.get(key)||0)>performance.now())return;
  publicRoom.spellPending.set(key,performance.now()+800);
  publicRoom.ws.send(JSON.stringify({t:'cast',key}));
}
function acceptMeadowMagic(packet) {
  if(!Number.isFinite(packet.time)||!Number.isFinite(packet.mana)||!Array.isArray(packet.effects)||packet.effects.length>64)return;
  const effects=packet.effects.filter(e=>e&&Object.hasOwn(WORLD.spells,e.key)&&Number.isInteger(e.id)&&e.id>0&&
    [1,2,3].includes(e.rank)&&Number.isFinite(e.x)&&Number.isFinite(e.z)&&Math.abs(e.x)<=WORLD.x+12&&Math.abs(e.z)<=WORLD.z+12&&
    Number.isFinite(e.age)&&e.age>=0&&Number.isFinite(e.duration)&&e.duration>0&&e.duration<=10&&Number.isFinite(e.aim));
  for(const e of effects)if(e.links)e.links=Array.isArray(e.links)?e.links.slice(0,4).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z)&&Math.abs(p.x)<=WORLD.x+12&&Math.abs(p.z)<=WORLD.z+12):[];
  const cooldowns={};
  for(const key of Object.keys(WORLD.spells))cooldowns[key]=clamp(packet.cooldowns?.[key],0,30)||0;
  publicRoom.magic={time:packet.time,mana:clamp(packet.mana,0,100),effects,cooldowns,receivedAt:performance.now()};
  const walls=effects.filter(e=>e.key==='earthwall'&&e.armed&&e.age>=.48&&e.age<e.duration-.35);
  publicRoom.cover=meadowCover.concat(walls.flatMap(WORLD.wallSegments).filter(c=>WORLD.insideRing(c.x,c.z)));
}
function prepareMeadowMagicControls() {
  $('fieldMap').onclick=toggleMeadowMap;
  $('mapClose').onclick=()=>{meadowMapOpen=false;$('fieldMap').focus({preventScroll:true});};
  $('mapRing').onclick=()=>{meadowGuide=true;meadowMapOpen=false;toast('Follow the ring compass. Damage is off until both players are inside.');};
  $('spellBuild').onclick=()=>openBuild('room');
}
function drawMeadowMagicHud() {
  const room=publicRoom,self=state.p[0],now=performance.now(),ranks=room.roster.get(room.id)?.ranks||{};
  const key=Object.keys(WORLD.spells).map(id=>id+':'+(ranks[id]||0)).join('|');
  if(key!==meadowSpellKey){
    meadowSpellKey=key;meadowSpellButtons.clear();$('spellSlots').replaceChildren();
    Object.entries(WORLD.spells).forEach(([id,definition],i)=>{
      const button=document.createElement('button'),number=document.createElement('kbd'),name=document.createElement('strong'),meter=document.createElement('span');
      button.type='button';button.style.setProperty('--spell','#'+definition.color.toString(16).padStart(6,'0'));
      number.textContent=i+1;name.textContent=definition.name;button.append(number,name,meter);
      button.onclick=()=>castMeadowSpell(id);$('spellSlots').append(button);meadowSpellButtons.set(id,{button,meter});
    });
  }
  const age=room.magic?Math.max(0,(now-room.magic.receivedAt)/1000):0;
  const mana=room.magic?Math.min(100,room.magic.mana+age*9):self.mana??100;
  setText($('manaLabel'),'Mana '+Math.floor(mana));
  const width=mana.toFixed(1)+'%';if($('manaMeter').firstElementChild.style.width!==width)$('manaMeter').firstElementChild.style.width=width;
  $('manaMeter').setAttribute('aria-valuenow',Math.floor(mana));
  for(const [id,{button,meter}] of meadowSpellButtons){
    const rank=ranks[id]||0,level=WORLD.spells[id].levels[Math.max(0,rank-1)];
    const cooldown=Math.max(0,(room.magic?.cooldowns[id]||0)-age),pending=(room.spellPending?.get(id)||0)>now;
    button.disabled=!rank||self.hp<=0||self.stun>0||!gameReady()||cooldown>.05||mana<level.cost||pending;
    const text=!rank?'Equip':cooldown>.05?Math.ceil(cooldown)+'s':pending?'…':['I','II','III'][rank-1]+' · '+level.cost+'m';
    setText(meter,text);button.title=rank?WORLD.spells[id].name+' · Rank '+rank+' · '+level.text:'Equip '+WORLD.spells[id].name+' in Meadow build';
    button.setAttribute('aria-label',button.title+(cooldown>.05?' · '+Math.ceil(cooldown)+' seconds remaining':''));
  }
  $('fieldMap').hidden=false;
  const distance=Math.hypot(self.x-WORLD.ring.x,self.z-WORLD.ring.z);
  $('ringCompass').hidden=!meadowGuide;
  if(meadowGuide){
    const turn=angleDiff(view.yaw,Math.atan2(WORLD.ring.x-self.x,WORLD.ring.z-self.z));
    const arrow=Math.abs(turn)<.5?'↑':turn>0?'←':'→';
    setText($('ringCompass'),insideFightRing(self.x,self.z)?'Inside ring · Damage on':arrow+' Duel Ring · '+Math.round(distance)+' m');
  }
  if(!meadowMapOpen||now-meadowMapAt<100)return;meadowMapAt=now;
  const canvas=$('meadowMapCanvas'),c=canvas.getContext('2d');if(!c)return;
  const w=canvas.width,h=canvas.height,toX=x=>w/2+x/WORLD.x*(w*.45),toZ=z=>h/2+z/WORLD.z*(h*.43);
  c.clearRect(0,0,w,h);c.fillStyle='#142d23';c.fillRect(0,0,w,h);
  c.strokeStyle='#61846c';c.lineWidth=1;c.beginPath();c.ellipse(w/2,h/2,w*.45,h*.43,0,0,TAU);c.stroke();
  c.strokeStyle='#567a62';c.setLineDash([3,4]);
  for(const p of WORLD.landmarks){c.beginPath();c.moveTo(w/2,h/2);c.lineTo(toX(p.x),toZ(p.z));c.stroke();}
  c.setLineDash([]);c.font='10px sans-serif';c.textAlign='center';
  for(const p of WORLD.landmarks){
    c.fillStyle='#'+p.color.toString(16).padStart(6,'0');c.beginPath();c.arc(toX(p.x),toZ(p.z),p.id==='ring'?WORLD.ring.radius/WORLD.x*w*.45:3,0,TAU);c.fill();
    c.fillStyle='#f1f1dc';c.fillText(p.name,toX(p.x),toZ(p.z)-8);
  }
  for(const p of room.frames.at(-1)?.poses.values()||[]){if(p.id===room.id)continue;c.fillStyle=insideFightRing(p.x,p.z)?'#ff987f':'#b6d0bb';c.fillRect(toX(p.x)-1,toZ(p.z)-1,2,2);}
  c.fillStyle='#ffffff';c.beginPath();c.arc(toX(self.x),toZ(self.z),4,0,TAU);c.fill();
  c.strokeStyle='#ffffff';c.beginPath();c.moveTo(toX(self.x),toZ(self.z));c.lineTo(toX(self.x)+Math.sin(view.yaw)*10,toZ(self.z)+Math.cos(view.yaw)*10);c.stroke();
  const place=WORLD.landmarks.reduce((best,p)=>Math.hypot(p.x-self.x,p.z-self.z)<Math.hypot(best.x-self.x,best.z-self.z)?p:best,WORLD.landmarks[0]);
  setText($('meadowLocation'),place.name+' · '+Math.round(Math.hypot(place.x-self.x,place.z-self.z))+' m · Outside ring: no damage');
}
