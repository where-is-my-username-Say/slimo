import { DurableObject } from 'cloudflare:workers';
import './slimo-world.js';
import { AuthError, hash, opaque, verifyGoogleIdToken } from './google-token.mjs';

const WEEK = 604800;
const USERNAME = /^[a-z0-9_]{3,16}$/;
const ROOM = /^rome-[a-zA-Z0-9_-]{6,80}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const ACCENTS = ['mint','gold','violet','ice'];
const HATS = ['none','crown','halo','horns'];
const fail = (message, status = 400) => { throw new AuthError(message, status); };
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const readCookie = (req, name) => req.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1) || '';
function json(data, status = 200, cookies = []) {
  const headers = new Headers({'Content-Type':'application/json','Cache-Control':'private, no-store'});
  for(const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(data), {status,headers});
}
async function body(req) {
  if(!req.headers.get('Content-Type')?.startsWith('application/json')) fail('JSON required.',415);
  const reader = req.body?.getReader();
  if(!reader) fail('Missing request body.');
  const decoder = new TextDecoder();
  let count = 0, text = '';
  for (;;) {
    const {value,done} = await reader.read();
    if(done) break;
    count += value.byteLength;
    if(count > 14000) { await reader.cancel(); fail('Request is too large.',413); }
    text += decoder.decode(value,{stream:true});
  }
  let data;
  try { data = JSON.parse(text + decoder.decode()); } catch { fail('Invalid JSON.'); }
  if(!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid request.');
  return data;
}

export class SlimoAccounts extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.store = ctx.storage;
    this.sql = ctx.storage.sql;
    this.env = env;
    this.run(`CREATE TABLE IF NOT EXISTS players(
      id TEXT PRIMARY KEY, username TEXT UNIQUE, owner INTEGER NOT NULL,
      atomic INTEGER NOT NULL DEFAULT 0, color INTEGER NOT NULL DEFAULT 0,
      hat TEXT NOT NULL DEFAULT 'none', accent TEXT NOT NULL DEFAULT 'mint'
    )`);
    this.run('CREATE TABLE IF NOT EXISTS vault(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.run('CREATE INDEX IF NOT EXISTS vault_expiry ON vault(expires)');
    this.run('CREATE TABLE IF NOT EXISTS friends(player TEXT, friend TEXT, PRIMARY KEY(player,friend))');
    this.run('CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, recipient TEXT, sender TEXT, kind TEXT, room TEXT, created INTEGER)');
    this.run('CREATE INDEX IF NOT EXISTS notifications_target ON notifications(recipient,created)');
    this.run('CREATE TABLE IF NOT EXISTS duels(id TEXT PRIMARY KEY, room TEXT, host TEXT, guest TEXT, expires INTEGER)');
    this.run('CREATE TABLE IF NOT EXISTS duel_votes(duel TEXT, match INTEGER, player TEXT, vote TEXT, PRIMARY KEY(duel,match,player))');
  }
  run(query,...args){ return this.sql.exec(query,...args); }
  one(query,...args){ return this.run(query,...args).toArray()[0]; }
  get(key, take = false) {
    const row = this.one('SELECT value,expires FROM vault WHERE key=?',key);
    if(take && row) this.run('DELETE FROM vault WHERE key=?',key);
    return row?.expires > Date.now() ? JSON.parse(row.value) : null;
  }
  put(key,value,ttl) {
    this.run('INSERT OR REPLACE INTO vault VALUES(?,?,?)',key,JSON.stringify(value),Date.now()+ttl*1000);
  }
  player(id) { return this.one('SELECT * FROM players WHERE id=?',id); }
  summary(p) {
    return p ? {id:p.id, username:p.username, owner:!!p.owner, atomic:!!(p.atomic || p.owner), beatenOwner:!!p.atomic,
      color:p.color, hat:p.hat, accent:p.accent} : null;
  }
  async session(req) {
    const token = readCookie(req,'slimo_session');
    return TOKEN.test(token) ? this.get('session:'+await hash(token)) : null;
  }
  notify(recipient,sender,kind,room = null) {
    this.run('INSERT INTO notifications VALUES(?,?,?,?,?,?)',opaque(),recipient,sender,kind,room,Date.now());
    this.run('DELETE FROM notifications WHERE recipient=? AND id NOT IN (SELECT id FROM notifications WHERE recipient=? ORDER BY created DESC LIMIT 50)',recipient,recipient);
  }
  async relayTicket(room,role,user) {
    const ticket=opaque();
    this.put('relay:'+await hash(ticket),{room,role,user,expires:Date.now()+7200000},60);
    return ticket;
  }
  async fetch(req) {
    try { return await this.route(req); }
    catch(error) {
      if (!(error instanceof AuthError)) console.error('Slimo account operation failed',error?.name);
      return json({error:error instanceof AuthError ? error.message : 'The account service is temporarily unavailable.'},error instanceof AuthError ? error.status : 503);
    }
  }
  async route(req) {
    const path = new URL(req.url).pathname;
    const post = req.method === 'POST', get = req.method === 'GET';
    if(path === '/internal/duel-relay' && post) {
      const {ticket}=await body(req);
      if(!TOKEN.test(ticket||''))fail('Duel login required.',401);
      const grant=this.get('relay:'+await hash(ticket),true);
      if(!grant||grant.expires<=Date.now())fail('Duel login expired.',401);
      return json({grant});
    }
    if(path === '/internal/meadow' && post) {
      const {ticket} = await body(req);
      if(!TOKEN.test(ticket || '')) fail('Meadow login required.',401);
      const digest = await hash(ticket);
      const grant = this.get('meadow:'+digest,true);
      const profile = grant && this.player(grant.id);
      if(!profile?.username) fail('Meadow login expired.',401);
      return json({profile:this.summary(profile)});
    }
    if(post && req.headers.get('Origin') !== this.env.SLIMO_ORIGIN) fail('Open the Slimo website to sign in.',403);
    if (get && path === '/api/slimo/config') return json({clientId:this.env.GOOGLE_CLIENT_ID || '',workerOrigin:this.env.WORKER_ORIGIN,protocols:{meadow:globalThis.SlimoWorld.protocol,duel:globalThis.SlimoWorld.duelProtocol}});
    if (post && path === '/api/slimo/challenge') {
      if(!this.env.GOOGLE_CLIENT_ID) fail('Google sign-in has not been configured.',503);
      const nonce = opaque();
      this.run('DELETE FROM vault WHERE expires<=?',Date.now());
      return json({nonce},200,[cookie('slimo_nonce',nonce,300)]);
    }
    if (post && path === '/api/slimo/login') {
      if(!this.env.GOOGLE_CLIENT_ID) fail('Google sign-in has not been configured.',503);
      const {credential} = await body(req);
      const nonce = readCookie(req,'slimo_nonce');
      if(!TOKEN.test(nonce)) fail('The sign-in challenge expired.',401);
      const [identity,digest] = await Promise.all([verifyGoogleIdToken(credential,this.env.GOOGLE_CLIENT_ID,nonce),hash(nonce)]);
      const id = await hash('google:'+identity.sub);
      const token = opaque(), sessionKey = 'session:'+await hash(token);
      const owner = identity.email.toLowerCase() === (this.env.OWNER_EMAIL || '').toLowerCase() && !!identity.email;
      const result = this.store.transactionSync(()=>{
        if(this.get('used:'+digest)) fail('That sign-in challenge was already used.',401);
        this.put('used:'+digest,true,600);
        this.run('INSERT INTO players(id,owner) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner',id,Number(owner));
        this.put(sessionKey,{id},WEEK);
        return this.summary(this.player(id));
      });
      return json({profile:result},200,[cookie('slimo_session',token,WEEK),cookie('slimo_nonce','',0)]);
    }
    const session = await this.session(req);
    const p = session && this.player(session.id);
    if(get && path === '/api/slimo/session') return json({profile:this.summary(p)});
    if(!p) fail('Sign in to continue.',401);
    if(post && path === '/api/slimo/logout') {
      this.run('DELETE FROM vault WHERE key=?','session:'+await hash(readCookie(req,'slimo_session')));
      return json({ok:true},200,[cookie('slimo_session','',0)]);
    }
    const data = post ? await body(req) : {};
    if(post && path === '/api/slimo/username') {
      const name = typeof data.username==='string' ? data.username.trim().toLowerCase() : '';
      if(!USERNAME.test(name)) fail('Use 3–16 letters, numbers or underscores.');
      if(p.username) fail('Your username is already set.',409);
      this.store.transactionSync(()=>{
        if(this.player(p.id)?.username) fail('Your username is already set.',409);
        if(this.one('SELECT id FROM players WHERE username=?',name)) fail('That username is taken.',409);
        this.run('UPDATE players SET username=? WHERE id=?',name,p.id);
      });
      return json({profile:this.summary(this.player(p.id))});
    }
    if(!p.username) fail('Choose a username first.',403);
    if(post && path === '/api/slimo/appearance') {
      if(!Number.isInteger(data.color)||data.color<0||data.color>3||!HATS.includes(data.hat)||!ACCENTS.includes(data.accent)) fail('Invalid appearance.');
      this.run('UPDATE players SET color=?,hat=?,accent=? WHERE id=?',data.color,data.hat,data.accent,p.id);
      return json({profile:this.summary(this.player(p.id))});
    }
    if(get && path === '/api/slimo/social') {
      const friends = this.run('SELECT p.username,p.owner FROM players p JOIN friends f ON f.friend=p.id WHERE f.player=? ORDER BY p.username LIMIT 100',p.id).toArray();
      const notifications = this.run('SELECT n.id,n.kind,n.room,p.username FROM notifications n JOIN players p ON p.id=n.sender WHERE n.recipient=? AND n.created>? ORDER BY n.created DESC LIMIT 30',p.id,Date.now()-86400000).toArray();
      return json({profile:this.summary(p),friends,notifications});
    }
    if(post && path === '/api/slimo/friend') {
      const target = this.one('SELECT id FROM players WHERE username=?',String(data.username||'').toLowerCase());
      if(!target || target.id===p.id) fail('That friend could not be found.',404);
      if(!this.one('SELECT 1 FROM friends WHERE player=? AND friend=?',p.id,target.id)) {
        if(this.one('SELECT COUNT(*) AS total FROM friends WHERE player=?',p.id).total>=100) fail('Your friends list is full.',409);
        this.run('INSERT INTO friends VALUES(?,?)',p.id,target.id);
      }
      return json({ok:true});
    }
    if(post && path === '/api/slimo/notify/read') {
      this.run('DELETE FROM notifications WHERE recipient=? AND id=?',p.id,String(data.id||''));
      return json({ok:true});
    }
    if(post && path === '/api/slimo/meadow') {
      const ticket = opaque();
      this.put('meadow:'+await hash(ticket),{id:p.id},30);
      return json({ticket});
    }
    if(post && path === '/api/slimo/duel/open') {
      if(!ROOM.test(data.room || '')) fail('Room code is invalid.');
      const existing = this.get('room:'+data.room);
      if(existing && existing.host!==p.id) fail('Room is already registered.',409);
      this.put('room:'+data.room,{host:p.id},7200);
      return json({ok:true,relayTicket:await this.relayTicket(data.room,'host',p.id)});
    }
    if(post && path === '/api/slimo/duel/close') {
      if(this.get('room:'+data.room)?.host===p.id)this.run('DELETE FROM vault WHERE key=?','room:'+data.room);
      return json({ok:true});
    }
    if(post && path === '/api/slimo/duel/invite') {
      const room = this.get('room:'+data.room);
      if(room?.host!==p.id) fail('Start a friend duel first.',409);
      const friend = this.one('SELECT p.id FROM players p JOIN friends f ON f.friend=p.id WHERE p.username=? AND f.player=?',String(data.username||'').toLowerCase(),p.id);
      if(!friend) fail('Add that player as a friend first.',404);
      const key = 'invite:'+p.id+':'+friend.id;
      if(this.get(key)) fail('An invite was just sent.',429);
      this.put(key,true,15);
      this.notify(friend.id,p.id,'duel',data.room);
      return json({ok:true});
    }
    if(post && path === '/api/slimo/duel/join') {
      const room = this.get('room:'+data.room);
      if(!room || room.host===p.id) fail('Ask your friend for a fresh invite.',404);
      const id = opaque(), pass = opaque();
      const passKey = 'duel:'+await hash(pass);
      this.store.transactionSync(()=>{
        this.run('DELETE FROM duel_votes WHERE duel IN (SELECT id FROM duels WHERE expires<=?)',Date.now());
        this.run('DELETE FROM duels WHERE expires<=?',Date.now());
        this.run('INSERT INTO duels(id,room,host,guest,expires) VALUES(?,?,?,?,?)',id,data.room,room.host,p.id,Date.now()+7200000);
        this.put(passKey,{id,host:room.host,guest:p.id,room:data.room},45);
      });
      return json({pass,id,host:this.summary(this.player(room.host)),relayTicket:await this.relayTicket(data.room,'guest',p.id)});
    }
    if(post && path === '/api/slimo/duel/accept') {
      if(!TOKEN.test(data.pass || '')) fail('The guest must sign in to Slimo.',403);
      const key = 'duel:'+await hash(data.pass);
      const grant = this.get(key);
      if(grant?.host!==p.id || grant.room!==data.room) fail('The guest’s duel authorization expired.',403);
      this.get(key,true);
      return json({id:grant.id,guest:this.summary(this.player(grant.guest))});
    }
    if(post && path === '/api/slimo/duel/result') {
      const id = String(data.id || ''), vote = data.winner, match = data.match;
      if(!Number.isInteger(match)||match<1||match>1000) fail('Invalid duel number.');
      this.store.transactionSync(()=>{
        const duel = this.one('SELECT * FROM duels WHERE id=? AND expires>?',id,Date.now());
        if(!duel||![duel.host,duel.guest].includes(p.id)||![duel.host,duel.guest,'draw'].includes(vote)) fail('Invalid duel result.',403);
        this.run('INSERT OR IGNORE INTO duel_votes VALUES(?,?,?,?)',id,match,p.id,vote);
        const votes = this.run('SELECT vote FROM duel_votes WHERE duel=? AND match=?',id,match).toArray();
        if(votes.length!==2 || votes[0].vote!==votes[1].vote || votes[0].vote==='draw') return;
        const winner = this.player(votes[0].vote), loser = this.player(votes[0].vote===duel.host?duel.guest:duel.host);
        if(!winner.atomic && loser.owner) {
          this.run('UPDATE players SET atomic=1 WHERE id=?',winner.id);
          this.notify(winner.id,loser.id,'achievement');
        }
      });
      return json({profile:this.summary(this.player(p.id))});
    }
    return json({error:'Unknown account endpoint.'},404);
  }
}
