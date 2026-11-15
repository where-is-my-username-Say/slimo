import { DurableObject } from 'cloudflare:workers';
export { SlimoAccounts } from './accounts.mjs';
const CAP=50, PROTOCOL=3, INPUT=54, STATE=55, PLAYER_BYTES=33;
const EMOTES=['none','dance','sit','wave','spin','bounce'];
const EMOTE_DURATION_MS=[0,0,0,1650,1150,1450];
const cors={ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Content-Type':'application/json' };
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const bounded=(v,lo,hi)=>Math.min(hi,Math.max(lo,Number.isFinite(v)?v:0));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const send=(ws,p)=>{try{ws.send(JSON.stringify(p));}catch{}};
export class GameRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.players=new Map(); this.tickNumber=0; this.chatId=0;
    for(const ws of ctx.getWebSockets()){
      try { ws.close(1012,'Meadow restarted'); } catch {}
    }
    this.loop=null;
  }
  roster(){return [...this.players.values()].filter(p=>p.joined).map(p=>({id:p.id,name:p.name,color:p.color,ranks:p.ranks,wins:p.wins||0,hat:p.profile.hat,accent:p.profile.accent,owner:p.profile.owner}));}
  broadcast(data){const raw=JSON.stringify(data);for(const p of this.players.values())if(p.joined)try{p.ws.send(raw);}catch{}}
  async fetch(req){
    if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return response({ok:true,protocol:PROTOCOL,capacity:CAP,players:this.roster().length});
    if(this.players.size>=CAP+8)return response({error:'room_full',message:'Open Meadow is full.'},409);
    const profile=JSON.parse(req.headers.get('X-Slimo-Profile') || 'null');
    if(!profile?.username)return response({error:'Meadow login required'},401);
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    const taken=new Set(this.players.keys()); let id=1;while(taken.has(id)&&id<=65535)id++;
    const p={id,profile,opened:Date.now(),vy:0,atomicAt:0,name:'Slime',color:0,ranks:{},wins:0,joined:false,x:0,z:0,r:0,vx:0,vz:0,kx:0,kz:0,hp:100,en:0,seq:0,ready:false,actions:[0,0,0,0,0],attack:'',attackTime:0,duration:0,contactTime:0,dashTime:0,dash:0,air:0,stun:0,shield:0,emote:0,emoteAge:0,emoteUntil:0,chatAt:0};
    server.binaryType='arraybuffer';
    server.serializeAttachment({id});this.ctx.acceptWebSocket(server);this.players.set(id,{...p,ws:server});
    if(this.loop===null)this.loop=setInterval(()=>this.tick(),50);
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws,raw){
    const id=ws.deserializeAttachment()?.id,p=this.players.get(id);if(p?.ws!==ws)return;
    if(typeof raw!=='string'){
      if(!p.joined)return;
      const buf=raw instanceof Blob?await raw.arrayBuffer():raw;
      if(this.players.get(id)!==p||!(buf instanceof ArrayBuffer)||buf.byteLength!==26)return;
      const v=new DataView(buf);if(v.getUint8(0)!==INPUT||v.getUint8(1)!==PROTOCOL)return;
      const seq=v.getUint32(4);if(seq<=p.seq)return;
      p.seq=seq;p.ready=v.getUint8(2)===1;
      p.ix=bounded(v.getInt16(8)/16000,-1,1);p.iz=bounded(v.getInt16(10)/16000,-1,1);
      p.aim=wrap(v.getInt16(12)/10000);
      for(let i=0;i<5;i++){
        const count=v.getUint16(14+i*2);if(count===p.actions[i])continue;
        p.actions[i]=count;
        if(i===0){p.attack='slap';p.attackTime=.33;p.duration=.33;p.contactTime=.14;}
        if(i===1){p.attack='spit';p.attackTime=.48;p.duration=.48;p.contactTime=.2;}
        if(i===2&&p.dash<=0){p.dashTime=.2;p.dash=1.1;p.kx=p.ix*15;p.kz=p.iz*15;}
        if(i===4&&p.air<=0.01&&p.dashTime<=0)p.vy=6.4;
        if(i===3&&p.en>=100){p.en=0;p.attack='nova';p.attackTime=.7;p.duration=.7;p.contactTime=.35;}
      }
      return;
    }
    if(raw.length>16000)return;
    let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m.t!=='string')return;
    if(m.t==='leave'){this.leave(ws);return;}
    if(m.t==='join'){
      if(m.protocol!==PROTOCOL){send(ws,{t:'error',message:'Game and server protocol versions do not match.'});return;}
      if(p.joined)return;
      for (const other of [...this.players.values()]) {
        if (other.id !== p.id && other.profile.id === p.profile.id) {
          send(other.ws,{t:'error',message:'Your account opened Open Meadow in another tab.'});
          this.leave(other.ws);
        }
      }
      if(this.roster().length>=CAP){
        send(ws,{t:'error',message:'Open Meadow is full.'});this.leave(ws);return;
      }
      p.joined=true;p.name=p.profile.username;p.color=p.profile.color;
      p.ranks=m.ranks&&typeof m.ranks==='object'?m.ranks:{};
      p.x=-24+(Math.random()-.5)*5;p.z=15+(Math.random()-.5)*5;
      send(ws,{t:'joined',id:p.id,players:this.roster().length,roster:this.roster()});
      this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});
    }else if(!p.joined)return;
    else if(m.t==='ping'&&Number.isFinite(m.stamp))send(ws,{t:'pong',stamp:m.stamp});
    else if(m.t==='build'){
      p.ranks=m.ranks&&typeof m.ranks==='object'?m.ranks:{};
      send(ws,{t:'build',ok:true});this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});
    }else if(m.t==='chat'){
      const now=Date.now();if(now-p.chatAt<750){send(ws,{t:'chatWait'});return;}
      const text=String(m.text||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,320);if(!text)return;
      p.chatAt=now;this.broadcast({t:'chat',id:++this.chatId,who:p.id,name:p.name,color:p.color,text});
    }else if(m.t==='voiceSignal'){
      const target=this.players.get(m.to);
      if(!target?.joined||target.id===p.id||!m.data||typeof m.data!=='object')return;
      const d=m.data;
      if(!['offer','answer','ice','end'].includes(d.kind))return;
      if(JSON.stringify(d).length>14000)return;
      send(target.ws,{t:'voiceSignal',from:p.id,data:d});
    }else if(m.t==='emote'){
      if(m.key==='atomic'){
        if(p.profile.atomic && Date.now()-p.atomicAt>=20000){
          p.atomicAt=Date.now();this.broadcast({t:'atomic',i:p.id});
        }
        return;
      }
      if(m.key==='playSlap'){
        p.emote=p.emoteAge=p.emoteUntil=0;
        p.attack='slap';p.attackTime=.3;p.duration=.3;p.contactTime=.12;
        return;
      }
      const next=m.key==='random'?1+Math.floor(Math.random()*(EMOTES.length-1)):EMOTES.indexOf(m.key);
      if(next<0)return;
      p.emote=p.emote===next?0:next;
      p.emoteAge=0;
      const duration=EMOTE_DURATION_MS[p.emote];
      p.emoteUntil=duration?Date.now()+duration:0;
    }
  }
  tick(){
    for(const p of this.players.values())if(!p.joined&&Date.now()-p.opened>8000)this.leave(p.ws);
    const players=[...this.players.values()].filter(p=>p.joined);if(!players.length)return;
    const dt=.05;this.tickNumber++;
    for(const p of players){
      if(p.air>0||p.vy>0){p.air=Math.max(0,p.air+p.vy*dt);p.vy=p.air>0?p.vy-17*dt:0;}
      p.dash=Math.max(0,p.dash-dt);p.dashTime=Math.max(0,p.dashTime-dt);
      p.attackTime=Math.max(0,p.attackTime-dt);if(!p.attackTime)p.attack='';
      if(p.emote){p.emoteAge+=dt;if((p.emoteUntil&&Date.now()>=p.emoteUntil)||Math.hypot(p.ix||0,p.iz||0)>.1){p.emote=0;p.emoteAge=0;}}
      const ix=p.ix||0,iz=p.iz||0,len=Math.max(1,Math.hypot(ix,iz));
      const targetX=ix/len*7.35,targetZ=iz/len*7.35;
      const factor=1-Math.exp(-19*dt);
      p.vx+=(targetX-p.vx)*factor;p.vz+=(targetZ-p.vz)*factor;
      p.x=bounded(p.x+(p.vx+p.kx)*dt,-90,90);p.z=bounded(p.z+(p.vz+p.kz)*dt,-90,90);
      p.kx*=Math.exp(-12.5*dt);p.kz*=Math.exp(-12.5*dt);
      if(p.ready&&!p.attack)p.r=p.aim||0;
    }
    for(const receiver of players){
      const data=new ArrayBuffer(12+players.length*PLAYER_BYTES),v=new DataView(data);
      v.setUint8(0,STATE);v.setUint8(1,PROTOCOL);v.setUint32(2,this.tickNumber);v.setUint32(6,receiver.seq);v.setUint8(10,players.length);v.setUint8(11,0);
      let o=12;const num=(at,n,scale)=>v.setInt16(at,Math.round(bounded(n*scale,-32767,32767)));
      const timer=(at,n)=>v.setUint8(at,Math.round(bounded(n,0,2.55)*100));
      for(const p of players){
        v.setUint16(o,p.id);num(o+2,p.x,100);num(o+4,p.z,100);num(o+6,wrap(p.r),10000);
        num(o+8,p.vx,300);num(o+10,p.vz,300);num(o+12,p.kx,300);num(o+14,p.kz,300);
        v.setUint16(o+16,Math.round(p.hp*10));v.setUint8(o+18,Math.round(p.en));
        v.setUint8(o+19,({slap:1,spit:2,nova:3}[p.attack]||0));
        timer(o+20,p.attackTime);timer(o+21,p.duration);timer(o+22,p.contactTime);
        timer(o+23,p.dashTime);timer(o+24,p.air);timer(o+25,p.dash);
        timer(o+26,p.stun);timer(o+27,0);v.setUint8(o+28,0);v.setUint8(o+29,0);
        v.setUint8(o+30,p.emote||0);v.setUint16(o+31,Math.round((p.emoteAge%40)*1000));o+=PLAYER_BYTES;
      }
      try{if(receiver.ws.readyState===1&&(receiver.ws.bufferedAmount??0)<262144)receiver.ws.send(data);}catch{}
    }
  }
  webSocketClose(ws){this.leave(ws);}webSocketError(ws){this.leave(ws);}
  leave(ws){const id=ws.deserializeAttachment()?.id;if(this.players.get(id)?.ws===ws&&this.players.delete(id))this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});try{ws.close();}catch{}if(!this.players.size&&this.loop!==null){clearInterval(this.loop);this.loop=null;}}
}
export default {
  async fetch(req,env){
    const u=new URL(req.url), origin=req.headers.get('Origin');
    if(u.pathname==='/health')return response({ok:true,service:'slimo-meadow',protocol:PROTOCOL,maxPlayers:CAP});
    const accounts=env.ACCOUNTS.getByName('slimo-accounts');
    if(u.pathname.startsWith('/api/slimo/'))return accounts.fetch(req);
    if(u.pathname==='/api/room' && req.method==='GET' && !req.headers.has('Upgrade')){
      if(origin && origin!==env.SLIMO_ORIGIN)return response({error:'Origin is not allowed'},403);
      return env.GAME_ROOM.getByName('OPEN-MEADOW').fetch(req);
    }
    if(u.pathname!=='/room/OPEN-MEADOW'||req.headers.get('Upgrade')?.toLowerCase()!=='websocket')
      return response({error:'Not found'},404);
    if(origin!==env.SLIMO_ORIGIN)return response({error:'Origin is not allowed'},403);
    const grant=await accounts.fetch('https://slimo.internal/internal/meadow',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:u.searchParams.get('ticket')})
    });
    if(!grant.ok)return response({error:'Meadow login expired'},401);
    const {profile}=await grant.json();
    u.search='';
    const headers=new Headers(req.headers);
    headers.set('X-Slimo-Profile',JSON.stringify(profile));
    return env.GAME_ROOM.getByName('OPEN-MEADOW').fetch(new Request(u,{headers}));
  }
};
