let slimoAccount = null;
let slimoDuel = null;
let slimoGuestGrant = null;
let slimoWorker = 'https://slimo-meadow.balochnajool.workers.dev';
let slimoSubmitted = '';
let slimoNoticeIds = new Set();
let slimoSocialBusy = false;

async function slimoApi(path, data) {
  const options = data === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  };
  const response = await fetch('/api/slimo/' + path, {...options, cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(10000)});
  const answer = await response.json().catch(()=>null);
  if(!response.ok || !answer) throw Error(answer?.error || 'The Slimo account server is unavailable.');
  return answer;
}
function slimoStatus(text) { $('accountStatus').textContent = text; }
function slimoUseProfile(p) {
  slimoAccount = p;
  const ready = !!p?.username;
  $('accountGate').hidden = ready;
  $('usernameForm').hidden = !p || ready;
  $('googleSlot').hidden = !!p;
  $('retryGoogle').hidden = !!p;
  $('accountTools').hidden = !ready;
  if(!ready) return;
  profile.name = p.username;
  profile.color = p.color;
  chosen = p.color;
  $('playerName').value = p.username;
  $('playerName').readOnly = true;
  $('accountName').textContent = p.username + (p.owner ? ' · Owner' : '');
  $('accountAward').textContent = p.beatenOwner ? 'Beat the Owner · Atomic unlocked' : p.atomic ? 'Atomic unlocked' : '';
  $('slimeHat').value = p.hat;
  $('slimeAccent').value = p.accent;
  if(mode === 'lobby') {
    state.p[0].color = p.color;
    state.p[0].hat = p.hat;
    state.p[0].accent = p.accent;
    state.p[0].owner = p.owner;
    updateSwatches();
  }
}
async function slimoGoogle(config) {
  if(config.workerOrigin) slimoWorker = config.workerOrigin;
  if(!config.clientId) throw Error('Google sign-in still needs to be configured on the Slimo server.');
  if(!window.google?.accounts?.id) {
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>{ script.remove(); reject(Error('Could not load Google sign-in.')); };
      document.head.append(script);
    });
  }
  const {nonce} = await slimoApi('challenge',{});
  window.google.accounts.id.initialize({
    client_id:config.clientId, nonce,
    callback:async ({credential})=>{
      try {
        const {profile:p} = await slimoApi('login',{credential});
        slimoUseProfile(p);
        slimoStatus(p.username ? '' : 'Choose a unique username.');
        if(p.username) {refreshRoomLobby();void slimoRefreshSocial();}
      } catch(error) { slimoStatus(error.message); }
    }
  });
  $('googleSlot').replaceChildren();
  window.google.accounts.id.renderButton($('googleSlot'),{theme:'filled_black',size:'large',text:'signin_with',shape:'pill'});
}
async function slimoBoot() {
  try {
    const [config,{profile:p}] = await Promise.all([slimoApi('config'),slimoApi('session')]);
    if(config.workerOrigin) slimoWorker=config.workerOrigin;
    slimoUseProfile(p);
    if(!p) await slimoGoogle(config);
    else if(p.username) { void slimoRefreshSocial(); refreshRoomLobby(); }
    else slimoStatus('Choose a unique username.');
  } catch(error) { slimoStatus(error.message); }
}
async function slimoSaveAppearance() {
  if(!slimoAccount?.username || mode !== 'lobby') return;
  try {
    const {profile:p}=await slimoApi('appearance',{color:chosen,hat:$('slimeHat').value,accent:$('slimeAccent').value});
    slimoUseProfile(p);
    toast('Look saved');
  } catch(error) { toast(error.message); }
}
function slimoAction(text, action) {
  const button = document.createElement('button');
  button.type='button'; button.textContent=text;
  button.onclick=async ()=>{
    button.disabled=true;
    try { await action(); }
    catch(error){ toast(error.message); }
    finally{ button.disabled=false; }
  };
  return button;
}
async function slimoRefreshSocial() {
  if(document.hidden || !slimoAccount?.username || slimoSocialBusy) return;
  slimoSocialBusy = true;
  try {
    const data = await slimoApi('social');
    if (!slimoAccount || data.profile.id !== slimoAccount.id) return;
    if(data.profile.atomic!==slimoAccount.atomic) slimoUseProfile(data.profile);
    $('friends').textContent=data.notifications.length ? 'Friends (' + data.notifications.length + ')' : 'Friends';
    $('duelFriends').textContent=$('friends').textContent;
    const notice = data.notifications.find(item=>!slimoNoticeIds.has(item.id));
    slimoNoticeIds = new Set(data.notifications.map(item=>item.id));
    if(notice) toast(notice.kind==='duel' ? notice.username + ' invited you to duel. Open Friends.' : 'Beat the Owner · Atomic unlocked');
    if(activeOverlay==='friendsOverlay') slimoRenderSocial(data);
  } catch { /* The next poll retries. */ }
  finally { slimoSocialBusy=false; }
}
function slimoRenderSocial({friends,notifications}) {
  const list=$('friendList');
  if(list.contains(document.activeElement)) return;
  list.replaceChildren();
  for(const note of notifications) {
    const line=document.createElement('div');
    line.className='friend';
    const label=document.createElement('span');
    label.textContent=note.kind==='duel' ? note.username+' invited you' : 'Beat the Owner · Atomic unlocked';
    line.append(label);
    if(note.kind==='duel') line.append(slimoAction('Join',async ()=>{
      if(mode!=='lobby') throw Error('Return to the lobby before joining another fight.');
      closeOverlay(false);
      $('joinCode').value=note.room;
      await requestEnter('guest',note.room);
      if(mode==='guest'||pending?.type==='guest') await slimoApi('notify/read',{id:note.id});
    }));
    line.append(slimoAction('Dismiss',async()=>{await slimoApi('notify/read',{id:note.id});line.remove();await slimoRefreshSocial();}));
    list.append(line);
  }
  for(const friend of friends) {
    const line=document.createElement('div');
    line.className='friend';
    const label=document.createElement('span');
    label.textContent=friend.username+(friend.owner?' · Owner':'');
    line.append(label);
    if(mode==='host' && roomId && !welcomed) line.append(slimoAction('Invite',async()=>{
      await slimoApi('duel/invite',{username:friend.username,room:roomId});
      toast('Invited '+friend.username);
    }));
    list.append(line);
  }
  if(!list.childElementCount) list.textContent='Add a friend by their Slimo username.';
}
function slimoOpenSocial() {
  if(!slimoAccount?.username) return;
  openOverlay('friendsOverlay');
  $('friendList').textContent='Loading friends…';
  void slimoRefreshSocial();
}
async function slimoReportResult() {
  if(!slimoDuel || !slimoAccount || state.phase!=='over') return;
  const match=state.duelMatch;
  const key=slimoDuel.id+':'+match;
  if(slimoSubmitted===key) return;
  const winner=state.run?.winner ?? state.winner;
  if(![-1,0,1].includes(winner)) return;
  slimoSubmitted=key;
  try {
    const {profile:p}=await slimoApi('duel/result',{id:slimoDuel.id,match,winner:winner===0?slimoDuel.host.id:winner===1?slimoDuel.guest.id:'draw'});
    if(slimoAccount?.id===p.id && p.atomic!==slimoAccount.atomic) slimoUseProfile(p);
  } catch {
    if(slimoSubmitted===key) slimoSubmitted='';
  }
}
function slimoInitAccount() {
  $('retryGoogle').onclick=()=>{void slimoBoot();};
  $('usernameForm').onsubmit=async event=>{
    event.preventDefault();
    try {
      const {profile:p}=await slimoApi('username',{username:$('newUsername').value});
      slimoUseProfile(p);refreshRoomLobby();void slimoRefreshSocial();
    } catch(error) { slimoStatus(error.message); }
  };
  $('saveSlimoLook').onclick=slimoSaveAppearance;
  $('slimoLogout').onclick=async()=>{try{await slimoApi('logout',{});location.reload();}catch(error){toast(error.message);}};
  $('duelFriends').onclick=slimoOpenSocial;
  $('friendForm').onsubmit=async event=>{
    event.preventDefault();
    try {
      await slimoApi('friend',{username:$('friendUsername').value.trim()});
      $('friendUsername').value='';
      $('friendUsername').blur();
      await slimoRefreshSocial();
    } catch(error){toast(error.message);}
  };
  setInterval(slimoRefreshSocial,5000);
  setInterval(slimoReportResult,3000);
  void slimoBoot();
}
