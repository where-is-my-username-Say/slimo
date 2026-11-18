/**
 * I AM ATOMIC — cinematic edition.
 *
 * Edit ATOMIC_CONFIG to retune the look. Colors are hexadecimal 0xRRGGBB.
 * Timeline values are fractions of durationSeconds and must stay in order.
 *
 * SEQUENCE (16 s by default)
 *   0.0 – 5.5 s  CHARGE     Ground + aerial arcane seals spin up, mana threads and
 *                           particle streams spiral into a pulsing black-violet core.
 *   5.5 – 8.2 s  IMPLOSION  Seals, threads and particles compress toward the caster;
 *                           the core shrinks into a razor-sharp lavender-white point.
 *   8.2 – 8.45 s DETONATION Blinding flash, light pillar, energy dome, staggered
 *                           ground shockwaves, embers and shards.
 *   8.45 – 16 s  AFTERMATH  Embers rise, shards drift, motes linger, then everything fades.
 *
 * Everything is procedural: canvas textures (runes, sprites) + GLSL shaders.
 * No external assets. Canvas textures are shared between simultaneous casts
 * (reference counted) and disposed when the last effect is cleared.
 *
 * The game supplies: T (Three.js), scene, mode, settings, publicRoom, fighters,
 * smooth, publicPose, interpolatePublic, renderedPose.
 */
'use strict';

const ATOMIC_CONFIG = {
  durationSeconds: 16,

  colors: {
    abyss: 0x2a0845,     // deep abyssal purple
    violet: 0x9a54ff,    // royal violet
    magenta: 0xd946ef,   // electric magenta
    white: 0xf5ebff,     // blinding lavender-white
    void: 0x07000f,      // body of the singularity
    seal: 0x9a54ff,      // ground outer seal tint
    inner: 0xecd8ff,     // central sigil tint
    wave: 0xc878ff,      // shockwave tint
    sparks: 0xdba9ff,    // particle highlight
    arc: 0xb47aff        // orbiting electric arcs
  },

  timeline: {
    chargeEnd: 5.5 / 16,    // charge complete, implosion begins
    burstStart: 8.2 / 16,   // detonation
    burstEnd: 8.45 / 16,    // end of the flash ramp
    fadeStart: 12 / 16      // global fade-out begins
  },

  detail: {
    ringSegments: 64,       // segments for circular meshes
    orbitPoints: 49,        // points per electric orbit
    tendrils: 16,           // mana threads
    tendrilPoints: 30,      // points per thread
    inflowParticles: 260,   // particles streaming into the core
    emberParticles: 300,    // post-blast embers
    moteParticles: 120,     // lingering atmospheric motes
    shards: 28,             // floating energy shards (instanced)
    shockwaves: 4,          // staggered ground rings
    domes: 2,               // nested energy domes
    pillarSegments: 48,
    textureSize: 512,       // procedural seal texture resolution
    reduced: {              // applied when settings.reduced is true
      particles: .35,       // multiplier for all particle counts
      tendrils: .5,
      shards: .35,
      shockwaves: 2,
      domes: 1,
      aerialSeals: false,
      pillarSegments: 24,
      textureSize: 256
    }
  },

  shape: {
    sealRadius: 2.7,        // outer ground seal
    innerRadius: 2.05,      // hexagram layer
    bandRadius: 1.5,        // counter-rotating rune band
    sigilRadius: .85,       // central sigil
    aerialRadius: 2.0,      // floating seal above the caster
    aerialY: 3.4,
    coreHeight: 1.0,        // height of the singularity
    coreRadius: .46,
    inflowReach: 4.4,       // how far out threads/particles start
    arcRadius: 1.18,
    sparkSize: .085,        // base inflow particle size (world units)
    pillarRadius: 1.05,
    pillarHeight: 60,
    domeRadius: 7.5,
    waveMaxRadius: 12,
    waveDuration: 2.6,
    waveStagger: .24,
    waveExpansion: 1        // multiplier on shockwave travel distance
  },

  opacity: {
    seal: .8, inner: .7, wave: .8, sparks: .85, arc: .7,
    core: 1, tendril: .75, pillar: .9, dome: .85,
    embers: .95, shards: .85, motes: .7, flash: 1, impact: .9
  },

  motion: {
    sealSpin: .12, innerSpin: -.26, bandSpin: .42, sigilSpin: -.9, aerialSpin: .3,
    implodeSpinBoost: 3,    // seals spin faster during implosion
    arcSpeed: .55,
    sparkSpeed: 1           // inflow particle speed multiplier
  },

  reducedIntensity: .55
};

const atomicEffects = new Map();

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const atomicClamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const atomicEaseOut = x => 1 - Math.pow(1 - atomicClamp(x), 3);

// Deterministic PRNG so every cast and every texture looks the same.
function atomicRng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Color for ShaderMaterial uniforms: raw sRGB bytes, no color-management conversion
// (custom shaders here do not apply an output transform).
function atomicRaw(hex) {
  const c = new T.Color();
  c.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  return c;
}

// Vertex colors on built-in materials go through output conversion on new Three.js.
function atomicMatColor(v) {
  return (T.ColorManagement && T.ColorManagement.enabled) ? Math.pow(v, 2.2) : v;
}

/* ------------------------------------------------------------------ */
/* Procedural textures (canvas)                                        */
/* ------------------------------------------------------------------ */

function atomicGlowTexture(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.15, 'rgba(255,255,255,.75)');
  grad.addColorStop(.4, 'rgba(255,255,255,.22)');
  grad.addColorStop(.7, 'rgba(255,255,255,.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new T.CanvasTexture(c);
}

