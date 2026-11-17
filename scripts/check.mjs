import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/([^"]+)"/g)) {
  assert.ok(existsSync(join(root, match[1])), 'Missing asset: ' + match[1]);
}
const scripts = [...html.matchAll(/<script\s+src="\.\/([^"]+)"/g)].map(m => m[1]);
assert.ok(scripts.indexOf('vendor/three-r128.min.js') < scripts.indexOf('slimo-game.js'));
assert.ok(scripts.indexOf('slimo-audio-synth.js') < scripts.indexOf('slimo-game.js'));
for(const file of ['slimo-world.js','slimo-meadow-map.js','slimo-magic-vfx.js','slimo-meadow-ui.js']) {
  assert.ok(scripts.includes(file) && scripts.indexOf(file)<scripts.indexOf('slimo-game.js'), file+' must load before the game');
}
for (const file of [...readdirSync(root).filter(f => /\.(js|mjs)$/.test(f)), ...scripts]) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], {encoding: 'utf8'});
  assert.equal(result.status, 0, file + ': ' + result.stderr);
}
const audio = vm.runInNewContext(readFileSync(join(root, 'slimo-audio-files.js'), 'utf8') + '\nAUDIO_FILES');
for (const [name, path] of Object.entries(audio)) {
  assert.ok(existsSync(join(root, path)), 'Missing audio: ' + name);
  assert.ok(readFileSync(join(root, path)).length > 0);
}
console.log(`Checked ${ids.length} unique IDs, ${scripts.length} ordered scripts and ${Object.keys(audio).length} audio files; JavaScript syntax valid.`);
