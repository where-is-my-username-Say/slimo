'use strict';
globalThis.SlimoNetwork=(()=>{
  function stationary(input,p){return Math.hypot(input.x||0,input.z||0)<.001&&Math.hypot(p?.vx||0,p?.vz||0,p?.kx||0,p?.kz||0)<.02&&
    !(p?.air>0||p?.vy>0||p?.attackTime>0||p?.stun>0||p?.dashTime>0||p?.emote);}
  function inputKey(input){return [input.ready?1:0,Math.round((input.assist||0)*255),Math.round(input.x*16000),Math.round(input.z*16000),Math.round((input.aim||0)*10000),
    ...['slap','spit','dash','nova','jump'].map(k=>input.a[k]&65535),Math.round((input.spitCharge||0)*255),input.slapHeld?1:0].join(',');}
  function inputDue(now,last,key,previousKey,input,p,force=false){return force||now-last>=(key===previousKey&&stationary(input,p)?180:33);}
  function movingPlayer(p){return Math.hypot(p.vx||0,p.vz||0,p.kx||0,p.kz||0)>.02||p.attack||p.air>0||p.vy>0||p.dashTime>0||p.stun>0||p.hit>0||p.emote;}
  function interestSnapshot(data,players,bullets,receiver,playerBytes=34,bulletBytes=22){
    const near=(p)=>{const dx=p.x-receiver.x,dz=p.z-receiver.z;return dx*dx+dz*dz<=80*80;};
    const pi=[],bi=[];players.forEach((p,i)=>{if(p.id===receiver.id||near(p))pi.push(i);});bullets.forEach((q,i)=>{if(q.owner===receiver.id||near(q))bi.push(i);});
    let packet;if(pi.length===players.length&&bi.length===bullets.length)packet=data.slice(0);
    else{packet=new ArrayBuffer(12+pi.length*playerBytes+bi.length*bulletBytes);const out=new Uint8Array(packet),source=new Uint8Array(data);out.set(source.subarray(0,12));let at=12;
      for(const i of pi){out.set(source.subarray(12+i*playerBytes,12+(i+1)*playerBytes),at);at+=playerBytes;}
      const base=12+players.length*playerBytes;for(const i of bi){out.set(source.subarray(base+i*bulletBytes,base+(i+1)*bulletBytes),at);at+=bulletBytes;}
    }
    const view=new DataView(packet);view.setUint32(6,receiver.seq);view.setUint8(10,pi.length);view.setUint8(11,bi.length);return packet;
  }
  return Object.freeze({stationary,inputKey,inputDue,movingPlayer,interestSnapshot});
})();