// Draws a white-on-transparent arcane seal layer. Tinted later by the material color.
// kind: 'outer' (runes + borders), 'geo' (hexagram), 'band' (rune band), 'sigil' (core glyph)
function atomicSealTexture(kind, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), R = size / 2, TAU = Math.PI * 2;
  g.translate(R, R);
  g.scale(R, R);                       // draw in unit-radius coordinates
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(255,255,255,.9)';
  g.shadowBlur = size * .008;
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = h * 131 + kind.charCodeAt(i);
  const rnd = atomicRng(h + 17);

  const circle = (r, w, a = 1) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
  const arcSeg = (r, w, a0, a1, a = 1) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke(); };
  const ticks = (r0, r1, n, w, a = 1, off = 0) => {
    g.globalAlpha = a; g.lineWidth = w; g.beginPath();
    for (let i = 0; i < n; i++) {
      const t = (i + off) / n * TAU, cs = Math.cos(t), sn = Math.sin(t);
      g.moveTo(cs * r0, sn * r0); g.lineTo(cs * r1, sn * r1);
    }
    g.stroke();
  };
  // Regular polygon or star polygon {n/skip}.
  const poly = (n, r, rot, w, a = 1, skip = 1) => {
    g.globalAlpha = a; g.lineWidth = w; g.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = rot + i * skip / n * TAU, x = Math.cos(t) * r, y = Math.sin(t) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  };
  const dots = (r, n, d, w, rot = 0, a = 1) => {
    g.globalAlpha = a; g.lineWidth = w; g.beginPath();
    for (let i = 0; i < n; i++) {
      const t = rot + i / n * TAU, x = Math.cos(t) * r, y = Math.sin(t) * r;
      g.moveTo(x + d, y); g.arc(x, y, d, 0, TAU);
    }
    g.stroke();
  };
  // One invented rune: a stem, a few cross-strokes on a 3x4 grid, sometimes a ring.
  const glyph = s => {
    const gx = [-.3, 0, .3], gy = [-.5, -.17, .17, .5];
    g.beginPath();
    const stem = gx[Math.floor(rnd() * 3)] * s;
    g.moveTo(stem, -.5 * s); g.lineTo(stem, .5 * s);
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      g.moveTo(gx[Math.floor(rnd() * 3)] * s, gy[Math.floor(rnd() * 4)] * s);
      g.lineTo(gx[Math.floor(rnd() * 3)] * s, gy[Math.floor(rnd() * 4)] * s);
    }
    if (rnd() < .35) {
      const x = gx[Math.floor(rnd() * 3)] * s, y = gy[Math.floor(rnd() * 4)] * s, d = .07 * s;
      g.moveTo(x + d, y); g.arc(x, y, d, 0, TAU);
    }
    g.stroke();
  };
  const glyphRing = (rIn, rOut, n, w, a = 1) => {
    g.globalAlpha = a; g.lineWidth = w;
    for (let i = 0; i < n; i++) {
      g.save();
      g.rotate(i / n * TAU);
      g.translate(0, -(rIn + rOut) / 2);
      glyph((rOut - rIn) * .78);
      g.restore();
    }
  };

  if (kind === 'outer') {
    circle(.975, .014); circle(.94, .006, .75);
    ticks(.94, .975, 144, .0035, .8);
    circle(.74, .01, .95); circle(.72, .004, .6);
    glyphRing(.755, .915, 40, .0075, .95);
    ticks(.745, .93, 40, .003, .35, .5);
    dots(.6, 8, .03, .006, 0, .7);
    for (let i = 0; i < 4; i++) arcSeg(.6, .008, i * Math.PI / 2 + .25, i * Math.PI / 2 + 1.3, .5);
  } else if (kind === 'geo') {
    circle(.97, .012); circle(.93, .005, .6);
    ticks(.93, .97, 60, .003, .6);
    poly(3, .92, -Math.PI / 2, .01, .95);
    poly(3, .92, Math.PI / 2, .01, .95);
    circle(.46, .01, .9); poly(6, .46, 0, .006, .7);
    dots(.92, 6, .045, .008, -Math.PI / 2);
    ticks(.46, .92, 12, .004, .25, .5);
    circle(.2, .008, .8); poly(5, .2, -Math.PI / 2, .006, .7, 2);
  } else if (kind === 'band') {
    circle(.97, .01, .9); circle(.62, .01, .9); circle(.8, .005, .55);
    for (let i = 0; i < 8; i++) arcSeg(.7, .03, i * Math.PI / 4 + .08, i * Math.PI / 4 + .62, .45);
    glyphRing(.84, .95, 32, .0065, .9);
    ticks(.62, .66, 72, .003, .7);
  } else { // sigil
    circle(.95, .02); circle(.78, .01, .8);
    poly(4, .78, Math.PI / 4, .015, .9); poly(4, .78, 0, .015, .7);
    circle(.4, .02, .95); poly(3, .4, -Math.PI / 2, .012, .8);
    ticks(.4, .78, 16, .01, .5);
    dots(.78, 8, .05, .014);
  }

  const tex = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

// Textures are shared by every active cast and released when the last one ends.
const atomicAssets = { refs: 0, tex: null };

function acquireAtomicTextures(size) {
  if (!atomicAssets.tex) {
    atomicAssets.tex = {
      outer: atomicSealTexture('outer', size),
      geo: atomicSealTexture('geo', size),
      band: atomicSealTexture('band', size),
      sigil: atomicSealTexture('sigil', size),
      glow: atomicGlowTexture(128)
    };
  }
  atomicAssets.refs++;
  return atomicAssets.tex;
}

