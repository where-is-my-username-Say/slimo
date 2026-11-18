'use strict';

let meadowMapOpen = false, meadowGuide = false, meadowMapAt = -Infinity;
function roomBuild() { return cleanBuild(Object.fromEntries(Object.entries(readStore('slimeMeadowRoomBuild', WORLD.starterBuild)||{}).filter(([key])=>!Object.hasOwn(WORLD.spells,key)))); }
function toggleMeadowMap() { meadowMapOpen = !meadowMapOpen; }
function prepareMeadowMapControls() {
  $('fieldMap').onclick=toggleMeadowMap;
  $('mapClose').onclick=()=>{meadowMapOpen=false;$('fieldMap').focus({preventScroll:true});};
  $('mapRing').onclick=()=>{meadowGuide=true;meadowMapOpen=false;toast('Follow the ring compass. Damage is off until both players are inside.');};
}
function drawMeadowMapHud() {
  const room=publicRoom,self=state.p[0],now=performance.now(),ranks=room.roster.get(room.id)?.ranks||{};
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
