'use strict';

// Original Slimo cues, synthesized locally. No audio service, download or key.
// Short envelopes and conservative peaks leave headroom for layered impacts.
const SlimoAudioSynth = (() => {
  const note = (hz, duration, delay = 0, end = hz, gain = .35, noise = 0) =>
    ({ hz, duration, delay, end, gain, noise });
  const definitions = {
    jump: [note(175, .20, 0, 490, .40), note(85, .12, 0, 58, .20, .20)],
    chargeSpit: [note(180, .35, 0, 660, .25, .06)],
    chargeNova: [note(90, .55, 0, 390, .32), note(185, .55, 0, 780, .15)],
    charged: [note(660, .12), note(990, .20, .10, 1100, .25)],
    ready: [note(392, .13), note(523.25, .13, .10), note(783.99, .26, .20)],
    victory: [note(392, .16), note(523.25, .16, .13), note(659.25, .16, .26), note(783.99, .38, .39)],
    defeat: [note(330, .20, 0, 294), note(261.63, .22, .17, 220), note(196, .36, .36, 147, .30)],
    draw: [note(392, .18), note(392, .18, .22)],
    lowHealth: [note(130, .12, 0, 98, .25), note(130, .12, .18, 98, .21)],
    heal: [note(420, .16, 0, 650, .28), note(650, .22, .11, 900, .22)],
    ui: [note(550, .065, 0, 780, .22)],
    back: [note(440, .09, 0, 290, .18)],
    spawn: [note(220, .32, 0, 660, .28), note(440, .26, .11, 880, .18)],
    combo: [note(210, .16, 0, 65, .38, .25), note(780, .10, .04, 1100, .15)],
    slap: [note(270, .12, 0, 105, .25, .7)],
    smack: [note(140, .15, 0, 42, .50, .60)],
    spit: [note(210, .16, 0, 115, .35, .30)],
    splat: [note(125, .20, 0, 48, .40, .65)],
    dash: [note(480, .15, 0, 140, .25, .7)],
    perfect: [note(660, .13), note(990, .20, .07, 1320, .25)],
    nova: [note(100, .46, 0, 32, .50, .55), note(220, .30, 0, 60, .18)],
    ko: [note(155, .40, 0, 38, .50, .45)],
    bounce: [note(125, .15, 0, 48, .35, .25)],
    upgrade: [note(440, .12), note(660, .12, .09), note(880, .25, .18)],
    start: [note(330, .12), note(440, .12, .09), note(660, .24, .18)],
    tick: [note(630, .07, 0, 480, .24)]
  };
  function createBuffers(ctx, names = Object.keys(definitions)) {
    const sampleRate = 22050;
    const buffers = new Map();
    for (const name of names) {
      const notes = definitions[name];
      const duration = Math.max(...notes.map(n => n.delay + n.duration));
      const buffer = ctx.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
      const samples = buffer.getChannelData(0);
      let seed = 7331;
      for (const n of notes) {
        let phase = 0;
        const offset = Math.round(n.delay * sampleRate);
        const count = Math.floor(n.duration * sampleRate);
        for (let i = 0; i < count && offset + i < samples.length; i++) {
          const t = i / sampleRate, progress = t / n.duration;
          phase += Math.PI * 2 * (n.hz + (n.end - n.hz) * progress) / sampleRate;
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const hiss = seed / 2147483648 - 1;
          const envelope = Math.min(1, t / .008) * Math.min(1, (n.duration - t) / .035) * (1 - progress) ** .65;
          const tone = Math.sin(phase) * .84 + Math.sin(phase * 2) * .16;
          samples[offset + i] += (tone * (1 - n.noise) + hiss * n.noise) * envelope * n.gain;
        }
      }
      for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-.85, Math.min(.85, samples[i]));
      buffers.set(name, buffer);
    }
    return buffers;
  }
  function createBank(ctx) {
    // Generate only the cue being heard. Keep first-touch work and memory small.
    return new class extends Map {
      get(name) {
        if (!this.has(name) && Object.hasOwn(definitions, name)) this.set(name, createBuffers(ctx, [name]).get(name));
        return super.get(name);
      }
    }();
  }
  return Object.freeze({ createBuffers, createBank });
})();