function releaseAtomicTextures() {
  if (atomicAssets.refs > 0 && --atomicAssets.refs === 0 && atomicAssets.tex) {
    Object.values(atomicAssets.tex).forEach(t => t.dispose());
    atomicAssets.tex = null;
  }
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const ATOMIC_GLSL_NOISE = `
float h31(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);
}`;

// Unstable singularity shell: noise-displaced vertices, fresnel rim, heats toward white.
const ATOMIC_CORE_VS = `
uniform float uTime, uUnrest;
varying vec3 vN; varying vec3 vV; varying float vNoise;
${ATOMIC_GLSL_NOISE}
void main(){
  float n=vnoise(normal*2.4+vec3(0.,uTime*1.7,uTime*.8));
  float n2=vnoise(normal*5.+vec3(uTime*2.3,0.,uTime*1.1));
  vNoise=n*.65+n2*.35;
  vec3 p=position*(1.+(vNoise-.5)*uUnrest*1.4);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  vN=normalize(normalMatrix*normal);
  vV=normalize(-mv.xyz);
  gl_Position=projectionMatrix*mv;
}`;
const ATOMIC_CORE_FS = `
uniform vec3 uColA, uColB, uColC; uniform float uOpacity, uHeat;
varying vec3 vN; varying vec3 vV; varying float vNoise;
void main(){
  float f=1.-abs(dot(normalize(vN),normalize(vV)));
  float rim=pow(f,2.);
  vec3 c=mix(uColA,uColB,clamp(rim*1.2+vNoise*.5,0.,1.));
  c=mix(c,uColC,uHeat*(.35+.65*rim));
  float a=(rim*.95+.12+vNoise*.18)*uOpacity;
  gl_FragColor=vec4(c*(1.+rim),a);
}`;

// Pillar of light: alpha falls off toward the silhouette (fresnel), streaks flow upward.
const ATOMIC_PILLAR_VS = `
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  vUv=uv;
  vec4 mv=modelViewMatrix*vec4(position,1.);
  vN=normalize(normalMatrix*normal);
  vV=normalize(-mv.xyz);
  gl_Position=projectionMatrix*mv;
}`;
const ATOMIC_PILLAR_FS = `
uniform float uTime, uOpacity, uPower; uniform vec3 uColA, uColB;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  float ndv=abs(dot(normalize(vN),normalize(vV)));
  float body=pow(ndv,uPower);
  float h=vUv.y;
  float streak=.7+.3*sin(vUv.x*37.699+uTime*2.+sin(h*18.-uTime*8.)*2.2);
  float flow=.82+.18*sin(h*90.-uTime*22.);
  float vert=smoothstep(0.,.015,h)*(1.-smoothstep(.45,1.,h));
  float a=body*streak*flow*(.35+.65*vert)*(1.-smoothstep(.7,1.,h));
  vec3 c=mix(uColA,uColB,pow(ndv,uPower*2.));
  gl_FragColor=vec4(c*(.9+.6*body),a*uOpacity);
}`;

// Hemispherical dome: glowing rim, warped energy bands, faint cell pattern.
const ATOMIC_DOME_VS = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vP=position;
  vec4 mv=modelViewMatrix*vec4(position,1.);
  vN=normalize(normalMatrix*normal);
  vV=normalize(-mv.xyz);
  gl_Position=projectionMatrix*mv;
}`;
const ATOMIC_DOME_FS = `
uniform float uTime, uOpacity; uniform vec3 uColA, uColB, uColC;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
${ATOMIC_GLSL_NOISE}
void main(){
  float ndv=abs(dot(normalize(vN),normalize(vV)));
  float rim=pow(1.-ndv,2.3);
  float lat=clamp(vP.y,0.,1.);
  float warp=vnoise(vP*4.+vec3(0.,uTime*1.2,0.));
  float bands=.5+.5*sin(lat*30.-uTime*8.+warp*5.);
  float ang=atan(vP.z,vP.x);
  float cells=smoothstep(.96,1.,sin(ang*20.+warp*3.)*sin(lat*16.));
  float a=rim*(.9+.4*bands)+.05+bands*.05*(1.-lat)+cells*.18;
  vec3 c=mix(uColA,uColB,clamp(rim+lat*.3,0.,1.));
  c=mix(c,uColC,rim*rim*.7);
  gl_FragColor=vec4(c,clamp(a,0.,1.)*uOpacity);
}`;

// Ground shockwave: a disc whose bright, distorted leading edge sits at local r = 1.
const ATOMIC_SHOCK_VS = `
varying vec2 vP;
void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const ATOMIC_SHOCK_FS = `
uniform float uTime, uOpacity, uWidth, uSeed; uniform vec3 uColA, uColB;
varying vec2 vP;
void main(){
  float ang=atan(vP.y,vP.x);
  float wob=.018*sin(ang*7.+uSeed+uTime*4.)+.012*sin(ang*17.-uTime*6.+uSeed*2.);
  float r=length(vP)+wob;
  float band=clamp((r-(1.-uWidth))/uWidth,0.,1.);
  float a=pow(band,2.6)*(1.-smoothstep(.97,1.,r));
  float hot=pow(band,9.);
  gl_FragColor=vec4(mix(uColA,uColB,hot)*(1.+hot),a*uOpacity);
}`;

// Particles: every point is animated on the GPU from a per-point random seed.
const ATOMIC_POINT_FS = `
uniform sampler2D uMap; varying float vA; varying vec3 vC;
void main(){ float m=texture2D(uMap,gl_PointCoord).a; gl_FragColor=vec4(vC,m*vA); }`;

// Charge: particles spiral inward toward the core; the spiral tightens on implosion.
const ATOMIC_INFLOW_VS = `
attribute vec4 aSeed;
uniform float uTime, uCharge, uImplode, uOpacity, uPx, uCoreY, uReach, uSize, uSpeed;
uniform vec3 uColA, uColB;
varying float vA; varying vec3 vC;
void main(){
  float rate=(.10+aSeed.x*.10)*uSpeed;
  float t=fract(aSeed.y+uTime*rate*(1.+uCharge*1.8+uImplode*3.));
  float reach=mix(uReach,uReach*.28,uImplode);
  float r=reach*pow(1.-t,1.55)+.06;
  float ang=aSeed.z*6.2831+t*(2.4+aSeed.w*3.2)*(1.+uImplode*1.5)+uTime*.35;
  float y=uCoreY+(aSeed.w-.5)*3.2*pow(1.-t,1.3)*(1.-uImplode*.6)+sin(uTime*2.+aSeed.x*30.)*.05;
  vec4 mv=modelViewMatrix*vec4(cos(ang)*r,y,sin(ang)*r,1.);
  float life=smoothstep(0.,.1,t)*(1.-smoothstep(.96,1.,t));
  vA=life*(.25+.75*t)*uOpacity;
  vC=mix(uColA,uColB,t);
  gl_PointSize=uSize*(.6+aSeed.x)*(.7+t*.9)*uPx/max(-mv.z,.1);
  gl_Position=projectionMatrix*mv;
}`;

