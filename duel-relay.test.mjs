import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {AuthError,hash,opaque,verifyGoogleIdToken} from './google-token.mjs';
import './slimo-world.js';
const read=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};

function relayHarness() {
  const sockets=[],intervals=new Map();let nextClient=null,nextInterval=0;
  class Socket {
    constructor(){this.readyState=1;this.bufferedAmount=0;this.events=new Map();this.sent=[];}
    addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    emit(name,value){for(const fn of this.events.get(name)||[])fn(value);}
    send(data){if(this.readyState!==1)throw Error('closed');this.sent.push(data);const peer=this.peer;queueMicrotask(()=>{if(peer?.readyState===1)peer.emit('message',{data});});}
    close(code=1000){if(this.readyState===3)return;this.readyState=3;this.closeCode=code;queueMicrotask(()=>this.emit('close',{}));
      if(this.peer&&this.peer.readyState!==3){this.peer.readyState=3;this.peer.closeCode=code;queueMicrotask(()=>this.peer.emit('close',{}));}}
    serializeAttachment(data){this.attachment=data;}deserializeAttachment(){return this.attachment;}
  }
  const ctx={getWebSockets:()=>sockets,acceptWebSocket(ws){sockets.push(ws);ws.addEventListener('message',e=>room.webSocketMessage(ws,e.data));ws.addEventListener('close',()=>room.webSocketClose(ws));}};
  const c=vm.createContext({ArrayBuffer,TextEncoder,Date,Map,JSON,Number,DurableObject:class{},
    Response:class{constructor(body,options){Object.assign(this,options);this.body=body;}},
    WebSocketPair:class{constructor(){const client=nextClient||new Socket(),server=new Socket();nextClient=null;client.peer=server;server.peer=client;return {0:client,1:server};}}});
  const Room=vm.runInContext(read('slimo-duel-relay.js').replace(/^import .*;\n/,'').replace('export class','class')+'\nDuelRelay',c),room=new Room(ctx,{});
  class BrowserSocket extends Socket {
    constructor(url){super();this.readyState=0;queueMicrotask(async()=>{
      nextClient=this;this.readyState=1;const role=new URL(url).searchParams.get('role');
      const response=await room.fetch(new Request('https://relay/duel',{headers:{Upgrade:'websocket','X-Slimo-Duel':JSON.stringify({role,user:role,expires:Date.now()+60000})}}));
      if(response.status!==101)this.close(1008);
    });}
  }
  const transportContext=vm.createContext({ArrayBuffer,performance,WebSocket:BrowserSocket,
    setInterval:fn=>{intervals.set(++nextInterval,fn);return nextInterval;},clearInterval:id=>intervals.delete(id)});
  vm.runInContext(read('slimo-duel-transport.js'),transportContext);
  const create=(role,callbacks={})=>transportContext.SlimoDuelTransport.create({url:'wss://relay/duel?role='+role,hostSide:role==='host',onConnection:()=>{},onError:()=>{},...callbacks});
  return {room,ctx,sockets,Socket,create,intervals};
}

