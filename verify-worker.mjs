import './slimo-world.js';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export async function verifyWorker(origin,fetcher=fetch) {
  const response=await fetcher(new URL('/health',origin),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Worker health check returned HTTP '+response.status+'. Confirm WORKER_ORIGIN and public Worker access.');
  const actual=await response.json(),expected=globalThis.SlimoWorld;
  if(actual.protocol!==expected.protocol||actual.duelProtocol!==expected.duelProtocol)
    throw Error('Worker version mismatch: expected Meadow '+expected.protocol+' / duel '+expected.duelProtocol+', received '+actual.protocol+' / '+(actual.duelProtocol??'older release')+'. Deploy the Worker from this source.');
  return actual;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const config=JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
    const result=await verifyWorker(config.vars.WORKER_ORIGIN);
    console.log('Worker verified: Meadow '+result.protocol+'; friend duel '+result.duelProtocol+'.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
