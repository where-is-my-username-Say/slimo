// Google identity is verified on the server. No Google client secret is needed
// for the GIS ID-token flow, and no Google token is stored by the browser.
export class AuthError extends Error {
  constructor(message,status=401){super(message);this.status=status;}
}
const text=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export const opaque=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async value=>hex(await crypto.subtle.digest('SHA-256',text.encode(value)));
const decode=part=>{try{const raw=atob(part.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}catch{throw new AuthError('Invalid Google credential.');}};
let keyCache={keys:[],expires:0,refreshed:0};
let keyRequest=null;
async function googleKeys(fetcher,now){
  if(keyCache.expires>now)return keyCache.keys;
  if(keyRequest)return keyRequest;
  keyRequest=(async()=>{
  const response=await fetcher('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new AuthError('Google verification is temporarily unavailable. Please try again.',503);
  const json=await response.json();if(!Array.isArray(json.keys))throw new AuthError('Google verification is unavailable.',503);
  const ttl=Math.min(3600,Number(/max-age=(\d+)/.exec(response.headers.get('cache-control')||'')?.[1])||300);
  keyCache={keys:json.keys,expires:now+ttl*1000,refreshed:now};return json.keys;
  })();try{return await keyRequest;}finally{keyRequest=null;}
}
export async function verifyGoogleIdToken(credential,clientId,nonce,{fetcher=fetch,now=Date.now(),keys}={}){
  if(typeof credential!=='string'||credential.length>12000)throw new AuthError('Invalid Google credential.');
  const parts=credential.split('.');if(parts.length!==3)throw new AuthError('Invalid Google credential.');
  let header,claims;try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{throw new AuthError('Invalid Google credential.');}
  if(!header||typeof header!=='object'||Array.isArray(header)||!claims||typeof claims!=='object'||Array.isArray(claims))throw new AuthError('Invalid Google credential.');
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw new AuthError('Google credential signature is not supported.');
  let available=keys||await googleKeys(fetcher,now),jwk=available.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!jwk&&!keys&&now-keyCache.refreshed>60000){keyCache.expires=0;available=await googleKeys(fetcher,now);jwk=available.find(k=>k.kid===header.kid&&k.kty==='RSA');}
  if(!jwk)throw new AuthError('Google credential signature could not be verified.');
  let valid=false;try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),text.encode(parts[0]+'.'+parts[1]));}catch{}
  if(!valid)throw new AuthError('Google credential signature could not be verified.');
  const seconds=now/1000,audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!audience.includes(clientId)||((audience.length>1||claims.azp)&&claims.azp!==clientId))throw new AuthError('This Google login belongs to another application.');
  if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss))throw new AuthError('Invalid Google issuer.');
  if(!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+60)throw new AuthError('Google login expired. Sign in again.');
  if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw new AuthError('Google account could not be identified.');
  if(!nonce||claims.nonce!==nonce)throw new AuthError('Google login challenge did not match. Reload and try again.');
  if(claims.email&&claims.email_verified!==true)throw new AuthError('A verified Google account is required.');
  return {sub:claims.sub,name:typeof claims.name==='string'?claims.name.slice(0,80):'Google player',email:typeof claims.email==='string'?claims.email.slice(0,254):''};
}