test('relay pairs two browsers, carries control and binary motion, then keeps the host for a new guest',async()=>{
  const h=relayHarness(),connections=[],guestConnections=[],errors=[];
  const host=h.create('host',{onConnection:c=>{connections.push(c);c.on('open',()=>c.send({t:'hello',version:6}));},onError:e=>errors.push(e)});
  await flush();assert.equal(host.connected,true);assert.equal(connections.length,0);
  const received=[];let guest=h.create('guest',{onConnection:c=>{guestConnections.push(c);c.on('data',v=>received.push(v));}});
  await flush();assert.equal(connections.length,1);assert.equal(received[0].version,6);
  const inputs=[],poses=[];connections[0].motion.addEventListener('message',e=>inputs.push(e.data));guestConnections[0].motion.addEventListener('message',e=>poses.push(e.data));
  guestConnections[0].motion.send(new ArrayBuffer(26));connections[0].motion.send(new ArrayBuffer(58));await flush();
  assert.equal(inputs[0].byteLength,26);assert.equal(poses[0].byteLength,58);
  guest.destroy();await flush();assert.equal(connections[0].open,false);assert.equal(host.connected,true);
  guest=h.create('guest',{onConnection:c=>guestConnections.push(c)});await flush();assert.equal(connections.length,2);assert.equal(guestConnections.length,2);
  host.destroy();guest.destroy();await flush();assert.equal(h.intervals.size,0);assert.deepEqual(errors,[]);
});
test('room rejects a second guest, packets in the wrong direction and oversized payloads',async()=>{
  const h=relayHarness();let hostConnection,guestConnection;
  const host=h.create('host',{onConnection:c=>hostConnection=c});const guest=h.create('guest',{onConnection:c=>guestConnection=c});await flush();
  const errors=[];const intruder=h.create('guest',{onError:e=>errors.push(e)});await flush();assert.equal(errors.length,1);
  const received=[];hostConnection.on('data',v=>received.push(v));guestConnection.send({t:'state',s:{hp:999}});guestConnection.motion.send(new ArrayBuffer(58));await flush();assert.equal(received.length,0);
  guestConnection.send({t:'input',v:{x:1}});await flush();assert.equal(received.length,1);
  guestConnection.send({t:'hello',padding:'a'.repeat(100000)});await flush();assert.equal(guestConnection.open,false);
  assert.equal(h.sockets.find(s=>s.attachment.role==='guest').closeCode,1009);
  host.destroy();guest.destroy();intruder.destroy();
});
test('relay closes expired and flooded connections and refuses missing authorization',async()=>{
  const h=relayHarness();const response=await h.room.fetch(new Request('https://relay/duel',{headers:{Upgrade:'websocket'}}));assert.equal(response.status,401);
  const ws=new h.Socket();ws.serializeAttachment({role:'host',user:'h',expires:Date.now()-1});h.room.webSocketMessage(ws,'{}');assert.equal(ws.closeCode,1008);
  const flood=new h.Socket();flood.serializeAttachment({role:'host',user:'h',expires:Date.now()+10000});
  for(let i=0;i<121;i++)h.room.webSocketMessage(flood,JSON.stringify({relay:'ping'}));assert.equal(flood.closeCode,1008);
});
test('host can eject a timed-out guest without losing its waiting room',async()=>{
  const h=relayHarness();let connection;const host=h.create('host',{onConnection:c=>connection=c}),errors=[];
  const guest=h.create('guest',{onError:e=>errors.push(e)});await flush();connection.close();await flush();
  assert.equal(host.connected,true);assert.equal(errors.length,1);
  let replacement;const next=h.create('guest',{onConnection:c=>replacement=c});await flush();assert.equal(replacement.open,true);
  host.destroy();guest.destroy();next.destroy();
});

function accountsHarness(){
  const db=new DatabaseSync(':memory:');
  const sql={exec(query,...args){const stmt=db.prepare(query),rows=stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);return {toArray:()=>rows};}};
  const context=vm.createContext({DurableObject:class{},AuthError,hash,opaque,verifyGoogleIdToken,Date,URL,Headers,Response,TextDecoder,JSON,console,SlimoWorld:globalThis.SlimoWorld});
  const Accounts=vm.runInContext(read('accounts.mjs').replace(/^import .*;\n/gm,'').replace('export class','class')+'\nSlimoAccounts',context);
  const api=new Accounts({storage:{sql,transactionSync:fn=>fn()}},{SLIMO_ORIGIN:'https://slimo.test'});
  for(const id of ['host','guest'])api.run('INSERT INTO players(id,username,owner) VALUES(?,?,?)',id,id,0);
  api.session=async req=>({id:req.headers.get('X-Test-User')||'host'});
  const request=(path,data,user='host')=>api.route(new Request('https://api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://slimo.test','X-Test-User':user},body:JSON.stringify(data)}));
  return {api,request,db};
}
test('real account routes issue scoped single-use relay tickets and still authorize duel results',async()=>{
  const {api,request,db}=accountsHarness();const room='rome-12345678';
  const host=await (await request('api/slimo/duel/open',{room})).json();
  const verify=ticket=>request('internal/duel-relay',{ticket});
  const hostGrant=await(await verify(host.relayTicket)).json();assert.equal(hostGrant.grant.role,'host');assert.equal(hostGrant.grant.room,room);
  await assert.rejects(()=>verify(host.relayTicket),/expired/);
  const guest=await(await request('api/slimo/duel/join',{room},'guest')).json();
  const guestGrant=await(await verify(guest.relayTicket)).json();assert.equal(guestGrant.grant.role,'guest');assert.equal(guestGrant.grant.user,'guest');
  const accepted=await(await request('api/slimo/duel/accept',{room,pass:guest.pass})).json();assert.equal(accepted.guest.id,'guest');assert.equal(accepted.id,guest.id);
  await assert.rejects(()=>request('api/slimo/duel/accept',{room,pass:guest.pass}),/expired/);
  const expiring=await api.relayTicket(room,'host','host');api.run('UPDATE vault SET expires=0 WHERE key=?','relay:'+await hash(expiring));await assert.rejects(()=>verify(expiring),/expired/);
  await request('api/slimo/duel/close',{room});await assert.rejects(()=>request('api/slimo/duel/join',{room},'guest'),/fresh invite/);db.close();
});