// Aftermath embers: staggered launch, outward spread, slow rise, flicker, cooling color.
const ATOMIC_EMBER_VS = `
attribute vec4 aSeed;
uniform float uTime, uSince, uOpacity, uPx;
uniform vec3 uColA, uColB;
varying float vA; varying vec3 vC;
void main(){
  float local=uSince-aSeed.x*.8;
  float on=step(0.,local);
  local=max(local,0.);
  float ang=aSeed.y*6.2831+local*.25*(aSeed.w-.5);
  float spread=(.8+aSeed.z*3.6)*(1.-exp(-local*1.1));
  float rise=(1.6+aSeed.w*8.)*(1.-exp(-local*.45));
  vec3 p=vec3(cos(ang)*spread,.1+rise+sin(local*3.+aSeed.x*40.)*.08,sin(ang)*spread);
  p.x+=sin(local*1.7+aSeed.z*20.)*.25;
  p.z+=cos(local*1.3+aSeed.y*20.)*.25;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  float flick=.6+.4*sin(local*14.+aSeed.x*50.);
  vA=on*smoothstep(0.,.12,local)*exp(-local*(.12+aSeed.z*.1))*flick*uOpacity;
  vC=mix(uColA,uColB,exp(-local*.6));
  gl_PointSize=(.04+.06*aSeed.w)*(1.+exp(-local)*1.5)*uPx/max(-mv.z,.1);
  gl_Position=projectionMatrix*mv;
}`;

// Lingering motes: slow drifting twinkling dust in a column around the caster.
const ATOMIC_MOTE_VS = `
attribute vec4 aSeed;
uniform float uTime, uOpacity, uPx, uRange;
uniform vec3 uColA, uColB;
varying float vA; varying vec3 vC;
void main(){
  float r=sqrt(aSeed.y)*uRange;
  float a=aSeed.w*6.2831+uTime*.03*(aSeed.x-.5);
  float y=mod(aSeed.z*6.5+uTime*(.12+.18*aSeed.x),6.5);
  vec3 p=vec3(cos(a)*r+sin(uTime*.5+aSeed.x*40.)*.35,y,sin(a)*r+cos(uTime*.4+aSeed.y*40.)*.35);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  float tw=.55+.45*sin(uTime*(1.2+aSeed.x*2.5)+aSeed.z*50.);
  vA=tw*uOpacity*smoothstep(0.,.4,y)*(1.-smoothstep(4.8,6.5,y));
  vC=mix(uColA,uColB,aSeed.x);
  gl_PointSize=(.035+.05*aSeed.x)*uPx/max(-mv.z,.1);
  gl_Position=projectionMatrix*mv;
}`;

function atomicShaderMat(vs, fs, uniforms, extra) {
  return new T.ShaderMaterial(Object.assign({
    uniforms, vertexShader: vs, fragmentShader: fs,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending
  }, extra || {}));
}

function atomicPointGeometry(count, seed) {
  const rnd = atomicRng(seed);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3)); // required for draw count
  geo.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
  return geo;
}

// Mana-thread color along its length: faint dark violet at the rim, hot near the core.
function atomicTendrilColor(s, out, o) {
  const b = atomicClamp(s / .15) * (.1 + .9 * Math.pow(s, 1.5));
  const m = atomicClamp(s * 1.25), w = atomicClamp((s - .8) / .2);
  let r = .30 + .55 * m, g = .08 + .19 * m, bl = .55 + .39 * m;
  r += (.96 - r) * w; g += (.92 - g) * w; bl += (1 - bl) * w;
  out[o] = atomicMatColor(r * b); out[o + 1] = atomicMatColor(g * b); out[o + 2] = atomicMatColor(bl * b);
}

/* ------------------------------------------------------------------ */
/* Effect construction                                                 */
/* ------------------------------------------------------------------ */

