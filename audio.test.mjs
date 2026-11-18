import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const game = readFileSync(new URL('./slimo-game.js', import.meta.url), 'utf8');
const audioCode = game.slice(game.indexOf('let audio = null;'), game.indexOf('function vibrate('));
const synth = readFileSync(new URL('./slimo-audio-synth.js', import.meta.url), 'utf8');
const files = readFileSync(new URL('./slimo-audio-files.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function harness({ failPlay = false } = {}) {
  const nodes = [], sources = [], tracks = [], timers = new Map();
  let now = 0, timerID = 0;
  const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; } });
  class Node {
    constructor() { this.gain = param(); this.pan = param(); this.playbackRate = param(); nodes.push(this); }
    connect(target) { return target; }
    disconnect() {}
  }
  class AudioContext {
    state = 'running'; currentTime = 0; sampleRate = 44100; destination = new Node();
    createGain() { return new Node(); }
    createDynamicsCompressor() { const n = new Node(); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[key] = param(); return n; }
    createStereoPanner() { return new Node(); }
    createMediaElementSource() { return new Node(); }
    createBufferSource() { const n = new Node(); n.start = () => sources.push(n); n.stop = () => n.onended?.(); return n; }
    createBuffer(channels, length, sampleRate) { const data = new Float32Array(length); return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data }; }
    decodeAudioData() { return Promise.resolve(this.createBuffer(1, 20, 22050)); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const elements = new Map();
  const context = vm.createContext({
    console, Float32Array, Map, Set, Math, Number, Promise, AbortSignal, AbortController,
    performance: { now: () => now },
    window: { AudioContext },
    document: { hidden: false, createElement() {
      const track = { paused: true, playCalls: 0, error: null,
        addEventListener() {}, pause() { this.paused = true; },
        play() { this.playCalls++; if (failPlay) return Promise.reject(new Error('autoplay blocked')); this.paused = false; return Promise.resolve(); }
      };
      tracks.push(track); return track;
    } },
    $: id => { if (!elements.has(id)) elements.set(id, { textContent: '', setAttribute() {} }); return elements.get(id); },
    fetch: () => new Promise(() => {}),
    setTimeout: (fn, delay) => { timers.set(++timerID, { fn, delay }); return timerID; },
    clearTimeout: id => timers.delete(id),
    settings: { vol: .85, sfx: .9, music: .25, alerts: true },
    state: { phase: 'fight', paused: false, round: 1, roundKey: 1, duelMatch: 0, winner: -1, p: [{ x: 0, z: 0, hp: 100, maxHp: 100, en: 0, air: 0, active: true }, { x: 3, z: 0, hp: 100, maxHp: 100, en: 0, air: 0, active: true }] },
    mode: 'bot', localSlot: 0, view: { yaw: 0 }, spitHold: null,
    publicRoom: { frames: [], id: 1 }, roomCanFight: () => true,
    toast() {}, clamp: (v, min, max) => Math.min(max, Math.max(min, v))
  });
  vm.runInContext(files + '\n' + synth + '\n' + audioCode, context);
  const run = code => vm.runInContext(code, context);
  return { run, nodes, sources, tracks, timers, elements, setNow: t => { now = t; } };
}

test('practice, host and guest select alternating fight music; waiting uses meadow', () => {
  const h = harness(); h.run('unlockAudio()');
  for (const mode of ['bot', 'host', 'guest']) {
    h.run(`mode = '${mode}'; state.round = 1`);
    assert.equal(h.run('selectMusic()'), 'fight-music-1');
    h.run('state.round = 2'); assert.equal(h.run('selectMusic()'), 'fight-music-2');
  }
  h.run("state.phase = 'waiting'"); assert.equal(h.run('selectMusic()'), 'meadow-music');
});

test('combat is audible immediately while downloaded samples are pending', () => {
  const h = harness(); h.run('unlockAudio(); playSound("smack", 0, 0)');
  assert.equal(h.sources.length, 1);
  assert.ok(h.sources[0].buffer.duration > 0);
});

test('missing or invalid round numbers never select an undefined track', () => {
  const h = harness(); h.run('unlockAudio()');
  for (const value of ['0', 'undefined', 'NaN', '-3']) {
    h.run(`state.round = ${value}`); assert.equal(h.run('selectMusic()'), 'fight-music-1');
  }
});

test('blocked music retries without requiring a mode change or extra gesture', async () => {
  const h = harness({ failPlay: true }); h.run('unlockAudio()'); await settle();
  const selected = h.tracks[1], attempts = selected.playCalls;
  h.setNow(4000); h.run('audioFrame()'); await settle();
  assert.ok(selected.playCalls > attempts);
  const retried = selected.playCalls;
  h.setNow(4010); h.run('audioFrame()'); await settle();
  assert.equal(selected.playCalls, retried, 'retries are bounded, not every frame');
});

test('muted, hidden and saturated effects do not start voices', () => {
  const h = harness(); h.run('unlockAudio(); settings.vol = 0; playSound("smack")');
  h.run('settings.vol = 1; settings.sfx = 0; playSound("smack")');
  h.run('settings.sfx = 1; document.hidden = true; playSound("smack")');
  h.run('document.hidden = false; audio.voices = 24; playSound("smack")');
  assert.equal(h.sources.length, 0);
});