test('actual duel handshake waits for host authorization before welcoming the guest',async()=>{
  const h=relayHarness(),source=read('slimo-game.js'),attach=source.slice(source.indexOf('function attach(connection,'),source.indexOf("const phases =",source.indexOf('function attach(connection,')));
  let authorize;const approval=new Promise(resolve=>authorize=resolve),messages=[];
  function side(hostSide){
    const context=vm.createContext({performance,setTimeout:()=>1,clearTimeout(){},netAttempt:1,link:null,lastRemote:0,lastSnapshot:0,welcomed:false,PROTOCOL:6,
      state:{p:[{},{}],phase:'waiting'},profile:{name:'test'},chosen:0,slimoAccount:{id:hostSide?'host':'guest'},slimoGuestGrant:{id:'duel',host:{id:'host'}},slimoDuel:null,
      peerTimer:0,roomId:'rome-12345678',activeOverlay:'shareOverlay',remoteReady:true,motionLink:null,watchedPeerConnection:null,watchMotionChannel:null,
      slimoApi:async()=>{messages.push('authorize');return approval;},gameReady:()=>true,setupMotionChannel(){},closeOverlay(){},restartMatch(){messages.push('restart');},
      broadcastState(){messages.push('state');},slimoCompleteJoin(){messages.push('notice read');},dropRival(){messages.push('drop');},failConnection(){messages.push('fail');},
      send(packet){context.link.send(packet);},toast(){}});
    vm.runInContext(attach,context);return context;
  }
  const host=side(true),guest=side(false);
  const a=h.create('host',{onConnection:c=>host.attach(c,true,1)}),b=h.create('guest',{onConnection:c=>guest.attach(c,false,1)});
  await flush();assert.equal(host.welcomed,false);assert.equal(guest.welcomed,false);assert.deepEqual(messages,['authorize']);
  authorize({id:'duel',guest:{id:'guest',username:'guest',color:1}});await flush();assert.equal(host.welcomed,true);assert.equal(guest.welcomed,true);
  assert.ok(messages.includes('notice read'));a.destroy();b.destroy();
});

test('actual mobile entry does not spend join authorization while waiting for rotation',async()=>{
  const source=read('slimo-game.js'),calls=[];
  const c=vm.createContext({performance,URL,crypto,window:{},pending:null,entryNonce:0,mode:'lobby',slimoAccount:{username:'guest'},lobbyFormat:'classic',chosen:0,
    slimoWorker:'https://slimo.test',netAttempt:0,roomId:'',slimoDuel:null,welcomed:false,peer:null,link:null,peerTimer:0,slimoGuestGrant:null,profile:{},
    setTimeout:()=>1,clearTimeout(){},unlockAudio(){},closeOverlay(){},writeStore(){},setStatus(){},resetInputs(){},isLandscape:()=>false,fullscreen:async()=>{},
    $:id=>id==='playerName'?{value:'guest'}:{hidden:false},failConnection:message=>calls.push(message),
    slimoApi:async(path,data)=>{calls.push({path,data});return {relayTicket:'ticket',id:'duel',host:{id:'host'}};},
    SlimoDuelTransport:{create:options=>({options,connected:false})}});
  vm.runInContext(source.slice(source.indexOf('async function connect(type,'),source.indexOf('\nfunction attach(')),c);
  c.enter=(type,code)=>{c.mode=type;void c.connect(type,code);};
  vm.runInContext(source.slice(source.indexOf('function updateOrientation()'),source.indexOf('function prepareLobby()')),c);
  await c.requestEnter('guest','rome-12345678');assert.equal(c.pending.ready,true);assert.deepEqual(calls,[]);
  c.isLandscape=()=>true;c.updateOrientation();await flush();assert.equal(calls.length,1);assert.equal(calls[0].path,'duel/join');
  assert.equal(new URL(c.peer.options.url).protocol,'wss:');assert.equal(c.slimoGuestGrant.id,'duel');
});