function makeAtomicEffect(reduced) {
  const C = ATOMIC_CONFIG, D = C.detail, S = C.shape, K = C.colors, RD = D.reduced;
  const count = n => Math.max(6, Math.round(n * (reduced ? RD.particles : 1)));
  const tex = acquireAtomicTextures(reduced ? RD.textureSize : D.textureSize);
  const group = new T.Group();
  const raw = {
    abyss: atomicRaw(K.abyss), violet: atomicRaw(K.violet),
    magenta: atomicRaw(K.magenta), white: atomicRaw(K.white)
  };
  const place = (obj, order, parent) => { obj.renderOrder = order; (parent || group).add(obj); return obj; };

  // ---- Arcane seals (planes with procedural rune textures, spun via local z) ----
  const sealPlane = (parent, map, hex, radius, y, order) => {
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
      map, color: hex, transparent: true, opacity: 0, depthWrite: false,
      side: T.DoubleSide, blending: T.AdditiveBlending
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.scale.setScalar(radius);
    return place(m, order, parent);
  };
  const gOuter = sealPlane(group, tex.outer, K.seal, S.sealRadius, .04, 1);
  const gGeo = sealPlane(group, tex.geo, K.magenta, S.innerRadius, .05, 1);
  const gBand = sealPlane(group, tex.band, K.violet, S.bandRadius, .06, 1);
  const gSigil = sealPlane(group, tex.sigil, K.inner, S.sigilRadius, .07, 1);

  let aerial = null, aOuter = null, aGeo = null;
  if (!reduced || RD.aerialSeals) {
    aerial = place(new T.Group(), 1);
    aOuter = sealPlane(aerial, tex.outer, K.violet, S.aerialRadius, 0, 1);
    aGeo = sealPlane(aerial, tex.geo, K.magenta, S.aerialRadius * .66, .02, 1);
  }

  const impact = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
    map: tex.glow, color: K.white, transparent: true, opacity: 0, depthWrite: false,
    blending: T.AdditiveBlending
  }));
  impact.rotation.x = -Math.PI / 2;
  impact.position.y = .08;
  place(impact, 2);

  // ---- Mana threads (vertex-colored line segments, updated on CPU) ----
  const tN = Math.max(4, Math.round(D.tendrils * (reduced ? RD.tendrils : 1)));
  const tP = D.tendrilPoints;
  const tPos = new Float32Array(tN * (tP - 1) * 6);
  const tCol = new Float32Array(tN * (tP - 1) * 6);
  const trnd = atomicRng(1234), tData = [];
  for (let i = 0; i < tN; i++) {
    tData.push({
      a: (i + trnd() * .7) / tN * Math.PI * 2,
      swirl: 1.6 + trnd() * 1.6,
      h: (trnd() - .5) * 3.4,
      w: trnd() * 6.28
    });
    for (let k = 0; k < tP - 1; k++) {
      const o = (i * (tP - 1) + k) * 6;
      atomicTendrilColor(k / (tP - 1), tCol, o);
      atomicTendrilColor((k + 1) / (tP - 1), tCol, o + 3);
    }
  }
  const tGeo = new T.BufferGeometry();
  tGeo.setAttribute('position', new T.BufferAttribute(tPos, 3).setUsage(T.DynamicDrawUsage));
  tGeo.setAttribute('color', new T.BufferAttribute(tCol, 3));
  const tendrils = new T.LineSegments(tGeo, new T.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending
  }));
  tendrils.frustumCulled = false;
  place(tendrils, 3);

  // ---- GPU particle systems ----
  const px = { value: 700 };   // shared pixel-scale uniform, refreshed every frame
  const map = { value: tex.glow };
  const inflowU = {
    uMap: map, uPx: px, uTime: { value: 0 }, uCharge: { value: 0 }, uImplode: { value: 0 },
    uOpacity: { value: 0 }, uCoreY: { value: S.coreHeight }, uReach: { value: S.inflowReach },
    uSize: { value: S.sparkSize }, uSpeed: { value: C.motion.sparkSpeed },
    uColA: { value: raw.magenta }, uColB: { value: atomicRaw(K.sparks) }
  };
  const inflow = new T.Points(atomicPointGeometry(count(D.inflowParticles), 11), atomicShaderMat(ATOMIC_INFLOW_VS, ATOMIC_POINT_FS, inflowU));
  inflow.frustumCulled = false;
  place(inflow, 3);

  const emberU = {
    uMap: map, uPx: px, uTime: { value: 0 }, uSince: { value: 0 }, uOpacity: { value: 0 },
    uColA: { value: raw.magenta }, uColB: { value: raw.white }
  };
  const embers = new T.Points(atomicPointGeometry(count(D.emberParticles), 23), atomicShaderMat(ATOMIC_EMBER_VS, ATOMIC_POINT_FS, emberU));
  embers.frustumCulled = false;
  place(embers, 3);

  const moteU = {
    uMap: map, uPx: px, uTime: { value: 0 }, uOpacity: { value: 0 }, uRange: { value: 5.5 },
    uColA: { value: raw.violet }, uColB: { value: atomicRaw(K.sparks) }
  };
  const motes = new T.Points(atomicPointGeometry(count(D.moteParticles), 37), atomicShaderMat(ATOMIC_MOTE_VS, ATOMIC_POINT_FS, moteU));
  motes.frustumCulled = false;
  place(motes, 3);

  // ---- Energy shards (instanced octahedra) ----
  const shardN = Math.max(4, Math.round(D.shards * (reduced ? RD.shards : 1)));
  const shards = new T.InstancedMesh(new T.OctahedronGeometry(1, 0), new T.MeshBasicMaterial({
    color: K.white, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending
  }), shardN);
  shards.frustumCulled = false;
  shards.visible = false;
  place(shards, 4);
  const srnd = atomicRng(77), shardData = [];
  for (let i = 0; i < shardN; i++) {
    shardData.push({
      a: srnd() * Math.PI * 2, delay: srnd() * .6, rad: 1.5 + srnd() * 5, rise: 1.4 + srnd() * 5,
      tx: (srnd() - .5) * 3, ty: (srnd() - .5) * 3, tz: (srnd() - .5) * 3, sz: .12 + srnd() * .18
    });
  }

  // ---- Shockwaves ----
  const shockGeo = new T.CircleGeometry(1.12, D.ringSegments);
  const shocks = [];
  const shockN = reduced ? RD.shockwaves : D.shockwaves;
  for (let i = 0; i < shockN; i++) {
    const mat = atomicShaderMat(ATOMIC_SHOCK_VS, ATOMIC_SHOCK_FS, {
      uTime: { value: 0 }, uOpacity: { value: 0 }, uWidth: { value: .16 + i * .05 }, uSeed: { value: i * 3.7 },
      uColA: { value: i % 2 ? raw.magenta : atomicRaw(K.wave) }, uColB: { value: raw.white }
    }, { side: T.DoubleSide });
    const mesh = new T.Mesh(shockGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = .09 + i * .005;
    mesh.visible = false;
    shocks.push(place(mesh, 4));
  }

  // ---- Energy domes ----
  const domeGeo = new T.SphereGeometry(1, reduced ? 24 : 48, reduced ? 12 : 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const domes = [];
  const domeN = reduced ? RD.domes : D.domes;
  for (let i = 0; i < domeN; i++) {
    const mesh = new T.Mesh(domeGeo, atomicShaderMat(ATOMIC_DOME_VS, ATOMIC_DOME_FS, {
      uTime: { value: 0 }, uOpacity: { value: 0 },
      uColA: { value: raw.violet }, uColB: { value: raw.magenta }, uColC: { value: raw.white }
    }, { side: T.DoubleSide }));
    mesh.position.y = .02;
    mesh.visible = false;
    domes.push(place(mesh, 5));
  }

  // ---- Pillar of light (violet shell + white-hot inner column) ----
  const pillarGeo = new T.CylinderGeometry(.82, 1, 1, reduced ? RD.pillarSegments : D.pillarSegments, 1, true);
  pillarGeo.translate(0, .5, 0);
  const pillarMat = (power, a, b) => atomicShaderMat(ATOMIC_PILLAR_VS, ATOMIC_PILLAR_FS, {
    uTime: { value: 0 }, uOpacity: { value: 0 }, uPower: { value: power }, uColA: { value: a }, uColB: { value: b }
  }, { side: T.DoubleSide });
  const pillar = place(new T.Mesh(pillarGeo, pillarMat(1.6, raw.violet, raw.white)), 6);
  const pillarCore = place(new T.Mesh(pillarGeo, pillarMat(2.4, raw.white, raw.white)), 7);
  pillar.visible = pillarCore.visible = false;

  // ---- Singularity: dark body + noisy fresnel shell + glow sprites + electric orbits ----
  const coreGroup = place(new T.Group(), 8);
  coreGroup.position.y = S.coreHeight;
  const coreDark = place(new T.Mesh(new T.SphereGeometry(1, reduced ? 20 : 32, reduced ? 14 : 24), new T.MeshBasicMaterial({
    color: K.void, transparent: true, opacity: 0, depthWrite: false
  })), 8, coreGroup);
  const coreShell = place(new T.Mesh(new T.SphereGeometry(1, reduced ? 24 : 40, reduced ? 16 : 28), atomicShaderMat(ATOMIC_CORE_VS, ATOMIC_CORE_FS, {
    uTime: { value: 0 }, uUnrest: { value: 0 }, uOpacity: { value: 0 }, uHeat: { value: 0 },
    uColA: { value: raw.abyss.clone().multiplyScalar(2.4) }, uColB: { value: raw.violet }, uColC: { value: raw.white }
  })), 10, coreGroup);

  const sprite = (hex, order, depthTest = true) => {
    const s = new T.Sprite(new T.SpriteMaterial({
      map: tex.glow, color: hex, transparent: true, opacity: 0, depthWrite: false, depthTest,
      blending: T.AdditiveBlending
    }));
    return place(s, order, coreGroup);
  };
  const glow = sprite(K.magenta, 11);
  const point = sprite(K.white, 12);
  const streak = sprite(K.white, 12);
  const flash = sprite(K.white, 13, false);

  const orbits = [];
  for (let k = 0; k < 3; k++) {
    const arr = new Float32Array(D.orbitPoints * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(arr, 3).setUsage(T.DynamicDrawUsage));
    const line = new T.Line(geo, new T.LineBasicMaterial({
      color: K.arc, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending
    }));
    line.frustumCulled = false;
    place(line, 9, coreGroup);
    orbits.push({ line, arr });
  }

  scene.add(group);
  return {
    group, reduced, px,
    gOuter, gGeo, gBand, gSigil, aerial, aOuter, aGeo, impact,
    tendrils, tPos, tTmp: new Float32Array(tP * 3), tData, tP,
    inflow, inflowU, embers, emberU, motes, moteU,
    shards, shardData, dummy: new T.Object3D(),
    shocks, domes, pillar, pillarCore,
    coreGroup, coreDark, coreShell, glow, point, streak, flash, orbits,
    cMag: new T.Color(K.magenta), cWhite: new T.Color(K.white), cTmp: new T.Color(),
    spin: [0, 0, 0, 0, 0, 0], last: 0, released: false
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

function startAtomic(caster) {
  if(mode==='lobby'||!Number.isInteger(caster))return;
  const key=mode+':'+caster;
  if(atomicEffects.has(key))return;
  atomicEffects.set(key,{
    ...makeAtomicEffect(settings.reduced),caster,mode,started:performance.now()
  });
}

function clearAtomicEffect(key, effect) {
  scene.remove(effect.group);
  effect.group.traverse(object=>{
    if(!object.isSprite)object.geometry?.dispose();   // sprites share one global quad
    object.material?.dispose();
    object.dispose?.();                               // InstancedMesh buffers
  });
  if(!effect.released){                               // shared canvas textures, ref-counted
    effect.released=true;
    releaseAtomicTextures();
  }
  atomicEffects.delete(key);
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

function animateAtomic(fx, age, I) {
  const C = ATOMIC_CONFIG, TL = C.timeline, O = C.opacity, M = C.motion, S = C.shape;
  const dur = C.durationSeconds, p = age / dur;

  // Phase drivers (all 0..1 unless noted)
  const charge = smooth(0, TL.chargeEnd, p);
  const implode = smooth(TL.chargeEnd, TL.burstStart, p);
  const burst = smooth(TL.burstStart, TL.burstEnd, p);
  const fade = 1 - smooth(TL.fadeStart, 1, p);
  const since = Math.max(0, age - TL.burstStart * dur);   // seconds since detonation
  const live = 1 - burst;                                  // pre-detonation things vanish with it
  const dt = atomicClamp(age - fx.last, 0, .1);
  fx.last = age;

  fx.px.value = Math.max(1, (window.innerHeight || 720) * .5 * (window.devicePixelRatio || 1));

  // ---- Seals: spin up, compress on implosion, rebound + bloom on detonation ----
  const boost = burst > 0 ? 1 + 2.5 * (1 - smooth(0, 2, since)) : 1 + charge * .8 + implode * M.implodeSpinBoost;
  const rates = [M.sealSpin, M.innerSpin, M.bandSpin, M.sigilSpin, M.aerialSpin, -M.aerialSpin * 1.7];
  for (let i = 0; i < 6; i++) fx.spin[i] += dt * rates[i] * boost;
  const sealLevel = (charge * (.7 + .3 * implode) * live +
    burst * (.5 + .8 * (1 - smooth(0, 1.4, since)))) * fade * I;
  const comp = 1 - implode * live * .55;
  const base = (.8 + charge * .2) * comp * (1 + atomicEaseOut(since / 2) * .16);
  const lay = (m, radius, k, op, spin) => {
    m.scale.setScalar(radius * base * k);
    m.rotation.z = spin;
    m.material.opacity = Math.min(1, op * sealLevel);
  };
  lay(fx.gOuter, S.sealRadius, 1, O.seal, fx.spin[0]);
  lay(fx.gGeo, S.innerRadius, 1 + .03 * Math.sin(age * 1.8), O.inner, fx.spin[1]);
  lay(fx.gBand, S.bandRadius, 1 + .02 * Math.sin(age * 2.3), O.seal * .9, fx.spin[2]);
  lay(fx.gSigil, S.sigilRadius, 1 + .06 * Math.sin(age * (2 + implode * 10)), O.inner * (1 + implode * .6), fx.spin[3]);

  if (fx.aerial) {
    const lvl = charge * live * fade * I;
    fx.aerial.visible = lvl > .003;
    if (fx.aerial.visible) {
      fx.aerial.position.y = S.aerialY + (S.coreHeight + .2 - S.aerialY) * Math.pow(implode, 1.5);
      fx.aerial.scale.setScalar((.9 + charge * .1) * (1 - implode * .72));
      fx.aOuter.rotation.z = fx.spin[4];
      fx.aGeo.rotation.z = fx.spin[5];
      fx.aOuter.material.opacity = Math.min(1, O.seal * lvl * .9);
      fx.aGeo.material.opacity = Math.min(1, O.inner * lvl);
    }
  }

  // ---- Mana threads ----
  {
    const lvl = O.tendril * charge * live * I * (1 + implode * .5);
    fx.tendrils.visible = lvl > .002;
    if (fx.tendrils.visible) {
      const reach = S.inflowReach * (.35 + .65 * charge) * (1 - implode * .7);
      const P = fx.tP, tmp = fx.tTmp, pos = fx.tPos, coreY = S.coreHeight;
      for (let i = 0; i < fx.tData.length; i++) {
        const d = fx.tData[i];
        for (let k = 0; k < P; k++) {
          const s = k / (P - 1), inv = 1 - s;
          const ang = d.a + s * d.swirl + age * .32 * (1 + implode * 2.2) + Math.sin(s * 9 + age * 1.6 + d.w) * .1 * inv;
          const rr = reach * Math.pow(inv, 1.6) + .12;
          tmp[k * 3] = Math.cos(ang) * rr;
          tmp[k * 3 + 1] = coreY + d.h * Math.pow(inv, 1.25) * (1 - implode * .5) + Math.sin(s * 7 + age * 1.7 + d.w) * .22 * inv;
          tmp[k * 3 + 2] = Math.sin(ang) * rr;
        }
        for (let k = 0; k < P - 1; k++) {
          const o = (i * (P - 1) + k) * 6;
          pos[o] = tmp[k * 3]; pos[o + 1] = tmp[k * 3 + 1]; pos[o + 2] = tmp[k * 3 + 2];
          pos[o + 3] = tmp[k * 3 + 3]; pos[o + 4] = tmp[k * 3 + 4]; pos[o + 5] = tmp[k * 3 + 5];
        }
      }
      fx.tendrils.geometry.attributes.position.needsUpdate = true;
      fx.tendrils.material.opacity = Math.min(1, lvl);
    }
  }

  // ---- Inflow particle streams (GPU) ----
  {
    const u = fx.inflowU, lvl = O.sparks * charge * live * I;
    fx.inflow.visible = lvl > .002;
    u.uTime.value = age; u.uCharge.value = charge; u.uImplode.value = implode; u.uOpacity.value = lvl;
  }

  // ---- Singularity ----
  {
    const r0 = S.coreRadius * (.25 + .75 * charge) * (1 - implode * .9);
    const pulse = 1 + Math.sin(age * (6 + implode * 34)) * (.05 + .05 * charge);
    const r = Math.max(.0001, r0 * pulse * live);
    fx.coreDark.scale.setScalar(r);
    fx.coreDark.material.opacity = Math.min(1, charge * 1.4) * live * .97;
    fx.coreShell.scale.setScalar(Math.max(.0001, r * 1.3));
    const u = fx.coreShell.material.uniforms;
    u.uTime.value = age;
    u.uUnrest.value = (.35 + .5 * charge) * (1 - implode * .7);
    u.uOpacity.value = O.core * charge * live * I;
    u.uHeat.value = implode;
    fx.coreGroup.visible = p < TL.burstEnd + .02 || since < 1.2;

    // Soft halo shifting from magenta to lavender-white as it compresses
    const gs = (.9 + charge * 2.2) * (1 - implode * .75);
    fx.glow.scale.set(gs, gs, 1);
    fx.cTmp.copy(fx.cMag).lerp(fx.cWhite, implode);
    fx.glow.material.color.copy(fx.cTmp);
    fx.glow.material.opacity = Math.min(1, (charge * .55 + implode * .45) * live * I * O.core);

    // Razor point + anamorphic streak at the end of the implosion (and the detonation flare)
    const flare = burst * (1 - smooth(0, .7, since));
    const st = Math.pow(implode, 3) * live + flare;
    const ps = .22 + .6 * (1 - implode);
    fx.point.scale.set(ps, ps, 1);
    fx.point.material.opacity = Math.min(1, Math.pow(implode, 1.5) * live * I);
    fx.streak.scale.set(Math.max(.001, st * (2.5 + implode * 3 + burst * 16)), .04 + .25 * flare, 1);
    fx.streak.material.opacity = Math.min(1, st * .95 * I);

    // Blinding flash
    const fl = burst * (1 - smooth(.05, 1.1, since));
    const fs = 6 + 16 * atomicEaseOut(since / .9);
    fx.flash.scale.set(fs, fs, 1);
    fx.flash.material.opacity = Math.min(1, fl * .9 * O.flash * I);

    // Electric atom orbits
    const orbR = S.arcRadius * (.5 + .5 * charge) * (1 - implode * .82);
    const oLvl = charge * (1 - implode * .6) * live * fade * (fx.reduced ? .32 : O.arc);
    fx.orbits.forEach((o, k) => {
      o.line.visible = oLvl > .002;
      if (!o.line.visible) return;
      const n = o.arr.length / 3;
      o.line.material.opacity = Math.min(1, oLvl);
      o.line.rotation.set([.35, -.7, 1.15][k], age * M.arcSpeed * (k % 2 ? -1 : 1) * (1 + implode * 5) + k * 2.1, k * .6);
      for (let i = 0; i < n; i++) {
        const step = i / (n - 1), ang = step * Math.PI * 2;
        const tw = Math.sin(step * Math.PI * 10 + age * 3.6 + k) * .09;
        const rr = orbR + tw;
        o.arr[i * 3] = Math.cos(ang) * rr;
        o.arr[i * 3 + 1] = tw * .8;
        o.arr[i * 3 + 2] = Math.sin(ang) * rr * .55;
      }
      o.line.geometry.attributes.position.needsUpdate = true;
    });
  }

  // ---- Detonation: pillar, impact glow ----
  const pillarLevel = burst * (1 - .5 * smooth(2.5, 7.5, since)) * fade;
  {
    const on = pillarLevel > .002;
    fx.pillar.visible = fx.pillarCore.visible = on;
    if (on) {
      const grow = atomicEaseOut(since / .5);
      const wk = (1 + 1.4 * Math.exp(-since * 2.6)) * (1 - .72 * smooth(1.2, 7.5, since)) * smooth(0, .15, since);
      const w = Math.max(.001, S.pillarRadius * wk), h = Math.max(.001, S.pillarHeight * grow);
      fx.pillar.scale.set(w, h, w);
      fx.pillarCore.scale.set(w * .38, h, w * .38);
      fx.pillar.material.uniforms.uTime.value = age;
      fx.pillarCore.material.uniforms.uTime.value = age;
      fx.pillar.material.uniforms.uOpacity.value = O.pillar * pillarLevel * I;
      fx.pillarCore.material.uniforms.uOpacity.value = Math.min(1, pillarLevel * I);
    }
    const fl = burst * (1 - smooth(.2, 2.2, since));
    fx.impact.scale.setScalar(S.sealRadius * (.5 + 1.2 * atomicEaseOut(since / 1.2)));
    fx.impact.material.opacity = Math.min(1, (fl * .9 + pillarLevel * .55) * O.impact * I);
  }

  // ---- Domes ----
  fx.domes.forEach((d, j) => {
    const local = Math.max(0, since - j * .18);
    const a = burst * (1 - smooth(.5, 3.4, local)) * O.dome * I * (j ? .8 : 1);
    d.visible = since > j * .18 && a > .002;
    if (!d.visible) return;
    d.scale.setScalar(S.domeRadius * (j ? .62 : 1) * (.04 + .96 * atomicEaseOut(smooth(0, 2.4, local))));
    d.material.uniforms.uTime.value = age;
    d.material.uniforms.uOpacity.value = a;
  });

  // ---- Shockwaves ----
  fx.shocks.forEach((s, i) => {
    const dur2 = S.waveDuration * (1 + i * .12);
    const local = since - i * S.waveStagger;
    const a = local > 0
      ? smooth(0, .06, local) * (1 - smooth(.35 * dur2, dur2, local)) * O.wave * I * (1 - i * .08)
      : 0;
    s.visible = a > .002;
    if (!s.visible) return;
    const R = S.waveMaxRadius * S.waveExpansion * (.72 + .28 * (i / Math.max(1, fx.shocks.length - 1))) * atomicEaseOut(local / dur2);
    s.scale.setScalar(Math.max(.01, R));
    s.material.uniforms.uTime.value = age;
    s.material.uniforms.uOpacity.value = a;
  });

  // ---- Embers, shards, motes ----
  {
    fx.emberU.uTime.value = age;
    fx.emberU.uSince.value = since;
    fx.emberU.uOpacity.value = O.embers * fade * I;
    fx.embers.visible = since > 0;

    fx.shards.visible = since > 0;
    if (fx.shards.visible) {
      const m = fx.dummy;
      for (let i = 0; i < fx.shardData.length; i++) {
        const sd = fx.shardData[i];
        const local = Math.max(0, since - sd.delay);
        const rad = sd.rad * (1 - Math.exp(-local * .9));
        const y = .15 + sd.rise * (1 - Math.exp(-local * .5)) + Math.sin(local * 1.1 + sd.a * 5) * .25;
        const ang = sd.a + local * .12;
        const sz = since > sd.delay ? sd.sz * smooth(0, .25, local) * fade : 0;
        m.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
        m.rotation.set(local * sd.tx, local * sd.ty, local * sd.tz);
        m.scale.set(Math.max(.0001, sz * .45), Math.max(.0001, sz * 1.8), Math.max(.0001, sz * .45));
        m.updateMatrix();
        fx.shards.setMatrixAt(i, m.matrix);
      }
      fx.shards.instanceMatrix.needsUpdate = true;
      fx.shards.material.opacity = Math.min(1, O.shards * I);
    }

    fx.moteU.uTime.value = age;
    fx.moteU.uOpacity.value = (charge * .2 * live + smooth(0, 1.5, since) * .8) * fade * O.motes * I;
    fx.motes.visible = fx.moteU.uOpacity.value > .002;
  }
}

function drawAtomic(now) {
  for(const [key,effect] of atomicEffects) {
    const age=Math.max(0,(now-effect.started)/1000);
    if(mode!==effect.mode||age>=ATOMIC_CONFIG.durationSeconds){
      clearAtomicEffect(key,effect);
      continue;
    }
    const isPublic=mode==='public';
    const caster=effect.caster;
    if(isPublic&&!publicRoom.roster.has(caster)){
      clearAtomicEffect(key,effect);
      continue;
    }
    const isSelf=isPublic&&caster===publicRoom.id;
    const model=isPublic?(isSelf?fighters[0]:publicRoom.models.get(caster)):fighters[caster];
    const pose=isPublic?(isSelf?publicPose():interpolatePublic(caster)):renderedPose(caster);
    effect.group.visible=!!pose && (isPublic||pose.active);
    if(!effect.group.visible)continue;
    const root=model?.root.position;
    const size=pose.size||1;
    effect.group.position.set(root?.x??pose.x,root?.y??pose.air??0,root?.z??pose.z);
    effect.group.scale.setScalar(size);

    animateAtomic(effect,age,effect.reduced?ATOMIC_CONFIG.reducedIntensity:1);
  }
}