test('jump, full charge, Nova ready and low health each cue once per transition', () => {
  const h = harness(); h.run('unlockAudio(); audioFrame()');
  const start = h.sources.length;
  h.run('state.p[0].air = .3'); h.setNow(200); h.run('audioFrame()');
  h.run('state.p[0].en = 100'); h.setNow(400); h.run('audioFrame()');
  h.run('state.p[0].hp = 20'); h.setNow(600); h.run('audioFrame()');
  h.run('spitHold = 0'); h.setNow(1000); h.run('audioFrame()');
  assert.equal(h.sources.length - start, 4);
  h.setNow(1200); h.run('audioFrame()');
  assert.equal(h.sources.length - start, 4);
});

test('round result stingers are once-only and use the local guest perspective', () => {
  const h = harness(); h.run('unlockAudio(); audioFrame(); localSlot = 1; state.phase = "over"; state.winner = 1');
  h.setNow(200); h.run('audioFrame()');
  const count = h.sources.length;
  assert.ok(count > 0);
  assert.equal(h.sources.at(-1).buffer, h.run('audio.generated.get("victory")'));
  h.setNow(400); h.run('audioFrame()'); assert.equal(h.sources.length, count);
});

test('procedural cues are finite, short, quiet at boundaries and within peak budget', () => {
  const h = harness(); h.run('unlockAudio()');
  assert.equal(h.run('audio.generated.size'), 0, 'no synthesis work before a cue is requested');
  const buffers = h.run('[...SlimoAudioSynth.createBuffers(audio.ctx).values()]');
  assert.ok(buffers.length >= 20);
  for (const b of buffers) {
    assert.ok(b.duration > 0 && b.duration < 1);
    const samples = b.getChannelData(0);
    assert.equal(samples[0], 0);
    assert.ok(Math.abs(samples.at(-1)) < .01);
    assert.ok(samples.some(v => Math.abs(v) > .02));
    assert.ok(samples.every(v => Number.isFinite(v) && Math.abs(v) <= .851));
  }
});

test('global countdown cues remain centered far from the arena origin', () => {
  const h = harness(); h.run('unlockAudio(); state.p[0].x = 80; state.p[0].z = 80; playSound("tick")');
  assert.equal(h.sources.length, 1);
  assert.equal(h.nodes.at(-1).pan.value, 0);
  assert.equal(h.nodes.at(-2).gain.value, .38);
});

test('old source completion cannot decrement the replacement audio context', () => {
  const h = harness(); h.run('unlockAudio(); playSound("smack")');
  const oldSource = h.sources[0];
  h.run('audio.ctx.state = "closed"; unlockAudio(); playSound("smack")');
  assert.equal(h.run('audio.voices'), 1);
  oldSource.onended(); oldSource.onended();
  assert.equal(h.run('audio.voices'), 1);
  h.sources[1].onended(); assert.equal(h.run('audio.voices'), 0);
});

test('voice capacity is released when a source finishes', () => {
  const h = harness(); h.run('unlockAudio(); for(let i=0;i<25;i++) playSound("smack")');
  assert.equal(h.sources.length, 24);
  h.sources[0].onended(); h.run('playSound("smack")');
  assert.equal(h.sources.length, 25);
  assert.equal(h.run('audio.voices'), 24);
});

test('optional alerts can be disabled while jump feedback remains', () => {
  const h = harness(); h.run('unlockAudio(); audioFrame(); settings.alerts = false; state.p[0].en = 100; state.p[0].hp = 10; spitHold = 0; state.p[0].air = .3');
  h.setNow(1000); h.run('audioFrame()'); assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].buffer, h.run('audio.generated.get("jump")'));
});

test('spatial effects outside Meadow hearing range are discarded', () => {
  const h = harness(); h.run('unlockAudio(); mode = "public"; playSound("smack", 80, 0)');
  assert.equal(h.sources.length, 0);
});

test('an old fade-out timer cannot pause a track selected again', async () => {
  const h = harness(); h.run('unlockAudio()'); await settle();
  h.run('const currentTrack = audio.tracks.get(audio.selection); mixTrack(currentTrack, 0, 0)');
  const staleTimer = [...h.timers.values()].find(t => t.delay === 1000);
  h.run('mixTrack(currentTrack, 1, 0)'); await settle();
  staleTimer.fn();
  assert.equal(h.tracks[1].paused, false);
});

test('launching a stunned slime does not play a jump cue', () => {
  const h = harness(); h.run('unlockAudio(); audioFrame(); state.p[0].air = .3; state.p[0].stun = .4');
  h.setNow(200); h.run('audioFrame()'); assert.equal(h.sources.length, 0);
});

test('public-room music scans run at most ten times per second', () => {
  const h = harness();
  h.run('unlockAudio(); mode = "public"; let scans = 0; ringHasRival = () => { scans++; return false; }');
  for (let frame = 0; frame < 600; frame++) { h.setNow(frame * (1000 / 60)); h.run('audioFrame()'); }
  assert.ok(h.run('scans') <= 100);
  assert.ok(h.run('scans') >= 80, 'music decisions still run regularly');
});