test('actual duel scheduler bounds large snapshots while retaining 30 Hz compact motion',()=>{
  const source=read('slimo-game.js'),packetSizes=[];let snapshots=0,motion=0;
  const c=vm.createContext({performance,mode:'host',link:{open:true},welcomed:true,document:{hidden:false},lastRemote:1000,remoteReady:true,
    state:{phase:'fight',roundKey:1},gameReady:()=>true,keyframePhase:'fight',keyframeRound:1,keyframeAt:1000,frameStateAt:1000,networkDirty:false,
    motionLink:{readyState:'open'},lastFast:1000,FULL_MS:200,STATE_MS:1000/30,packMotion:()=>new ArrayBuffer(58),sendFast:buffer=>{packetSizes.push(buffer.byteLength);motion++;return true;},
    broadcastState:now=>{snapshots++;c.keyframeAt=now;c.networkDirty=false;},dropRival:()=>assert.fail('unexpected disconnect')});
  vm.runInContext(source.slice(source.indexOf('function tickNet('),source.indexOf('\nfunction renderBullet(')),c);
  for(let n=1;n<=120;n++){c.lastFast=1000+n*1000/120;c.tickNet(c.lastFast);}
  assert.ok(snapshots<=5);assert.ok(motion>=24&&motion<=30);assert.ok(packetSizes.every(n=>n===58));
  snapshots=0;c.keyframeAt=2000;
  for(let n=1;n<=120;n++){c.networkDirty=true;c.lastFast=2000+n*1000/120;c.tickNet(c.lastFast);}
  assert.ok(snapshots<=20,'combat dirtiness must not flood full snapshots at render frequency');
});
test('actual send path drops stale state/input under backpressure while allowing control packets',()=>{
  const source=read('slimo-game.js'),sent=[],c=vm.createContext({link:{open:true,dataChannel:{bufferedAmount:70000},send:p=>sent.push(p)}});
  vm.runInContext(source.slice(source.indexOf('function send(packet)'),source.indexOf('\nfunction clearPeer()')),c);
  assert.equal(c.send({t:'state'}),false);assert.equal(c.send({t:'input'}),false);assert.equal(c.send({t:'leave'}),true);assert.equal(sent.length,1);
});

test('Worker rejects cross-origin relay access and forwards only verified room grants',async()=>{
  const source=read('worker.js'),world=source.slice(source.indexOf('export default')+'export default'.length).trim().replace(/;$/,'');
  const c=vm.createContext({URL,Headers,Request,PROTOCOL:4,CAP:50,response:(data,status=200)=>Response.json(data,{status})});
  const worker=vm.runInContext('('+world+')',c),calls=[],grant={room:'rome-12345678',role:'host',user:'host',expires:Date.now()+10000};
  const env={SLIMO_ORIGIN:'https://slimo.test',ACCOUNTS:{getByName:()=>({fetch:async()=>{calls.push('authorize');return Response.json({grant});}})},
    DUEL_RELAY:{getByName:room=>({fetch:async req=>{calls.push({room,headers:JSON.parse(req.headers.get('X-Slimo-Duel'))});return new Response('ok');}})}};
  const request=origin=>new Request('https://worker/duel?ticket=abc',{headers:{Upgrade:'websocket',Origin:origin,'X-Slimo-Duel':'untrusted'}});
  assert.equal((await worker.fetch(request('https://evil.test'),env)).status,403);assert.equal(calls.length,0);
  assert.equal((await worker.fetch(request('https://slimo.test'),env)).status,200);assert.equal(calls[1].room,grant.room);assert.deepEqual(calls[1].headers,grant);
});

