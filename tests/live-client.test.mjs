import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildLiveClient} from '../scripts/build-live-client.mjs';
const root=new URL('..',import.meta.url).pathname;
function handler(){const source=buildLiveClient(root).replace('export function serveLiveClient','function serveLiveClient');return vm.runInNewContext(source+'\nserveLiveClient',{URL,Response,Object});}
test('the hosted game serves the exact checked frontend and all text dependencies at versioned URLs',async()=>{
  const serve=handler(),base='https://worker.test/api/slimo/play/';
  const response=serve(new Request(base));assert.equal(response.headers.get('cache-control'),'no-store');
  const html=await response.text();assert.match(html,/<base href="\/">/);
  const dependencies=[...html.matchAll(/(?:src|href)="(\/api\/slimo\/play\/assets\/[a-f0-9]{16}\/([^"?]+))"/g)];
  assert.equal(dependencies.length,15);
  for(const [,path,file]of dependencies){
    const asset=serve(new Request(new URL(path,base)));assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control'),/immutable/);
    assert.equal(await asset.text(),readFileSync(new URL('../'+file,import.meta.url),'utf8'),file);
  }
  assert.ok(dependencies.some(m=>m[2]==='slimo-duel-transport.js'));
});
test('hosted game supports both proxy URL forms and reject unknown files and write methods',async()=>{
  const serve=handler(),root='https://worker.test/api/slimo/play';
  assert.equal(serve(new Request(root)).status,200);
  assert.equal(serve(new Request(root+'/missing.js')).status,404);
  assert.equal(serve(new Request(root+'/',{method:'POST'})).status,405);
  const head=serve(new Request(root+'/',{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
});
