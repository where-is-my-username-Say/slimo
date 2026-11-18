import { DurableObject } from 'cloudflare:workers';

// One object per room. It transports the existing host-authoritative duel;
// account credentials and ticket verification stay in the account service.
export class DuelRelay extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx=ctx; this.rates=new Map(); }
  sockets() { return this.ctx.getWebSockets().filter(ws=>ws.readyState===1); }
  meta(ws) { return ws.deserializeAttachment(); }
  other(ws) { return this.sockets().find(s=>s!==ws&&this.meta(s)?.role!==this.meta(ws)?.role); }
  control(ws, status, message) { try { ws.send(JSON.stringify({relay:status,message})); } catch {} }
  async fetch(req) {
    if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    let grant;try{grant=JSON.parse(req.headers.get('X-Slimo-Duel')||'null');}catch{}
    if(!grant||!['host','guest'].includes(grant.role)||typeof grant.user!=='string'||!Number.isFinite(grant.expires)||grant.expires<=Date.now())
      return new Response('Duel authorization required',{status:401});
    const sockets=this.sockets(),same=sockets.find(s=>this.meta(s)?.role===grant.role);
    if(same||grant.role==='guest'&&!sockets.some(s=>this.meta(s)?.role==='host'))
      return new Response(same?'Room already has this player slot':'Host is no longer connected',{status:409});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    server.serializeAttachment(grant);this.ctx.acceptWebSocket(server);
    this.control(server,'connected');
    const other=this.other(server);
    if(other){this.control(other,'paired');this.control(server,'paired');}
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,raw) {
    const meta=this.meta(ws);if(!meta||meta.expires<=Date.now()){ws.close(1008,'Duel session expired');return;}
    const size=typeof raw==='string'?new TextEncoder().encode(raw).byteLength:raw.byteLength;
    if(!Number.isFinite(size)||size>98304){ws.close(1009,'Packet too large');return;}
    const now=Date.now();let rate=this.rates.get(ws);
    if(!rate||now-rate.at>=1000){rate={at:now,count:0,bytes:0};this.rates.set(ws,rate);}
    if(++rate.count>120||(rate.bytes+=size)>524288){ws.close(1008,'Duel send limit');return;}
    if(typeof raw==='string'){
      let packet;try{packet=JSON.parse(raw);}catch{return;}
      if(packet?.relay==='ping'){this.control(ws,'pong');return;}
      if(packet?.relay==='leave'){
        const other=this.other(ws);
        if(meta.role==='host'){
          if(other){this.control(other,'ended','The host ended this duel.');other.close(1000,'Duel ended');}
          this.control(ws,'waiting');
        }else ws.close(1000,'Left duel');
        return;
      }
      const allowed=meta.role==='host'?['hello','state','version','leave']:['hello','input','draftPick','rematch','slimoEmote','leave'];
      if(!packet||!allowed.includes(packet.t))return;
    }else if(!(raw instanceof ArrayBuffer)||raw.byteLength!==(meta.role==='host'?58:26))return;
    const other=this.other(ws);if(!other)return;
    // Abort a congested stream instead of accumulating seconds of old combat.
    // Cloudflare may omit bufferedAmount; browsers enforce their own limits too.
    if((other.bufferedAmount||0)>262144){this.control(other,'ended','Connection is too slow. Rejoin the duel.');other.close(1013,'Slow connection');return;}
    try{other.send(raw);}catch{other.close(1011,'Connection lost');}
  }
  webSocketClose(ws) {
    this.rates.delete(ws);
    // A late close/error from an old socket must not evict a replacement.
    const role=this.meta(ws)?.role;
    if(this.sockets().some(s=>s!==ws&&this.meta(s)?.role===role))return;
    const other=this.other(ws);if(!other)return;
    if(this.meta(ws)?.role==='host'){this.control(other,'ended','The host left the room.');other.close(1000,'Host left');}
    else this.control(other,'waiting');
  }
  webSocketError(ws) { try{ws.close(1011,'Connection error');}catch{}this.webSocketClose(ws); }
}