test('version checks explain whether to deploy the Worker or reload an old client',()=>{
  const source=read('slimo-account.js'),c=vm.createContext({Number});
  vm.runInContext(source.slice(source.indexOf('function slimoVersionMessage('),source.indexOf('function slimoStatus(')),c);
  assert.match(c.slimoVersionMessage(4,3),/Worker needs updating.*game 4, server 3/);
  assert.match(c.slimoVersionMessage(4,5),/Reload the game/);
  assert.match(c.slimoVersionMessage(4,undefined),/Deploy the matching Worker/);
});
test('deployment verifier rejects old Workers and accepts the shared protocol contract',async()=>{
  const {verifyWorker}=await import('./verify-worker.mjs');
  await assert.rejects(()=>verifyWorker('https://worker.test',async()=>Response.json({protocol:3})),/version mismatch/);
  const expected=globalThis.SlimoWorld;
  const result=await verifyWorker('https://worker.test',async()=>Response.json({protocol:expected.protocol,duelProtocol:expected.duelProtocol}));assert.equal(result.duelProtocol,globalThis.SlimoWorld.duelProtocol);
  await assert.rejects(()=>verifyWorker('https://worker.test',async()=>new Response('no',{status:403})),/HTTP 403/);
});
test('Meadow version preflight stops incompatible joins before requesting a ticket',async()=>{
  const source=read('slimo-game.js'),calls=[];
  // Stop at the first WebSocket construction: this test exercises only the
  // real early compatibility path, not a duplicated version-check algorithm.
  const end=source.indexOf("  const path = new URL('/room/OPEN-MEADOW'",source.indexOf('async function openPublicConnection()'));
  const preflight=source.slice(source.indexOf('async function openPublicConnection()'),end)+'\n}';
  const c=vm.createContext({mode:'public',document:{hidden:false},meadowSuspended:false,publicRoom:{entry:0,ws:null},MEADOW_PROTOCOL:4,
    slimoApi:async path=>{calls.push(path);return {protocols:{meadow:3}};},slimoVersionMessage:()=> 'Deploy matching Worker',leave:message=>calls.push(message)});
  vm.runInContext(preflight,c);await c.openPublicConnection();assert.deepEqual(calls,['config','Deploy matching Worker']);
});

test('public account configuration advertises the same versions used by both game runtimes',async()=>{
  const {api,db}=accountsHarness();
  const data=await(await api.route(new Request('https://api/api/slimo/config'))).json();
  assert.equal(data.protocols.meadow,globalThis.SlimoWorld.protocol);
  assert.equal(data.protocols.duel,globalThis.SlimoWorld.duelProtocol);db.close();
});

test('a delayed close callback from an old guest cannot drop a replacement duel',async()=>{
  const h=relayHarness();let connection;const host=h.create('host',{onConnection:c=>connection=c});
  const guest=h.create('guest');await flush();const old=h.sockets.find(s=>s.attachment.role==='guest');
  guest.destroy();await flush();const replacement=h.create('guest');await flush();const current=connection;
  h.room.webSocketClose(old);await flush();assert.equal(current.open,true);assert.equal(connection,current);
  host.destroy();replacement.destroy();
});

test('friend-duel relay carries Atomic requests to the host and the cast state back to the guest',async()=>{
 const h=relayHarness();let hostConnection,guestConnection;
 const host=h.create('host',{onConnection:c=>hostConnection=c});
 const guest=h.create('guest',{onConnection:c=>guestConnection=c});await flush();
 const requests=[],states=[];
 hostConnection.on('data',packet=>requests.push(packet));guestConnection.on('data',packet=>states.push(packet));
 guestConnection.send({t:'slimoEmote',key:'atomic'});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(requests)),[{t:'slimoEmote',key:'atomic'}]);
 hostConnection.send({t:'state',s:{events:[{type:'atomic',i:1}]}});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(states)),[{t:'state',s:{events:[{type:'atomic',i:1}]}}]);
 host.destroy();guest.destroy();
});
