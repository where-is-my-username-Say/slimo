import { DurableObject } from 'cloudflare:workers';
export { SlimoAccounts } from './accounts.mjs';
export { DuelRelay } from './slimo-duel-relay.js';
import './slimo-world.js';
import './slimo-network.js';
import { serveLiveClient } from './slimo-live-client.generated.js';
import { MeadowCombat } from './slimo-meadow-combat.js';
const WORLD = globalThis.SlimoWorld;
const NETWORK = globalThis.SlimoNetwork;
const CAP=50, PROTOCOL=WORLD.protocol, INPUT=54, STATE=55, PLAYER_BYTES=WORLD.playerBytes, GLOB_BYTES=22;
const EMOTES=['none','dance','sit','wave','spin','bounce'];
const EMOTE_DURATION_MS=[0,0,0,1650,1150,1450];
const cors={ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Content-Type':'application/json' };
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const bounded=(v,lo,hi)=>Math.min(hi,Math.max(lo,Number.isFinite(v)?v:0));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const send=(ws,p)=>{try{ws.send(JSON.stringify(p));}catch{}};
const cleanBuild = raw => WORLD.cleanBuild(Object.fromEntries(Object.entries(raw||{}).filter(([key])=>!Object.hasOwn(WORLD.spells,key))));

export class GameRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.players=new Map(); this.tickNumber=0; this.chatId=0;
    for(const ws of ctx.getWebSockets()){
      try { ws.close(1012,'Meadow restarted'); } catch {}
    }
    this.loop=null; this.combat=new MeadowCombat(this.players);
  }
  roster(){return [...this.players.values()].filter(p=>p.joined).map(p=>({id:p.id,name:p.name,color:p.color,ranks:p.ranks,wins:p.wins||0,hat:p.profile.hat,accent:p.profile.accent,owner:p.profile.owner}));}
  broadcast(data){const raw=JSON.stringify(data);for(const p of this.players.values())if(p.joined)try{p.ws.send(raw);}catch{}}
  async fetch(req){
    if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return response({ok:true,protocol:PROTOCOL,capacity:CAP,players:this.roster().length});
    if(this.players.size>=CAP+8)return response({error:'room_full',message:'Open Meadow is full.'},409);
    let profile;
    try { profile = JSON.parse(req.headers.get('X-Slimo-Profile') || 'null'); }
    catch { return response({error:'Meadow login required'},401); }
    if(!profile?.username)return response({error:'Meadow login required'},401);
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    const taken=new Set(this.players.keys()); let id=1;while(taken.has(id)&&id<=65535)id++;
    const p={id,profile,opened:Date.now(),vy:0,atomicAt:0,name:'Slime',color:0,ranks:{},wins:0,joined:false,x:0,z:0,r:0,vx:0,vz:0,kx:0,kz:0,hp:100,en:0,seq:0,hasInput:false,inputAt:0,ready:false,actions:[0,0,0,0,0],attack:'',attackTime:0,duration:0,contactTime:0,dashTime:0,dash:0,air:0,stun:0,shield:0,emote:0,emoteAge:0,emoteUntil:0,chatAt:0};
    this.combat.prepare(p);
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
      const seq = v.getUint32(4);
      const advance = (seq - p.seq) >>> 0;
      if (p.hasInput && (advance === 0 || advance >= 0x80000000)) return;
      const firstInput = !p.hasInput;
      p.spitCharge = v.getUint8(24)/255;
      p.seq = seq;
      p.hasInput = true;
      p.inputAt = Date.now();
      p.ready = v.getUint8(2) === 1;
      p.ix=bounded(v.getInt16(8)/16000,-1,1);p.iz=bounded(v.getInt16(10)/16000,-1,1);
      p.aim=wrap(v.getInt16(12)/10000);
      for(let i=0;i<5;i++){
        const count=v.getUint16(14+i*2);if(count===p.actions[i])continue;
        p.actions[i]=count;
        if(firstInput || !p.ready) continue;
        this.combat.startMove(p,['slap','spit','dash','nova','jump'][i]);
      }
      return;
    }
    if(raw.length>16000)return;
    let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m.t!=='string')return;
    if(m.t==='leave'){this.leave(ws);return;}
    if(m.t==='join'){
      if(m.protocol!==PROTOCOL){send(ws,{t:'error',serverProtocol:PROTOCOL,clientProtocol:m.protocol,message:'The game and Worker are different versions. Deploy the matching Worker, then reload the game.'});this.leave(ws);return;}
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
      p.ranks=cleanBuild(m.ranks);this.combat.prepare(p);
      p.x=-24+(Math.random()-.5)*5;p.z=15+(Math.random()-.5)*5;
      send(ws,{t:'joined',id:p.id,players:this.roster().length,roster:this.roster()});
      this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});
    }else if(!p.joined)return;
    else if(m.t==='ping'&&Number.isFinite(m.stamp))send(ws,{t:'pong',stamp:m.stamp});
    else if(m.t==='cast'){
      send(ws,{t:'castResult',ok:false,message:'Spells are roguelike upgrades. Use the existing combat moves after choosing one.'});
    }else if(m.t==='build'){
      if(WORLD.insideRing(p.x,p.z)||p.hp<=0){send(ws,{t:'build',ok:false,message:'Leave the fight ring before changing your build.'});return;}
      p.ranks=cleanBuild(m.ranks);p.maxHp=100+([18,36,54][p.ranks.colossus-1]||0);p.size=1+([.10,.19,.29][p.ranks.colossus-1]||0);p.hp=Math.min(p.hp,p.maxHp);
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
        this.combat.startMove(p,'slap');
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
    this.tickNumber=(this.tickNumber+1)>>>0;
    this.combat.tick(.05,Date.now());
    const bullets=this.combat.bullets;
    // Keep simulation at 20 Hz. Idle rooms need only five snapshots per second.
    if(this.tickNumber%4!==0&&!bullets.length&&!this.combat.events.length&&!this.combat.rosterDirty&&
       players.every(p=>p.lastStateTick!==undefined&&!NETWORK.movingPlayer(p)))return;
    const data=new ArrayBuffer(12+players.length*PLAYER_BYTES+bullets.length*GLOB_BYTES),v=new DataView(data);
    v.setUint8(0,STATE);v.setUint8(1,PROTOCOL);v.setUint32(2,this.tickNumber);v.setUint32(6,0);v.setUint8(10,players.length);v.setUint8(11,bullets.length);
    let o=12;const num=(at,n,scale)=>v.setInt16(at,Math.round(bounded(n*scale,-32767,32767)));
    const timer=(at,n)=>v.setUint8(at,Math.round(bounded(n,0,2.55)*100));
    for(const p of players){
      v.setUint16(o,p.id);num(o+2,p.x,100);num(o+4,p.z,100);num(o+6,wrap(p.r),10000);
      num(o+8,p.vx,300);num(o+10,p.vz,300);num(o+12,p.kx,300);num(o+14,p.kz,300);
      v.setUint16(o+16,Math.round(p.hp*10));v.setUint8(o+18,Math.round(p.en));
      const guard=p.ranks.guard>0&&!p.guarded;
      v.setUint8(o+19,({slap:1,spit:2,nova:3}[p.attack]||0)|(p.combo&3)<<2|(p.counterUntil>this.combat.time?16:0)|(p.respawnAt?32:0)|(p.hit>0?64:0)|(guard?128:0));
      timer(o+20,p.attackTime);timer(o+21,p.duration);timer(o+22,p.contactTime);
      timer(o+23,p.dashTime);timer(o+24,p.air);timer(o+25,p.dash);timer(o+26,p.stun);timer(o+27,p.chill);
      v.setUint8(o+28,Math.round(bounded(p.chillAmount,0,1)*100));v.setUint8(o+29,p.burnTicks||0);
      v.setUint8(o+30,(p.emote||0)|(!p.attackArmed?8:0));v.setUint16(o+31,Math.round((p.emoteAge%40)*1000));
      v.setUint8(o+33,Math.round(p.mana));o+=PLAYER_BYTES;
    }
    for(const q of bullets){
      v.setUint32(o,q.id);v.setUint16(o+4,q.owner);num(o+6,q.x,100);num(o+8,q.z,100);num(o+10,q.vx,300);num(o+12,q.vz,300);
      for(const [i,key] of ['color','fire','frost','seeker','cannon','returns','fork'].entries())v.setUint8(o+14+i,q[key]||0);
      v.setUint8(o+21,(q.charged?1:0)|(q.rock?2:0));o+=GLOB_BYTES;
    }
    const events=this.combat.events.splice(0);
    // Each client receives its own ACK and the actors/projectiles within interest range.
    for (const receiver of players) {
      if (receiver.ws.readyState !== 1 || (receiver.ws.bufferedAmount ?? 0) >= 8192) continue;
      const snapshot=NETWORK.interestSnapshot(data,players,bullets,receiver,PLAYER_BYTES,GLOB_BYTES);
      try {
        receiver.ws.send(snapshot);receiver.lastStateTick=this.tickNumber;
        const nearby=events.filter(q=>q.i===receiver.id||q.j===receiver.id||Math.hypot(q.x-receiver.x,q.z-receiver.z)<65);
        if(nearby.length)send(receiver.ws,{t:'fx',events:nearby.slice(-90)});
      } catch {}
    }
    if(this.combat.rosterDirty){this.combat.rosterDirty=false;this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});}
  }
  webSocketClose(ws){this.leave(ws);}webSocketError(ws){this.leave(ws);}
  leave(ws){const id=ws.deserializeAttachment()?.id;if(this.players.get(id)?.ws===ws&&this.players.delete(id))this.broadcast({t:'roster',players:this.roster().length,roster:this.roster()});try{ws.close();}catch{}if(!this.players.size&&this.loop!==null){clearInterval(this.loop);this.loop=null;}}
}
export default {
  async fetch(req,env){
    const u=new URL(req.url), origin=req.headers.get('Origin');
    if(u.pathname==='/health')return response({ok:true,service:'slimo-meadow',protocol:PROTOCOL,duelProtocol:WORLD.duelProtocol,maxPlayers:CAP});
    if(u.pathname==='/api/slimo/play'||u.pathname.startsWith('/api/slimo/play/'))return serveLiveClient(req);
    const accounts=env.ACCOUNTS.getByName('slimo-accounts');
    if(u.pathname.startsWith('/api/slimo/'))return accounts.fetch(req);
    if(u.pathname==='/duel'&&req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
      if(origin!==env.SLIMO_ORIGIN)return response({error:'Origin is not allowed'},403);
      const auth=await accounts.fetch('https://slimo.internal/internal/duel-relay',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:u.searchParams.get('ticket')})
      });
      if(!auth.ok)return response({error:'Duel login expired'},401);
      const {grant}=await auth.json();
      const headers=new Headers(req.headers);headers.set('X-Slimo-Duel',JSON.stringify(grant));
      return env.DUEL_RELAY.getByName(grant.room).fetch(new Request('https://slimo.internal/duel',{headers}));
    }
    if(u.pathname==='/api/room' && req.method==='GET' && !req.headers.has('Upgrade')){
      if(origin && origin!==env.SLIMO_ORIGIN)return response({error:'Origin is not allowed'},403);
      return env.GAME_ROOM.getByName('OPEN-MEADOW-regional-v2',{locationHint:env.MEADOW_REGION||'me'}).fetch(req);
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
    return env.GAME_ROOM.getByName('OPEN-MEADOW-regional-v2',{locationHint:env.MEADOW_REGION||'me'}).fetch(new Request(u,{headers}));
  }
};
