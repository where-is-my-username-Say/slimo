'use strict';

const elementCache = new Map();
const $ = id => {
  const cached = elementCache.get(id);
  if (cached?.isConnected) return cached;
  const element = document.getElementById(id);
  if (element) elementCache.set(id, element);
  return element;
};
const T = window.THREE;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const palette = [
  { body: 0x26977e, light: 0x9bf2cc, dark: 0x145e65, hud: '#57d5af' },
  { body: 0xcc5449, light: 0xffc5a2, dark: 0x843747, hud: '#ff856f' },
  { body: 0x855bc6, light: 0xdbbbff, dark: 0x4d3f8f, hud: '#b995ff' },
  { body: 0xd49936, light: 0xffdc88, dark: 0x98602d, hud: '#ffd16e' }
];
const actions = ['slap', 'spit', 'dash', 'nova', 'jump'];
const coarse = matchMedia('(pointer:coarse)').matches || matchMedia('(hover:none) and (any-pointer:coarse)').matches;
const prefersReduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
const ARENA_X = 29.6;
const ARENA_Z = 16.8;
const cover = [
  { x: -9.4, z: -6.8, r: 1.03, height: 3.35 },
  { x: 9.4, z: 6.8, r: 1.03, height: 3.35 },
  { x: 1.2, z: -10.2, r: .82, height: 2.5 },
  { x: -1.2, z: 10.2, r: .82, height: 2.5 }
];
const config = [
  ['Controls', [
    ['sens', 'Look sensitivity', .3, 3, .05], ['sensY', 'Vertical sensitivity', .3, 3, .05],
    ['dyn', 'Swipe acceleration', 0, 1, .05], ['smooth', 'Camera smoothing', 0, .9, .05],
    ['inv', 'Invert vertical aim'], ['floating', 'Floating joystick'], ['stickSize', 'Joystick size', .7, 1.6, .05],
    ['dead', 'Joystick dead zone', 0, .4, .02], ['btn', 'Touch button size', .7, 1.4, .05],
    ['btnOp', 'Touch button opacity', .3, 1, .05], ['assist', 'Manual aim assist', 0, 1, .05],
    ['hold', 'Hold to repeat attacks'], ['autoLock', 'Start with lock-on']
  ]],
  ['Camera', [
    ['fov', 'Field of view', 45, 85, 1], ['dist', 'Camera distance', 5, 11, .25], ['shake', 'Screen shake', 0, 1.5, .1],
    ['cinema', 'Cinematic knockouts'], ['reduced', 'Reduce motion']
  ]],
  ['Audio & vibration', [['vol', 'Master volume', 0, 1, .05], ['music', 'Background music', 0, 1, .05], ['sfx', 'Combat sounds', 0, 1, .05], ['alerts', 'Charge, Nova and low-health sound cues'], ['haptic', 'Mobile vibration']]],
  ['Graphics', [
    ['quality', 'Quality (0 low, 1 medium, 2 high)', 0, 2, 1], ['parts', 'Particles', .2, 1, .1],
    ['crowd', 'Animated crowd'], ['adaptive', 'Adaptive render resolution'], ['dmg', 'Damage numbers'], ['vig', 'Hit vignette'], ['cross', 'Reticle'], ['fps', 'Show FPS']
  ]],
  ['Practice', [['bot', 'Difficulty (0 easy, 1 normal, 2 hard)', 0, 2, 1]]]
];
const defaults = {
  sens: 1, sensY: 1, dyn: .35, smooth: .24, inv: false, floating: true, stickSize: 1, dead: .1, btn: 1, btnOp: 1,
  assist: .32, hold: true, autoLock: true, fov: 56, dist: 7.25, shake: prefersReduced ? 0 : .85,
  cinema: !prefersReduced, reduced: prefersReduced, vol: .85, music: .25, sfx: .90, alerts: true, haptic: true,
  quality: coarse ? 1 : 2, parts: 1, crowd: true, adaptive: true, dmg: true, vig: true, cross: true, fps: false, bot: 1
};
function readStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may block storage. */ }
}
const stored = readStore('slimeRomeSettings', {});
let settings = { ...defaults };
for (const [, group] of config) {
  for (const [key, , min, max] of group) {
    const value = stored[key];
    if (key === 'music' && value === .58) continue; // Previous default was off the slider's step.
    if (typeof value === 'boolean' && min === undefined) settings[key] = value;
    if (Number.isFinite(value) && min !== undefined) {
      settings[key] = clamp(value, min, max);
      if (key === 'quality' || key === 'bot') settings[key] = Math.round(settings[key]);
    }
  }
}
if (readStore('slimeRomeSound', true) === false && stored.vol === undefined) settings.vol = 0;
const savedProfile = readStore('slimeRomeProfile', {});
let profile = {
  name: typeof savedProfile.name === 'string' ? savedProfile.name.slice(0, 16) : 'Jade',
  color: clamp(Math.round(Number(savedProfile.color) || 0), 0, palette.length - 1)
};
let chosen = profile.color;
$('playerName').value = profile.name;
document.body.classList.toggle('touch', coarse);

function emptyButtons() { return { slap: 0, spit: 0, dash: 0, nova: 0, jump: 0 }; }
function neutralInput(ready = true) {
  return { x: 0, z: 0, aim: null, assist: 0, a: emptyButtons(), ready };
}
const inputCounts = emptyButtons();
let inputs = [neutralInput(), neutralInput()];
let mode = 'lobby';
let localSlot = 0;
let clock = 0;
let pending = null;
let entryNonce = 0;
let toastTimer = 0;
let activeOverlay = null;
let focusBeforeOverlay = null;
let graphicsLost = false;
let meadowExpansion=null,magicView=null;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
function overlayFocusables(element) {
  return [...element.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length && el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]'));
}
function overlayInert(open) {
  for (const id of ['lobby', 'touchControls']) $(id).inert = open;
  $('hud').inert = open || (!$('draftPanel').hidden);
}

function isLandscape() { return innerWidth >= innerHeight; }
function setStatus(message) { $('status').textContent = message; }
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2450);
}
function openOverlay(id) {
  if (activeOverlay === id) return;
  if (id === 'setOverlay' && mode === 'public') suspendMeadow('settings');
  if (activeOverlay) closeOverlay(false);
  resetInputs();
  focusBeforeOverlay = document.activeElement;
  activeOverlay = id;
  const el = $(id);
  el.hidden = false;
  overlayInert(true);
  overlayFocusables(el)[0]?.focus({ preventScroll: true });
  playSound('ui');
}
function closeOverlay(restoreFocus = true) {
  if (!activeOverlay) return;
  const closed = activeOverlay;
  $(activeOverlay).hidden = true;
  activeOverlay = null;
  overlayInert(false);
  if (closed === 'setOverlay' && mode === 'public') resumeMeadow();
  if (restoreFocus && focusBeforeOverlay?.getClientRects().length) focusBeforeOverlay.focus({ preventScroll: true });
  if (restoreFocus) playSound('back');
}
function gameReady() {
  return !graphicsLost && isLandscape() && !document.hidden && (!activeOverlay || (mode !== 'bot' && state.phase === 'over'));
}
function buildSettings() {
  const body = $('setBody');
  body.replaceChildren();
  for (const [group, controls] of config) {
    const heading = document.createElement('h3');
    heading.textContent = group;
    body.append(heading);
    for (const [key, title, min, max, step] of controls) {
      const row = document.createElement('label');
      row.className = 'srow';
      const label = document.createElement('span');
      label.textContent = title;
      const input = document.createElement('input');
      row.append(label);
      if (min === undefined) {
        input.type = 'checkbox';
        input.checked = settings[key];
        input.onchange = () => {
          settings[key] = input.checked;
          saveSettings(key);
        };
      } else {
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = settings[key];
        const value = document.createElement('output');
        value.value = Number(settings[key]).toFixed(step < 1 ? 2 : 0);
        row.append(value);
        input.oninput = () => {
          settings[key] = Number(input.value);
          value.value = settings[key].toFixed(step < 1 ? 2 : 0);
          saveSettings(key);
        };
      }
      row.append(input);
      body.append(row);
    }
  }
}
function saveSettings(key) {
  writeStore('slimeRomeSettings', settings);
  applySettings(key);
  if (key === 'music' || key === 'sfx' || key === 'vol' || !key) unlockAudio();
  if (key === 'bot') {
    practiceOptions.difficulty = settings.bot;
    preservePractice();
  }
}

const DRAFT_MS = 30000;
const RUN_BOUTS = 7;
const BOUT_SECONDS = 48;

function skill(name, group, color, icon, levels, animations) {
  return { name, group, color, icon, levels, animations };
}
const skills = {
  colossus: skill('Colossus Goo', 'Body', 0xffb96b, 'crown', [
    { hp: 18, size: .10, text: '+18 max HP and 10% larger.' },
    { hp: 36, size: .19, text: '+36 max HP and 19% larger.' },
    { hp: 54, size: .29, text: '+54 max HP and 29% larger.' }
  ], ['One big jelly swell.', 'A double swell with a gold belt flash.', 'A stomp, a crown burst, and a full-body wobble.']),
  armor: skill('Marble Shell', 'Body', 0xffe0ba, 'shield', [
    { cut: .09, text: 'Take 9% less direct damage.' },
    { cut: .15, text: 'Take 15% less direct damage.' },
    { cut: .22, text: 'Take 22% less direct damage.' }
  ], ['A marble plate flashes on impact.', 'Two plates lock together.', 'A marble dome cracks into gold shards.']),
  second: skill('Second Splat', 'Body', 0x8bf4be, 'cross', [
    { heal: 8, text: 'Heal 8 HP the first time you survive a hit below 34% HP.' },
    { heal: 14, text: 'Heal 14 HP the first time you survive a hit below 34% HP.' },
    { heal: 20, text: 'Heal 20 HP the first time you survive a hit below 34% HP.' }
  ], ['A green pulse lifts off the ground.', 'Two green pulses spiral upward.', 'A green fountain scatters healing crosses.']),
  anchor: skill('Anchor Goo', 'Body', 0xe7a783, 'anchor', [
    { cut: .18, text: 'Reduce horizontal knockback by 18%.' },
    { cut: .32, text: 'Reduce horizontal knockback by 32%.' },
    { cut: .48, text: 'Reduce horizontal knockback by 48%.' }
  ], ['An anchor slams down.', 'Two anchors pull against each other.', 'An anchor stomp sends cracks outward.']),
  leech: skill('Snack Slap', 'Body', 0xfacb81, 'snack', [
    { heal: 2, text: 'Heal 2 HP per landed slap.' },
    { heal: 4, text: 'Heal 4 HP per landed slap.' },
    { heal: 6, text: 'Heal 6 HP per landed slap.' }
  ], ['A snack hops into your mouth.', 'Two snacks orbit before the bite.', 'A trail of crumbs follows a giant snack.']),
  guard: skill('Bubble Wrap', 'Body', 0xa8deff, 'bubble', [
    { cut: .22, text: 'Block 22% of the first direct hit each bout.' },
    { cut: .36, text: 'Block 36% of the first direct hit each bout.' },
    { cut: .50, text: 'Block 50% of the first direct hit each bout.' }
  ], ['A bubble pops.', 'Twin bubbles pop in succession.', 'A bubble shell bursts outward.']),
  power: skill('Heavy Hands', 'Slap', 0xffa96e, 'hand', [
    { damage: 2, text: '+2 damage per slap.' },
    { damage: 4, text: '+4 damage per slap.' },
    { damage: 6, text: '+6 damage per slap.' }
  ], ['The mitt bulges on contact.', 'An oversize mitt leaves a second crescent.', 'A giant mitt sweeps through a gold impact crown.']),
  reach: skill('Stretch Slap', 'Slap', 0xf4c591, 'stretch', [
    { reach: .35, text: '+0.35 m slap reach.' },
    { reach: .65, text: '+0.65 m slap reach.' },
    { reach: .95, text: '+0.95 m slap reach.' }
  ], ['The palm stretches out.', 'The long palm snaps back through a ribbon.', 'An elastic whip sweeps through three arcs.']),
  tempo: skill('Rapid Rhythm', 'Slap', 0xf5adcb, 'beat', [
    { time: .93, text: 'Slap windup and recovery are 7% shorter.' },
    { time: .88, text: 'Slap windup and recovery are 12% shorter.' },
    { time: .83, text: 'Slap windup and recovery are 17% shorter.' }
  ], ['A single snap follows the swing.', 'A two-beat wrist flick.', 'Three staccato pulses trace the swing.']),
  finisher: skill('Encore', 'Slap', 0xffca67, 'star', [
    { damage: 3, lift: .55, text: 'Third slap adds 3 damage and 0.55 launch speed.' },
    { damage: 6, lift: 1.10, text: 'Third slap adds 6 damage and 1.10 launch speed.' },
    { damage: 9, lift: 1.65, text: 'Third slap adds 9 damage and 1.65 launch speed.' }
  ], ['A star rises from the uppercut.', 'Twin stars corkscrew upward.', 'A gold starburst follows the launch.']),
  echo: skill('Slap Echo', 'Slap', 0xdfacff, 'echo', [
    { damage: 3, radius: 2.2, text: 'Third slap leaves a 3-damage echo in a 2.2 m radius.' },
    { damage: 5, radius: 2.7, text: 'Third slap leaves a 5-damage echo in a 2.7 m radius.' },
    { damage: 7, radius: 3.2, text: 'Third slap leaves a 7-damage echo in a 3.2 m radius.' }
  ], ['A delayed ripple replays the slap.', 'Two opposing ripples meet.', 'A three-lobed wave breaks out of the sand.']),
  return: skill('Return to Sender', 'Slap', 0xe2bbff, 'mirror', [
    { window: .028, damage: 2, text: '+28 ms reflection window on either side and +2 return damage.' },
    { window: .052, damage: 4, text: '+52 ms reflection window on either side and +4 return damage.' },
    { window: .080, damage: 6, text: '+80 ms reflection window on either side and +6 return damage.' }
  ], ['One mirrored crescent turns the spit around.', 'Twin violet mirrors flip in opposite directions.', 'A violet portal opens and snaps shut.']),
  fire: skill('Fire Spit', 'Spit', 0xff8952, 'flame', [
    { burn: 4, text: 'Spit burns for 4 damage over 2.4 s.' },
    { burn: 7, text: 'Spit burns for 7 damage over 2.4 s.' },
    { burn: 10, text: 'Spit burns for 10 damage over 2.4 s.' }
  ], ['An ember tail follows the glob.', 'Two flames twist around the glob.', 'A bright flame core punches through a ring of sparks.']),
  frost: skill('Frost Spit', 'Spit', 0x87eaff, 'ice', [
    { slow: .12, text: 'Spit slows movement by 12% for 1.45 s.' },
    { slow: .20, text: 'Spit slows movement by 20% for 1.45 s.' },
    { slow: .28, text: 'Spit slows movement by 28% for 1.45 s.' }
  ], ['One ice crystal forms on the hit.', 'Twin crystals spiral around the target.', 'An ice rosette shatters outward.']),
  fork: skill('Split Spit', 'Spit', 0x95f7c5, 'fork', [
    { count: 1, sideDamage: 7, spread: .227, text: 'Add one side glob for 7 damage. One hit per volley.' },
    { count: 2, sideDamage: 8, spread: .279, text: 'Add two wide side globs for 8 each. One hit per volley.' },
    { count: 2, sideDamage: 9, spread: .175, text: 'Add two tighter side globs for 9 each. One hit per volley.' }
  ], ['One trail forks from the shot.', 'Two wing trails open into a fan.', 'A tight three-pronged volley flickers in formation.']),
  seeker: skill('Homing Spit', 'Spit', 0xf9a9e9, 'target', [
    { turn: 14, text: 'Globs steer up to 14° per second.' },
    { turn: 25, text: 'Globs steer up to 25° per second.' },
    { turn: 38, text: 'Globs steer up to 38° per second.' }
  ], ['One pink ring tracks the glob.', 'Two tracking rings counter-rotate.', 'A spinning reticle follows the curved trail.']),
  speed: skill('Cannon Spit', 'Spit', 0xffd697, 'bolt', [
    { speed: 4, damage: 2, text: '+4 m/s projectile speed and +2 direct damage.' },
    { speed: 7, damage: 3, text: '+7 m/s projectile speed and +3 direct damage.' },
    { speed: 10, damage: 4, text: '+10 m/s projectile speed and +4 direct damage.' }
  ], ['A bright straight streak.', 'A second streak twists around the shot.', 'A sharp shock cone follows the shot.']),
  boomer: skill('Pillar Pinball', 'Spit', 0xe5b0ff, 'ricochet', [
    { banks: 1, text: 'Globs can bounce off a pillar once.' },
    { banks: 2, text: 'Globs can bounce off pillars twice.' },
    { banks: 3, text: 'Globs can bounce off pillars three times.' }
  ], ['A single pinball spark at the wall.', 'Two rebound rings spin off the pillar.', 'A violet pinball burst sprays in both directions.']),
  swift: skill('Slipstream', 'Dodge & Nova', 0x91f6df, 'dash', [
    {"cooldown": 0.78, "text": "Dodge cooldown drops to 0.78 s."},
    {"cooldown": 0.62, "text": "Dodge cooldown drops to 0.62 s."},
    {"cooldown": 0.46, "text": "Dodge cooldown drops to 0.46 s."}
  ], ['A short teal trail.', 'Two offset speed ribbons.', 'A triple wave peels off behind the dash.']),
  phase: skill('Ghost Dodge', 'Dodge & Nova', 0xc9c6ff, 'ghost', [
    {"inv": 0.06, "perfect": 0.02, "text": "+60 ms dodge invulnerability and +20 ms perfect-dodge window."},
    {"inv": 0.12, "perfect": 0.04, "text": "+120 ms dodge invulnerability and +40 ms perfect-dodge window."},
    {"inv": 0.18, "perfect": 0.06, "text": "+180 ms dodge invulnerability and +60 ms perfect-dodge window."}
  ], ['A pale afterimage fades out.', 'Twin afterimages split sideways.', 'A ghost shell expands through three silhouettes.']),
  counter: skill('Revenge Recipe', 'Dodge & Nova', 0xff9cbc, 'counter', [
    {"damage": 5, "time": 2.4, "text": "+5 counter damage and 2.40 s to use it after a perfect dodge."},
    {"damage": 9, "time": 2.8, "text": "+9 counter damage and 2.80 s to use it after a perfect dodge."},
    {"damage": 14, "time": 3.2, "text": "+14 counter damage and 3.20 s to use it after a perfect dodge."}
  ], ['A pink mark flashes on the dodge.', 'Two pink marks trade places.', 'A pink crown snaps shut on the counter.']),
  battery: skill('Crowd Favorite', 'Dodge & Nova', 0xffd383, 'spark', [
    { energy: 1.13, text: 'Gain 13% more Nova energy from combat.' },
    { energy: 1.25, text: 'Gain 25% more Nova energy from combat.' },
    { energy: 1.40, text: 'Gain 40% more Nova energy from combat.' }
  ], ['A gold spark marks full charge.', 'Two sparks spiral into the crown.', 'A crown of sparks salutes the full meter.']),
  wide: skill('Big Bang', 'Dodge & Nova', 0xffae80, 'sun', [
    { radius: .60, text: 'Nova reaches 0.60 m farther.' },
    { radius: 1.10, text: 'Nova reaches 1.10 m farther.' },
    { radius: 1.65, text: 'Nova reaches 1.65 m farther.' }
  ], ['A wide sun ring opens.', 'A second ring rises through the first.', 'A rising gold corona sweeps the full blast radius.']),
  after: skill('Afterparty', 'Dodge & Nova', 0xffb6f1, 'burst', [
    { damage: 4, radius: 3.1, text: 'Nova leaves a delayed 4-damage wave in a 3.1 m radius.' },
    { damage: 7, radius: 3.7, text: 'Nova leaves a delayed 7-damage wave in a 3.7 m radius.' },
    { damage: 10, radius: 4.3, text: 'Nova leaves a delayed 10-damage wave in a 4.3 m radius.' }
  ], ['A late pink ripple.', 'Two pink waves cross with confetti.', 'A firework detonates into a pink corona.'])
};
const passiveSkillIds = Object.keys(skills);
const WORLD = globalThis.SlimoWorld;
for (const [id, data] of Object.entries(WORLD.spells)) {
  skills[id] = skill(data.name, 'Arcane', data.color, ({earthwall:'shield',embertrail:'flame',frostbloom:'ice',stormcoil:'bolt',vortex:'echo',stoneburst:'fork',mending:'cross',starfall:'star'})[id],
    data.levels.map(level => ({...level,text:({earthwall:'Dodge',mending:'Dodge',embertrail:'Slap',stormcoil:'Slap',stoneburst:'Spit',starfall:'Spit',frostbloom:'Nova',vortex:'Nova'})[id]+': '+level.text+' Internal cooldown '+level.cooldown+' s. Roguelike upgrade; uses your existing move.'})),
    ['A ground sigil and a first elemental shape.','More segments, brighter runes and a wider effect.','A complete elemental formation with layered particles.']);
}
const allSkillIds = Object.keys(skills);
const skillIds = allSkillIds;
const groups = ['Body', 'Slap', 'Spit', 'Dodge & Nova', 'Arcane'];
const stages = [
  { name: 'Warm Sand', note: 'Opening bout. Everyone starts fresh.', color: 0xefbc7d },
  { name: 'Snack Break', note: 'Grab the gold snack to restore 14% of your max HP.', color: 0xffc276 },
  { name: 'Slime Skating', note: 'Less traction. Dodges and knockback slide farther.', color: 0x90e5d7 },
  { name: 'Pop-up Pillars', note: 'Two new pillars block spits and break sightlines.', color: 0xedb293 },
  { name: 'Hot Seats', note: 'Step out of glowing circles before they pop.', color: 0xff825e },
  { name: 'Crowd Goes Wild', note: 'Combat charges Nova 25% faster. A gold pickup gives 27 energy.', color: 0xe3adff },
  { name: 'Last Slime Standing', note: 'The safe ring starts closing 20 seconds into the bout.', color: 0xffa278 },
  { name: 'Overtime', note: 'One final bout. The safe ring closes after 12 seconds.', color: 0xff9f79 }
];
function skillRank(player, id) { return player?.ranks?.[id] || 0; }
function skillValue(player, id, key, fallback = 0) {
  return skills[id].levels[skillRank(player, id) - 1]?.[key] ?? fallback;
}
function stageOf(match) {
  return match.format === 'rogue' ? stages[stageIndex(match.round)] : null;
}

const BUILD_POINTS = WORLD.buildPoints;
const practiceKits = {
  blaze: { fire: 3, fork: 2, speed: 2, seeker: 1, swift: 2, guard: 2 },
  titan: { colossus: 3, armor: 2, anchor: 2, power: 2, finisher: 2, leech: 1 },
  phantom: { swift: 3, phase: 2, counter: 3, tempo: 2, reach: 1, return: 1 }
};
function cleanBuild(raw, limit = BUILD_POINTS) {
  const result = {};
  let left = limit;
  for (const key of allSkillIds) {
    const rank = Number.isInteger(raw?.[key]) ? Math.max(0, Math.min(3, raw[key], left)) : 0;
    if (!rank) continue;
    result[key] = rank;
    left -= rank;
  }
  return result;
}
function buildCost(ranks) { return Object.values(ranks).reduce((sum, rank) => sum + rank, 0); }

const moves = {
  slap: [
    { duration: .352, contact: .131, damage: 11, reach: 3.26, stun: .18, shove: 5.8, lunge: 5.4 },
    { duration: .378, contact: .151, damage: 13, reach: 3.45, stun: .21, shove: 7.1, lunge: 6.6 },
    { duration: .580, contact: .270, damage: 20, reach: 3.83, stun: .44, shove: 14.4, lunge: 9.6 }
  ],
  spit: { duration: .441, contact: .176, damage: 11, speed: 28 },
  nova: { duration: .690, contact: .352, damage: 26, reach: 6.6 },
  dash: { time: .268, inv: .214, perfect: .154, cooldown: .98, speed: 23 }
};

/* Shared by the browser and the open-room server. */
const MEADOW_X = WORLD.x;
const MEADOW_Z = WORLD.z;
const meadowRocks = WORLD.rocks;
const meadowTrees = WORLD.trees;
const meadowCover = WORLD.cover;
const MEADOW_RING_X = WORLD.ring.x;
const MEADOW_RING_Z = WORLD.ring.z;
const MEADOW_RING_RADIUS = WORLD.ring.radius;
function insideFightRing(x,z) { return WORLD.insideRing(x,z); }

/* Shared Open Meadow social state and text limits. */
const ROOM_CHAT_LIMIT = 160;
const ROOM_EMOTES = [
  { key: 'none', label: 'Stop', duration: 0 },
  { key: 'dance', label: 'Dance', duration: 0 },
  { key: 'sit', label: 'Sit', duration: 0 },
  { key: 'wave', label: 'Wave', duration: 1.65 },
  { key: 'spin', label: 'Spin', duration: 1.15 },
  { key: 'bounce', label: 'Bounce', duration: 1.45 }
];
const emoteCodes = Object.fromEntries(ROOM_EMOTES.map((emote, index) => [emote.key, index]));
const disallowedControls = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
function cleanRoomChat(value) {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(disallowedControls, ' ').replace(/\s+/gu, ' ').trim();
  return Array.from(text).slice(0, ROOM_CHAT_LIMIT).join('').trim();
}

/* Compact 20 Hz movement and projectile snapshots for the shared meadow. */
const ROOM_CAP = 50;
const MEADOW_ROOM = 'Open Meadow';
const MEADOW_PROTOCOL = WORLD.protocol;
const ROOM_INPUT = 54;
const ROOM_STATE = 55;
const MEADOW_ACTIONS = actions;
const PLAYER_BYTES = WORLD.playerBytes;
const GLOB_BYTES = 22;
const meleeFlag = { '': 0, slap: 1, spit: 2, nova: 3 };
const meleeName = ['', 'slap', 'spit', 'nova'];
function wireNumber(n, lo, hi) { return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0)); }
function wireAngle(n) { return Math.atan2(Math.sin(n || 0), Math.cos(n || 0)); }
function inputPacket(input, sequence) {
  const v = new DataView(new ArrayBuffer(26));
  v.setUint8(0, ROOM_INPUT);
  v.setUint8(1, MEADOW_PROTOCOL);
  v.setUint8(2, input.ready ? 1 : 0);
  v.setUint8(3, Math.round(wireNumber(input.assist, 0, 1) * 255));
  v.setUint32(4, sequence);
  v.setInt16(8, Math.round(wireNumber(input.x, -1, 1) * 16000));
  v.setInt16(10, Math.round(wireNumber(input.z, -1, 1) * 16000));
  v.setInt16(12, Math.round(wireAngle(input.aim) * 10000));
  MEADOW_ACTIONS.forEach((key, i) => v.setUint16(14 + 2 * i, input.a[key] & 65535));
  v.setUint8(24, Math.round(wireNumber(input.spitCharge,0,1)*255));
  return v.buffer;
}
function decodeRoomInput(buffer) {
  if (buffer.byteLength !== 26) return null;
  const v = new DataView(buffer);
  if (v.getUint8(0) !== ROOM_INPUT || v.getUint8(1) !== MEADOW_PROTOCOL) return null;
  const a = {};
  MEADOW_ACTIONS.forEach((key, i) => { a[key] = v.getUint16(14 + 2 * i); });
  return { seq: v.getUint32(4), ready: v.getUint8(2) === 1, assist: v.getUint8(3) / 255,
    x: wireNumber(v.getInt16(8) / 16000, -1, 1), z: wireNumber(v.getInt16(10) / 16000, -1, 1),
    aim: v.getInt16(12) / 10000, spitCharge: v.getUint8(24)/255, a };
}
function encodeRoomState(tick, ack, players, bullets) {
  const v = new DataView(new ArrayBuffer(12 + players.length * PLAYER_BYTES + bullets.length * GLOB_BYTES));
  v.setUint8(0, ROOM_STATE);
  v.setUint8(1, MEADOW_PROTOCOL);
  v.setUint32(2, tick);
  v.setUint32(6, ack);
  v.setUint8(10, players.length);
  v.setUint8(11, bullets.length);
  let o = 12;
  const number = (at, n, factor) => v.setInt16(at, Math.round(wireNumber(n * factor, -32767, 32767)));
  const time = (at, n) => v.setUint8(at, Math.round(wireNumber(n, 0, 2.55) * 100));
  for (const p of players) {
    v.setUint16(o, p.id);
    number(o + 2, p.x, 100); number(o + 4, p.z, 100); number(o + 6, wireAngle(p.r), 10000);
    number(o + 8, p.vx, 300); number(o + 10, p.vz, 300); number(o + 12, p.kx, 300); number(o + 14, p.kz, 300);
    v.setUint16(o + 16, Math.round(wireNumber(p.hp, 0, 200) * 10));
    v.setUint8(o + 18, Math.round(wireNumber(p.en, 0, 100)));
    v.setUint8(o + 19, (meleeFlag[p.attack] || 0) | (p.combo & 3) << 2 | (p.countering ? 16 : 0) |
      (p.respawnAt ? 32 : 0) | (p.hit > .05 ? 64 : 0) | (p.shield > 0 ? 128 : 0));
    time(o + 20, p.attackTime); time(o + 21, p.duration); time(o + 22, p.contactTime);
    time(o + 23, p.dashTime); time(o + 24, p.air); time(o + 25, p.dash);
    time(o + 26, p.stun); time(o + 27, p.chill);
    v.setUint8(o + 28, Math.round(wireNumber(p.chillAmount, 0, 1) * 100));
    v.setUint8(o + 29, p.burnTicks || 0);
    v.setUint8(o + 30, (p.emote || 0) | (p.attackPlayful ? 8 : 0));
    v.setUint16(o + 31, Math.round(wireNumber(p.emoteAge, 0, 65.535) * 1000));
    v.setUint8(o+33,Math.round(wireNumber(p.mana ?? 100,0,100)));
    o += PLAYER_BYTES;
  }
  for (const q of bullets) {
    v.setUint32(o, q.id);
    v.setUint16(o + 4, q.owner);
    number(o + 6, q.x, 100); number(o + 8, q.z, 100); number(o + 10, q.vx, 300); number(o + 12, q.vz, 300);
    v.setUint8(o + 14, q.color || 0);
    v.setUint8(o + 15, q.fire || 0);
    v.setUint8(o + 16, q.frost || 0);
    v.setUint8(o + 17, q.seeker || 0);
    v.setUint8(o + 18, q.cannon || 0);
    v.setUint8(o + 19, q.returns || 0);
    v.setUint8(o + 20, q.fork || 0);
    v.setUint8(o + 21, (q.charged ? 1 : 0) | (q.rock ? 2 : 0));
    o += GLOB_BYTES;
  }
  return v.buffer;
}
function decodeRoomState(buffer) {
  if (buffer.byteLength < 12) return null;
  const v = new DataView(buffer);
  if (v.getUint8(0) !== ROOM_STATE || v.getUint8(1) !== MEADOW_PROTOCOL) return null;
  const players = [], bullets = [], count = v.getUint8(10), shots = v.getUint8(11);
  if (count > ROOM_CAP || shots > 120 || buffer.byteLength !== 12 + count * PLAYER_BYTES + shots * GLOB_BYTES) return null;
  let o = 12;
  for (let i = 0; i < count; i++) {
    const flag = v.getUint8(o + 19), social = v.getUint8(o + 30);
    players.push({
      id: v.getUint16(o), x: v.getInt16(o + 2) / 100, z: v.getInt16(o + 4) / 100, r: v.getInt16(o + 6) / 10000,
      vx: v.getInt16(o + 8) / 300, vz: v.getInt16(o + 10) / 300,
      kx: v.getInt16(o + 12) / 300, kz: v.getInt16(o + 14) / 300, hp: v.getUint16(o + 16) / 10, en: v.getUint8(o + 18),
      attack: meleeName[flag & 3], combo: (flag >> 2) & 3, countering: !!(flag & 16), knockedOut: !!(flag & 32),
      hit: flag & 64 ? .2 : 0, shield: !!(flag & 128), attackTime: v.getUint8(o + 20) / 100,
      duration: v.getUint8(o + 21) / 100, contactTime: v.getUint8(o + 22) / 100, dashTime: v.getUint8(o + 23) / 100,
      air: v.getUint8(o + 24) / 100, dash: v.getUint8(o + 25) / 100, stun: v.getUint8(o + 26) / 100,
      chill: v.getUint8(o + 27) / 100, chillAmount: v.getUint8(o + 28) / 100, burnTicks: v.getUint8(o + 29),
      mana: v.getUint8(o+33),
      emote: (social & 7) < ROOM_EMOTES.length ? social & 7 : 0, attackPlayful: !!(social & 8), emoteAge: v.getUint16(o + 31) / 1000
    });
    o += PLAYER_BYTES;
  }
  for (let i = 0; i < shots; i++) {
    bullets.push({
      id: v.getUint32(o), owner: v.getUint16(o + 4), x: v.getInt16(o + 6) / 100, z: v.getInt16(o + 8) / 100,
      vx: v.getInt16(o + 10) / 300, vz: v.getInt16(o + 12) / 300, color: v.getUint8(o + 14) % 4,
      fire: Math.min(3, v.getUint8(o + 15)), frost: Math.min(3, v.getUint8(o + 16)), seeker: Math.min(3, v.getUint8(o + 17)),
      charged: !!(v.getUint8(o+21)&1), rock: !!(v.getUint8(o+21)&2), scale: v.getUint8(o+21)&1 ? 1.45 : 1,
      cannon: Math.min(3, v.getUint8(o + 18)), returns: Math.min(3, v.getUint8(o + 19)), fork: Math.min(3, v.getUint8(o + 20))
    });
    o += GLOB_BYTES;
  }
  return { tick: v.getUint32(2), ack: v.getUint32(6), players, bullets };
}

let renderer;
try {
  renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  setStatus('This game needs WebGL. Open it in a browser with hardware acceleration enabled.');
  for (const id of ['practice', 'practiceSetup', 'host', 'openMeadow', 'join', 'openSet', 'friends', 'openGuide']) $(id).disabled = true;
  throw error;
}
renderer.outputEncoding = T.sRGBEncoding;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.domElement.id = 'world';
renderer.domElement.setAttribute('aria-label', 'Slime Circuit arena');
$('stage').append(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color(0x594052);
scene.fog = new T.FogExp2(0x684552, .012);
const camera = new T.PerspectiveCamera(55, 1, .13, 720);
const hemisphere = new T.HemisphereLight(0xf9dbec, 0x6b547c, .83);
const sun = new T.DirectionalLight(0xffc18e, 1.53);
sun.position.set(-17, 25, -22);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 30, bottom: -30, near: 1, far: 91 });
sun.shadow.normalBias = .041;
sun.shadow.bias = -.00015;
const rim = new T.DirectionalLight(0xc6cbff, .66);
rim.position.set(8, 9, 14);
scene.add(hemisphere, sun, rim);

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
const rand = seeded(3655);
function texture(w, h, paint, color = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const result = new T.CanvasTexture(canvas);
  result.encoding = color ? T.sRGBEncoding : T.LinearEncoding;
  result.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return result;
}
const radial = texture(64, 64, (c, w) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff');
  g.addColorStop(.28, '#fffa');
  g.addColorStop(.72, '#fff2');
  g.addColorStop(1, '#fff0');
  c.fillStyle = g;
  c.fillRect(0, 0, w, w);
});
const shadeTexture = texture(64, 64, (c, w) => {
  const g = c.createRadialGradient(32, 32, 3, 32, 32, 31);
  g.addColorStop(0, '#fff');
  g.addColorStop(.48, '#fffc');
  g.addColorStop(1, '#fff0');
  c.fillStyle = g;
  c.fillRect(0, 0, w, w);
});
const gooTexture = texture(128, 128, c => {
  c.fillStyle = '#fff';
  c.beginPath();
  for (let i = 0; i < 70; i++) {
    const a = i / 70 * TAU;
    const r = 32 + Math.cos(a * 7) * 5 + Math.sin(a * 11) * 3 + Math.cos(a * 3) * 8;
    c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  c.fill();
  for (let i = 0; i < 13; i++) {
    const a = i * .53 + rand() * .2;
    const r = 44 + rand() * 14;
    c.beginPath();
    c.ellipse(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3 + rand() * 5, 2 + rand() * 3, a, 0, TAU);
    c.fill();
  }
});
const sandTexture = texture(1536, 1024, (c, w, h) => {
  c.fillStyle = '#af7856';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 950; i++) {
    const x = rand() * w, y = rand() * h, r = 10 + rand() * 94;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > .48 ? '#ffd9a321' : '#5f303424');
    g.addColorStop(1, '#733e3400');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 26000; i++) {
    const x = rand() * w, y = rand() * h;
    c.fillStyle = rand() > .6 ? '#f7cb9c45' : '#6c383334';
    c.fillRect(x, y, .5 + rand() * 3.4, .7 + rand() * 1.8);
  }
  for (let i = 0; i < 200; i++) {
    const x = rand() * w, y = rand() * h;
    c.beginPath();
    c.strokeStyle = '#5f362520';
    c.lineWidth = 1 + rand() * 1.5;
    c.moveTo(x, y);
    c.quadraticCurveTo(x + 18, y - 5, x + 34 + rand() * 18, y + 3);
    c.stroke();
  }
  c.save();
  c.translate(w / 2, h / 2);
  c.scale(1, 1.13);
  const ring = (r, width, col) => {
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.lineWidth = width;
    c.strokeStyle = col;
    c.stroke();
  };
  ring(179, 10, '#7f3a36ac');
  ring(161, 3, '#ffdfae92');
  ring(147, 3, '#7f3a36a0');
  ring(61, 3, '#824746aa');
  c.strokeStyle = '#7c423dbb';
  c.lineWidth = 4;
  for (const side of [-1, 1]) {
    c.beginPath();
    c.moveTo(0, 96);
    c.quadraticCurveTo(side * 112, 67, side * 92, -74);
    c.stroke();
    c.fillStyle = '#7c423dbb';
    for (let i = 0; i < 8; i++) {
      const a = .06 + i * .182;
      const x = Math.sin(a) * 98 * side;
      const y = 86 - i * 20;
      c.beginPath();
      c.ellipse(x + 10 * side, y - 8, 16, 5, -side * (.4 + a), 0, TAU);
      c.ellipse(x - 9 * side, y + 1, 13, 4, side * (.62 - a), 0, TAU);
      c.fill();
    }
  }
  c.fillStyle = '#7e403dcc';
  c.font = 'bold 43px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('SPQR', 0, -3);
  c.restore();
});
const stoneTexture = texture(256, 256, (c, w, h) => {
  c.fillStyle = '#ddd0c1';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = rand() > .5 ? '#f7e8d436' : '#5d43511d';
    c.fillRect(rand() * w, rand() * h, rand() * 15 + 1, rand() * 4 + .8);
  }
  for (let i = 0; i < 23; i++) {
    const x = rand() * w, y = rand() * h;
    c.strokeStyle = '#63506033';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 16, y + 2);
    c.lineTo(x + 27, y - 2);
    c.stroke();
  }
});
const flagTexture = texture(128, 256, (c, w, h) => {
  c.fillStyle = '#983d4a';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1450; i++) {
    c.fillStyle = i % 2 ? '#ffd19e28' : '#421e3654';
    c.fillRect(rand() * w, rand() * h, 1, 2 + rand() * 6);
  }
  c.strokeStyle = '#e4a264';
  c.lineWidth = 3;
  c.strokeRect(9, 4, 110, 247);
  c.lineWidth = 1;
  c.strokeRect(14, 8, 100, 239);
  c.save();
  c.translate(64, 123);
  c.strokeStyle = '#ebaf73';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(0, -4, 31, .78, 2.36);
  c.arc(0, -4, 31, 2.36, 4.1);
  c.moveTo(18, -30);
  c.arc(0, -4, 31, 5.35, 7.08);
  c.stroke();
  c.fillStyle = '#ebaf73';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = -.8 + i * .43;
      c.beginPath();
      c.ellipse(side * (27 * Math.cos(a) + 4), -4 + Math.sin(a) * 32, 7, 3, side * (a - .6), 0, TAU);
      c.fill();
    }
  }
  c.beginPath();
  c.ellipse(0, 0, 16, 10, 0, 0, TAU);
  c.fill();
  c.fillStyle = '#983d4a';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.ellipse(s * 6, -2, 2, 3, 0, 0, TAU);
    c.fill();
  }
  c.restore();
});

function standard(color, params = {}) {
  return new T.MeshStandardMaterial({ color, roughness: .84, ...params });
}
const rock = standard(0xffffff, { map: stoneTexture });
const bronze = standard(0x825743, { metalness: .25, roughness: .55 });
const grout = standard(0x523746);
const flagMat = standard(0xffffff, { map: flagTexture, side: T.DoubleSide, roughness: 1 });
const box = new T.BoxGeometry();
const cylinder = new T.CylinderGeometry(1, 1, 1, 18);
function addMesh(geometry, material, parent, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geometry, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const tempObject = new T.Object3D();
const tempColor = new T.Color();
function instances(geometry, material, transforms, castShadow = false) {
  const mesh = new T.InstancedMesh(geometry, material, transforms.length);
  transforms.forEach((item, i) => {
    const [x, y, z, yaw, sx, sy, sz, color, roll = 0] = item;
    tempObject.position.set(x, y, z);
    tempObject.rotation.set(0, yaw, roll);
    tempObject.scale.set(sx, sy, sz);
    tempObject.updateMatrix();
    mesh.setMatrixAt(i, tempObject.matrix);
    if (color !== undefined) mesh.setColorAt(i, tempColor.setHex(color));
  });
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

const sky = addMesh(new T.SphereGeometry(148, 40, 20), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false,
  vertexShader: [
    'varying vec3 vSky;',
    'void main(){ vSky=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }'
  ].join('\n'),
  fragmentShader: [
    'varying vec3 vSky;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}',
    'void main(){',
    ' vec3 v=normalize(vSky); float h=v.y;',
    ' vec3 sunDir=normalize(vec3(-.32,.34,-.92)); float s=max(0.,dot(v,sunDir));',
    ' vec3 color=mix(vec3(.54,.245,.22),vec3(.115,.088,.235),smoothstep(-.075,.63,h));',
    ' color+=vec3(.65,.27,.08)*pow(s,13.)*exp(-max(0.,h-.40)*4.);',
    ' float cloud=n(vec2(atan(v.z,v.x)*7.5, h*31.))+n(vec2(atan(v.z,v.x)*22.7+3.,h*78.))*.34;',
    ' float cloudMask=smoothstep(.62,.99,cloud)*(1.-smoothstep(.15,.60,h))*smoothstep(-.16,.09,h);',
    ' color=mix(color,mix(vec3(.25,.12,.22),vec3(.88,.40,.21),pow(s,8.)),cloudMask*.52);',
    ' color+=vec3(.26,.12,.055)*pow(s,155.);',
    ' color=mix(color,vec3(1.,.81,.51),smoothstep(.9985,.9991,s));',
    ' gl_FragColor=vec4(color,1.);',
    '}'
  ].join('\n')
}), scene);
sky.renderOrder = -5;

const ellipse = 1.74;
const edge = 18.15;
function arcPoint(a, radius) {
  return [Math.sin(a) * radius * ellipse, Math.cos(a) * radius, Math.atan2(Math.sin(a), ellipse * Math.cos(a))];
}
const ground = addMesh(new T.PlaneGeometry(225, 225), standard(0x49313f), scene, 0, -.08, 0);
ground.rotation.x = -Math.PI / 2;
const sand = addMesh(new T.CircleGeometry(1, 100), standard(0xffffff, { map: sandTexture, roughness: 1 }), scene, 0, .005, 0);
sand.rotation.x = -Math.PI / 2;
sand.scale.set(edge * ellipse, edge, 1);
sand.receiveShadow = true;

function wall(radius, low, high, color) {
  const m = addMesh(new T.CylinderGeometry(1, 1, high - low, 116, 1, true),
    standard(color, { side: T.DoubleSide }), scene, 0, (low + high) * .5, 0);
  m.scale.set(radius * ellipse, 1, radius);
  m.receiveShadow = true;
  return m;
}
function terrace(inner, outer, y, color) {
  const m = addMesh(new T.RingGeometry(inner, outer, 116), standard(color, { side: T.DoubleSide }), scene, 0, y, 0);
  m.rotation.x = -Math.PI / 2;
  m.scale.x = ellipse;
  m.receiveShadow = true;
  return m;
}
wall(18.22, .0, 2.42, 0xa27466);
wall(18.14, .02, .24, 0x74505a);
wall(18.16, 1.96, 2.12, 0x7a3645);
wall(18.19, 2.19, 2.49, 0xc6997c);
terrace(18.12, 18.82, 2.48, 0xc39a80);
for (let k = 0; k < 5; k++) {
  const r = 18.6 + k * 1.11;
  const h = 2.7 + k * .68;
  wall(r, h - .69, h, k % 2 ? 0x96695f : 0xa97f6a);
  terrace(r, r + 1.13, h, k % 2 ? 0x9b7068 : 0xac826c);
  wall(r - .03, h - .11, h + .025, 0xc59a83);
}
wall(24.5, 5.3, 6.33, 0x9c7165);
wall(24.42, 5.96, 6.13, 0x754551);
wall(24.37, 6.19, 6.41, 0xc59b85);
terrace(24.38, 26.25, 6.41, 0xa78275);
wall(25.28, 10.03, 10.54, 0xa77569);
wall(25.22, 10.02, 10.16, 0xceaa87);
wall(25.25, 10.52, 10.68, 0xc79c7f);
wall(25.33, 13.8, 14.15, 0x996b65);
wall(25.28, 14.11, 14.36, 0xd1aa8b);

const masonry = [];
for (let row = 0; row < 4; row++) {
  for (let i = 0; i < 112; i++) {
    const a = (i + (row % 2) * .5) / 112 * TAU;
    const [x, z, yaw] = arcPoint(a, 18.15);
    const w = TAU / 112 * Math.hypot(18.15 * ellipse * Math.cos(a), 18.15 * Math.sin(a));
    const colors = [0xba8a74, 0xad806d, 0xb48270, 0xc0937b, 0xa17368, 0xc29b83];
    masonry.push([x, .41 + row * .43, z, yaw, w * .975, .418, .17, colors[Math.floor(rand() * colors.length)]]);
  }
}
instances(box, rock, masonry);
function archGeometry() {
  const shape = new T.Shape();
  shape.moveTo(1.065, 0);
  for (let j = 1; j <= 18; j++) {
    const a = j / 18 * Math.PI;
    shape.lineTo(Math.cos(a) * 1.065, Math.sin(a) * 1.065);
  }
  for (let j = 18; j >= 0; j--) {
    const a = j / 18 * Math.PI;
    shape.lineTo(Math.cos(a) * .80, Math.sin(a) * .80);
  }
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth: .36, bevelEnabled: false });
}
const columns = [], arches = [], caps = [], sockets = [];
const archCount = 56;
for (let tier = 0; tier < 2; tier++) {
  for (let i = 0; i < archCount; i++) {
    const a = (i + .5) * TAU / archCount;
    const pillarAngle = i * TAU / archCount;
    const [x, z, yaw] = arcPoint(a, 25.04);
    const [px, pz, pyaw] = arcPoint(pillarAngle, 25.08);
    const halfBay = TAU * Math.hypot(25.04 * ellipse * Math.cos(a), 25.04 * Math.sin(a)) / (archCount * 2);
    const low = tier ? 10.63 : 6.46;
    const spring = tier ? 12.54 : 8.62;
    const archHeight = tier ? 1.23 : 1.4;
    const color = [0xb58a7b, 0xc79d86, 0xac7d6e, 0xc69d8b][(i * 17 + (i >> 2)) % 4];
    arches.push([x, spring, z, yaw, halfBay * .95, archHeight, 1.8, color]);
    columns.push([px, (low + spring + .15) * .5, pz, pyaw, .51, spring - low + .15, .82, color]);
    caps.push([px, low + .13, pz, pyaw, .77, .24, 1.08, 0xd1a892]);
    caps.push([px, spring - .07, pz, pyaw, .76, .19, 1.02, 0xc5a08b]);
    sockets.push([x, spring + archHeight * .97, z, yaw, .31, .29, .74, 0xd2ae94]);
  }
}
instances(box, rock, columns);
instances(box, rock, caps);
instances(box, rock, sockets);
instances(archGeometry(), rock, arches);
const city = [];
for (let i = 0; i < 64; i++) {
  const a = i / 64 * TAU;
  const [x, z, yaw] = arcPoint(a, 40 + rand() * 11);
  const height = 4 + rand() * 11;
  city.push([x, height * .5, z, yaw, 2 + rand() * 5, height, 2.6, i % 2 ? 0x51374e : 0x654758]);
}
instances(box, new T.MeshBasicMaterial({ color: 0xffffff }), city);

const gateParts = [], gateBars = [];
const gateVoid = new T.MeshBasicMaterial({ color: 0x281a2b });
for (let i = 0; i < 8; i++) {
  const a = (i + .5) * TAU / 8;
  const [x, z, yaw] = arcPoint(a, 17.97);
  const g = new T.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  scene.add(g);
  const door = addMesh(box, gateVoid, g, 0, 1.10, -.10);
  door.scale.set(2.6, 2.2, .09);
  const head = addMesh(new T.CircleGeometry(1.29, 26, 0, Math.PI), gateVoid, g, 0, 2.14, -.16);
  head.rotation.y = Math.PI;
  const band = addMesh(archGeometry(), rock, g, 0, 2.13, -.28);
  band.scale.set(1.58, 1.28, .65);
  for (const side of [-1, 1]) {
    const p = addMesh(box, rock, g, side * 1.45, 1.06, -.15);
    p.scale.set(.38, 2.22, .40);
  }
  const base = addMesh(box, bronze, g, 0, .13, -.34);
  base.scale.set(2.56, .18, .09);
  for (let j = -4; j <= 4; j++) {
    const height = 2.1 + Math.sqrt(1.23 ** 2 - (j * .275) ** 2);
    gateBars.push([x + Math.cos(yaw) * j * .275 - Math.sin(yaw) * .33, height * .5, z - Math.sin(yaw) * j * .275 - Math.cos(yaw) * .33, yaw, .061, height, .061]);
  }
  gateParts.push([x, 1.16, z, yaw, 2.6, .09, .73]);
}
instances(box, bronze, gateBars);
instances(box, bronze, gateParts);

const pennants = [];
for (let i = 0; i < 14; i++) {
  const a = (i + .36) / 14 * TAU;
  const [x, z, yaw] = arcPoint(a, 23.98);
  const g = new T.Group();
  g.rotation.y = yaw;
  g.position.set(x, 9.65, z);
  scene.add(g);
  const pin = addMesh(box, bronze, g, 0, 0, 0);
  pin.scale.set(2.22, .095, .14);
  for (const side of [-1, 1]) {
    const tip = addMesh(new T.SphereGeometry(.11, 8, 6), bronze, g, side * 1.16, 0, 0);
    tip.scale.set(1, .8, .8);
  }
  const geo = new T.PlaneGeometry(1.94, 3.87, 8, 12);
  const flag = addMesh(geo, flagMat, g, 0, -1.97, -.035);
  const pos = geo.attributes.position;
  const rest = pos.array.slice();
  for (let v = 0; v < pos.count; v++) {
    const bottom = smooth(-1.50, -1.93, rest[v * 3 + 1]);
    rest[v * 3 + 1] += bottom * (1 - Math.abs(rest[v * 3]) / .97) * .33;
  }
  pennants.push({ geo, rest, offset: i * 1.78 });
}

const crowdUniform = { time: { value: 0 }, cheer: { value: 0 } };
const crowdMat = standard(0xffffff);
crowdMat.onBeforeCompile = shader => {
  shader.uniforms.cTime = crowdUniform.time;
  shader.uniforms.cheer = crowdUniform.cheer;
  shader.vertexShader = 'uniform float cTime; uniform float cheer;\n' + shader.vertexShader.replace('#include <begin_vertex>', [
    '#include <begin_vertex>',
    'float person=instanceMatrix[3].x*1.97+instanceMatrix[3].z*1.21;',
    'transformed.y+=max(0.,sin(cTime*4.+person))*(.10+cheer*.34);',
    'transformed.x+=sin(cTime*2.6+person)*(.045+cheer*.08);'
  ].join('\n'));
};
const spectators = [], spectatorHeads = [];
const clothes = [0xb1605e, 0x926c83, 0xb6a194, 0x686d91, 0xb38761, 0x805565, 0x6a677b, 0xcb986b];
for (let row = 0; row < 5; row++) {
  const count = 101 + row * 15;
  for (let i = 0; i < count; i++) {
    const a = (i + rand() * .55) * TAU / count;
    if (Math.abs(Math.sin(a * 4)) < .12) continue;
    const [x, z, yaw] = arcPoint(a, 19.05 + row * 1.10 + rand() * .16);
    const h = 2.70 + row * .68;
    const size = .68 + rand() * .24;
    const color = clothes[Math.floor(rand() * clothes.length)];
    spectators.push([x, h + size * .36, z, yaw, size * .78, size * .96, size * .59, color]);
    spectatorHeads.push([x, h + size * .90, z, yaw, size * .26, size * .27, size * .24, [0xd6a289, 0xaf7365, 0xe1bb9d, 0x936668][i % 4]]);
  }
}
instances(new T.CylinderGeometry(.38, .65, 1, 6), crowdMat, spectators);
instances(new T.SphereGeometry(1, 7, 5), crowdMat, spectatorHeads);

const pillarBase = [], pillarShaft = [], pillarCaps = [], flutes = [], rubble = [];
for (const p of cover) {
  pillarBase.push([p.x, .13, p.z, .14, p.r * 1.20, .25, p.r * 1.20, 0xb78e79]);
  pillarBase.push([p.x, .37, p.z, 0, p.r * .97, .22, p.r * .97, 0xceaa8d]);
  pillarShaft.push([p.x, p.height * .5 + .15, p.z, 0, p.r * .79, p.height - .4, p.r * .79, 0xbe9b87]);
  for (let j = 0; j < 13; j++) {
    const a = j * TAU / 13;
    flutes.push([p.x + Math.cos(a) * p.r * .765, p.height * .5 + .17, p.z + Math.sin(a) * p.r * .765,
      0, .064, p.height - .58, .064, j % 2 ? 0xad826e : 0xd0ad92]);
  }
  pillarCaps.push([p.x, p.height - .10, p.z, .10, p.r * 1.9, .23, p.r * 1.9, 0xcda78c]);
  pillarCaps.push([p.x, p.height - .31, p.z, .10, p.r * 1.7, .14, p.r * 1.7, 0xa98272]);
}
for (let j = 0; j < 54; j++) {
  const a = rand() * TAU;
  const [x, z] = arcPoint(a, 16.8 + rand() * 1.02);
  rubble.push([x, .10, z, rand() * TAU, .13 + rand() * .68, .09 + rand() * .33, .15 + rand() * .52, j % 2 ? 0xb3856a : 0x9d715f, rand() * .35]);
}
instances(cylinder, rock, pillarBase, true);
instances(new T.CylinderGeometry(.91, 1.02, 1, 18), rock, pillarShaft, true);
instances(box, rock, pillarCaps, true);
instances(cylinder, rock, flutes);
instances(new T.DodecahedronGeometry(.75, 0), rock, rubble, true);

const torches = [];
const torchBowls = [], torchStems = [];
const floorGlow = new T.MeshBasicMaterial({ map: radial, color: 0xff8b43, transparent: true, opacity: .36, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
for (let i = 0; i < 13; i++) {
  const a = (i + .18) * TAU / 13;
  const [x, z, yaw] = arcPoint(a, 17.5);
  torchStems.push([x, 2.72, z, yaw, .18, .88, .18]);
  torchBowls.push([x, 3.07, z, yaw, .48, .39, .48]);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: radial, color: 0xff812e, opacity: .68, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
  glow.position.set(x, 3.57, z);
  glow.scale.set(4, 4, 1);
  scene.add(glow);
  const fire = new T.Group();
  fire.position.set(x, 3.24, z);
  const leaves = [];
  for (let j = 0; j < 3; j++) {
    const geo = new T.SphereGeometry(1, 7, 6);
    const flame = addMesh(geo, new T.MeshBasicMaterial({ color: [0xff984d, 0xffd183, 0xf75b32][j], toneMapped: false }), fire, (j - 1) * .18, .35, (j - 1) * .09);
    flame.scale.set(.19, .55 - j * .09, .17);
    leaves.push(flame);
  }
  scene.add(fire);
  torches.push({ leaves, glow });
  const floorLight = addMesh(new T.PlaneGeometry(6, 6), floorGlow, scene, x * .93, .014, z * .93);
  floorLight.rotation.x = -Math.PI / 2;
}
instances(cylinder, bronze, torchStems);
instances(new T.CylinderGeometry(1, .44, 1, 12), bronze, torchBowls);

const driftingCount = coarse ? 36 : 84;
const drifting = [];
const driftPos = new Float32Array(driftingCount * 3);
for (let i = 0; i < driftingCount; i++) drifting.push([rand() * 64 - 32, rand() * 9, rand() * 37 - 18.5, rand() * TAU]);
const dustGeometry = new T.BufferGeometry();
dustGeometry.setAttribute('position', new T.BufferAttribute(driftPos, 3));
const dust = new T.Points(dustGeometry, new T.PointsMaterial({
  color: 0xffbe7f, size: .14, map: radial, transparent: true, opacity: .47, depthWrite: false,
  blending: T.AdditiveBlending, toneMapped: false
}));
dust.frustumCulled = false;
scene.add(dust);

const romanSet = scene.children.filter(o => !o.isLight);
let flagUpdateAt = -Infinity;
function animateArena(time, dt) {
  showEnvironment();
  if (inMeadow()) { animateMeadow(time); return; }
  crowdUniform.time.value = settings.crowd ? time : 0;
  crowdUniform.cheer.value = Math.max(0, crowdUniform.cheer.value - dt * .68);
  if (settings.quality > 0 && time - flagUpdateAt >= 1 / 36) {
    flagUpdateAt = time;
    for (const { geo, rest, offset } of pennants) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const k = i * 3;
        const weight = (1.94 - rest[k + 1]) * .27;
        pos.setXYZ(i, rest[k], rest[k + 1], Math.sin(time * 1.75 + rest[k] * 2.25 + offset) * weight * .23);
      }
      pos.needsUpdate = true;
    }
  }
  for (const [i, { leaves, glow }] of torches.entries()) {
    glow.material.opacity = .5 + Math.sin(time * 6.1 + i) * .13;
    for (const [j, f] of leaves.entries()) {
      const wave = Math.sin(time * 12 + i * 2.7 + j * 1.3);
      f.scale.y = .40 + (.18 - j * .05) * wave;
      f.rotation.z = wave * .17;
    }
  }
  dust.visible = settings.quality > 0;
  if (dust.visible) {
    for (let i = 0; i < driftingCount; i++) {
      const [x, y, z, a] = drifting[i];
      dustGeometry.attributes.position.setXYZ(i, x + Math.sin(time * .30 + a) * 2, y + Math.sin(time * .5 + a) * .56, z + Math.cos(time * .32 + a) * 1.2);
    }
    dustGeometry.attributes.position.needsUpdate = true;
  }
}

const groveRoot = new T.Group();
scene.add(groveRoot);
const meadowRand = seeded(942821);
const meadowTone = new T.Color();
const foliageTime = { value: 0 };
const foliageShader = mat => {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uGroveTime = foliageTime;
    shader.vertexShader = 'uniform float uGroveTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', [
      '#include <begin_vertex>',
      '#ifdef USE_INSTANCING',
      'float phase=instanceMatrix[3].x*.084+instanceMatrix[3].z*.063;',
      'float flex=.32+.68*clamp(position.y+.5,0.,1.);',
      'transformed.x+=sin(uGroveTime*1.12+phase)*flex*.054;',
      'transformed.z+=cos(uGroveTime*.91+phase+position.y)*flex*.038;',
      '#endif'
    ].join('\n'));
  };
  return mat;
};
const meadowSun = new T.Vector3(-31, 49, -27);
const romanSun = sun.position.clone();
const meadowFog = new T.FogExp2(0x9fb7aa, .0048);
const romanFog = scene.fog;
const groveHemi = new T.Color(0xdbe8d7);
const groveGroundLight = new T.Color(0x586d60);
const groveSunColor = new T.Color(0xf4e2c6);
const baseHemi = hemisphere.color.clone();
const baseGroundLight = hemisphere.groundColor.clone();
const baseSunColor = sun.color.clone();
let activeEnvironment = '';

function groveBatch(geometry, material, transforms, cast = false) {
  const mesh = instances(geometry, material, transforms, cast);
  groveRoot.add(mesh);
  return mesh;
}
const groveSky = addMesh(new T.SphereGeometry(440, 40, 22), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vSky; void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: [
    'varying vec3 vSky;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}',
    'float fb(vec2 p){return n(p)*.57+n(p*2.07+vec2(7.,3.))*.24+n(p*4.04)*.12+n(p*8.2)*.07;}',
    'void main(){vec3 v=normalize(vSky);float h=max(0.,v.y);',
    ' vec3 color=mix(vec3(.82,.92,.80),vec3(.27,.66,.81),smoothstep(0.,.49,h));',
    ' color=mix(color,vec3(.20,.47,.71),smoothstep(.49,1.,h)*.7);',
    ' vec2 p=vec2(atan(v.z,v.x)*6.9, h*13.);p.x+=sin(h*5.)*.37;',
    ' float clouds=fb(p+vec2(17.,5.));float base=smoothstep(.49,.65,clouds)*(1.-smoothstep(.46,.72,h))*smoothstep(.035,.13,h);',
    ' float light=smoothstep(.54,.70,fb(p+vec2(17.07,5.12)));',
    ' vec3 cloud=mix(vec3(.71,.83,.84),vec3(1.,.985,.87),light);',
    ' vec3 sd=normalize(vec3(-31.,49.,-27.));float sunDot=max(0.,dot(v,sd));',
    ' color=mix(color,cloud,base*.97);',
    ' color+=vec3(.22,.12,.035)*pow(sunDot,17.);',
    ' color=mix(color,vec3(1.,.974,.79),smoothstep(.998,.9992,sunDot));',
    ' gl_FragColor=vec4(color,1.);}'
  ].join('\n')
}), groveRoot);
groveSky.renderOrder = -8;

const meadowFloorTex = texture(1024, 1024, (c, w, h) => {
  c.fillStyle = '#688458';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1500; i++) {
    const x = meadowRand() * w, y = meadowRand() * h, r = 6 + meadowRand() * 65;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, ['#d0ce8040', '#92ba6539', '#426e4b26', '#c5b26b29', '#72aa7930'][i % 5]);
    g.addColorStop(1, '#73945c00');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 17500; i++) {
    c.fillStyle = ['#d7db9159', '#c8d08a55', '#426f4946', '#3d684526', '#9eb57155'][i % 5];
    const x = meadowRand() * w, y = meadowRand() * h;
    c.fillRect(x, y, .7 + meadowRand() * 2.2, .4 + meadowRand() * 2.8);
  }
  c.strokeStyle = '#dcce9248';
  c.lineWidth = 18;
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * .209, h * .209, 0, 0, TAU);
  c.stroke();
  c.strokeStyle = '#dec99242';
  c.lineWidth = 3;
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * .233, h * .233, 0, 0, TAU);
  c.stroke();
});
const meadowFloor = addMesh(new T.PlaneGeometry(MEADOW_X*2+110, MEADOW_Z*2+110), standard(0xffffff, { map: meadowFloorTex, roughness: 1 }), groveRoot, 0, -.004, 0);
meadowFloor.rotation.x = -Math.PI / 2;
meadowFloor.receiveShadow = true;

const hillGeo = new T.IcosahedronGeometry(1, 3);
const hillTops = [];
for (let i = 0; i < 33; i++) {
  const angle = i * TAU / 33, outer = i % 3 === 0;
  const x = Math.cos(angle) * (outer ? 218 : 183), z = Math.sin(angle) * (outer ? 203 : 170);
  const colors = outer ? [0x769f99, 0x80a6a3, 0x76969b, 0x6d9a94] : [0x719559, 0x8ba768, 0x7ba163, 0x66916d];
  hillTops.push([x, outer ? -.8 : -2.7, z, angle, 15 + meadowRand() * 17, 4 + meadowRand() * (outer ? 15 : 8), 10 + meadowRand() * 16, colors[i % colors.length]]);
}
groveBatch(hillGeo, standard(0xffffff), hillTops);
const ridgeGeometry = new T.IcosahedronGeometry(1, 1);
const rockColors = [0x879584, 0xa5ae95, 0x74877b, 0xadb29b, 0x829480, 0x929c89];
const cliffPieces = [];
for (let i = 0; i < 29; i++) {
  const a = i * TAU / 29;
  if (i % 4 === 2) continue;
  const x = Math.cos(a) * (MEADOW_X+12), z = Math.sin(a) * (MEADOW_Z+12);
  cliffPieces.push([x, -1 + meadowRand() * 3, z, a, 3.2 + meadowRand() * 8, 5 + meadowRand() * 13, 2.4 + meadowRand() * 6,
    rockColors[i % rockColors.length], (meadowRand() - .5) * .4]);
}
groveBatch(ridgeGeometry, standard(0xffffff, { flatShading: true }), cliffPieces);

const roots = [], boughs = [], canopy = [], leafCaps = [], fieldTrees = meadowTrees.slice(0,21);
for (let i = 0; i < 25; i++) {
  const a = (i + meadowRand() * .37) / 25 * TAU;
  fieldTrees.push({ x: Math.cos(a) * (51 + meadowRand() * 15), z: Math.sin(a) * (39 + meadowRand() * 14), s: .78 + meadowRand() * .7 });
}
const crownColors = [0x35654f, 0x3d7058, 0x4b8060, 0x5c9068, 0x67966a, 0x70a070, 0x80a678, 0x8bac82];
const highlightLeaves = [0x8aaf7b, 0xa6be91, 0x77a77c, 0x8fb68d, 0x64966f, 0x78a17a];
const woodColors = [0x65554b, 0x6e6254, 0x886c56, 0x87745d, 0x786351];
const leafMesh = new T.IcosahedronGeometry(1, 2);
const leafVertices = leafMesh.attributes.position;
for (let j = 0; j < leafVertices.count; j++) {
  const x = leafVertices.getX(j), y = leafVertices.getY(j), z = leafVertices.getZ(j);
  const f = 1 + Math.sin(x * 9 + z * 11) * Math.cos(y * 14 + z * 4) * .09;
  leafVertices.setXYZ(j, x * f, y * f, z * f);
}
leafMesh.computeVertexNormals();
for (const [i, { x, z, s }] of fieldTrees.entries()) {
  const yaw = meadowRand() * TAU;
  const tone = woodColors[i % woodColors.length];
  roots.push([x, 1.84 * s, z, yaw, .63 * s, 3.70 * s, .62 * s, tone, -.074]);
  roots.push([x + .24 * s, 4.56 * s, z, yaw, .42 * s, 2.70 * s, .43 * s, tone, .145]);
  for (let j = 0; j < 5; j++) {
    const a = yaw + j * TAU / 5, d = (1.14 + meadowRand() * .35) * s;
    const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
    boughs.push([x + dx * .64, (4.17 + j * .21) * s, z + dz * .64, -a,
      .24 * s, 2.64 * s, .28 * s, tone, j % 2 ? .62 : -.59]);
  }
  const skyward = i % 6 !== 4;
  for (let j = 0; j < 9; j++) {
    const a = yaw + j * 2.39996, outer = j < 6;
    const r = (outer ? 1.55 + meadowRand() * 1.48 : .54 + meadowRand() * .48) * s;
    const h = (outer ? 5.06 + meadowRand() * .87 : (skyward ? 6.28 : 5.8) + meadowRand() * .70) * s;
    const xx = x + Math.cos(a) * r, zz = z + Math.sin(a) * r;
    const col = crownColors[(i * 3 + j) % crownColors.length];
    canopy.push([xx, h, zz, a, (1.75 + meadowRand() * 1.01) * s, (1.06 + meadowRand() * .49) * s,
      (1.51 + meadowRand() * .79) * s, col, (meadowRand() - .5) * .40]);
    for (let k = 0; k < 2; k++) {
      const off = a + k * 1.7;
      leafCaps.push([xx + Math.cos(off) * .85 * s, h + (.48 + k * .26) * s, zz + Math.sin(off) * .73 * s,
        off, (1.05 + meadowRand() * .42) * s, (.35 + meadowRand() * .45) * s, (1.10 + meadowRand() * .43) * s,
        highlightLeaves[(i + j + k) % highlightLeaves.length], (meadowRand() - .5) * .31]);
    }
  }
}
const bark = standard(0xffffff, { roughness: .94 });
groveBatch(new T.CylinderGeometry(.72, 1, 1, 9), bark, roots, true);
groveBatch(new T.CylinderGeometry(.56, 1, 1, 7), bark, boughs);
const leavesMaterial = foliageShader(standard(0xffffff, { roughness: .98, flatShading: true, emissive: 0x1a3b27, emissiveIntensity: .23 }));
groveBatch(leafMesh, leavesMaterial, canopy, true);
groveBatch(ridgeGeometry, leavesMaterial, leafCaps);

const meadowStones = [], mossPieces = [];
for (const [i, o] of meadowRocks.entries()) {
  const a = meadowRand() * TAU;
  meadowStones.push([o.x, .44, o.z, a, o.r * 1.12, o.height * .69, o.r * .86, rockColors[i % 6], -.21]);
  meadowStones.push([o.x + .62, .24, o.z - .84, a + 1.3, o.r * .51, .60, o.r * .40, rockColors[(i + 2) % 6], .25]);
  mossPieces.push([o.x - .43, o.height * .64, o.z + .26, a + .55, o.r * .70, .24, o.r * .57, 0x6c9a5e, .19]);
}
for (let i = 0; i < 185; i++) {
  const a = meadowRand() * TAU, distance = Math.sqrt(meadowRand());
  const x = Math.cos(a) * distance * 61, z = Math.sin(a) * distance * 47;
  if (Math.hypot(x / 12, z / 9) < 1.1) continue;
  const s = .13 + meadowRand() * .49;
  meadowStones.push([x, -.008, z, a, s * 1.5, s * .56, s * 1.1, rockColors[i % 6], .27]);
}
groveBatch(ridgeGeometry, standard(0xffffff, { flatShading: true }), meadowStones, true);
groveBatch(ridgeGeometry, standard(0xffffff, { flatShading: true }), mossPieces);

function bladePatch() {
  const points = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * .15, bend = i % 2 ? .18 : -.17, h = .38 + (i * 3 % 5) * .112;
    points.push(x - .069, 0, 0, x + .068, 0, .023, x + bend * .42, h * .53, .12,
      x + .068, 0, .023, x + bend * .73 + .026, h * .62, .14, x + bend * .42, h * .53, .12,
      x + bend * .42, h * .53, .12, x + bend * .73 + .026, h * .62, .14, x + bend, h, .24);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return geometry;
}
const grassMat = foliageShader(standard(0xffffff, { side: T.DoubleSide, roughness: 1, emissive: 0x375a2f, emissiveIntensity: .18 }));
const grass = bladePatch();
const meadowFlora = [0x627f50, 0x79945e, 0x6b8c59, 0x93a66c, 0x789462, 0x5b7c5a, 0x829b66, 0x4d795f];
const bloomColors = [0xe4e9ad, 0xffde83, 0xd4c3ee, 0xa2ddda, 0xeed0dc];
const flowerStalk = new T.CylinderGeometry(.018, .032, 1, 5);
const bloomGeo = new T.IcosahedronGeometry(.11, 0);
for (let tx = -2; tx <= 2; tx++) {
  for (let tz = -2; tz <= 2; tz++) {
    const patches = [], blossoms = [], stalks = [];
    for (let i = 0; i < 224; i++) {
      const x = (tx + meadowRand() - .5) * 29, z = (tz + meadowRand() - .5) * 22;
      if (Math.hypot(x / 72, z / 51) > 1.04 || Math.hypot(x / 10.1, z / 7.9) < .92 && meadowRand() < .93) continue;
      const s = .53 + meadowRand() * .91;
      patches.push([x, .007, z, meadowRand() * TAU, s, s, s, meadowFlora[i % 8]]);
      if (i % 8 === 1 && Math.hypot(x / 10, z / 8) > 1) {
        const height = .33 + meadowRand() * .43;
        stalks.push([x, height * .5, z, .3, 1, height, 1, 0x658e59]);
        blossoms.push([x, height, z, meadowRand() * TAU, 1.21, .60, 1.24, bloomColors[(i + tx * 5 + 40 + tz) % 5]]);
      }
    }
    for (const [geo, items] of [[grass, patches], [flowerStalk, stalks], [bloomGeo, blossoms]]) {
      if (!items.length) continue;
      const batch = groveBatch(geo, grassMat, items);
      batch.frustumCulled = true;
      batch.geometry = geo.clone();
      batch.geometry.boundingSphere = new T.Sphere(new T.Vector3(tx * 29, .4, tz * 22), 19.3);
    }
  }
}

const stonePath = [], stoneRing = [];
for (let i = 0; i < 63; i++) {
  const a = i / 63 * TAU;
  const x = Math.cos(a) * 13.8, z = Math.sin(a) * 11.3;
  stoneRing.push([x, .009, z, -a + Math.PI / 2, .56 + meadowRand() * .39, .085, .32 + meadowRand() * .27,
    rockColors[(i + 3) % rockColors.length], (meadowRand() - .5) * .08]);
}
for (let i = 0; i < 29; i++) {
  const s = (i - 14) / 14;
  const x = s * 32, z = -Math.sin(s * 2.15) * 18;
  if (Math.hypot(x / 14, z / 11) < 1.08) continue;
  stonePath.push([x, .035, z, .50 + meadowRand() * .6, 1.05 + meadowRand() * .7, .11, .64 + meadowRand() * .48,
    rockColors[(i + 3) % rockColors.length], 0]);
}
groveBatch(ridgeGeometry, standard(0xffffff, { flatShading: true }), [...stonePath, ...stoneRing]);

const groveLanterns = [], fence = [];
for (const [i, x, z] of [[0, -7.5, -11], [1, 7.5, -11], [2, -12.8, 6.5], [3, 13.6, 7.8], [4, 22, -16], [5, -27, 13]]) {
  const post = addMesh(cylinder, standard(0x675949), groveRoot, x, .95, z);
  post.scale.set(.15, 1.9, .15);
  const top = addMesh(new T.ConeGeometry(.42, .38, 6), standard(0x517263), groveRoot, x, 2.36, z);
  top.rotation.y = Math.PI * i * .15;
  const glass = addMesh(new T.IcosahedronGeometry(.25, 0), new T.MeshBasicMaterial({ color: 0xffe29d, toneMapped: false }), groveRoot, x, 2.07, z);
  glass.scale.y = 1.27;
  const glow = new T.Sprite(new T.SpriteMaterial({ map: radial, color: 0xffd994, transparent: true, opacity: .29,
    depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
  glow.position.set(x, 2.09, z);
  glow.scale.set(2.23, 2.23, 1);
  groveRoot.add(glow);
  groveLanterns.push(glow);
}
for (let i = 0; i < 21; i++) {
  const a = .79 + i * .071;
  const x = Math.cos(a) * -42, z = Math.sin(a) * -31;
  const c = 0x897251;
  fence.push([x, .49, z, -a, .22, 1.02, .24, c]);
  if (i < 20) fence.push([x + Math.sin(a) * 1.35, .64, z - Math.cos(a) * .94, -a + .42, 2.3, .15, .17, c]);
}
groveBatch(box, standard(0xffffff), fence);

const groveDriftCount = 66;
const groveDrift = Array.from({ length: groveDriftCount }, () => [(meadowRand() - .5) * 76, .8 + meadowRand() * 10,
  (meadowRand() - .5) * 63, meadowRand() * TAU]);
const driftMeadowGeo = new T.BufferGeometry();
driftMeadowGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(groveDriftCount * 3), 3));
const driftMeadow = new T.Points(driftMeadowGeo, new T.PointsMaterial({
  size: .24, color: 0xffffb8, transparent: true, opacity: .59, depthWrite: false, map: radial
}));
driftMeadow.frustumCulled = false;
groveRoot.add(driftMeadow);

function inMeadow() {
  return mode === 'lobby' || mode === 'public' || (mode === 'bot' && practiceOptions.arena === 'meadow');
}

// Extra free-roam grove: one instanced canopy batch, no draw call per tree.
{
  const trunkGeo = new T.CylinderGeometry(.19,.34,3.4,5);
  const crownGeo = new T.IcosahedronGeometry(1.9,0);
  const trunks = new T.InstancedMesh(trunkGeo, standard(0x615344), 110);
  const crowns = new T.InstancedMesh(crownGeo, foliageShader(standard(0x527e5e)), 110);
  const dummy = new T.Object3D();
  for(let i=0;i<110;i++){
    const side = i%4, a=meadowRand(), b=meadowRand();
    const x=side<2?(side===0?-1:1)*(43+a*40):(b-.5)*160;
    const z=side>=2?(side===2?-1:1)*(33+a*42):(b-.5)*145;
    dummy.position.set(x,1.7,z);dummy.rotation.set(0,b*6.28,0);dummy.scale.setScalar(.85+b*.5);dummy.updateMatrix();
    trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.y=4.1;dummy.scale.setScalar(.9+b*.65);dummy.updateMatrix();
    crowns.setMatrixAt(i,dummy.matrix);
    crowns.setColorAt(i,new T.Color().setHSL(.31+b*.06,.24,.28+b*.1));
  }
  trunks.castShadow=crowns.castShadow=true;
  trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;
  groveRoot.add(trunks,crowns);
}
// Water with transparent layered surface, shoreline and subtle shader ripple.
// The fish are simple colored shapes below the surface, not detailed 3D models.
const pondLife=[];
for(const [cx,cz,rx,rz] of [[-50,-31,12,8],[47,39,14,10],[52,-39,9,7]]){
  const rim=addMesh(new T.CircleGeometry(1,48),standard(0x7c8b70,{roughness:1}),groveRoot,cx,.012,cz);
  rim.rotation.x=-Math.PI/2;rim.scale.set(rx*1.12,rz*1.12,1);
  const bed=addMesh(new T.CircleGeometry(1,48),standard(0x315c54,{roughness:1}),groveRoot,cx,.016,cz);
  bed.rotation.x=-Math.PI/2;bed.scale.set(rx,rz,1);
  const waterMat=new T.MeshPhysicalMaterial({
    color:0x4a9d91,transparent:true,opacity:.70,roughness:.18,metalness:0,
    clearcoat:.65,clearcoatRoughness:.12,depthWrite:false,side:T.DoubleSide
  });
  const water=addMesh(new T.CircleGeometry(1,48),waterMat,groveRoot,cx,.055,cz);
  water.rotation.x=-Math.PI/2;water.scale.set(rx*.97,rz*.97,1);
  const ripples=[];
  for(let j=0;j<3;j++){
    const r=addMesh(new T.RingGeometry(.65+j*.95,.69+j*.95,36),
      new T.MeshBasicMaterial({color:0xc7e8d8,transparent:true,opacity:.17,depthWrite:false,side:T.DoubleSide}),
      groveRoot,cx+(j-1)*rx*.22,.068,cz+(j-1)*rz*.17);
    r.rotation.x=-Math.PI/2;r.scale.set(1,.75,1);ripples.push(r);
  }
  for(let j=0;j<7;j++){
    const fish=new T.Group();
    const body=new T.Mesh(new T.PlaneGeometry(.7,.23),new T.MeshBasicMaterial({
      color:[0xf4bc77,0xdee4c1,0xe29a7d,0x8eb7ab][j%4],side:T.DoubleSide,depthWrite:false
    }));
    body.rotation.x=-Math.PI/2;fish.add(body);
    const tail=new T.Mesh(new T.BufferGeometry(),body.material);
    // Fish tail drawn as a simple triangular fin
    tail.geometry.setAttribute('position',new T.Float32BufferAttribute([-.34,0,0,-.7,0,.18,-.7,0,-.18],3));
    fish.add(tail);groveRoot.add(fish);
    pondLife.push({fish,cx,cz,rx,rz,j,phase:meadowRand()*6.28,ripples:j===0?ripples:null});
  }
}
// Wind streaks and flat butterfly sprites share two batched BufferGeometries.
const breezeCount=72,butterflyCount=30;
const breezeGeo=new T.BufferGeometry(),butterflyGeo=new T.BufferGeometry();
breezeGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(breezeCount*6),3));
butterflyGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(butterflyCount*9),3));
const breeze=new T.LineSegments(breezeGeo,new T.LineBasicMaterial({
  color:0xd4eee0,transparent:true,opacity:.19,depthWrite:false
}));
const butterflies=new T.Mesh(butterflyGeo,new T.MeshBasicMaterial({
  color:0xffd8a5,side:T.DoubleSide,transparent:true,opacity:.84,depthWrite:false
}));
breeze.frustumCulled=false;butterflies.frustumCulled=false;
groveRoot.add(breeze,butterflies);
let groveAmbientFrame=0;
function animateGroveAmbient(time){
  if(!groveRoot.visible)return;
  // Animate at 20fps max, skip expensive decorative work on low quality.
  if(settings.quality===0||settings.reduced){breeze.visible=false;butterflies.visible=false;return;}
  breeze.visible=butterflies.visible=true;
  if(++groveAmbientFrame%3!==0)return;
  const bp=breezeGeo.attributes.position,fp=butterflyGeo.attributes.position;
  for(let i=0;i<breezeCount;i++){
    const t=time*.8+i*7.3,x=((i*17.93+t*6)%166)-83,z=((i*11.37+t*2)%148)-74,y=.9+(i%8)*.37;
    bp.setXYZ(i*2,x,y,z);bp.setXYZ(i*2+1,x+(.7+i%4*.3),y+.04,z+.13);
  }
  for(let i=0;i<butterflyCount;i++){
    const t=time*.55+i*2.4,x=Math.sin(t*.4+i*7.1)*68,z=Math.cos(t*.3+i*3.9)*61;
    const y=1.1+Math.sin(t*1.7+i)*.55+(i%4)*.25,flap=Math.abs(Math.sin(time*9+i));
    fp.setXYZ(i*3,x,y,z);fp.setXYZ(i*3+1,x-.18,y+.13*flap,z+.08);
    fp.setXYZ(i*3+2,x+.18,y+.13*flap,z+.08);
  }
  bp.needsUpdate=true;fp.needsUpdate=true;
  for(const p of pondLife){
    const t=time*.7+p.phase;
    p.fish.position.set(p.cx+Math.cos(t)*p.rx*.56,.043,p.cz+Math.sin(t)*p.rz*.56);
    p.fish.rotation.y=-t;
    if(p.ripples)for(let i=0;i<p.ripples.length;i++)p.ripples[i].material.opacity=.09+.08*Math.sin(time*1.4+i);
  }
}

const meadowBounds = { x: MEADOW_X, z: MEADOW_Z };
const romanBounds = { x: ARENA_X, z: ARENA_Z };
function arenaSize() { return inMeadow() ? meadowBounds : romanBounds; }
function showEnvironment() {
  const name = inMeadow() ? 'meadow' : 'rome';
  if (name === activeEnvironment) return;
  activeEnvironment = name;
  const meadow = name === 'meadow';
  groveRoot.visible = meadow;
  for (const mesh of romanSet) mesh.visible = !meadow;
  scene.fog = meadow ? meadowFog : romanFog;
  scene.background.setHex(meadow ? 0x9fb7aa : 0x594052);
  hemisphere.color.copy(meadow ? groveHemi : baseHemi);
  hemisphere.groundColor.copy(meadow ? groveGroundLight : baseGroundLight);
  hemisphere.intensity = meadow ? .86 : .83;
  sun.color.copy(meadow ? groveSunColor : baseSunColor);
  sun.position.copy(meadow ? meadowSun : romanSun);
  sun.intensity = meadow ? 1.28 : 1.53;
  rim.intensity = meadow ? .42 : .66;
  renderer.toneMappingExposure = meadow ? .91 : 1.05;
  sun.shadow.camera.left = meadow ? -57 : -36;
  sun.shadow.camera.right = meadow ? 57 : 36;
  sun.shadow.camera.top = meadow ? 49 : 30;
  sun.shadow.camera.bottom = meadow ? -49 : -30;
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
  document.body.classList.toggle('meadow', meadow);
}
function animateMeadow(time) {
  animateGroveAmbient(time);
  foliageTime.value = settings.reduced ? 0 : time;
  for (const [i, glow] of groveLanterns.entries()) glow.material.opacity = .30 + Math.sin(time * 3 + i) * .065;
  const attribute = driftMeadowGeo.attributes.position;
  if (settings.quality === 0 || settings.reduced) { driftMeadow.visible = false; return; }
  driftMeadow.visible = true;
  for (const [i, [x, y, z, p]] of groveDrift.entries()) {
    attribute.setXYZ(i, x + Math.sin(time * .41 + p) * 3, y + Math.sin(time * .62 + p) * .56, z + Math.cos(time * .33 + p) * 2.3);
  }
  attribute.needsUpdate = true;
}

const fightRing = new T.Group();
fightRing.position.set(MEADOW_RING_X, 0, MEADOW_RING_Z);
groveRoot.add(fightRing);
fightRing.visible = false;

const ringTile = standard(0xb69e74, { roughness: .93 });
const tile = addMesh(new T.CircleGeometry(MEADOW_RING_RADIUS, 96), ringTile, fightRing, 0, .016, 0);
tile.rotation.x = -Math.PI / 2;
tile.receiveShadow = true;
tile.renderOrder = -1;
const ringBorder = new T.MeshBasicMaterial({ color: 0xffcc74, transparent: true, opacity: .93, side: T.DoubleSide, toneMapped: false });
const ringDark = new T.MeshBasicMaterial({ color: 0x3f492e, side: T.DoubleSide, toneMapped: false });
const ringSoft = new T.MeshBasicMaterial({ color: 0xf5c870, transparent: true, opacity: .18,
  depthWrite: false, side: T.DoubleSide, toneMapped: false });
function fightTrim(inner, outer, y, material) {
  const piece = addMesh(new T.RingGeometry(inner, outer, 96), material, fightRing, 0, y, 0);
  piece.rotation.x = -Math.PI / 2;
  return piece;
}
fightTrim(MEADOW_RING_RADIUS - .24, MEADOW_RING_RADIUS + .19, .026, ringDark);
fightTrim(MEADOW_RING_RADIUS - .083, MEADOW_RING_RADIUS + .072, .035, ringBorder);
fightTrim(MEADOW_RING_RADIUS + .082, MEADOW_RING_RADIUS + .47, .034, ringSoft);
fightTrim(MEADOW_RING_RADIUS - .58, MEADOW_RING_RADIUS - .50, .033,
  new T.MeshBasicMaterial({ color: 0x72583d, transparent: true, opacity: .6, side: T.DoubleSide }));

const crestTexture = texture(512, 512, (c, w) => {
  c.clearRect(0, 0, w, w);
  c.translate(w * .5, w * .5);
  c.strokeStyle = '#4e3c28';
  c.fillStyle = '#4e3c28';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 10;
  c.beginPath();
  c.arc(0, 0, 153, 0, TAU);
  c.stroke();
  c.lineWidth = 7;
  c.beginPath();
  c.arc(0, 0, 129, 0, TAU);
  c.stroke();
  c.beginPath();
  c.moveTo(-75, 45);
  c.bezierCurveTo(-92, -12, -54, -71, 0, -71);
  c.bezierCurveTo(52, -71, 93, -14, 75, 45);
  c.quadraticCurveTo(0, 75, -75, 45);
  c.stroke();
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(side * 27, -15, 7, 15, 0, 0, TAU);
    c.fill();
    for (let i = 0; i < 6; i++) {
      const a = -.87 + i * .245;
      c.beginPath();
      c.ellipse(side * Math.cos(a) * 176, Math.sin(a) * 179, 16, 5, side * (a - .6), 0, TAU);
      c.fill();
    }
  }
  c.beginPath();
  c.arc(0, 8, 23, .19 * Math.PI, .81 * Math.PI);
  c.stroke();
});
const ringCrest = addMesh(new T.PlaneGeometry(7.1, 7.1), new T.MeshBasicMaterial({
  map: crestTexture, transparent: true, opacity: .34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3
}), fightRing, 0, .027, 0);
ringCrest.rotation.x = -Math.PI / 2;

const markers = [];
for (let i = 0; i < 12; i++) {
  const a = (i + .5) / 12 * TAU;
  const x = Math.cos(a) * (MEADOW_RING_RADIUS + .56), z = Math.sin(a) * (MEADOW_RING_RADIUS + .56);
  markers.push([x, .077, z, -a, .39, .14, .26, i % 3 ? 0xb29b70 : 0xe2b673]);
}
fightRing.add(groveBatch(new T.CylinderGeometry(1, 1.12, 1, 6), standard(0xffffff, { roughness: .77 }), markers));

const gateTexture = texture(768, 224, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#263d32';
  c.fillRect(14, 15, w - 28, h - 30);
  c.strokeStyle = '#e0bc78';
  c.lineWidth = 8;
  c.strokeRect(21, 22, w - 42, h - 44);
  c.strokeStyle = '#70845d';
  c.lineWidth = 2;
  c.strokeRect(35, 34, w - 70, h - 68);
  c.fillStyle = '#ffe5b3';
  c.font = 'bold 79px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('FIGHT RING', w * .5, h * .48);
  c.fillStyle = '#dfbe82';
  for (const x of [78, w - 78]) {
    c.beginPath();
    c.moveTo(x, h * .53 - 12);
    c.lineTo(x + 9, h * .53);
    c.lineTo(x, h * .53 + 12);
    c.lineTo(x - 9, h * .53);
    c.closePath();
    c.fill();
  }
});
const sign = new T.Sprite(new T.SpriteMaterial({ map: gateTexture, transparent: true, depthWrite: false, toneMapped: false }));
sign.position.set(0, 2.9, MEADOW_RING_RADIUS + 1.32);
sign.scale.set(5.25, 1.55, 1);
fightRing.add(sign);
const standWood = standard(0x756044);
for (const x of [-2.08, 2.08]) {
  const post = addMesh(cylinder, standWood, fightRing, x, 1.33, MEADOW_RING_RADIUS + 1.32);
  post.scale.set(.11, 2.66, .11);
}
function animateFightRing(time) {
  fightRing.visible = mode === 'public';
  if (!fightRing.visible) return;
  ringSoft.opacity = settings.reduced ? .19 : .20 + Math.sin(time * 1.7) * .085;
}

/* Pose offsets are visual only. Room movement and hit reactions stay authoritative. */
function meadowPose(p, dt, m) {
  const target = ROOM_EMOTES[p.emote || 0];
  const key = !p.attack && !p.knockedOut && p.hp > 0 && !m.rag && target ? target.key : 'none';
  const rate = damp(14, dt);
  if (!m.socialPose) m.socialPose = { kind: 'none', weight: 0, age: 0, y: 0, roll: 0, yaw: 0, width: 1, height: 1, arm: 0, wave: 0 };
  const pose = m.socialPose;
  if (key !== pose.kind && key !== 'none') {
    pose.kind = key;
    pose.age = p.emoteAge || 0;
    pose.weight = 0;
  }
  pose.weight = lerp(pose.weight, key === 'none' ? 0 : 1, rate);
  if (key !== 'none') pose.age = Math.max(0, p.emoteAge ?? pose.age + dt);
  const weight = pose.weight;
  const motion = settings.reduced ? .32 : 1;
  let y = 0, roll = 0, yaw = 0, width = 1, height = 1, arm = 0, wave = 0;
  if (pose.kind === 'sit') {
    height = .61;
    width = 1.21;
    arm = -.29;
  } else if (pose.kind === 'dance') {
    const beat = pose.age * TAU * 1.85;
    y = (.09 + Math.abs(Math.sin(beat)) * .25) * motion;
    roll = Math.sin(beat * .5) * .26 * motion;
    yaw = Math.sin(beat * .5) * .24 * motion;
    height = .94 + Math.cos(beat * 2) * .14 * motion;
    width = 1 / Math.sqrt(height);
    arm = .59 + Math.sin(beat) * .28 * motion;
    wave = Math.sin(beat + .6) * .26 * motion;
  } else if (pose.kind === 'wave') {
    arm = .12;
    wave = (.70 + Math.sin(pose.age * 19) * .31 * motion) * smooth(0, .17, pose.age);
    roll = -.13 * motion;
  } else if (pose.kind === 'spin') {
    yaw = TAU * smooth(0, 1.09, pose.age) * motion;
    y = Math.sin(Math.PI * clamp(pose.age / 1.15, 0, 1)) * .34 * motion;
    arm = .62;
    roll = .13 * Math.sin(pose.age * 11) * motion;
  } else if (pose.kind === 'bounce') {
    const beat = pose.age * TAU * 2.1;
    y = Math.abs(Math.sin(beat)) * .54 * motion;
    height = 1.03 + Math.cos(beat * 2) * .20 * motion;
    width = 1 / Math.sqrt(height);
    arm = .31 + Math.sin(beat) * .22 * motion;
  }
  const tap = m.playTapAt === undefined || p.attack || m.rag ? 0 : clamp((performance.now() - m.playTapAt) / 425, 0, 1);
  const ripple = tap > 0 && tap < 1 ? Math.sin(tap * Math.PI * 2.6) * (1 - tap) * .14 * motion : 0;
  pose.y = y * weight;
  pose.roll = roll * weight + ripple;
  pose.yaw = yaw * weight;
  pose.width = lerp(1, width, weight) + ripple * .40;
  pose.height = lerp(1, height, weight) - ripple * .55;
  pose.arm = arm * weight;
  pose.wave = wave * weight;
  return pose;
}

const sphere = new T.SphereGeometry(1, 22, 15);
const smallSphere = new T.SphereGeometry(1, 12, 9);
const skinGeometry = new T.LatheGeometry([
  [0, .04], [.44, .045], [.81, .08], [1.03, .15], [1.13, .26], [1.17, .43],
  [1.15, .64], [1.08, .85], [.99, 1.05], [.88, 1.23], [.72, 1.43],
  [.53, 1.58], [.30, 1.69], [.15, 1.73], [0, 1.75]
].map(([x, y]) => new T.Vector2(x, y)), 64);
const bellyGeometry = new T.CircleGeometry(.49, 44);
bellyGeometry.rotateX(Math.PI / 2);
bellyGeometry.translate(0, .042, 0);
const ink = new T.MeshBasicMaterial({ color: 0x130f1b, side: T.BackSide, toneMapped: false });
const gelInk = new T.MeshBasicMaterial({ color: 0x142322, side: T.BackSide, toneMapped: false });
const gelDetail = texture(256, 256, (ctx, width, height) => {
  const random = seeded(744821);
  const depth = ctx.createLinearGradient(0, height, 0, 0);
  depth.addColorStop(0, '#a6a6a6');
  depth.addColorStop(.23, '#d0d0d0');
  depth.addColorStop(.64, '#f4f4f4');
  depth.addColorStop(1, '#fff');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 65; i++) {
    const x = random() * width;
    const y = height * (.18 + random() * .72);
    const radius = .65 + Math.pow(random(), 2.6) * 3.7;
    for (const cx of [x - width, x, x + width]) {
      if (cx + radius < 0 || cx - radius > width) continue;
      const bubble = ctx.createRadialGradient(cx - radius * .26, y - radius * .27, 0, cx, y, radius);
      bubble.addColorStop(0, '#fff9');
      bubble.addColorStop(.38, '#fffa');
      bubble.addColorStop(.70, '#6664');
      bubble.addColorStop(1, '#6660');
      ctx.fillStyle = bubble;
      ctx.fillRect(cx - radius, y - radius, radius * 2, radius * 2);
    }
  }
});

function addGelScattering(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
    #include <emissivemap_fragment>
    vec3 gelView = normalize(vViewPosition);
    float gelFacing = clamp(dot(normal, gelView), 0.0, 1.0);
    float gelEdge = pow(1.0 - gelFacing, 2.2);
    float gelBacklight = 0.0;
    #if NUM_DIR_LIGHTS > 0
      gelBacklight = max(dot(-gelView, directionalLights[0].direction), 0.0);
    #endif
    totalEmissiveRadiance += diffuseColor.rgb * gelEdge * (0.11 + 0.40 * gelBacklight);
  `).replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', `
    // A broad, sky-facing reflection complements the sharp direct-light clearcoat.
    vec3 gelReflected = inverseTransformDirection(reflect(-gelView, normal), viewMatrix);
    float skyBand = smoothstep(-0.13, 0.32, gelReflected.y);
    outgoingLight += vec3(0.62, 0.78, 0.87) * skyBand * (0.021 + gelEdge * 0.23);
    gl_FragColor = vec4( outgoingLight, diffuseColor.a );
  `);
}

const eyeDark = standard(0x251a33, { roughness: .27 });
const white = standard(0xffefd5, { roughness: .51, emissive: 0x634653, emissiveIntensity: .2 });
const sparkle = new T.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false });
const mouthMat = new T.MeshBasicMaterial({ color: 0x271528, toneMapped: false });
const cheekMat = standard(0xc97772, { roughness: .56 });
const tongueMat = standard(0xeb627a, { roughness: .46 });
const goldMat = standard(0xeaa64e, { roughness: .37, metalness: .24, emissive: 0x99471a, emissiveIntensity: .19 });
const paleGold = standard(0xffcf75, { roughness: .39, metalness: .19, emissive: 0x954a21, emissiveIntensity: .14 });
const leather = standard(0x6d303e, { roughness: .86 });
const starGeo = (() => {
  const path = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU + Math.PI / 2;
    const r = i % 2 === 0 ? .18 : .079;
    if (i === 0) path.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  path.closePath();
  return new T.ExtrudeGeometry(path, { depth: .035, bevelEnabled: true, bevelThickness: .013, bevelSize: .011, bevelSegments: 1 });
})();

function ellipsoid(parent, material, x, y, z, sx, sy, sz, geo = sphere) {
  const m = addMesh(geo, material, parent, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function outline(part, scale, material = ink) {
  const m = addMesh(part.geometry, material, part);
  m.scale.setScalar(scale);
  return m;
}
function curveTube(points, width, material, parent) {
  const path = new T.CatmullRomCurve3(points.map(point => new T.Vector3(...point)));
  return addMesh(new T.TubeGeometry(path, 12, width, 6, false), material, parent);
}
function makeFighter(index) {
  const root = new T.Group();
  const tilt = new T.Group();
  const jelly = new T.Group();
  const face = new T.Group();
  scene.add(root);
  root.add(tilt);
  tilt.add(jelly);
  jelly.add(face);

  const fill = new T.MeshPhysicalMaterial({
    color: 0xffffff, map: gelDetail, roughness: .25, metalness: 0,
    clearcoat: .82, clearcoatRoughness: .19,
    emissive: 0x102945, emissiveIntensity: .19
  });
  fill.onBeforeCompile = addGelScattering;
  const body = addMesh(skinGeometry, fill, jelly);
  body.castShadow = true;
  body.receiveShadow = true;
  addMesh(bellyGeometry, fill, jelly);
  const shell = outline(body, 1.014, gelInk);
  shell.position.y = -.008;

  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new T.Group();
    eye.position.set(side * .338, 1.119, .91);
    eye.rotation.y = side * .26;
    face.add(eye);
    ellipsoid(eye, eyeDark, 0, 0, .017, .26, .291, .116);
    ellipsoid(eye, white, 0, .007, .072, .225, .247, .123);
    const pupil = new T.Group();
    pupil.position.set(.018, .003, .168);
    eye.add(pupil);
    ellipsoid(pupil, eyeDark, 0, 0, 0, .104, .145, .055, smallSphere);
    ellipsoid(pupil, sparkle, -.030, .056, .043, .031, .038, .022, smallSphere);
    ellipsoid(pupil, sparkle, .038, -.045, .041, .014, .018, .015, smallSphere);
    const brow = ellipsoid(face, eyeDark, side * .351, 1.395, .738, .199, .052, .059, smallSphere);
    brow.rotation.y = side * .32;
    const cheek = ellipsoid(face, cheekMat, side * .65, .865, .889, .133, .066, .039, smallSphere);
    cheek.rotation.y = side * .62;
    eyes.push({ side, eye, pupil, brow });
  }
  const mouth = new T.Group();
  mouth.position.set(0, .783, 1.039);
  face.add(mouth);
  ellipsoid(mouth, mouthMat, 0, 0, 0, .225, .153, .072);
  const tongue = ellipsoid(mouth, tongueMat, 0, -.061, .064, .105, .039, .031, smallSphere);
  const teeth = ellipsoid(mouth, white, 0, .054, .059, .138, .041, .029, smallSphere);
  const smile = curveTube([[-.183, .822, 1.033], [-.1, .767, 1.09], [0, .743, 1.108], [.11, .756, 1.088], [.188, .818, 1.032]], .026, mouthMat, face);
  const pout = curveTube([[-.11, .776, 1.071], [0, .802, 1.107], [.11, .776, 1.071]], .026, mouthMat, face);

  const crown = new T.Group();
  crown.position.set(0, 1.53, .02);
  crown.rotation.set(.09, 0, -.06);
  jelly.add(crown);
  const band = addMesh(new T.TorusGeometry(.60, .036, 7, 40), leather, crown);
  band.rotation.x = -Math.PI / 2;
  band.scale.y = 1.01;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = .11 + i * .31;
      const x = Math.cos(a) * .59 * side;
      const z = Math.sin(a) * -.60 - .03;
      const leaf = ellipsoid(crown, i % 2 ? goldMat : paleGold, x, .035 + i * .012, z, .087, .213, .038, smallSphere);
      leaf.rotation.set(-.59 + i * .08, side * .32, -side * (.66 + i * .08));
      outline(leaf, 1.12);
    }
  }
  const buckle = ellipsoid(crown, goldMat, 0, .01, .606, .125, .105, .052, smallSphere);
  outline(buckle, 1.10);
  const rearTie = ellipsoid(crown, leather, 0, -.031, -.612, .115, .096, .057, smallSphere);
  rearTie.rotation.z = .31;
  for (const side of [-1, 1]) {
    const tie = ellipsoid(crown, leather, side * .068, -.147, -.628, .049, .139, .040, smallSphere);
    tie.rotation.z = side * .39;
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new T.Group();
    shoulder.position.set(side * .83, .62, .03);
    jelly.add(shoulder);
    const limb = ellipsoid(shoulder, fill, side * .24, 0, 0, .37, .158, .178);
    outline(limb, 1.038, gelInk);
    const palm = new T.Group();
    palm.position.set(side * .56, 0, 0);
    shoulder.add(palm);
    const hand = ellipsoid(palm, fill, 0, 0, 0, .267, .253, .143);
    outline(hand, 1.036, gelInk);
    for (let f = 0; f < 3; f++) {
      const digit = ellipsoid(palm, fill, (f - 1) * .138, .192 + (f === 1 ? .034 : 0), .015, .088, .145, .085, smallSphere);
      digit.rotation.z = (1 - f) * .14;
      outline(digit, 1.045, gelInk);
    }
    const thumb = ellipsoid(palm, fill, -side * .235, .014, .041, .098, .139, .091, smallSphere);
    thumb.rotation.z = side * .56;
    outline(thumb, 1.05, gelInk);
    arms.push({ side, shoulder, palm });
  }

  const dizzy = new T.Group();
  for (let i = 0; i < 3; i++) {
    const star = addMesh(starGeo, i % 2 ? goldMat : paleGold, dizzy);
    outline(star, 1.11);
  }
  dizzy.visible = false;
  scene.add(dizzy);
  const shadow = addMesh(new T.PlaneGeometry(3.55, 3.55), new T.MeshBasicMaterial({
    map: shadeTexture, color: 0x25162a, transparent: true, opacity: .66, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3
  }), scene, 0, .024 + .002 * index, 0);
  shadow.rotation.x = -Math.PI / 2;
  return { root, tilt, jelly, face, fill, eyes, mouth, smile, pout, tongue, teeth, arms, crown, shadow, dizzy,
    x: 0, z: 0, yaw: 0, inkColor: -1, bob: 0, hopPhase: 0, wobble: 0, wobbleSpeed: 0, hitX: 0, hitZ: 0, rag: null };
}
const fighters = [makeFighter(0), makeFighter(1)];
function setFighterColor(m, index) {
  if (m.inkColor === index) return;
  const color = palette[index] || palette[0];
  m.fill.color.setHex(color.body);
  m.fill.emissive.setHex(color.dark);
  m.inkColor = index;
}
function snapFighters() {
  fighters.forEach((m, i) => {
    const p = state.p[i];
    m.x = p.x;
    m.z = p.z;
    m.yaw = p.r;
    m.bob = 0;
    m.hopPhase = 0;
    m.wobble = 0;
    m.wobbleSpeed = 0;
    m.rag = null;
  });
}

function animateRag(m, dt, audible = true) {
  const rag = m.rag;
  rag.age += dt;
  if (!rag.rest) {
    rag.vy -= 19 * dt;
    rag.x += rag.vx * dt;
    rag.y += rag.vy * dt;
    rag.z += rag.vz * dt;
    const bounds = arenaSize();
    const edge = Math.hypot(rag.x / bounds.x, rag.z / bounds.z);
    if (edge > 1) {
      rag.x /= edge;
      rag.z /= edge;
      rag.vx *= -.33;
      rag.vz *= -.33;
    }
    for (const o of runCover()) {
      const dx = rag.x - o.x, dz = rag.z - o.z, d = Math.hypot(dx, dz), size = o.r + .72;
      if (d >= size || rag.y > o.height || d < .001) continue;
      const nx = dx / d, nz = dz / d;
      rag.x = o.x + nx * size;
      rag.z = o.z + nz * size;
      const inward = Math.min(0, rag.vx * nx + rag.vz * nz);
      rag.vx -= inward * nx * 1.55;
      rag.vz -= inward * nz * 1.55;
    }
    rag.rx += rag.spinX * dt;
    rag.rz += rag.spinZ * dt;
    if (rag.y < .09 && rag.vy < 0) {
      const speed = -rag.vy;
      rag.y = .09;
      if (speed > 2.0) {
        rag.vy = speed * .37;
        rag.vx *= .59;
        rag.vz *= .59;
        rag.spinX *= .45;
        rag.spinZ *= .45;
        rag.squash = .35;
        if (rag.bounces++ < 2 && audible) {
          playSound('bounce', rag.x, rag.z);
          particles(rag.x, .23, rag.z, 15, 0xdca279, 4, 1.4, .46, 'dust');
          shockRing(rag.x, .037, rag.z, .42, 2.25, 0xffd3a0, .33, .48);
        }
      } else {
        rag.rest = true;
        rag.restX = Math.round(rag.rx / TAU) * TAU + .13;
        rag.restZ = Math.round(rag.rz / TAU) * TAU + Math.sign(rag.rz || 1) * 1.28;
      }
    }
  } else {
    rag.rx = lerp(rag.rx, rag.restX, damp(8, dt));
    rag.rz = lerp(rag.rz, rag.restZ, damp(8, dt));
  }
  rag.squash = Math.max(0, rag.squash - dt * 1.82);
}
const rotatedCenter = new T.Vector3();
function animateFighters(dt, time) {
  for (const [i, m] of fighters.entries()) {
    const p = renderedPose(i);
    const present = p.active && !(mode === 'public' && i === 1);
    m.root.visible = m.shadow.visible = present;
    m.dizzy.visible = false;
    if (!present) continue;
    const dx = p.x - m.x, dz = p.z - m.z;
    m.x += dx * damp(mode === 'guest' ? 23 : 28, dt);
    m.z += dz * damp(mode === 'guest' ? 23 : 28, dt);
    m.yaw += angleDiff(m.yaw, p.r) * damp(20, dt);
    const speed = clamp(Math.hypot(p.vx, p.vz) / 7.5, 0, 1.25);
    const dash = p.dashTime > 0;
    const hurt = p.stun > .035 || p.hit > .04;
    const knock = m.rag;
    const age = p.duration - p.attackTime;
    const isSlap = p.attack === 'slap';
    const isSpit = p.attack === 'spit';
    const isNova = p.attack === 'nova';
    const at = p.contactTime || moves.nova.contact;
    const anticipation = smooth(0, Math.max(.08, at - .047), age);
    const snap = smooth(at - .052, at + .043, age);
    const settle = smooth(at + .05, Math.max(at + .10, p.duration), age);
    const pose = isSlap ? (snap - anticipation * .53) * (1 - settle) : 0;
    const puff = isSpit ? anticipation * (1 - snap) : 0;
    const recoil = isSpit ? snap * (1 - settle) : 0;
    const flex = isNova ? Math.sin(clamp(age / p.duration, 0, 1) * Math.PI) : 0;
    const heavy = p.combo === 2 || p.countering;
    const side = p.combo === 1 ? -1 : 1;
    m.hopPhase += dt * (5 + speed * 9);
    m.bob = lerp(m.bob, Math.abs(Math.sin(m.hopPhase)) * .155 * speed, damp(15, dt));
    m.wobbleSpeed += (-125 * m.wobble - 14 * m.wobbleSpeed) * dt;
    m.wobble += m.wobbleSpeed * dt;
    const breath = Math.sin(time * 3.2 + i * 2) * .020;
    if (knock) animateRag(m, dt);
    const ragY = knock ? knock.y : 0;
    const rootX = knock ? knock.x : m.x;
    const rootZ = knock ? knock.z : m.z;

    const victor = state.phase === 'over' && state.run ? state.run.winner : state.winner;
    const celebrating = !knock && victor === i && ['round', 'over'].includes(state.phase) && state.wait < 2.44;
    const cheer = celebrating ? (.5 + Math.sin(time * 8.8) * .5) : 0;
    const growthRank = skillRank(p, 'colossus');
    const growthAge = clamp(1 - p.growth / 1.8, 0, 1);
    const swell = p.growth > 0 && !settings.reduced ? Math.sin(growthAge * Math.PI * growthRank) * (1 - growthAge) * .17 : 0;
    const physicalSize = p.growth > 0 ? lerp(1 + (skills.colossus.levels[growthRank - 2]?.size || 0), p.size, smooth(0, .66, growthAge)) : p.size;
    const stretch = clamp(1 + breath + swell + m.bob * .63 + m.wobble * .27 - (dash ? .25 : 0) - puff * .11 + recoil * .19 + flex * .21 + cheer * .10 + pose * (heavy ? .29 : .16) - (knock ? knock.squash : 0), .49, 1.63);
    m.root.position.set(rootX, p.air, rootZ);
    m.root.rotation.set(knock ? knock.rx : 0, 0, knock ? knock.rz : 0);
    if (knock) {
      const halfHeight = .85 * stretch * physicalSize;
      rotatedCenter.set(0, halfHeight, 0).applyQuaternion(m.root.quaternion);
      const upright = rotatedCenter.y / halfHeight;
      const footprint = 1.135 * physicalSize / Math.sqrt(stretch);
      const clearance = Math.hypot(upright * halfHeight, Math.sqrt(Math.max(0, 1 - upright ** 2)) * footprint);
      m.root.position.set(rootX - rotatedCenter.x, ragY + clearance - rotatedCenter.y, rootZ - rotatedCenter.z);
      m.dizzy.visible = knock.rest;
      if (knock.rest) {
        m.dizzy.position.set(rootX, ragY + clearance + 1.18, rootZ);
        for (const [j, star] of m.dizzy.children.entries()) {
          const t = (settings.reduced ? 0 : time * 3.7) + j / 3 * TAU;
          star.position.set(Math.cos(t) * .77, .13 * Math.sin(t * 2), Math.sin(t) * .57);
          star.rotation.set(.14, t * .55, Math.sin(t) * .28);
        }
      }
    }
    m.tilt.rotation.set(hurt && !knock ? m.hitZ * m.wobble * .67 : 0, m.yaw, hurt && !knock ? -m.hitX * m.wobble * .67 : 0, 'YXZ');
    m.jelly.position.set(0, dash || knock ? 0 : m.bob + cheer * .15, 0);
    m.jelly.scale.set((1 + puff * .17) / Math.sqrt(stretch), stretch, (1 + puff * .11 + (dash ? .20 : 0)) / Math.sqrt(stretch));
    m.jelly.scale.multiplyScalar(physicalSize);
    m.jelly.rotation.set(dash ? .32 : recoil * -.20 - speed * .04, pose * side * -.34, pose * side * -.23 + breath * .5);
    m.face.rotation.x = puff * -.065 + recoil * -.10;
    m.crown.rotation.z = -.06 + pose * -.22 * side + Math.sin(time * 4 + i) * .018 + m.wobble * .20;
    m.shadow.position.set(rootX, .024 + .002 * i, rootZ);
    m.shadow.scale.setScalar(physicalSize + (ragY + p.air) * .11);
    m.shadow.material.opacity = .67 / (1 + (ragY + p.air) * .7);
    setFighterColor(m, p.color);
    slimoLook(m,p,time);
    if(ownerWave?.slot===i&&ownerWave.until>performance.now()&&p.owner) m.jelly.rotation.z+=Math.sin(time*19)*.22;
    const fire = skillRank(p, 'fire');
    if (isSpit && fire) m.fill.emissive.setHex(0xf05d25);
    else if (p.chill > 0) m.fill.emissive.setHex(0x258fc0);
    else m.fill.emissive.setHex(palette[p.color].dark);
    m.fill.emissiveIntensity = isSpit && fire ? .30 + puff * fire * .26 : p.hit > .08 ? .50 : isNova ? .34 + flex * .56 : .19;

    const rival = state.p[1 - i];
    const glance = mode === 'lobby' ? -.14 : clamp(angleDiff(m.yaw, Math.atan2(rival.x - p.x, rival.z - p.z)) * .26, -.24, .24);
    const blink = (time + i * 1.71) % 4.06;
    const grimace = hurt || !!knock;
    for (const e of m.eyes) {
      const wince = knock ? (knock.rest ? .14 : .91) : hurt ? (e.side === side ? .28 : .79) : 1;
      e.eye.scale.set(1 + (knock && !knock.rest ? .11 : puff * .05), wince * (blink < .115 && !grimace ? .14 + .86 * Math.abs(blink - .057) / .057 : 1 + flex * .14), 1);
      e.pupil.position.x = .018 + glance * .35 + (knock && !knock.rest ? Math.sin(time * 21 + e.side) * .056 : 0);
      e.pupil.position.y = knock && !knock.rest ? .043 : -.016 + pose * .045;
      e.pupil.scale.setScalar(knock && !knock.rest ? .63 : 1 - puff * .15);
      e.brow.rotation.z = e.side * (grimace ? -.34 : isSlap || isNova ? .44 * (1 - settle) : puff * -.30);
      e.brow.position.y = 1.395 + (knock && !knock.rest ? .075 : 0) + puff * .056;
    }
    m.smile.visible = !isSpit && !grimace && !isNova && !celebrating;
    m.pout.visible = isSpit && age < at * .46 && !grimace;
    m.mouth.visible = !m.smile.visible && !m.pout.visible;
    m.mouth.scale.set(grimace ? 1.18 : isSpit ? .69 + recoil * .64 : 1.20, grimace ? .88 + (knock ? .25 : 0) : .72 + puff * .32 + recoil * .69, 1);
    m.tongue.visible = !isSpit || grimace;
    m.tongue.position.set(knock && knock.rest ? .07 : 0, knock && knock.rest ? -.14 : -.061, .064);
    m.tongue.scale.y = knock && knock.rest ? .101 : .039;
    m.teeth.visible = !isSpit && !knock;

    const social = mode === 'public' ? meadowPose(p, dt, m) : null;
    if (social) {
      m.jelly.position.y += social.y;
      m.jelly.scale.x *= social.width;
      m.jelly.scale.y *= social.height;
      m.jelly.scale.z *= social.width;
      m.jelly.rotation.y += social.yaw;
      m.jelly.rotation.z += social.roll;
    }
    for (const arm of m.arms) {
      const strike = isSlap && arm.side === side;
      const power = strike ? (anticipation * .45 + snap * (heavy ? .94 : .60)) * (1 - settle) : 0;
      const ready = Math.sin(time * 4 + arm.side * .7 + i) * .07;
      const swing = strike ? lerp(1.17 * anticipation, -1.56 - (age - at > .055 ? .47 * smooth(at + .055, at + .13, age) : 0), snap) * (1 - settle) : 0;
      arm.shoulder.scale.set(.69 + power * .36, .76 + power * .37, .78 + power * .32);
      arm.shoulder.position.y = .57 + (strike ? anticipation * (1 - settle) * (heavy ? .54 : .34) : 0) + flex * .34;
      arm.shoulder.position.z = .035 + power * .40;
      arm.shoulder.rotation.set(flex * -.56, arm.side * (swing + .09), arm.side * (.14 + ready + cheer * .82 + power * (heavy ? .47 : .24) - (dash ? .43 : 0)));
      arm.palm.scale.setScalar(1 + power * ((heavy ? .88 : .55) + skillRank(p, 'power') * .16));
      arm.palm.position.x = arm.side * (.56 + power * skillValue(p, 'reach', 'reach') * .68);
      arm.palm.rotation.set(puff * -.3, arm.side * (-.25 + snap * power * .68), arm.side * (.25 - power * .67));
      if (social) {
        const gesture = social.arm + (arm.side > 0 ? social.wave : 0);
        arm.shoulder.position.y += gesture * .32;
        arm.shoulder.rotation.z -= arm.side * gesture * .78;
        arm.palm.rotation.z -= arm.side * gesture * .65;
      }
      if (knock) {
        const flail = Math.exp(-knock.age * 1.24);
        arm.shoulder.rotation.set(Math.sin(knock.age * 18 + arm.side) * flail, arm.side * .36, arm.side * (1.03 + Math.sin(knock.age * 16) * flail));
      }
    }
  }
}

const ROUND_SECONDS = 90;
const FINISH_SECONDS = 3.75;
const STEP = 1 / 90;
const timers = ['dash', 'dashTime', 'inv', 'stun', 'hit', 'chain', 'counter', 'chill', 'growth'];
const contacts = [];

function freshPlayer(slot, previous = {}) {
  const ranks = { ...previous.ranks };
  const maxHp = 100 + skillValue({ ranks }, 'colossus', 'hp');
  return {
    x: slot ? 5.1 : -5.1, z: slot ? -.62 : .62, vx: 0, vz: 0, kx: 0, kz: 0, air: 0, vy: 0,
    r: slot ? -1.4498 : 1.6918, hp: maxHp, maxHp, size: 1 + skillValue({ ranks }, 'colossus', 'size'), ranks, en: 0, dash: 0, dashTime: 0, inv: 0, stun: 0, hit: 0, chain: 0,
    counter: 0, attack: '', attackTime: 0, duration: 0, contactTime: 0, attackAim: 0, struck: false, reflected: false,
    burnTicks: 0, burnDamage: 0, burnClock: 0, chill: 0, chillAmount: 0,
    guarded: false, secondUsed: false, lastVolley: -1, growth: 0, spellCooldowns: {},
    countering: false, combo: 0, comboLanded: false, lastDamage: '',
    active: previous.active ?? (slot === 0),
    hat: previous.hat, accent: previous.accent, owner: previous.owner, spitCharge: 0,
    name: previous.name ?? (slot ? 'Rival' : profile.name),
    color: previous.color ?? (slot ? 1 : chosen)
  };
}
function freshMatch(format = 'classic') {
  return {
    p: [freshPlayer(0), freshPlayer(1)], score: [0, 0], phase: 'waiting', timer: ROUND_SECONDS,
    wait: 0, round: 1, roundKey: 0, duelMatch: 0, winner: -1, paused: false,
    bullets: [], fx: [], serial: 0, rematch: [false, false], format, run: format === 'rogue' ? newRun() : null
  };
}
let state = freshMatch();
let fightTime = 0;
let consumed = [emptyButtons(), emptyButtons()];
let queued = [{}, {}];

function event(type, x, z, data = {}) {
  const fx = { id: ++state.serial, type, x, z, ...data };
  state.fx.push(fx);
  if (['atomic','ownerWave','start', 'dash', 'slap', 'spit', 'splat', 'return', 'nova', 'hit', 'ko', 'perfect', 'pickup', 'skill', 'waveCue', 'wave', 'spell'].includes(type)) networkDirty = true;
  if (state.fx.length > 25) state.fx.shift();
  return fx;
}
function resetFightQueues() {
  fightTime = 0;
  queued = [{}, {}];
  consumed = inputs.map(input => ({ ...input.a }));
}
function startRound() {
  state.p = state.p.map((p, i) => freshPlayer(i, p));
  state.roundKey++;
  state.timer = mode === 'bot' ? boutDuration() : state.run ? BOUT_SECONDS : ROUND_SECONDS;
  state.wait = 2.82;
  state.phase = 'countdown';
  state.winner = -1;
  state.bullets.length = 0;
  state.fx.length = 0;
  resetFightQueues();
  bot.nextDecision = 0;
  bot.time = 0;
  if (state.run) {
    state.p.forEach((p, i) => { if (state.run.recent[i] === 'colossus') p.growth = 1.8; });
    primeStage();
  }
}
function restartMatch() {
  state.duelMatch++;
  state.round = 1;
  state.score = [0, 0];
  state.rematch = [false, false];
  if (state.format === 'rogue') state.run = newRun();
  if (mode === 'bot' || state.format === 'rogue') {
    state.p = state.p.map((p, i) => freshPlayer(i, { ...p,
      ranks: mode === 'bot' ? i === 0 ? practiceOptions.ranks : chooseBotBuild() : {} }));
  }
  startRound();
}
function aimOf(player, input) { return Number.isFinite(input.aim) ? input.aim : player.r; }

function segmentCircle(x, z, nx, nz, cx, cz, radius) {
  const dx = nx - x, dz = nz - z, ox = x - cx, oz = z - cz;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return Infinity;
  const b = ox * dx + oz * dz;
  const delta = b * b - a * c;
  if (delta < 0) return Infinity;
  const f = (-b - Math.sqrt(delta)) / a;
  return f >= 0 && f <= 1 ? f : Infinity;
}
function hasCover(x, z, nx, nz, margin = 0) {
  return runCover().some(o => segmentCircle(x, z, nx, nz, o.x, o.z, o.r + margin) !== Infinity);
}
function dashAge(p) { return moves.dash.time - p.dashTime; }
function perfectWindow(p) { return p.dashTime > 0 && dashAge(p) < moves.dash.perfect + skillValue(p,'phase','perfect'); }
function perfectDodge(i) {
  const p = state.p[i];
  if (!perfectWindow(p) || p.counter > 0) return;
  p.counter = skillValue(p, 'counter', 'time', 1.65);
  gainEnergy(p, 16, i);
  emitSkill(i, 'counter');
  event('perfect', p.x, p.z, { i, color: p.color, angle: p.r });
}
function cancelAttack(p) {
  p.attack = '';
  p.attackTime = 0;
  p.duration = 0;
  p.contactTime = 0;
  p.struck = false;
  p.countering = false;
}
function damagePlayer(i, damage, nx, nz, options) {
  const p = state.p[i], attacker = state.p[1 - i];
  if (p.hp <= 0 || !p.active) return false;
  if (p.inv > 0) {
    perfectDodge(i);
    return false;
  }
  const { source, power, stun, launch = 0, chain = 0, counter = false, returned = false } = options;
  const shell = skillValue(p, 'armor', 'cut');
  const bubble = p.guarded ? 0 : skillValue(p, 'guard', 'cut');
  const anchor = skillValue(p, 'anchor', 'cut');
  if (shell) emitSkill(i, 'armor');
  if (bubble) {
    p.guarded = true;
    emitSkill(i, 'guard');
  }
  if (anchor && power >= 4) emitSkill(i, 'anchor');
  damage = Math.max(1, Math.round(damage * (1 - shell) * (1 - bubble)));
  p.hp = Math.max(0, p.hp - damage);
  p.lastDamage = source;
  p.stun = Math.max(p.stun, stun);
  p.hit = Math.max(p.hit, .27 + (launch > 0 ? .13 : 0));
  p.kx = nx * power * (1 - anchor);
  p.kz = nz * power * (1 - anchor);
  p.vy = Math.max(launch, p.vy);
  if (launch) p.air = Math.max(.04, p.air);
  p.chain = 0;
  p.comboLanded = false;
  cancelAttack(p);
  gainEnergy(p, launch ? 12 : 7, i);
  gainEnergy(attacker, source === 'slap' ? 19 : ['nova', 'after', 'echo'].includes(source) ? 0 : 13, 1 - i);
  const reserve = skillValue(p, 'second', 'heal');
  if (reserve && !p.secondUsed && p.hp > 0 && p.hp < p.maxHp * .34) {
    p.secondUsed = true;
    p.hp = Math.min(p.maxHp, p.hp + reserve);
    emitSkill(i, 'second');
  }
  const snack = source === 'slap' && skillValue(attacker, 'leech', 'heal');
  if (snack && attacker.hp > 0 && attacker.hp < attacker.maxHp) {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + snack);
    emitSkill(1 - i, 'leech');
  }
  event('hit', p.x, p.z, {
    i, color: p.color, nx, nz, damage, source, chain, counter, returned,
    heavy: launch > 0, finish: p.hp === 0, height: p.air
  });
  return true;
}
function startMove(i, name) {
  const p = state.p[i], input = inputs[i];
  if (p.hp <= 0 || p.stun > 0 || p.dashTime > 0 || p.air > .1) return false;
  const aim = aimOf(p, input);
  if (name === 'jump') {
    if(p.attackTime>0 || p.vy>0) return false;
    p.vy=6.4; p.air=.04;
    return true;
  }
  if (name === 'dash') {
    if (p.dash > 0 || (p.attackTime > 0 && (!p.struck || p.duration - p.attackTime < .20))) return false;
    const len = Math.hypot(input.x, input.z);
    const nx = len > .12 ? input.x / len : -Math.sin(aim);
    const nz = len > .12 ? input.z / len : -Math.cos(aim);
    p.dash = skillValue(p, 'swift', 'cooldown', moves.dash.cooldown);
    p.dashTime = moves.dash.time;
    p.inv = moves.dash.inv + skillValue(p, 'phase', 'inv');
    p.kx = nx * moves.dash.speed;
    p.kz = nz * moves.dash.speed;
    p.r = aim;
    cancelAttack(p);
    event('dash', p.x, p.z, { i, color: p.color, angle: Math.atan2(nx, nz) });
    emitSkill(i, 'swift');
    emitSkill(i, 'phase');
    triggerRogueSpells(i,'dash',aim);
    return true;
  }
  if (p.attackTime > 0 || (name === 'nova' && p.en < 100)) return false;

  p.combo = name === 'slap' && p.chain > 0 && p.comboLanded && p.combo < 2 ? p.combo + 1 : 0;
  p.comboLanded = false;
  p.chain = 0;
  p.attack = name;
  p.attackAim = p.r = aim;
  p.struck = false;
  p.reflected = false;
  p.countering = name === 'slap' && p.counter > 0;
  if (p.countering) p.counter = 0;
  const move = name === 'slap' ? moves.slap[p.combo] : moves[name];
  const pace = name === 'slap' ? skillValue(p, 'tempo', 'time', 1) : 1;
  p.attackTime = p.duration = move.duration * pace;
  p.contactTime = move.contact * pace;
  if (name === 'slap') {
    const amount = move.lunge * .41;
    p.kx += Math.sin(aim) * amount;
    p.kz += Math.cos(aim) * amount;
    if (p.combo === 2 || p.countering) event('wind', p.x, p.z, { i, color: p.color, angle: aim, heavy: true });
  }
  if (name === 'spit') {
    p.spitCharge=clamp(input.spitCharge || 0,0,1);
    event('chargeSpit',p.x,p.z,{i,color:p.color,angle:aim});
  }
  if (name === 'nova') {
    p.en = 0;
    event('chargeNova', p.x, p.z, { i, color: p.color });
  }
  return true;
}
function reflectSpit(i) {
  const p = state.p[i];
  if (p.reflected) return;
  let candidate = null;
  let best = 4.55;
  for (const glob of state.bullets) {
    if (glob.owner === i || glob.returns >= 3) continue;
    const dx = glob.x - p.x, dz = glob.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d >= best || dx * glob.vx + dz * glob.vz >= 0 || Math.abs(angleDiff(p.attackAim, Math.atan2(dx, dz))) > (glob.charged ? 1.72 : 1.36)) continue;
    candidate = glob;
    best = d;
  }
  if (!candidate) return;
  const rival = state.p[1 - i];
  const bearing = Math.atan2(rival.x - candidate.x, rival.z - candidate.z);
  const direction = p.attackAim + clamp(angleDiff(p.attackAim, bearing), -.64, .64);
  candidate.owner = i;
  candidate.color = p.color;
  candidate.returns++;
  candidate.vx = Math.sin(direction) * (34 + candidate.returns * 2);
  candidate.vz = Math.cos(direction) * (34 + candidate.returns * 2);
  candidate.life = 1.45;
  candidate.dodged = false;
  candidate.volley = ++state.serial;
  candidate.damage = 15 + candidate.returns + skillValue(p, 'return', 'damage');
  p.reflected = true;
  gainEnergy(p, 19, i);
  event('return', candidate.x, candidate.z, { i, color: p.color, angle: direction });
  emitSkill(i, 'return', candidate.x, candidate.z);
}
function resolveAttack(i, dt) {
  const p = state.p[i];
  if (!p.attack) return;
  const name = p.attack;
  const move = name === 'slap' ? moves.slap[p.combo] : moves[name];
  p.attackTime = Math.max(0, p.attackTime - dt);
  const age = p.duration - p.attackTime;

  const reflection = skillValue(p, 'return', 'window');
  if (name === 'slap' && age >= p.contactTime - .105 - reflection && age <= p.contactTime + .14 + reflection) reflectSpit(i);
  if (!p.struck && age + 1e-6 >= p.contactTime) {
    p.struck = true;
    const rival = state.p[1 - i];
    const dx = rival.x - p.x, dz = rival.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx, dz);
    const delta = angleDiff(p.attackAim, heading);
    const nx = Math.sin(p.attackAim), nz = Math.cos(p.attackAim);
    triggerRogueSpells(i,name,p.attackAim);
    if (name === 'slap') {
      const heavy = p.combo === 2 || p.countering;
      p.kx += nx * move.lunge;
      p.kz += nz * move.lunge;
      event('slap', p.x, p.z, { i, color: p.color, angle: p.attackAim, side: p.combo === 1 ? -1 : 1, heavy, combo:p.combo+1 });
      emitSkill(i, 'power');
      emitSkill(i, 'reach');
      emitSkill(i, 'tempo');
      const third = p.combo === 2;
      const arc = third ? 1.04 : .91;
      const reach = move.reach + skillValue(p, 'reach', 'reach') + (rival.size - 1) * .76;
      if (third) queueWave(i, 'echo', p.x + nx * 2.25, p.z + nz * 2.25, .43);
      if (Math.abs(delta) <= arc && rival.air < 1.7 && !hasCover(p.x, p.z, rival.x, rival.z)) {
        if (d <= reach + .83 && perfectWindow(rival)) perfectDodge(1 - i);
        if (d <= reach + (p.countering ? .23 : 0)) {
          const damage = move.damage + skillValue(p, 'power', 'damage') +
            (p.countering ? 7 + skillValue(p, 'counter', 'damage') : 0) + (third ? skillValue(p, 'finisher', 'damage') : 0);
          const launch = heavy ? 4.8 + (third ? skillValue(p, 'finisher', 'lift') : 0) : 0;
          if (third) emitSkill(i, 'finisher', rival.x, rival.z);
          contacts.push({
            i, damage, nx: dx / d, nz: dz / d, source: 'slap', power: heavy ? 12.5 + (third ? 2 : 0) : move.shove,
            stun: heavy ? .44 : move.stun, launch, chain: p.combo + 1, counter: p.countering
          });
        }
      }
    } else if (name === 'spit') {
      const help = inputs[i].assist || 0;
      const aim = p.attackAim + (d < 27 && Math.abs(delta) < .08 + help * .48 ? delta * help * .85 : 0);
      const x = Math.sin(aim), z = Math.cos(aim);
      const mouth = 1.17 * p.size;
      const spawnX = p.x + x * mouth, spawnZ = p.z + z * mouth;
      const count = skillValue(p, 'fork', 'count');
      const spread = skillValue(p, 'fork', 'spread');
      const shots = [0];
      if (count) shots.push(spread * (i ? -1 : 1));
      if (count > 1) shots.push(-shots[1]);
      const volley = ++state.serial;
      const bonus = skillValue(p, 'speed', 'damage');
      for (const [index, offset] of shots.entries()) {
        const heading = aim + offset;
        const charged = p.spitCharge >= .93;
        const speed = move.speed + skillValue(p, 'speed', 'speed') + p.spitCharge * 24;
        state.bullets.push({
          id: ++state.serial, volley, owner: i, color: p.color, returns: 0, dodged: false,
          charged, scale:1+p.spitCharge*.92,
          x: spawnX, z: spawnZ, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, life: charged ? 5.5 : 1.48,
          damage: (index ? skillValue(p, 'fork', 'sideDamage') : move.damage) + bonus + p.spitCharge * 13,
          fire: skillRank(p, 'fire'), frost: skillRank(p, 'frost'), seeker: skillRank(p, 'seeker'),
          cannon: skillRank(p, 'speed'), fork: skillRank(p, 'fork'), banks: skillValue(p, 'boomer', 'banks')
        });
      }
      p.kx -= x * 2.7;
      p.kz -= z * 2.7;
      event('spit', spawnX, spawnZ, { i, color: p.color, angle: aim });
      for (const id of ['fire', 'frost', 'fork', 'seeker', 'speed']) emitSkill(i, id, spawnX, spawnZ);
    } else {
      const radius = move.reach + skillValue(p, 'wide', 'radius');
      event('nova', p.x, p.z, { i, color: p.color, radius });
      emitSkill(i, 'wide');
      queueWave(i, 'after', p.x, p.z, .66);
      if (d <= radius + .67 && perfectWindow(rival)) perfectDodge(1 - i);
      if (d <= radius) contacts.push({
        i, damage: move.damage, nx: dx / d, nz: dz / d, source: 'nova', power: 15.1, stun: .49, launch: 5.4
      });
    }
  }
  if (p.attackTime <= 0) cancelAttack(p);
}
function advanceBullets(dt) {
  for (let index = state.bullets.length - 1; index >= 0; index--) {
    const glob = state.bullets[index];
    const p = state.p[1 - glob.owner];
    const x = glob.x, z = glob.z;
    if ((glob.seeker || glob.charged) && p.hp > 0 && !glob.dodged) {
      const heading = Math.atan2(glob.vx, glob.vz);
      const delta = angleDiff(heading, Math.atan2(p.x - x, p.z - z));
      const turn = (glob.charged ? 1650 : skills.seeker.levels[glob.seeker - 1].turn) * Math.PI / 180 * dt;
      const speed = Math.hypot(glob.vx, glob.vz);
      glob.vx = Math.sin(heading + clamp(delta, -turn, turn)) * speed;
      glob.vz = Math.cos(heading + clamp(delta, -turn, turn)) * speed;
    }
    const nx = x + glob.vx * dt, nz = z + glob.vz * dt;
    glob.life -= dt;
    let obstacle = Infinity, pillar = null;
    for (const o of runCover()) {
      const f = glob.charged ? Infinity : segmentCircle(x, z, nx, nz, o.x, o.z, o.r + .20);
      if (f < obstacle) { obstacle = f; pillar = o; }
    }
    const impact = (!glob.charged && p.air > 1.45) || !p.active ? Infinity : segmentCircle(x, z, nx, nz, p.x, p.z, (1.18+(glob.scale-1||0)*.46)*p.size);
    const brush = perfectWindow(p) && !glob.dodged ? segmentCircle(x, z, nx, nz, p.x, p.z, 1.73 * p.size) : Infinity;
    if (brush < obstacle || (glob.charged && impact < obstacle && p.inv > 0)) {
      perfectDodge(1 - glob.owner);
      if(glob.charged){
        event('splat',x,z,{color:glob.color});
        state.bullets.splice(index,1);
        continue;
      }
      glob.dodged = true;
    }
    if (impact < obstacle && p.inv <= 0 && p.hp > 0 && !glob.dodged) {
      const speed = Math.hypot(glob.vx, glob.vz);
      const freshVolley = glob.volley === undefined || glob.volley !== p.lastVolley;
      if (freshVolley && damagePlayer(1 - glob.owner, glob.damage ?? (glob.returns ? 15 + glob.returns : moves.spit.damage),
        glob.vx / speed, glob.vz / speed, {
          source: glob.fire ? 'fire' : 'spit', power: glob.returns ? 8.4 : 4.8,
          stun: glob.returns ? .29 : .16, returned: glob.returns > 0
        })) {
        p.lastVolley = glob.volley;
        if (glob.volley !== undefined) {
          for (const other of state.bullets) if (other.volley === glob.volley && other !== glob) other.dodged = true;
        }
        if (glob.fire && p.hp > 0) {
          if (!p.burnTicks) p.burnClock = .6;
          p.burnTicks = 4;
          p.burnDamage = Math.max(p.burnDamage, skills.fire.levels[glob.fire - 1].burn / 4);
        }
        if (glob.frost) {
          p.chill = 1.45;
          p.chillAmount = skills.frost.levels[glob.frost - 1].slow;
          event('skill', p.x, p.z, { i: glob.owner, skill: 'frost', rank: glob.frost,
            angle: Math.atan2(glob.vx, glob.vz), color: glob.color });
        }
      }
      state.bullets.splice(index, 1);
      continue;
    }
    if (impact < obstacle && p.inv > 0) glob.dodged = true;
    if (pillar && glob.banks > 0 && glob.life > 0) {
      const bx = lerp(x, nx, obstacle), bz = lerp(z, nz, obstacle);
      const len = Math.hypot(bx - pillar.x, bz - pillar.z) || 1;
      const normalX = (bx - pillar.x) / len, normalZ = (bz - pillar.z) / len;
      const dot = glob.vx * normalX + glob.vz * normalZ;
      glob.vx -= 2 * Math.min(dot, 0) * normalX;
      glob.vz -= 2 * Math.min(dot, 0) * normalZ;
      glob.x = pillar.x + normalX * (pillar.r + .24);
      glob.z = pillar.z + normalZ * (pillar.r + .24);
      glob.banks--;
      emitSkill(glob.owner, 'boomer', bx, bz);
      continue;
    }
    const bounds = arenaSize();
    if (obstacle !== Infinity || glob.life <= 0 || Math.hypot(nx / bounds.x, nz / bounds.z) > 1.04) {
      const f = Number.isFinite(obstacle) ? obstacle : 1;
      event('splat', lerp(x, nx, f), lerp(z, nz, f), { color: glob.color, fire: glob.fire || 0, frost: glob.frost || 0 });
      state.bullets.splice(index, 1);
      continue;
    }
    glob.x = nx;
    glob.z = nz;
  }
}
function contain(p) {
  const bounds = arenaSize();
  const edge = Math.hypot(p.x / bounds.x, p.z / bounds.z);
  if (edge > 1) {
    p.x /= edge;
    p.z /= edge;
    p.kx *= .45;
    p.kz *= .45;
  }
  for (const o of runCover()) {
    if ((mode === 'public'||state.format==='rogue') && p.air > o.height + .2) continue;
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
    const min = o.r + .83 * p.size;
    if (d >= min) continue;
    p.x = o.x + (d > 0 ? dx / d : 1) * min;
    p.z = o.z + (d > 0 ? dz / d : 0) * min;
    p.kx *= .72;
    p.kz *= .72;
  }
}
function drivePlayer(p, input, dt, air = p.air > 0 || p.vy > 0) {
  const baseSpeed = p.stun > 0 ? 1.15 : p.attack ? (p.attack === 'nova' ? .5 : 3.9) : p.dashTime > 0 ? .54 : 7.35;
  const speed = baseSpeed * (p.chill > 0 ? 1 - p.chillAmount : 1);
  const traction = state.run && stageIndex() === 2 ? .61 : 1;
  const len = Math.max(1, Math.hypot(input.x, input.z));
  const control = air ? .32 : 1;
  const turn = damp((p.dashTime > 0 ? 28 : 19) * traction, dt);
  p.vx = lerp(p.vx, input.x / len * speed * control, turn);
  p.vz = lerp(p.vz, input.z / len * speed * control, turn);
  p.x += (p.vx + p.kx) * dt;
  p.z += (p.vz + p.kz) * dt;
  const drag = Math.exp(-dt * (p.dashTime > 0 ? 2.4 : air ? 4.1 : 12.5) * traction);
  p.kx *= drag;
  p.kz *= drag;
  contain(p);
}

function advancePlayer(i, dt) {
  const p = state.p[i], input = inputs[i];
  for (const key of timers) p[key] = Math.max(0, p[key] - dt);
  for (const name of actions) {
    const count = input.a[name];
    if (count !== consumed[i][name]) {
      if (count > consumed[i][name]) queued[i][name] = fightTime + (name === 'dash' ? .155 : .205);
      consumed[i][name] = count;
    }
  }
  for (const name of ['dash', 'jump', 'nova', 'slap', 'spit']) {
    if (!queued[i][name]) continue;
    if (queued[i][name] < fightTime) {
      delete queued[i][name];
      continue;
    }
    if (startMove(i, name)) {
      delete queued[i][name];
      break;
    }
  }

  if (!p.attack && p.stun <= 0) p.r = aimOf(p, input);
  const air = p.air > 0 || p.vy > 0;
  if (air) {
    p.vy -= 17 * dt;
    p.air += p.vy * dt;
    if (p.air <= 0) {
      p.air = p.vy = 0;
      event('land', p.x, p.z, { i, color: p.color });
    }
  }
  drivePlayer(p, input, dt, air);
  if (p.burnTicks > 0 && p.hp > 0) {
    p.burnClock -= dt;
    if (p.burnClock <= 0) {
      p.burnClock += .6;
      p.burnTicks--;
      p.hp = Math.max(0, p.hp - p.burnDamage);
      p.lastDamage = 'fire';
      event('burn', p.x, p.z, { i, color: p.color, damage: p.burnDamage });
      if (!p.burnTicks) p.burnDamage = 0;
    }
  }
  const safe = safeScale();
  if (safe < 1) {
    const bounds = arenaSize();
    if (Math.hypot(p.x / (bounds.x * safe), p.z / (bounds.z * safe)) > 1 && p.hp > 0) {
      p.hp = Math.max(0, p.hp - dt * 12);
      p.lastDamage = 'arena';
    }
  }
}
function safeScale() { return runSafeScale(); }
function finishRound(decision = null) {
  const down = state.p.map(p => p.hp <= 0);
  const winner = decision === null ? down.every(Boolean) ? -1 : down[0] ? 1 : 0 : decision;
  state.winner = winner;
  if (winner >= 0) state.score[winner]++;
  for (let i = 0; i < 2; i++) {
    const p = state.p[i], other = state.p[1 - i];
    if (down[i]) {
      const dx = p.x - other.x, dz = p.z - other.z, d = Math.hypot(dx, dz) || 1;
      event('ko', p.x, p.z, { i, color: p.color, nx: dx / d, nz: dz / d, source: p.lastDamage, height: p.air });
    }
    cancelAttack(p);
    p.kx = p.kz = p.vx = p.vz = p.air = p.dashTime = 0;
  }
  state.bullets.length = 0;
  state.phase = 'round';
  state.wait = state.format === 'sandbox' ? 2.22 : FINISH_SECONDS;
  state.rematch = [false, false];
}
function simulate(dt) {
  if (state.paused || ['waiting', 'over', 'draft'].includes(state.phase)) return;
  if (state.phase === 'countdown') {
    state.wait -= dt;
    if (state.wait <= 0) {
      resetFightQueues();
      state.phase = 'fight';
      event('start', 0, 0);
    }
    return;
  }
  if (state.phase === 'round') {
    state.wait -= dt;
    if (state.wait <= 0) finishBoutTransition();
    return;
  }

  if (mode === 'bot') updateBot(dt);
  fightTime += dt;
  if (state.format !== 'sandbox') state.timer -= dt;
  for (let i = 0; i < 2; i++) advancePlayer(i, dt);
  const [a, b] = state.p;
  const dx = b.x - a.x, dz = b.z - a.z, gap = Math.hypot(dx, dz);
  const separation = .975 * (a.size + b.size);
  if (gap < separation && Math.abs(a.air - b.air) < .8) {
    const push = (separation - gap) * .5;
    const nx = gap > .001 ? dx / gap : 1, nz = gap > .001 ? dz / gap : 0;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
    contain(a);
    contain(b);
  }
  contacts.length = 0;
  resolveAttack(0, dt);
  resolveAttack(1, dt);
  for (const contact of contacts) {
    const { i, damage, nx, nz, source } = contact;
    const landed = damagePlayer(1 - i, damage, nx, nz, contact);
    const p = state.p[i];
    if (landed && source === 'slap' && p.attack === 'slap') {
      p.comboLanded = true;
      if (p.combo < 2) p.chain = .79;
    }
  }
  advanceBullets(dt);
  tickStage(dt);
  SlimoRogueSpells.tick(state,dt,{damage:damagePlayer,blocked:hasCover});
  if (a.hp <= 0 || b.hp <= 0) finishRound();
  else if ((state.run || mode === 'bot' && state.format === 'classic') && state.timer <= 0) {
    const difference = a.hp / a.maxHp - b.hp / b.maxHp;
    finishRound(Math.abs(difference) < .0001 ? -1 : difference > 0 ? 0 : 1);
  }
}

const bot = { time: 0, nextDecision: 0, direction: 1, rng: seeded(558137) };
function updateBot(dt) {
  const p = state.p[1], rival = state.p[0], input = inputs[1];
  const level = practiceOptions.difficulty;
  bot.time += dt;
  const dx = rival.x - p.x, dz = rival.z - p.z, distance = Math.hypot(dx, dz) || 1;
  const bearing = Math.atan2(dx, dz);
  if (practiceOptions.ai !== 'active') {
    input.x = input.z = 0;
    input.aim = bearing;
    if (practiceOptions.ai === 'mirror') input.a = { ...inputs[0].a };
    return;
  }
  const blocked = hasCover(p.x, p.z, rival.x, rival.z, .24);
  const go = distance > 3.15 || blocked ? 1 : distance > 2.2 ? .19 : -.32;
  const strafe = (blocked ? .92 : .44) * bot.direction;
  input.x = dx / distance * go - dz / distance * strafe;
  input.z = dz / distance * go + dx / distance * strafe;
  input.aim = bearing + Math.sin(bot.time * 2.7) * [.38, .17, .07][level];
  input.assist = .25 + level * .2;
  const objective = botObjective(p);
  if (objective) {
    input.x = objective.x;
    input.z = objective.z;
  }

  if (bot.time < bot.nextDecision) return;
  bot.nextDecision = bot.time + [.33, .19, .107][level] * (.8 + bot.rng() * .5);
  if (bot.rng() < .16) bot.direction *= -1;
  if (p.stun > .11 || p.dashTime > 0 || p.air > .1) return;
  const threat = state.bullets.some(glob => glob.owner === 0 && !glob.dodged &&
    segmentCircle(glob.x, glob.z, glob.x + glob.vx * .155, glob.z + glob.vz * .155, p.x, p.z, 1.25) < Infinity);
  const windup = rival.attack === 'slap' && !rival.struck && rival.duration - rival.attackTime > .07 && distance < 3.7 &&
    Math.abs(angleDiff(rival.attackAim, bearing + Math.PI)) < .87;
  const evasive = level > 0 && !blocked && (threat || windup) && bot.rng() < (level === 2 ? .74 : .38);
  if (objective?.urgent && level > 0 && p.dash <= 0 && p.attackTime <= .055) {
    input.a.dash++;
    return;
  }
  if (evasive && p.dash <= 0 && p.attackTime <= .055) {
    input.x = -dz / distance * bot.direction;
    input.z = dx / distance * bot.direction;
    input.a.dash++;
  } else if (p.attackTime < .14 && !blocked && !objective) {
    if (p.en >= 100 && distance < 5.75 && bot.rng() < .72) input.a.nova++;
    else if (distance < (p.comboLanded ? 3.69 : 3.27) && bot.rng() < [.48, .75, .92][level]) input.a.slap++;
    else if (distance > 5 && distance < 24 && bot.rng() < [.23, .34, .46][level]) input.a.spit++;
  }
}

const FX_CAP = 620;
const bits = Array.from({ length: FX_CAP }, () => ({ life: 0 }));
const bitGeo = new T.IcosahedronGeometry(1, 0);
const bitMaterial = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const bitMesh = new T.InstancedMesh(bitGeo, bitMaterial, FX_CAP);
bitMesh.frustumCulled = false;
bitMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
bitMesh.setColorAt(0, tempColor.setHex(0xffffff));
bitMesh.count = 0;
scene.add(bitMesh);
let particleCursor = 0;
const rollFx = seeded(928601);
function particles(x, y, z, count, color, speed, lift, life, style, angle = 0) {
  const total = Math.ceil(count * settings.parts);
  for (let i = 0; i < total; i++) {
    const k = particleCursor++ % FX_CAP;
    const p = bits[k];
    const a = style === 'line' ? angle + (rollFx() - .5) * 1.78 : rollFx() * TAU;
    const v = speed * (.27 + rollFx() * .88);
    const t = life * (.54 + rollFx() * .64);
    Object.assign(p, {
      x: x + (rollFx() - .5) * .30, y: y + rollFx() * .16, z: z + (rollFx() - .5) * .30,
      vx: Math.sin(a) * v, vy: (.22 + rollFx() * .97) * lift, vz: Math.cos(a) * v,
      life: t, total: t, size: (.045 + rollFx() * .10) * (style === 'dust' ? 1.35 : 1),
      style, angle: a, color, gravity: style === 'line' ? 6.1 : style === 'dust' ? 3.3 : 10.3
    });
  }
}
const moving = [];
const fxPool = [];
const maxFxPool = 105;
function transient(geometry, material, x, y, z) {
  let index = fxPool.length - 1;
  while (index >= 0 && fxPool[index].geometry !== geometry) index--;
  if (index >= 0) {
    const [mesh] = fxPool.splice(index, 1);
    mesh.material.copy(material);
    material.dispose();
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(1);
    mesh.renderOrder = 0;
    scene.add(mesh);
    return mesh;
  }
  return addMesh(geometry, material, scene, x, y, z);
}
const splashes = [];
const marks = [];
const globModels = new Map();
let lastEvent = 0;
let lastRoundKey = -1;
let hitFreeze = 0;
let hurtTint = 0;
let impactTint = 0;
let calloutTime = 0;
let startBanner = 0;
let reticleFlash = 0;

const plane = new T.PlaneGeometry(1, 1);
const ring = new T.RingGeometry(.89, 1, 48);
const arc = new T.RingGeometry(.71, 1, 40, 1, 0, Math.PI * 1.16);
const thinArc = new T.RingGeometry(.94, 1, 36, 1, 0, Math.PI * 1.08);
const shellRings = new T.TorusGeometry(1, .018, 6, 46);
const comicTexture = texture(160, 160, c => {
  c.fillStyle = '#fff';
  c.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU, r = i % 2 ? 15 + i % 7 : 76 - (i % 7) * 4;
    const x = 80 + Math.cos(a) * r, y = 80 + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
});
const flatGlow = texture(128, 128, c => {
  const g = c.createRadialGradient(64, 64, 1, 64, 64, 64);
  g.addColorStop(0, '#fff');
  g.addColorStop(.18, '#fffd');
  g.addColorStop(.38, '#fff6');
  g.addColorStop(1, '#fff0');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
});
function fxMaterial(color, opacity = 1, map = null) {
  return new T.MeshBasicMaterial({ color, opacity, map, transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false });
}
function movingFx(obj, ttl, data) {
  if (moving.length >= 82) removeMoving(0);
  moving.push({ obj, life: ttl, total: ttl, ...data });
}
function removeMoving(index) {
  const [{ obj }] = moving.splice(index, 1);
  scene.remove(obj);
  if (fxPool.length < maxFxPool) fxPool.push(obj);
  else obj.material.dispose();
}
function shockRing(x, y, z, a, b, color, ttl = .38, opacity = .74, airborne = false) {
  const m = transient(ring, fxMaterial(color, opacity), x, y, z);
  m.rotation.x = -Math.PI / 2;
  if (airborne) m.rotation.x = -.7;
  m.scale.setScalar(a);
  movingFx(m, ttl, { kind: 'ring', a, b, opacity });
}
function swipe(q, color) {
  const m = transient(arc, fxMaterial(q.heavy ? 0xffcf83 : color, .80), q.x, q.heavy ? 1.02 : .86, q.z);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2 + .12 * q.side, q.angle, -.34 + q.side * .28, 'YXZ');
  m.scale.setScalar(2.1);
  movingFx(m, q.heavy ? .27 : .20, { kind: 'arc', a: 2.23, b: q.heavy ? 3.98 : 3.35, opacity: .79, side: q.side });
  const inner = transient(thinArc, fxMaterial(0xffecd5, .70), q.x, 1.04, q.z);
  inner.rotation.copy(m.rotation);
  movingFx(inner, .18, { kind: 'arc', a: 1.86, b: q.heavy ? 3.7 : 3.02, opacity: .73, side: q.side });
  if (q.heavy) {
    const outer = transient(thinArc, fxMaterial(0xff9e61, .72), q.x, 1.25, q.z);
    outer.rotation.copy(m.rotation);
    outer.rotation.z -= q.side * .17;
    movingFx(outer, .29, { kind: 'arc', a: 2.52, b: 4.56, opacity: .78, side: q.side });
  }
}
function starburst(x, y, z, color, big) {
  const m = transient(plane, fxMaterial(color, .94, comicTexture), x, y, z);
  m.renderOrder = 1;
  movingFx(m, big ? .27 : .19, { kind: 'star', a: big ? 1.22 : .55, b: big ? 3.8 : 2.45, opacity: .97, roll: rollFx() * TAU });
}
function goo(x, z, color, scale = 1) {
  if (splashes.length >= 18) removeSplash(0);
  const m = addMesh(plane, fxMaterial(color, .73, gooTexture), scene, x, .032 + (particleCursor % 21) * .001, z);
  m.rotation.set(-Math.PI / 2, 0, rollFx() * TAU);
  m.scale.set(3.16 * scale, 3.16 * scale, 1);
  splashes.push({ m, life: 6.9, scale });
}
function removeSplash(i) {
  const [{ m }] = splashes.splice(i, 1);
  scene.remove(m);
  m.material.dispose();
}
function word(q, text, color, damage = false) {
  if (marks.length >= 14) marks.shift().el.remove();
  const el = document.createElement('div');
  el.className = damage ? 'damage' : 'impact-word';
  el.textContent = text;
  if (color) el.style.setProperty('--word', color);
  $('worldText').append(el);
  marks.push({
    el, x: q.x, y: (q.height || 0) + (damage ? 2.15 : 2.65), z: q.z, damage,
    ttl: damage ? .70 : .59, age: 0, tilt: damage ? 0 : (q.id % 2 ? -7 : 7)
  });
}
function callout(title, subtitle, time = 1.2) {
  const panel = $('callout');
  $('calloutText').textContent = title;
  $('calloutDetail').textContent = subtitle;
  panel.hidden = false;
  calloutTime = time;
}
function showEffect(q) {
  const colors = palette[q.color] || palette[0];
  const local = q.i === localSlot;
  const affected = !q.quiet && (mode !== 'public' || local || q.ownStrike);
  const rotation = q.angle ?? 0;
  const height = .88 + (q.height || 0);
  switch (q.type) {
    case 'atomic': {
      startAtomic(q.i,q.castId);
      break;
    }
    case 'ownerWave':
      ownerWave={slot:q.i,until:performance.now()+1600};
      break;
    case 'start':
      startBanner = .68;
      playSound('start');
      break;
    case 'wind':
      playSound('slap', q.x, q.z, true);
      particles(q.x, .8, q.z, 6, 0xffd692, 2.2, .75, .27, 'line', rotation + Math.PI);
      break;
    case 'slap':
      playSound('slap', q.x, q.z, q.heavy);
      swipe(q, q.playful ? 0xe1e8ac : colors.light);
      if (local && (mode !== 'public' || q.playful) && coarse) vibrate('swing');
      if (q.heavy) particles(q.x, .68, q.z, 12, 0xffcc87, 8.4, 2.1, .36, 'line', rotation);
      break;
    case 'chargeSpit':
      playSound('chargeSpit', q.x, q.z);
      break;
    case 'spit':
      playSound('spit', q.x, q.z);
      particles(q.x, .81, q.z, 11, colors.light, 5.5, 2.15, .42, 'line', rotation);
      break;
    case 'splat': {
      playSound('splat', q.x, q.z);
      const splatColor = q.fire ? 0xfd7a3f : q.frost ? 0x84d9f1 : colors.body;
      goo(q.x, q.z, splatColor, .84);
      particles(q.x, .55, q.z, 13, q.fire || q.frost ? splatColor : colors.light, 4.6, 2.8, .59, 'drop');
      break;
    }
    case 'dash':
      const predicted = local && (mode === 'guest' && performance.now() - localDashSoundAt < 250 ||
        mode === 'public' && publicRoom.prediction?.predictedDash > performance.now());
      if (!predicted) playSound('dash', q.x, q.z);
      if (local) vibrate('dash');
      particles(q.x, .13, q.z, 18, 0xecd0a9, 5.1, 1.2, .44, 'dust');
      particles(q.x, .47, q.z, 10, colors.light, 8.1, 1.4, .26, 'line', rotation + Math.PI);
      shockRing(q.x, .047, q.z, .6, 2.9, 0xe6cbb5, .34, .62);
      break;
    case 'perfect':
      playSound('perfect', q.x, q.z);
      particles(q.x, .95, q.z, 18, 0x9dffe9, 6.5, 3.4, .57, 'line', rotation);
      starburst(q.x, 1.47, q.z, 0xadffe6, false);
      shockRing(q.x, .04, q.z, .8, 3.75, 0x9ff8ed, .39);
      if (local) {
        callout('Perfect dodge', 'Your next slap is powered up', 1.42);
        vibrate('perfect');
        if (!settings.reduced) hitFreeze = Math.max(hitFreeze, .046);
      } else word(q, 'WHOOSH', '#b2fff0');
      break;
    case 'return':
      playSound('return', q.x, q.z);
      starburst(q.x, 1.05, q.z, 0xfff2bd, false);
      particles(q.x, 1, q.z, 15, 0xecd3ff, 6.2, 2.9, .46, 'line', rotation);
      if (local) callout('Return to sender', 'Spit reflected');
      else word(q, 'NOPE!', '#eccfff');
      break;
    case 'spell': {
      const definition=WORLD.spells[q.key];if(!definition)break;
      playSound(q.key==='mending'?'heal':q.key==='earthwall'?'bounce':'chargeNova',q.x,q.z);
      word(q,definition.name,'#'+definition.color.toString(16).padStart(6,'0'));
      break;
    }
    case 'chargeNova':
      playSound('chargeNova', q.x, q.z);
      shockRing(q.x, .046, q.z, 5.7, .8, 0xffc87c, .39, .70);
      particles(q.x, .55, q.z, 18, 0xffd98c, 3, 2.7, .42, 'drop');
      break;
    case 'nova':
      playSound('nova', q.x, q.z);
      const bonus = (q.radius || 6.6) - 6.6;
      shockRing(q.x, .062, q.z, 1.1, 8.4 + bonus, 0xffbb71, .46, .89);
      shockRing(q.x, .39, q.z, 1.4, 6.9 + bonus, 0xffebba, .35, .92, true);
      shockRing(q.x, .04, q.z, 1.3, 9.3 + bonus, colors.light, .62, .66);
      const globe = transient(shellRings, fxMaterial(0xffcb92, .80), q.x, 1.14, q.z);
      globe.rotation.set(-1.22, .4, .1);
      movingFx(globe, .41, { kind: 'ring', a: .55, b: 5.4, opacity: .86 });
      particles(q.x, .82, q.z, 43, 0xffcc85, 13.2, 5.1, .67, 'drop');
      if (affected) kickCamera(.23, .013);
      if (local) vibrate('nova');
      if (affected && !settings.reduced) impactTint = Math.max(impactTint, .70);
      break;
    case 'hit': {
      const spit = ['spit', 'fire'].includes(q.source);
      const impactColor = q.source === 'fire' ? 0xff9748 : spit ? colors.light : 0xffcf87;
      playSound(q.source === 'slap' ? 'smack' : spit ? 'splat' : 'bounce', q.x, q.z, q.heavy);
      const m = q.model || fighters[q.i];
      if (m) {
        m.hitX = q.nx;
        m.hitZ = q.nz;
        m.wobbleSpeed = q.heavy ? -9 : -5.7;
      }
      crowdUniform.cheer.value = Math.max(crowdUniform.cheer.value, q.heavy ? 1.14 : .55);
      if (affected && !settings.reduced && mode !== 'public') hitFreeze = Math.max(hitFreeze, q.heavy ? .098 : spit ? .027 : .053);
      if (affected) kickCamera(q.heavy ? .31 : .137, q.heavy ? .027 : .015, q.nz);
      particles(q.x, height, q.z, q.heavy ? 27 : 13, 0xffdf9b, q.heavy ? 12.6 : 9.2, 3.5, .43, 'line', Math.atan2(q.nx, q.nz));
      particles(q.x, height, q.z, q.heavy ? 24 : 14, colors.light, 5.9, q.heavy ? 6.5 : 3.9, .67, 'drop');
      if (spit) goo(q.x, q.z, q.source === 'fire' ? impactColor : colors.body, .91);
      starburst(q.x, height + .12, q.z, impactColor, q.heavy);
      if (q.heavy) {
        shockRing(q.x, .04, q.z, .70, 4.65, 0xffc67f, .34, .78);
        shockRing(q.x, .10, q.z, 1.10, 6.4, inMeadow() ? 0xcee6a0 : 0xf2ad69, .44, .56);
        impactDebris(q.x, q.z, q.nx, q.nz);
        if (affected && !settings.reduced) impactTint = Math.max(impactTint, .51);
      }
      if(q.chain) slimoImpactFrame(q.chain);
      if (q.chain === 3 && affected) playSound('combo', q.x, q.z);
      if (!q.finish && !q.quiet) {
        const lines = q.source === 'fire' ? ['TOAST!', 'SIZZLE!', 'FWOOSH!', 'HOT!'] : spit ? ['SPLOT!', 'PLOP!', 'BLEH!', 'SPLAT!'] : ['WHAP!', 'PAF!', 'SMACK!', 'PLAP!'];
        if (q.heavy || q.returned || q.id % 3 !== 1) word(q, q.heavy ? 'KAPOW!' : lines[q.id % lines.length], spit && q.source !== 'fire' ? '#b7ffee' : '#ffe2a8');
      }
      if (settings.dmg && !q.quiet) word(q, '−' + q.damage, null, true);
      if (local) {
        hurtTint = 1;
        vibrate(q.heavy ? 'heavy' : 'light');
      } else if (affected) {
        if (q.heavy) vibrate('heavy');
        else if (mode === 'public') vibrate('light');
        reticleFlash = .13;
        if (q.counter) callout('Counter slap', 'Perfect dodge bonus');
        else if (q.chain > 1) callout(q.chain === 3 ? 'Slap trilogy' : 'Double slap', q.chain === 3 ? 'All three hits connected' : 'Two hits connected');
      }
      break;
    }
    case 'skill':
      skillEffect(q);
      break;
    case 'waveCue':
      shockRing(q.x, .055, q.z, q.radius, q.radius * .88, skills[q.skill].color, q.delay || .45, .47);
      break;
    case 'wave':
      skillEffect(q);
      shockRing(q.x, .063, q.z, .6, q.radius, skills[q.skill].color, .34);
      playSound('wave', q.x, q.z);
      break;
    case 'pickup':
      starburst(q.x, 1, q.z, 0xffdc8c, true);
      shockRing(q.x, .045, q.z, .55, 3.1, 0xffd699, .51);
      playSound(q.hp ? 'heal' : 'upgrade', q.x, q.z);
      if (local) callout(q.hp ? 'Snack break!' : 'Crowd charge', q.hp ? 'Health restored' : '+27 Nova energy');
      break;
    case 'hazard':
      shockRing(q.x, .08, q.z, .62, q.radius, 0xffa662, .43);
      particles(q.x, .2, q.z, 25, 0xff9c59, 4.8, 4.9, .58, 'drop');
      playSound('wave', q.x, q.z);
      break;
    case 'burn':
      particles(q.x, .70, q.z, 6, 0xff9a43, 1.7, 2.2, .34, 'drop');
      if (settings.dmg && !q.quiet) word(q, '−' + Number(q.damage.toFixed(1)), '#ffaf62', true);
      break;
    case 'land':
      particles(q.x, .23, q.z, 14, 0xe5b08c, 3.8, 1.65, .44, 'dust');
      playSound('bounce', q.x, q.z);
      break;
    case 'ko':
      if(!startSlimoFinish(q)) beginKnockout(q);
      break;
  }
}
function impactDebris(x, z, nx = 0, nz = 1) {
  const color = inMeadow() ? 0xaed27c : 0xdeaa70;
  const direction = Math.atan2(nx, nz);
  particles(x, .14, z, 24, color, 6.8, 3.9, .74, 'drop', direction);
  particles(x, .27, z, 17, inMeadow() ? 0xc1de8a : 0xe8bf8f, 4.6, 2.85, .65, 'line', direction + .52);
}
function beginKnockout(q, m = fighters[q.i], cinematic = true) {
  if (!m) return;
  const nx = q.nx || .001, nz = q.nz || 0;
  m.rag = {
    x: q.x, y: .23 + (q.height || 0), z: q.z, vx: nx * (q.source === 'spit' ? 7.8 : 10.1),
    vz: nz * (q.source === 'spit' ? 7.8 : 10.1), vy: 7.95,
    rx: 0, rz: 0, spinX: nz * 9.9 + 1.5, spinZ: -nx * 11, age: 0, bounces: 0, squash: 0, rest: false
  };
  playSound('ko', q.x, q.z);
  particles(q.x, .89 + (q.height || 0), q.z, 42, 0xffd58f, 12.7, 7.1, .73, 'line', Math.atan2(nx, nz));
  particles(q.x, 1.1, q.z, 33, (palette[q.color] || palette[0]).light, 10.6, 6.4, .87, 'drop');
  shockRing(q.x, .041, q.z, 1.12, 7.3, 0xffcb81, .55, .9);
  starburst(q.x, 1.04 + (q.height || 0), q.z, 0xffdfa4, true);
  crowdUniform.cheer.value = 1.8;
  calloutTime = 0;
  $('callout').hidden = true;
  if (cinematic && q.i === localSlot) vibrate('ko');
  if (cinematic && !settings.reduced) {
    hitFreeze = Math.max(hitFreeze, .125);
    impactTint = .85;
  }
  impactDebris(q.x, q.z, nx, nz);
  if (cinematic) {
    kickCamera(.45, .032, nz);
    startFinishCamera(q);
  }
}
function syncEvents() {
  if (state.roundKey !== lastRoundKey) {
    lastRoundKey = state.roundKey;
    if (state.phase === 'countdown' || state.phase === 'fight') {
      snapFighters();
      resetViewForRound();
      clearFx(false);
    }
  }
  for (const q of state.fx) {
    if (q.id <= lastEvent) continue;
    lastEvent = q.id;
    showEffect(q);
  }
}
function clearFx(clearEvents = true) {
  while (moving.length) removeMoving(moving.length - 1);
  while (splashes.length) removeSplash(splashes.length - 1);
  while (marks.length) marks.pop().el.remove();
  for (const p of bits) p.life = 0;
  for (const o of globModels.values()) {
    scene.remove(o.group);
    o.material.dispose();
    o.light.material.dispose();
    for (const orbit of o.orbits) orbit.material.dispose();
  }
  globModels.clear();
  if (clearEvents) {
    magicView?.clear();
    slimoFinish=null; slimoImpact=null;
    $('slimoImpact').hidden = true;
    delete document.body.dataset.impactFrame;
    lastEvent = 0;
    lastRoundKey = -1;
  }
  hitFreeze = hurtTint = impactTint = calloutTime = startBanner = reticleFlash = 0;
  $('callout').hidden = true;
}
const globInk = new T.MeshBasicMaterial({ color: 0x231528, side: T.BackSide, toneMapped: false });
function globModel(q) {
  const colors = globPalette(q);
  const group = new T.Group();
  scene.add(group);
  const material = standard(colors.body, { roughness: .24, emissive: colors.dark, emissiveIntensity: .8 });
  const shape = q.rock ? bitGeo : smallSphere;
  const blob = ellipsoid(group, material, 0, 0, 0, .30, .32, .53, shape);
  const edge = addMesh(shape, globInk, blob);
  edge.scale.setScalar(1.13);
  const glint = ellipsoid(group, sparkle, -.13, .18, .28, .091, .065, .11, smallSphere);
  glint.rotation.z = -.5;
  const blobs = [];
  for (let i = 0; i < 4; i++) blobs.push(ellipsoid(group, material, 0, 0, 0, .10, .10, .14, smallSphere));
  const orbits = [];
  const count = Math.max(q.fire ? q.fire - 1 : 0, q.seeker || 0, q.cannon === 3 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const orbit = addMesh(q.seeker ? shellRings : thinArc, fxMaterial(q.seeker ? 0xff9de3 : colors.light, .69), group);
    orbits.push(orbit);
  }
  const light = new T.Sprite(new T.SpriteMaterial({ map: flatGlow, color: colors.light, transparent: true, opacity: .55, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
  light.scale.set(2.1, 2.1, 1);
  group.add(light);
  return { group, material, blob, blobs, light, orbits, x: q.x, z: q.z, color: q.color, trail: 0, returns: q.returns };
}
function globPalette(q) {
  if (q.rock) return {body:0xc9a877,dark:0x67512d,light:0xffdd9b};
  if (q.fire) return { body: q.fire === 3 ? 0xffc562 : 0xf8803c, dark: 0xd6421f, light: 0xffcf60 };
  if (q.frost) return { body: 0x90e6fc, dark: 0x2277c4, light: 0xb6f9ff };
  return palette[q.color] || palette[0];
}
const globIds = new Set();
function animateGlobs(dt, time) {
  globIds.clear();
  for (const bullet of state.bullets) {
    const q = renderBullet(bullet);
    globIds.add(q.id);
    let m = globModels.get(q.id);
    if (!m) {
      m = globModel(q);
      globModels.set(q.id, m);
    }
    if (m.color !== q.color) {
      m.color = q.color;
      const c = globPalette(q);
      m.material.color.setHex(c.body);
      m.material.emissive.setHex(c.dark);
      m.light.material.color.setHex(c.light);
    }
    if (m.returns !== q.returns) {
      m.x = q.x;
      m.z = q.z;
      m.returns = q.returns;
    }
    const f = mode === 'guest' ? damp(49, dt) : 1;
    m.x += (q.x - m.x) * f;
    m.z += (q.z - m.z) * f;
    const size = (q.scale || 1) * (q.returns ? 1.31 : 1) * (1 + (q.fire || 0) * .065);
    const wobble = Math.sin(time * 29 + q.id);
    m.group.position.set(m.x, .83 + wobble * .066, m.z);
    if(q.charged) m.light.material.color.setHex(0xcca2ff);
    m.group.rotation.y = Math.atan2(q.vx, q.vz);
    m.group.scale.setScalar(size);
    m.blob.scale.set(.30 + wobble * .043, .32 - wobble * .025, .53 + wobble * .032 + (q.cannon || 0) * .05);
    if(q.rock){m.blob.scale.setScalar(.29);m.blob.rotation.set(time*4+q.id,time*3,0);}
    m.blobs.forEach((blob, i) => {
      blob.visible=!q.rock;
      blob.position.set(Math.sin(time * 23 - i * 1.08) * (.11 + (q.fire || 0) * .04), -.027 * i + (q.fire ? Math.cos(time * 19 - i) * .14 : 0), -.40 - .34 * i);
      const r = .158 - i * .029;
      blob.scale.set(r, r, r * (q.fire ? 2.4 : 1.65));
    });
    for (const [i, orbit] of m.orbits.entries()) {
      orbit.rotation.set(time * (i % 2 ? -9 : 8) + i, i * 1.32, time * (i % 2 ? 7 : -6));
      orbit.position.z = -.23 - i * .20;
      orbit.scale.setScalar(.52 + i * .12);
    }
    m.trail += dt;
    if (m.trail > .048) {
      m.trail = 0;
      particles(m.x, .73, m.z, q.fire ? q.fire + 1 : q.returns ? 3 : 1, globPalette(q).light, 1.7, q.fire ? 1.2 : .31, .30, q.cannon ? 'line' : 'drop', Math.atan2(-q.vx, -q.vz));
    }
  }
  for (const [id, o] of globModels) {
    if (globIds.has(id)) continue;
    scene.remove(o.group);
    o.material.dispose();
    o.light.material.dispose();
    for (const orbit of o.orbits) orbit.material.dispose();
    globModels.delete(id);
  }
}
function animateEffects(dt, realDt) {
  let visible = 0;
  for (let i = 0; i < FX_CAP; i++) {
    const p = bits[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    p.vy -= p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y <= .067) {
      p.y = .067;
      p.vy = Math.max(.04, -p.vy * .27);
      p.vx *= .70;
      p.vz *= .70;
    }
    const size = p.size * Math.sqrt(Math.max(0, p.life / p.total));
    tempObject.position.set(p.x, p.y, p.z);
    tempObject.rotation.set(.26, p.angle, p.life * 2.5);
    tempObject.scale.set(size, size * (p.style === 'drop' ? 1.47 : 1), size * (p.style === 'line' ? 4.5 : 1.16));
    tempObject.updateMatrix();
    bitMesh.setMatrixAt(visible, tempObject.matrix);
    bitMesh.setColorAt(visible, tempColor.setHex(p.color));
    visible++;
  }
  bitMesh.count = visible;
  if (visible) {
    bitMesh.instanceMatrix.needsUpdate = true;
    bitMesh.instanceColor.needsUpdate = true;
  }
  for (let i = moving.length - 1; i >= 0; i--) {
    const p = moving[i];
    p.life -= dt;
    if (p.life <= 0) {
      removeMoving(i);
      continue;
    }
    const t = 1 - p.life / p.total;
    p.obj.scale.setScalar(lerp(p.a, p.b, 1 - (1 - t) ** 2.6));
    p.obj.material.opacity = p.opacity * (1 - t) ** (p.kind === 'star' ? 1.8 : 1.15);
    if (p.kind === 'arc') p.obj.rotation.z += p.side * dt * 3.8;
    if (p.kind === 'star') {
      p.obj.quaternion.copy(camera.quaternion);
      p.obj.rotateZ(p.roll + t * .6);
    }
    if (p.kind === 'skill') {
      const a = p.angle + t * p.speed;
      const distance = p.radius * (t * .65 + .3);
      p.obj.position.set(p.x + Math.sin(a) * distance, p.y + t * p.height, p.z + Math.cos(a) * distance);
      p.obj.rotation.set(t * p.speed, a, t * p.speed * .7);
    }
  }
  for (let i = splashes.length - 1; i >= 0; i--) {
    const p = splashes[i];
    p.life -= dt;
    if (p.life <= 0) removeSplash(i);
    else p.m.material.opacity = clamp(p.life / 1.6, 0, 1) * .72;
  }
  hurtTint = Math.max(0, hurtTint - realDt * 2.42);
  impactTint = Math.max(0, impactTint - realDt * 5.9);
  calloutTime = Math.max(0, calloutTime - realDt);
  startBanner = Math.max(0, startBanner - realDt);
  reticleFlash = Math.max(0, reticleFlash - realDt);
  $('impactVeil').style.opacity = settings.reduced ? '0' : impactTint;
  $('hitVignette').style.opacity = settings.vig && !settings.reduced ? hurtTint * .76 : 0;
  $('callout').hidden = calloutTime <= 0 || state.paused;
}
const projection = new T.Vector3();
function project(x, y, z) {
  projection.set(x, y, z).project(camera);
  if (projection.z < -1 || projection.z > 1 || Math.abs(projection.x) > 1.07 || Math.abs(projection.y) > 1.07) return null;
  return { x: (projection.x * .5 + .5) * innerWidth, y: (.5 - projection.y * .5) * innerHeight };
}
function animateWords(dt) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    mark.age += dt;
    const t = mark.age / mark.ttl;
    if (t >= 1) {
      mark.el.remove();
      marks.splice(i, 1);
      continue;
    }
    const spot = project(mark.x, mark.y + t * (mark.damage ? .64 : .43), mark.z);
    if (!spot) {
      mark.el.hidden = true;
      continue;
    }
    mark.el.hidden = false;
    mark.el.style.left = (spot.x + (mark.damage ? 22 : 0)) + 'px';
    mark.el.style.top = Math.max(innerHeight * .14, spot.y) + 'px';
    mark.el.style.opacity = 1 - smooth(.58, 1, t);
    const size = settings.reduced ? 1 : 1 + (t < .19 ? Math.sin(t / .19 * Math.PI) * .27 : 0);
    mark.el.style.transform = 'translate(-50%, -50%) rotate(' + mark.tilt + 'deg) scale(' + size + ')';
  }
}

const crowdBodyGeo = new T.LatheGeometry([
  [0,.04],[.65,.08],[1.03,.18],[1.14,.43],[1.08,.76],[.93,1.09],[.72,1.36],[.42,1.57],[0,1.71]
].map(([x, y]) => new T.Vector2(x, y)), 24);
const crowdFills = palette.map(p => new T.MeshPhysicalMaterial({
  color: p.body, roughness: .33, clearcoat: .55, clearcoatRoughness: .26,
  emissive: p.dark, emissiveIntensity: .22
}));
const crowdEyeWhite = new T.MeshBasicMaterial({ color: 0xfff7df, toneMapped: false });
const crowdEyeBlack = new T.MeshBasicMaterial({ color: 0x24172d, toneMapped: false });
const crowdGlow = new T.MeshBasicMaterial({ color: 0xc9edb6, transparent: true, opacity: .54, depthWrite: false });
const crowdShadow = new T.MeshBasicMaterial({ map: shadeTexture, color: 0x2b4336, transparent: true, opacity: .57, depthWrite: false });
const roomShadowGeometry = new T.PlaneGeometry(3.25, 3.25);
const crowdCrown = new T.TorusGeometry(.54, .065, 6, 18);
const crowdMouthGeo = new T.TorusGeometry(.145, .035, 7, 14, Math.PI);
const roomGeo = new T.SphereGeometry(1, 10, 8);
function makeRoomFighter(p, pose) {
  const root = new T.Group(), jelly = new T.Group();
  root.add(jelly);
  const fill = crowdFills[p.color];
  const body = addMesh(crowdBodyGeo, fill, jelly);
  body.castShadow = false;
  outline(body, 1.018, gelInk);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = addMesh(roomGeo, fill, jelly, s * 1.11, .60, .045);
    arm.scale.set(.28, .21, .27);
    outline(arm, 1.045, gelInk);
    arms.push(arm);
    ellipsoid(jelly, crowdEyeWhite, s * .31, 1.09, .91, .17, .209, .093, roomGeo);
    ellipsoid(jelly, crowdEyeBlack, s * .31, 1.086, .985, .084, .128, .042, roomGeo);
  }
  const smile = addMesh(crowdMouthGeo, crowdEyeBlack, jelly, 0, .80, 1.07);
  smile.rotation.z = Math.PI;
  const crown = addMesh(crowdCrown, goldMat, jelly, 0, 1.52, 0);
  crown.rotation.x = Math.PI / 2.2;
  const shadow = new T.Mesh(roomShadowGeometry, crowdShadow);
  shadow.position.set(pose.x, .035, pose.z);
  shadow.rotation.x = -Math.PI / 2;
  const guard = addMesh(shellRings, crowdGlow, root, 0, .86, 0);
  guard.scale.setScalar(1.35);
  guard.visible = false;
  return { root, jelly, body, arms, smile, crown, shadow, guard, color: p.color,
    x: pose.x, z: pose.z, yaw: pose.r, size: p.size, dead: false, rag: null, wobbleSpeed: 0, wobble: 0 };
}
const roomBatches = new Map();
const roomFrustum = new T.Frustum(), roomProjection = new T.Matrix4();
const roomBound = new T.Sphere(new T.Vector3(), 3.5);
function writeRoomMesh(mesh) {
  if (!mesh.isMesh) return;
  const key = mesh.geometry.id + ':' + mesh.material.id;
  let batch = roomBatches.get(key);
  if (!batch) {
    batch = new T.InstancedMesh(mesh.geometry, mesh.material, ROOM_CAP * 4);
    batch.count = 0;
    batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    roomBatches.set(key, batch);
    scene.add(batch);
  }
  if (batch.count < ROOM_CAP * 4) batch.setMatrixAt(batch.count++, mesh.matrixWorld);
}
function clearRoomBatches() {
  for (const batch of roomBatches.values()) batch.count = 0;
}
function batchRoomFighters() {
  clearRoomBatches();
  if (mode !== 'public') return;
  roomProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  roomFrustum.setFromProjectionMatrix(roomProjection);
  for (const model of publicRoom.models.values()) {
    if (!model.root.visible) continue;
    roomBound.center.copy(model.root.position).add(roomFrustumHeight);
    if (!roomFrustum.intersectsSphere(roomBound)) continue;
    model.root.updateMatrixWorld();
    model.root.traverseVisible(writeRoomMesh);
    if (model.shadow.visible) {
      model.shadow.updateMatrixWorld();
      writeRoomMesh(model.shadow);
    }
  }
  for (const batch of roomBatches.values()) if (batch.count) batch.instanceMatrix.needsUpdate = true;
}
const roomFrustumHeight = new T.Vector3(0, .8, 0);

function animateRoomFighter(m, p, dt, time, selected) {
  m.size = p.size;
  m.dead = p.knockedOut;
  if (!p.knockedOut && m.rag) m.rag = null;
  if (!m.rag && Math.hypot(p.x - m.x, p.z - m.z) > 6) { m.x = p.x; m.z = p.z; }
  const f = damp(22, dt);
  m.x = lerp(m.x, p.x, f); m.z = lerp(m.z, p.z, f);
  m.yaw += angleDiff(m.yaw, p.r) * f;
  m.root.visible = !p.knockedOut || !!m.rag;
  m.shadow.visible = m.root.visible;
  if (!m.root.visible) return;
  const speed = clamp(Math.hypot(p.vx, p.vz) / 7.35, 0, 1);
  const bob = Math.abs(Math.sin(time * 11.5 + p.id)) * .095 * speed;
  const age = p.duration - p.attackTime;
  const strike = p.attack === 'slap' ? Math.sin(clamp(age / Math.max(.15, p.duration), 0, 1) * Math.PI) : 0;
  const recoil = p.attack === 'spit' ? Math.sin(clamp(age / Math.max(.16, p.duration), 0, 1) * Math.PI) * .14 : 0;
  const flash = p.hit > 0 ? Math.sin(time * 27 + p.id) * .07 : 0;
  const squash = 1 + bob * .43 - (p.dashTime > 0 ? .18 : 0) + flash;
  const social = meadowPose(p, dt, m);
  const width = (m.size / Math.sqrt(squash) + recoil) * social.width;
  m.jelly.scale.set(width, m.size * squash * social.height, width);
  m.jelly.rotation.set(recoil * -.8, m.yaw + social.yaw, flash + social.roll + strike * .14 * (p.combo === 1 ? -1 : 1));
  m.jelly.position.y = bob + social.y;
  m.root.position.set(m.x, p.air, m.z);
  m.root.rotation.set(0, 0, 0);
  m.guard.visible = p.shield;
  m.guard.rotation.set(time * .9, 0, time * .7);
  m.shadow.position.set(m.x, .035, m.z);
  m.shadow.scale.setScalar(p.size);
  if (m.color !== p.color) {
    m.color = p.color;
    m.body.material = crowdFills[p.color];
    for (const arm of m.arms) arm.material = crowdFills[p.color];
  }
  for (const [i, arm] of m.arms.entries()) {
    const side = i ? 1 : -1;
    const swing = (p.combo === 1 ? i === 0 : i === 1) ? strike : 0;
    const gesture = social.arm + (side > 0 ? social.wave : 0);
    arm.position.set(side * (1.11 + swing * .48 + gesture * .17), .59 + swing * .31 + gesture * .64, swing * 1.05 + gesture * .19);
    arm.rotation.z = side * gesture * .35;
    arm.scale.set(.28 + swing * .22, .21 + swing * .16, .27 + swing * .34);
  }
  if (m.rag) {
    animateRag(m, dt, selected);
    const q = m.rag;
    m.root.position.set(q.x, q.y + .81 * p.size, q.z);
    m.root.rotation.set(q.rx, 0, q.rz);
    m.jelly.position.y = -.81 * p.size;
    m.shadow.position.set(q.x, .035, q.z);
  }
}

const view = {
  yaw: 0, targetYaw: 0, pitch: .15, targetPitch: .15, lock: settings.autoLock, shake: 0, roll: 0,
  fresh: true, finish: null, fov: 0, anchorX: 0, anchorZ: 0, lastCountdown: null
};
const cameraTarget = new T.Vector3();
const cameraSpot = new T.Vector3();
const normalSpot = new T.Vector3();
const normalTarget = new T.Vector3();
const cinemaSpot = new T.Vector3();
const cinemaTarget = new T.Vector3();
function resetViewForRound() {
  view.yaw = view.targetYaw = state.p[localSlot].r;
  view.pitch = view.targetPitch = .15;
  view.anchorX = state.p[localSlot].x;
  view.anchorZ = state.p[localSlot].z;
  view.lastCountdown = null;
  view.finish = null;
  view.shake = view.roll = 0;
  view.fresh = true;
  document.body.classList.remove('cinema');
}
function lockOn(value) {
  if (view.lock && !value) view.targetYaw = view.yaw;
  view.lock = value;
  if (mode === 'public') publicRoom.locked = value;
  $('lock').setAttribute('aria-pressed', String(value));
  $('lock').textContent = value ? 'Lock on' : 'Lock off';
}
function kickCamera(power, roll, direction = 0) {
  if (settings.reduced || !settings.shake) return;
  view.shake = Math.max(view.shake, power * settings.shake);
  view.roll = (direction >= 0 ? 1 : -1) * roll * settings.shake;
  view.fov = Math.max(view.fov, power * 17);
}
function startFinishCamera(q) {
  if (view.finish || !settings.cinema || settings.reduced) return;
  const loser = q.i;
  const victor = state.p[1 - loser];
  const dx = q.x - victor.x, dz = q.z - victor.z, d = Math.hypot(dx, dz) || 1;
  const axisX = dx / d, axisZ = dz / d;
  const facing = (camera.position.x - q.x) * axisZ - (camera.position.z - q.z) * axisX;
  view.finish = {
    loser, age: 0, x: q.x, z: q.z, axisX, axisZ, side: facing >= 0 ? 1 : -1
  };
}
function updateLook(dt) {
  if (mode === 'lobby' || state.paused || activeOverlay) return;
  const self = renderedPose(localSlot), other = renderedPose(1 - localSlot);
  if (view.lock && other.active && !view.finish) {
    view.targetYaw = view.yaw + angleDiff(view.yaw, Math.atan2(other.x - self.x, other.z - self.z));
    view.targetPitch = .15;
  }
  view.yaw += angleDiff(view.yaw, view.targetYaw) * damp(view.lock ? 14 : 52 - settings.smooth * 47, dt);
  view.pitch = lerp(view.pitch, view.targetPitch, damp(20 - settings.smooth * 14, dt));
}
function cameraLimit(anchorX, anchorY, anchorZ, point) {
  let first = 1;
  for (const p of runCover()) {
    const fraction = segmentCircle(anchorX, anchorZ, point.x, point.z, p.x, p.z, p.r + .40);
    if (fraction < first && lerp(anchorY, point.y, fraction) < p.height + .30) first = fraction;
  }
  if (first < 1) {
    const f = Math.max(.24, first - .081);
    point.set(lerp(anchorX, point.x, f), lerp(anchorY, point.y, f) + .12, lerp(anchorZ, point.z, f));
  }
  const bounds = arenaSize();
  const limit = Math.hypot(point.x / (bounds.x + .70), point.z / (bounds.z + .62));
  if (limit > 1) {
    point.x /= limit;
    point.z /= limit;
  }
}
function aimCamera(dt, realDt) {
  let fov = settings.fov;
  let mix = 0;
  if (mode === 'lobby') {
    const portrait = innerHeight > innerWidth;
    const slide = Math.sin(clock * .36) * (settings.reduced ? 0 : .58);
    cameraSpot.set(1.15 + slide, 2.68 + Math.sin(clock * .28) * (settings.reduced ? 0 : .13), 8.84);
    cameraTarget.set(portrait ? .65 : -.72, portrait ? -.55 : 1.62, 1.35);
    fov = portrait ? 46 : 47;
  } else {
    const own = renderedPose(localSlot), rival = renderedPose(1 - localSlot);
    const selfModel = fighters[localSlot];
    const racing = own.dashTime > 0 ? 1 : 0;
    const range = Math.hypot(rival.x - own.x, rival.z - own.z);
    const close = view.lock && rival.active ? 1 - smooth(2.1, 6.8, range) : 0;
    const back = settings.dist + racing * .62 - close * .52 + (own.size - 1) * 3.1;
    const fx = Math.sin(view.yaw), fz = Math.cos(view.yaw);
    const rx = -fz, rz = fx;
    view.anchorX = lerp(view.anchorX, selfModel.x, damp(21, dt));
    view.anchorZ = lerp(view.anchorZ, selfModel.z, damp(21, dt));
    const shoulder = view.lock ? 1.48 + close * 2.85 : .98;
    normalSpot.set(view.anchorX - fx * back + rx * shoulder, 2.68 + close * .58 + view.pitch * 3.8 + own.air * .40 + (own.size - 1) * 1.8,
      view.anchorZ - fz * back + rz * shoulder);
    if (view.lock && rival.active) {
      const lead = clamp(range * .67 + .16, 1.48, 8);
      normalTarget.set(view.anchorX + fx * lead, 1.12 + rival.air * .43 + own.air * .16, view.anchorZ + fz * lead);
    } else {
      normalTarget.set(view.anchorX + fx * 17, 1.05 - Math.tan(view.pitch - .14) * 12, view.anchorZ + fz * 17);
    }
    cameraLimit(view.anchorX, 1.16 + own.air * .35, view.anchorZ, normalSpot);
    cameraSpot.copy(normalSpot);
    cameraTarget.copy(normalTarget);
    fov += racing * 4.4 + view.fov;
    if (state.phase === 'countdown' && !settings.reduced) fov += smooth(1, 2.8, state.wait) * 4;

    const finish = view.finish;
    if (finish) {
      if (!settings.cinema || settings.reduced || !['round', 'over'].includes(state.phase)) view.finish = null;
      else {
        if (!state.paused) finish.age += realDt;
        const age = finish.age;
        mix = smooth(0, .31, age) * (1 - smooth(2.37, 3.22, age));
        const rag = fighters[finish.loser].rag;
        const x = rag?.x ?? finish.x, z = rag?.z ?? finish.z;
        const y = rag?.y ?? 0;
        const focusX = lerp(finish.x, x, .79), focusZ = lerp(finish.z, z, .79);
        const swing = smooth(.0, 2.25, age);
        const d = lerp(7.3, 6.15, swing);
        cinemaSpot.set(focusX + finish.axisZ * d * finish.side - finish.axisX * (3.8 - swing * 1.28),
          2.12 + y * .49 + swing * .54, focusZ - finish.axisX * d * finish.side - finish.axisZ * (3.8 - swing * 1.28));
        cameraLimit(focusX, 1.10 + y * .5, focusZ, cinemaSpot);
        cinemaTarget.set(focusX - finish.axisX * .55, .97 + y * .75, focusZ - finish.axisZ * .55);
        cameraSpot.lerp(cinemaSpot, mix);
        cameraTarget.lerp(cinemaTarget, mix);
        fov = lerp(fov, 46 + swing * 4.5, mix);
        if (age > 3.28) view.finish = null;
      }
    }
    view.shake *= Math.exp(-realDt * 13.8);
    view.roll *= Math.exp(-realDt * 10.3);
    view.fov *= Math.exp(-realDt * 10.7);
    if (!settings.reduced && view.shake > .001) {
      cameraSpot.x += Math.sin(clock * 82.5) * view.shake * .54;
      cameraSpot.y += Math.sin(clock * 98.2) * view.shake * .37;
      cameraSpot.z += Math.cos(clock * 71.4) * view.shake * .48;
    }
  }
  document.body.classList.toggle('cinema', mix > .29 && !state.paused);
  if (view.fresh) {
    camera.position.copy(cameraSpot);
    camera.fov = fov;
    view.fresh = false;
  } else {
    camera.position.lerp(cameraSpot, damp(mix > .1 ? 14 : mode === 'lobby' ? 4.7 : 17, dt));
    camera.fov = lerp(camera.fov, fov, damp(12, dt));
  }
  camera.lookAt(cameraTarget);
  if (mode !== 'lobby' && !settings.reduced) camera.rotateZ(view.roll + mix * .026 * (view.finish?.side ?? 0));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
function visualDelta(realDt) {
  if (settings.reduced) return realDt;
  if (hitFreeze > 0) {
    hitFreeze = Math.max(0, hitFreeze - realDt);
    return realDt * .09;
  }
  const age = view.finish?.age;
  if (Number.isFinite(age) && age < 1.02 && !state.paused) return realDt * lerp(.26, 1, smooth(.29, 1.02, age));
  return realDt;
}

const keys = new Set();
const held = new Set();
const canvas = renderer.domElement;
let drag = null;
let stickPointer = null;
let stickCenter = null;
let joystick = { x: 0, z: 0 };
let lastRepeat = { slap: -99, spit: -99 };
let spitHold = null;
let spitCharge = 0;
function beginSpitHold() {
  if(spitHold===null && mode!=='lobby' && state.phase==='fight' && gameReady()) spitHold=performance.now();
}
function releaseSpitHold() {
  if(spitHold===null) return;
  spitCharge=clamp((performance.now()-spitHold-130)/710,0,1);
  spitHold=null;
  trigger('spit');
}
let lastSafeHint = -Infinity;
const stick = $('stick'), nub = $('nub'), zone = $('zoneL');
function resetInputs() {
  spitHold=null;
  spitCharge=0;
  keys.clear();
  held.clear();
  abilityPointers.clear();
  drag = null;
  stickPointer = null;
  stickCenter = null;
  joystick = { x: 0, z: 0 };
  nub.style.transform = '';
  stick.classList.remove('on');
}
function trigger(action) {
  if (!actions.includes(action) || mode === 'lobby' || state.phase !== 'fight' || !gameReady()) return;
  if (mode === 'public') {
    if (!publicRoom.id || state.p[0].hp <= 0) return;
    if (!roomCanFight() && action === 'nova') {
      if (clock - lastSafeHint > 1.35) {
        lastSafeHint = clock;
        toast('Enter the gold fight ring to use this move.');
      }
      return;
    }
  }
  inputCounts[action]++;
  if (action === 'slap' || action === 'spit') lastRepeat[action] = clock;
  if (mode === 'guest') {
    if(action!=='jump') predictAttack(action);
    tickNet(performance.now(), true);
  } else if (mode === 'public') {
    predictPublicAttack(action);
    sendRoomInput(true);
  }
}
function readInput() {
  const right = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')) + joystick.x;
  const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown')) - joystick.z;
  const magnitude = Math.max(1, Math.hypot(right, forward));
  const f = Math.sin(view.yaw), g = Math.cos(view.yaw);
  const self = renderedPose(localSlot), other = renderedPose(1 - localSlot);
  const desired = view.lock && other.active ? Math.atan2(other.x - self.x, other.z - self.z) : view.yaw;
  const ready = gameReady();
  return {
    x: ready ? (-g * right + f * forward) / magnitude : 0,
    z: ready ? (f * right + g * forward) / magnitude : 0,
    aim: desired, assist: view.lock ? 1 : settings.assist, a: { ...inputCounts }, ready, spitCharge
  };
}
function repeatInput() {
  if (!settings.hold || state.phase !== 'fight' || !gameReady()) return;
  const p = mode === 'public' ? publicPose() : state.p[localSlot];
  for (const name of ['slap']) {
    const key = name === 'slap' ? keys.has('j') || keys.has(' ') : keys.has('e');
    if ((!key && !held.has(name)) || clock - lastRepeat[name] < .24 || p.attackTime > .095 || p.stun > .05 || p.dashTime > .08) continue;
    trigger(name);
  }
}

const KEY_ACTION = { j: 'slap', ' ': 'slap', e: 'spit', q: 'nova', shift: 'dash', f: 'jump' };
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('quickChatBar').hidden) { closeQuickChat(); event.preventDefault(); return; }
  if (event.key === 'Escape' && activeOverlay) {
    if (activeOverlay === 'buildOverlay') finishBuild(false); else closeOverlay();
    event.preventDefault();
    return;
  }
  if (activeOverlay && event.key === 'Tab') {
    const list = overlayFocusables($(activeOverlay));
    if (!list.length) { event.preventDefault(); return; }
    if (!list.includes(document.activeElement)) {
      (event.shiftKey ? list.at(-1) : list[0]).focus();
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === list[0]) {
      list.at(-1).focus();
      event.preventDefault();
    } else if (list.length && !event.shiftKey && document.activeElement === list.at(-1)) {
      list[0].focus();
      event.preventDefault();
    }
    return;
  }
  if (!$('quickChatBar').hidden || mode === 'lobby' || activeOverlay || event.target.matches?.('input, textarea, select, [contenteditable]')) return;
  if (publicSocialKey(event)) return;
  if (state.phase === 'draft') {
    draftKeys(event);
    return;
  }
  const key = event.key.toLowerCase();
    if(mode==='public' && key==='m' && !event.repeat){toggleMeadowMap();event.preventDefault();return;}
  if (key === ' ' && event.target.closest?.('button')) return;
  if (key === 'r' && !event.repeat) lockOn(mode === 'public' ? !publicRoom.locked : !view.lock);
  if (MOVE_KEYS.includes(key) || KEY_ACTION[key]) event.preventDefault();
  keys.add(key);
  if (!event.repeat && KEY_ACTION[key]) {
    if(key==='e') beginSpitHold();
    else trigger(KEY_ACTION[key]);
  }
  if(!event.repeat && key==='x') slimoActivateEmote('atomic');
});
addEventListener('keyup', event => {
  const key=event.key.toLowerCase();
  keys.delete(key);
  if(key==='e') releaseSpitHold();
});
addEventListener('blur', resetInputs);
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (mode === 'lobby' || activeOverlay || drag || (event.pointerType === 'mouse' && ![0, 2].includes(event.button))) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  unlockAudio();
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, turned: false, at: performance.now() };
  canvas.setPointerCapture(event.pointerId);
  if(event.pointerType==='mouse' && event.button===2) beginSpitHold();
});
canvas.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  const now = performance.now();
  const speed = Math.hypot(dx, dy) / Math.max(6, now - drag.at);
  drag.at = now;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.turned && Math.hypot(drag.originX - drag.x, drag.originY - drag.y) > 8) {
    drag.turned = true;
    if (view.lock || mode === 'public' && publicRoom.locked) lockOn(false);
  }
  if (!drag.turned) return;
  const sensitivity = 680 / Math.max(innerHeight, 360);
  const acceleration = 1 + settings.dyn * smooth(.35, 2.5, speed) * 1.55;
  view.targetYaw = (view.targetYaw - dx * .0041 * settings.sens * sensitivity * acceleration) % TAU;
  view.targetPitch = clamp(view.targetPitch + dy * .0032 * settings.sensY * sensitivity * (settings.inv ? -1 : 1), -.15, .49);
});
function releaseDrag(event) {
  if (drag?.id !== event.pointerId) return;
  if(event.type==='pointerup' && event.pointerType==='mouse'){
    if(event.button===2) releaseSpitHold();
    else if(!drag.turned) trigger('slap');
  }else if(event.type!=='pointerup') spitHold=null;
  drag = null;
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, releaseDrag);

function moveStick(event) {
  if (event.pointerId !== stickPointer) return;
  const radius = Math.max(18, stick.getBoundingClientRect().width * .38);
  const dx = (event.clientX - stickCenter.x) / radius;
  const dz = (event.clientY - stickCenter.y) / radius;
  const len = Math.hypot(dx, dz);
  const travel = clamp((len - settings.dead) / (1 - settings.dead), 0, 1);
  joystick.x = len > .001 ? dx / len * travel : 0;
  joystick.z = len > .001 ? dz / len * travel : 0;
  const scale = stick.getBoundingClientRect().width / Math.max(1, stick.offsetWidth);
  nub.style.transform = 'translate(' + joystick.x * radius / Math.max(.5, scale) + 'px,' + joystick.z * radius / Math.max(.5, scale) + 'px)';
}
zone.addEventListener('pointerdown', event => {
  if (stickPointer !== null || !gameReady()) return;
  event.preventDefault();
  stickPointer = event.pointerId;
  zone.setPointerCapture(event.pointerId);
  unlockAudio();
  const width = stick.getBoundingClientRect().width;
  if (settings.floating) {
    const x = clamp(event.clientX, width * .5 + 4, innerWidth * .43);
    const y = clamp(event.clientY, width * .5 + 4, innerHeight - width * .5 - 4);
    stick.style.left = (x - width * .5) + 'px';
    stick.style.top = (y - width * .5) + 'px';
    stick.style.bottom = 'auto';
  } else stick.style.left = stick.style.top = stick.style.bottom = '';
  const rect = stick.getBoundingClientRect();
  stickCenter = { x: rect.left + rect.width * .5, y: rect.top + rect.height * .5 };
  stick.classList.add('on');
  moveStick(event);
});
zone.addEventListener('pointermove', moveStick);
function releaseStick(event) {
  if (event.pointerId !== stickPointer) return;
  stickPointer = null;
  joystick = { x: 0, z: 0 };
  nub.style.transform = '';
  stick.classList.remove('on');
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(type, releaseStick);
const abilityPointers = new Map();
function releaseAbility(name, event) {
  if (abilityPointers.get(name) !== event.pointerId) return;
  abilityPointers.delete(name);
  if (name === 'spit') {
    if (event.type === 'pointerup') releaseSpitHold();
    else { spitHold = null; spitCharge = 0; }
  }
  held.delete(name);
}
const abilityButtons = [...document.querySelectorAll('.ability')];
for (const button of abilityButtons) {
  const name = button.dataset.action;
  button.addEventListener('pointerdown', event => {
    if (abilityPointers.has(name) || !gameReady() || event.button !== 0) return;
    event.preventDefault();
    abilityPointers.set(name, event.pointerId);
    unlockAudio();
    if(name==='spit') beginSpitHold();
    else trigger(name);
    held.add(name);
    button.setPointerCapture(event.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => releaseAbility(name, event));
  button.addEventListener('click', event => {
    if(event.detail===0){
      if(name==='spit') spitCharge=0;
      trigger(name);
    }
  });
}

let resolutionScale = 1;
function resizeView() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
function applySettings(key) {
  if (key === 'quality' || key === 'adaptive' || !key) {
    resolutionScale = 1;
    updateQuality();
  }
  const root = document.documentElement.style;
  root.setProperty('--controls-scale', settings.btn);
  root.setProperty('--controls-opacity', settings.btnOp);
  root.setProperty('--stick', settings.stickSize);
  document.body.classList.toggle('float-stick', settings.floating);
  document.body.classList.toggle('reduced', settings.reduced);
  $('fps').hidden = !settings.fps;
  if (!settings.floating) stick.style.left = stick.style.top = stick.style.bottom = '';
  if (key === 'autoLock' || (!key && mode === 'lobby')) lockOn(settings.autoLock);
  refreshAudio();
}
function updateQuality() {
  const q = settings.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, [1, 1.25, coarse ? 1.5 : 1.8][q]) * resolutionScale);
  renderer.shadowMap.enabled = q > 0;
  const size = q === 2 ? 1536 : 1024;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  resizeView();
}
let perfTime = 0, perfFrames = 0;
function samplePerformance(dt) {
  if (document.hidden || dt <= 0) return;
  perfTime += dt;
  perfFrames++;
  if (perfTime < 2.25) return;
  const fps = perfFrames / perfTime;
  if (settings.fps) $('fps').textContent = Math.round(fps) + ' FPS';
  if (settings.adaptive && mode !== 'lobby' && !state.paused && fps < (coarse ? 33 : 40) && resolutionScale > .72) {
    resolutionScale = Math.max(.71, resolutionScale - .095);
    updateQuality();
  }
  perfTime = 0;
  perfFrames = 0;
}

const paletteCss = palette.map(color => color.hud);
let lastBanner = '';
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
function fillBar(id, number) {
  const el = $(id), width = clamp(number, 0, 100).toFixed(1) + '%';
  if (el.style.width !== width) el.style.width = width;
}
function healthCards() {
  const self = state.p[localSlot], other = state.p[1 - localSlot];
  const left = $('myName').closest('.fighter'), right = $('theirName').closest('.fighter');
  left.style.setProperty('--color', paletteCss[self.color]);
  right.style.setProperty('--color', paletteCss[other.color]);
  const hpLabel = p => Math.ceil(p.hp) + '/' + p.maxHp;
  const run = state.format === 'rogue' || mode === 'bot' || mode === 'public';
  setText($('myName'), self.name + (run ? ' · ' + hpLabel(self) : ' · You'));
  setText($('theirName'), other.active ? other.name + (run ? ' · ' + hpLabel(other) : '') :
    mode === 'public' ? 'No rival nearby' : 'Waiting for rival');
  fillBar('myHp', self.hp / self.maxHp * 100);
  fillBar('myGhost', self.hp / self.maxHp * 100);
  fillBar('theirHp', other.active ? other.hp / other.maxHp * 100 : 0);
  fillBar('theirGhost', other.active ? other.hp / other.maxHp * 100 : 0);
  fillBar('myEnergy', self.en);
  fillBar('theirEnergy', other.active ? other.en : 0);
  $('myEnergy').parentElement.classList.toggle('full', self.en >= 100);
  $('theirEnergy').parentElement.classList.toggle('full', other.active && other.en >= 100);
  for (const [id, index] of [['myScore', localSlot], ['theirScore', 1 - localSlot]]) {
    const score = state.score[index], el = $(id);
    setText(el, mode === 'public' ? '' : run ? score + (score === 1 ? ' win' : ' wins') : '◆'.repeat(score) + '◇'.repeat(Math.max(0, 3 - score)));
    el.setAttribute('aria-label', mode === 'public' ? '' : run ? score + ' bouts won' : score + ' of 3 rounds won');
  }
}
function banner() {
  let title = '', label = '', detail = '';
  let style = state.phase;
  const other = state.p[1 - localSlot];
  const run = state.run;
  const winner = style === 'over' && run ? run.winner : state.winner;
  const winning = winner === localSlot;
  if (mode === 'public') {
    if (!publicRoom.id) { title = 'Open Meadow'; detail = 'Connecting…'; }
  } else if (state.paused && !['waiting', 'over', 'draft'].includes(state.phase)) {
    style = 'paused';
    title = 'Duel paused';
    detail = !isLandscape() ? 'Turn your device sideways.' : mode === 'bot' ? '' : 'Both players need the arena open in landscape.';
  } else if (style === 'waiting') {
    title = mode === 'guest' ? 'Joining arena' : 'Waiting for rival';
    detail = mode === 'guest' ? 'Opening the duel connection.' : 'Send an invite to bring in a friend.';
  } else if (style === 'countdown') {
    title = String(Math.max(1, Math.ceil(state.wait)));
    const total = boutTotal();
    label = state.format === 'sandbox' ? 'Free training' : run || mode === 'bot' ?
      state.round > total ? 'Overtime' : 'Bout ' + state.round + ' of ' + total : 'Round ' + state.round;
    detail = run || mode === 'bot' ? '' : 'First to three rounds';
    if (!state.paused && view.lastCountdown !== title) {
      playSound('tick');
      view.lastCountdown = title;
    }
  } else if (style === 'fight' && startBanner > 0) {
    title = 'SLAP!';
  } else if (style === 'round' && state.wait < 2.56) {
    const fall = [...state.fx].reverse().find(q => q.type === 'ko');
    title = fall ? winner < 0 ? 'Double splat' : 'K.O.' : 'Time!';
    label = winner < 0 ? 'Draw' : winning ? (run ? 'Bout won' : 'Round won') : (run ? 'Bout lost' : 'Round lost');
    if (!fall && run) detail = winner < 0 ? 'Both slimes finished with the same health percentage.' : 'The healthier slime takes it.';
    if (fall && state.winner >= 0) {
      const jokes = {
        slap: ['The crowd felt that.', 'That slap had witnesses.', 'Jelly has left the building.'],
        spit: ['Defeated by a mouthful.', 'A terrible day to have a face.', 'The floor would like a towel.'],
        fire: ['Slime, lightly toasted.', 'Flambé was a mistake.', 'Please stop cooking the contestants.'],
        nova: ['Please remain in your seats.', 'That was mostly slime.', 'Rome felt that one.'],
        arena: ['The floor wins this one.', 'The sand has spoken.']
      };
      const lines = jokes[fall.source] || jokes.slap;
      detail = lines[fall.id % lines.length];
    }
  } else if (style === 'over') {
    title = winner < 0 ? 'Draw' : winning ? 'Hail, champion' : 'A noble splat';
    if (run) label = 'Run complete';
    detail = winner < 0 ? state.score.join('–') : (state.p[winner]?.name || other.name) + ' wins ' + state.score[winner] + '–' + state.score[1 - winner];
  }
  const key = [style, title, label, detail].join('|');
  if (key !== lastBanner) {
    const panel = $('announcement');
    panel.hidden = !title;
    panel.dataset.state = style;
    setText($('announceTitle'), title);
    setText($('announceLabel'), label);
    setText($('announceDetail'), detail);
    lastBanner = key;
  }
  $('rematch').hidden = state.phase !== 'over';
  $('rematch').disabled = state.rematch[localSlot];
  setText($('rematch'), state.rematch[localSlot] ? 'Waiting for rival' : 'Rematch');
}
function drawHud() {
  if (mode === 'lobby') return;
  const canEmote=['fight','round','over'].includes(state.phase);
  $('duelTools').hidden = mode!=='host' && !slimoAccount?.owner && !slimoAccount?.atomic;
  $('duelFriends').hidden=mode!=='host';
  $('ownerWave').hidden=!canEmote || !slimoAccount?.owner || mode==='public';
  $('atomicEmote').hidden=!canEmote || !slimoAccount?.atomic;
  $('aSpit').style.setProperty('--charge',spitHold===null?'0%':(clamp((performance.now()-spitHold-130)/710,0,1)*100)+'%');
  healthCards();
  const self = state.p[localSlot], other = state.p[1 - localSlot];
  const seconds = Math.max(0, Math.ceil(state.timer));
  setText($('clock'), Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
  const run = state.run;
  const stage = stageOf(state);
  const total = boutTotal();
  setText($('roundText'), run ? state.round > total ? 'Overtime' : 'Bout ' + state.round + '/' + total :
    state.format === 'sandbox' ? 'Free training' : mode === 'bot' ? 'Bout ' + state.round + '/' + total :
      state.timer < 0 ? 'Sudden death' : 'Round ' + state.round);
  $('battleSkills').hidden = !run && mode !== 'bot';
  if (mode === 'public') drawPublicHud();
  const rule = $('stageRule');
  rule.hidden = !stage || state.phase !== 'countdown' || state.paused;
  if (!rule.hidden) {
    rule.style.setProperty('--stage', '#' + stage.color.toString(16).padStart(6, '0'));
    setText($('stageName'), stage.name);
    setText($('stageNote'), stage.note);
  }
  setText($('connection'), mode === 'bot' ? '' : link?.open && other.active ? 'Friend connected' : mode === 'host' ? 'Invite a friend' : 'Connecting');
  $('addFriend').disabled = !other.active;
  banner();

  const reticle = $('reticle'), bearing = $('bearing');
  const inactive = state.phase !== 'fight' || state.paused || self.hp <= 0;
  const model = mode === 'public' ? publicRoom.models.get(publicRoom.target) : fighters[1 - localSlot];
  const target = view.lock && other.active && !inactive && model ? project(model.x, 1.97 * other.size + other.air, model.z) : null;
  reticle.hidden = !settings.cross || inactive || (view.lock && !target);
  reticle.classList.toggle('locked', !!target);
  reticle.classList.toggle('strike', reticleFlash > 0);
  reticle.style.left = target ? target.x + 'px' : '50%';
  reticle.style.top = target ? target.y + 'px' : '50%';
  const delta = angleDiff(view.yaw, Math.atan2(other.x - self.x, other.z - self.z));
  const offscreen = !target && other.active && !inactive && Math.abs(delta) > .67;
  bearing.hidden = !offscreen;
  if (offscreen) setText(bearing, delta > 0 ? 'Rival ←' : 'Rival →');

  if (coarse) {
    for (const button of abilityButtons) {
      const name = button.dataset.action;
      const meter = name === 'nova' && self.en < 100 ? Math.floor(self.en) + '%' : name === 'dash' && self.dash > .12 ? self.dash.toFixed(1) : '';
      setText(button.lastElementChild, meter);
      button.classList.toggle('ready', name === 'nova' && self.en >= 100);
    }
  }
}

const bonusCover = [
  { x: -3.5, z: -4.25, r: 1.12, height: 3.1 },
  { x: 3.5, z: 4.25, r: 1.12, height: 3.1 }
];
const pillarRoundCover = [...cover, ...bonusCover];
const meadowPillarCover = [...meadowCover, ...bonusCover];
const hotSpots = [[-5.7, 3.8], [2.65, -5.7], [7.3, 2.6]];
const draftClock = { id: -1, end: 0 };
let draftSelection = '';
let sentDraft = null;
let draftViewKey = -1;
let lobbyFormat = 'rogue';

function newRun() {
  return {
    seed: (Math.random() * 4294967296) >>> 0, draft: null, recent: ['', ''],
    winner: -1, pickup: false, nextPickup: 0, hazard: -1, waves: [], spellEffects: [], spellRevision: 0
  };
}
function runCover() {
  if(mode==='public')return meadowCover;
  const base=inMeadow()?(state.run&&stageIndex()===3?meadowPillarCover:meadowCover):
    state.format==='rogue'&&stageIndex()===3?pillarRoundCover:cover;
  return SlimoRogueSpells.cover(state,base);
}
function triggerRogueSpells(i,move,aim) {
  SlimoRogueSpells.trigger(state,i,move,e=>event('spell',e.x,e.z,{i:e.owner,key:e.key,rank:e.rank,color:state.p[e.owner].color}),aim);
}

function stageIndex(round = state.round) {
  if (round <= 1) return 0;
  if (round > boutTotal()) return 7;
  if (round === boutTotal()) return 6;
  return 1 + (round - 2) % 5;
}
function shuffledSkills(seed) {
  const rng = seeded(seed);
  const pool = [...skillIds];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function offerSkills(p, id, seed) {
  const pool = shuffledSkills((seed ^ Math.imul(id, 0x9e3779b1)) >>> 0);
  const eligible = pool.filter(key => skillRank(p, key) < 3);
  if (eligible.length < 3) return eligible;
  if (state.round === 1 && skillRank(p, 'colossus') < 3 && skillRank(p, 'fire') < 3) {
    return ['colossus', 'fire', eligible.find(key => key !== 'colossus' && key !== 'fire')];
  }
  const offered = [];
  const upgrade = eligible.find(key => skillRank(p, key) > 0);
  if (upgrade) offered.push(upgrade);
  for (const key of eligible) {
    if (offered.length === 3) break;
    if (offered.some(picked => skills[picked].group === skills[key].group)) continue;
    offered.push(key);
  }
  for (const key of eligible) {
    if (offered.length === 3) break;
    if (!offered.includes(key)) offered.push(key);
  }
  return offered;
}
function startDraft(now = performance.now()) {
  const run = state.run;
  const id = ++state.serial;
  const offers = state.p.map(p => offerSkills(p, id, run.seed));
  run.draft = {
    id, deadline: now + DRAFT_MS, remaining: DRAFT_MS, offers,
    picks: ['', ''], locked: offers.map(cards => cards.length === 0), botAt: now + 1050 + (id % 5) * 120
  };
  state.phase = 'draft';
  state.wait = 0;
  state.bullets.length = 0;
  if (run.draft.locked.every(Boolean)) finishDraft();
}
function lockDraft(slot, id, skillId, now = performance.now()) {
  const draft = state.run?.draft;
  if (state.phase !== 'draft' || !draft || draft.id !== id || draft.locked[slot] ||
      now >= draft.deadline || !draft.offers[slot].includes(skillId)) return false;
  draft.picks[slot] = skillId;
  draft.locked[slot] = true;
  if (draft.locked.every(Boolean)) finishDraft();
  return true;
}
function finishDraft() {
  const run = state.run, draft = run?.draft;
  if (!draft || state.phase !== 'draft') return;
  run.recent = state.p.map((p, i) => {
    const chosen = draft.picks[i] || draft.offers[i][0] || '';
    if (chosen) p.ranks[chosen] = Math.min(3, skillRank(p, chosen) + 1);
    return chosen;
  });
  run.draft = null;
  state.round++;
  startRound();
}
function updateDraft(now = performance.now()) {
  const draft = state.run?.draft;
  if (mode === 'guest' || state.phase !== 'draft' || !draft) return;
  draft.remaining = Math.max(0, draft.deadline - now);
  if (!draft.remaining) {
    finishDraft();
    return;
  }
  if (mode === 'bot' && !draft.locked[1] && now >= draft.botAt) {
    const picks = draft.offers[1];
    const chosen = picks.find(key => skillRank(state.p[1], key) > 0) || picks[(draft.id + state.run.seed) % picks.length];
    lockDraft(1, draft.id, chosen, now);
  }
}
function draftRemaining() {
  const draft = state.run?.draft;
  if (!draft) return 0;
  return Math.max(0, (mode === 'guest' ? draftClock.end : draft.deadline) - performance.now());
}
function syncDraftClock(incoming, now) {
  const draft = incoming.run?.draft;
  if (!draft) return;
  const deadline = now + draft.remaining;
  draftClock.end = draftClock.id === draft.id ? Math.min(draftClock.end, deadline) : deadline;
  draftClock.id = draft.id;
}
function submitDraftChoice() {
  const draft = state.run?.draft;
  if (!draft || draft.locked[localSlot] || !draft.offers[localSlot].includes(draftSelection) || draftRemaining() <= 0) return;
  if (mode === 'guest') {
    if (sentDraft?.id === draft.id) return;
    sentDraft = { id: draft.id, key: draftSelection };
    send({ t: 'draftPick', ...sentDraft });
  } else {
    lockDraft(localSlot, draft.id, draftSelection);
    if (mode === 'host') broadcastState();
  }
}
function finishBoutTransition() {
  if (practiceRespawn()) return;
  const [a, b] = state.score;
  const limit = boutTotal();
  if (state.format !== 'rogue') {
    const ended = mode === 'bot' ? state.round >= limit : Math.max(a, b) >= 3;
    if (ended) {
      state.winner = a === b ? -1 : a > b ? 0 : 1;
      state.phase = 'over';
    } else {
      state.round++;
      startRound();
    }
    return;
  }
  if (state.round < limit || (state.round === limit && a === b)) startDraft();
  else {
    state.run.winner = a === b ? -1 : a > b ? 0 : 1;
    state.phase = 'over';
  }
}
function primeStage() {
  const run = state.run;
  if (!run) return;
  run.pickup = false;
  run.nextPickup = [1, 5].includes(stageIndex()) ? 5 : 999;
  run.hazard = -1;
  run.waves.length = 0;
  run.spellEffects=[];run.spellRevision=(run.spellRevision||0)+1;
  for (const [i, id] of run.recent.entries()) {
    if (id) emitSkill(i, id, state.p[i].x, state.p[i].z, true);
  }
}
function emitSkill(i, id, x = state.p[i].x, z = state.p[i].z, upgrade = false) {
  const p = state.p[i], rank = skillRank(p, id);
  if (rank) event('skill', x, z, { i, skill: id, rank, angle: p.r, color: p.color, upgrade });
}
function gainEnergy(p, amount, i) {
  if (!amount) return;
  const before = p.en;
  const rate = state.run && stageIndex() === 5 ? 1.25 : 1;
  p.en = Math.min(100, p.en + amount * rate * skillValue(p, 'battery', 'energy', 1));
  if (before < 100 && p.en >= 100 && skillRank(p, 'battery')) emitSkill(i, 'battery');
}
function queueWave(i, id, x, z, delay) {
  const p = state.p[i], rank = skillRank(p, id);
  if (!rank) return;
  const { damage, radius } = skills[id].levels[rank - 1];
  state.run.waves.push({ id, owner: i, x, z, delay, damage, radius, rank });
  event('waveCue', x, z, { i, skill: id, rank, color: p.color, radius, delay });
}
function hazardAt(elapsed) {
  const cycle = Math.floor(elapsed / 9);
  const [x, z] = hotSpots[cycle % hotSpots.length];
  return { cycle, x, z, age: elapsed % 9, radius: 2.65 };
}
function tickStage(dt) {
  const run = state.run;
  if (!run) return;
  const elapsed = boutDuration() - state.timer;
  const stage = stageIndex();
  if (elapsed >= run.nextPickup && [1, 5].includes(stage)) run.pickup = true;
  if (run.pickup) {
    const contenders = state.p.map((p, i) => ({ p, i, d: Math.hypot(p.x, p.z) })).sort((a, b) => a.d - b.d);
    const winner = contenders.find(({ p, d }) => p.hp > 0 && p.air < 1.05 && d < 1.44 * p.size &&
      (stage === 1 ? p.hp < p.maxHp : p.en < 100));
    if (winner) {
      const { p, i } = winner;
      const hp = stage === 1;
      if (hp) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * .14));
      else p.en = Math.min(100, p.en + 27);
      event('pickup', 0, 0, { i, color: p.color, hp });
      run.pickup = false;
      run.nextPickup = elapsed + 12;
    }
  }
  if (stageIndex() === 4) {
    const h = hazardAt(elapsed);
    if (h.age >= 6.6 && run.hazard !== h.cycle) {
      run.hazard = h.cycle;
      for (const s of [-1, 1]) {
        const x = h.x * s, z = h.z * s;
        event('hazard', x, z, { color: 1, radius: h.radius });
        for (const p of state.p) {
          if (p.hp <= 0 || p.air > .9 || p.inv > 0 || Math.hypot(x - p.x, z - p.z) > h.radius) continue;
          p.hp = Math.max(0, p.hp - 7);
          p.lastDamage = 'arena';
        }
      }
    }
  }
  for (let i = run.waves.length - 1; i >= 0; i--) {
    const wave = run.waves[i];
    wave.delay -= dt;
    if (wave.delay > 0) continue;
    run.waves.splice(i, 1);
    const p = state.p[1 - wave.owner];
    const dx = p.x - wave.x, dz = p.z - wave.z, d = Math.hypot(dx, dz);
    event('wave', wave.x, wave.z, { i: wave.owner, skill: wave.id, rank: wave.rank, radius: wave.radius, color: state.p[wave.owner].color });
    if (d <= wave.radius && p.air < 1.8 && p.inv <= 0) {
      damagePlayer(1 - wave.owner, wave.damage, d > .001 ? dx / d : 0, d > .001 ? dz / d : 1,
        { source: wave.id, power: 2.5, stun: .09 });
    }
  }
}
function runSafeScale() {
  if (state.format === 'sandbox' || mode === 'public') return 1;
  if (!state.run) return Math.max(.25, 1 + state.timer / 43);
  const seconds = boutDuration(), elapsed = seconds - state.timer, stage = stageIndex();
  const start = stage === 6 ? Math.min(20, seconds * .43) : stage === 7 ? Math.min(12, seconds * .30) : seconds;
  return Math.max(.18, 1 - Math.max(0, elapsed - start) / (stage >= 6 ? Math.min(33, seconds * .69) : 26));
}
function selectDraftCard(key) {
  const draft = state.run?.draft;
  if (!draft || draft.locked[localSlot] || sentDraft?.id === draft.id || !draft.offers[localSlot].includes(key)) return;
  draftSelection = key;
  drawDraft();
}
function draftKeys(event) {
  if (state.phase !== 'draft' || !state.run?.draft || !isLandscape() || activeOverlay) return false;
  if (event.key === 'Tab') {
    const cards = [...$('draftCards').children];
    const available = [...cards, $('draftLock'), $('draftExit')].filter(el => !el.disabled);
    const current = available.indexOf(document.activeElement);
    if (current < 0 || (!event.shiftKey && current === available.length - 1) || (event.shiftKey && current === 0)) {
      (event.shiftKey ? available.at(-1) : available[0])?.focus({ preventScroll: true });
      event.preventDefault();
    }
    return true;
  }
  const choice = Number(event.key);
  if (Number.isInteger(choice) && choice >= 1 && choice <= 3) {
    const key = state.run.draft.offers[localSlot][choice - 1];
    if (key) selectDraftCard(key);
    event.preventDefault();
    return true;
  }
  return false;
}
function cardSkill(key, rank, index) {
  const skill = skills[key], level = skill.levels[rank - 1];
  const card = document.createElement('button');
  card.className = 'draft-card';
  card.dataset.skill = key;
  card.dataset.rank = rank;
  card.style.setProperty('--card-color', '#' + skill.color.toString(16).padStart(6, '0'));
  const art = document.createElement('canvas');
  art.width = 220;
  art.height = 104;
  art.setAttribute('aria-hidden', 'true');
  paintSkillCard(art, skill, rank);
  const meta = document.createElement('span');
  meta.className = 'draft-meta';
  meta.textContent = skill.group + ' · Rank ' + ['I', 'II', 'III'][rank - 1];
  const title = document.createElement('strong');
  title.textContent = skill.name;
  const description = document.createElement('span');
  description.className = 'draft-effect';
  description.textContent = level.text;
  const shortcut = document.createElement('kbd');
  shortcut.textContent = index + 1;
  shortcut.setAttribute('aria-hidden', 'true');
  card.append(art, meta, title, description, shortcut);
  card.onclick = () => selectDraftCard(key);
  return card;
}
function drawDraft() {
  const panel = $('draftPanel'), draft = state.run?.draft;
  const visible = mode !== 'lobby' && state.phase === 'draft' && !!draft && !activeOverlay;
  panel.hidden = !visible;
  $('hud').inert = visible || !!activeOverlay;
  document.body.classList.toggle('drafting', visible);
  if (!visible) {
    if (!draft) {
      draftViewKey = -1;
      draftSelection = '';
      sentDraft = null;
    }
    return;
  }
  if (draftViewKey !== draft.id) {
    draftViewKey = draft.id;
    draftSelection = draft.picks[localSlot] || draft.offers[localSlot][0];
    $('draftCards').replaceChildren(...draft.offers[localSlot].map((key, i) => cardSkill(key, skillRank(state.p[localSlot], key) + 1, i)));
    const next = stages[stageIndex(state.round + 1)];
    setText($('draftRound'), 'After bout ' + state.round);
    setText($('draftNext'), next.name + ' · ' + next.note);
    resetInputs();
    if (document.activeElement && !$('draftLock').disabled) $('draftLock').focus({ preventScroll: true });
  }
  const locked = draft.locked[localSlot];
  const sending = !locked && sentDraft?.id === draft.id;
  const left = draftRemaining();
  const secs = Math.ceil(left / 1000);
  setText($('draftSeconds'), secs + 's');
  $('draftMeter').style.setProperty('--remaining', left / DRAFT_MS);
  $('draftMeter').setAttribute('aria-label', secs + ' seconds remaining');
  $('draftMeter').classList.toggle('urgent', secs <= 5);
  $('draftLock').disabled = locked || sending || secs <= 0;
  setText($('draftLock'), locked ? draft.offers[localSlot].length ? 'Locked in' : 'Build maxed' : sending ? 'Locking in…' : 'Lock in skill');
  if (locked || sending) {
    const focused = document.activeElement;
    if (focused === $('draftLock') || [...$('draftCards').children].includes(focused)) $('draftExit').focus({ preventScroll: true });
  }
  setText($('draftRival'), (mode === 'bot' ? 'Cassius' : 'Rival') + (draft.locked[1 - localSlot] ? ' is ready' : ' is choosing'));
  for (const card of $('draftCards').children) {
    card.setAttribute('aria-pressed', String(card.dataset.skill === draftSelection));
    card.disabled = locked || sending || secs <= 0;
  }
  $('draftPreview').hidden = !draftSelection;
  if (draftSelection) {
    const rank = skillRank(state.p[localSlot], draftSelection) + 1;
    setText($('draftPreview'), skills[draftSelection].animations[rank - 1]);
  }
}
function showSkillBook() {
  const content = $('skillCatalog');
  content.replaceChildren();
  const own = mode !== 'lobby' && state.format === 'rogue' ? state.p[localSlot] : null;
  for (const group of groups) {
    const list = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = group;
    list.append(title);
    for (const key of allSkillIds.filter(id => skills[id].group === group)) {
      const skill = skills[key], current = own ? skillRank(own, key) : 0;
      const entry = document.createElement('details');
      const head = document.createElement('summary');
      head.textContent = skill.name + (current ? ' · Rank ' + ['I', 'II', 'III'][current - 1] : '');
      entry.append(head);
      if (current) entry.open = true;
      for (const [i, level] of skill.levels.entries()) {
        const row = document.createElement('p');
        row.textContent = ['I', 'II', 'III'][i] + ' · ' + level.text + ' ' + skill.animations[i];
        entry.append(row);
      }
      list.append(entry);
    }
    content.append(list);
  }
  openOverlay('skillOverlay');
}

function botObjective(p) {
  const run = state.run;
  if (!run) return null;
  const direction = (x, z, urgent) => {
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, z: z / len, urgent };
  };
  const safe = runSafeScale();
  const bounds = arenaSize();
  if (safe < 1 && Math.hypot(p.x / bounds.x, p.z / bounds.z) > safe * .96) return direction(-p.x, -p.z, true);
  if (stageIndex() === 4) {
    const h = hazardAt(boutDuration() - state.timer);
    if (h.age > 4.8 && h.age < 6.6) {
      for (const sign of [-1, 1]) {
        const dx = p.x - h.x * sign, dz = p.z - h.z * sign;
        if (Math.hypot(dx, dz) < h.radius + .56) return direction(dx || .05, dz, h.age > 5.84);
      }
    }
  }
  if (run.pickup && Math.hypot(p.x, p.z) < 11 &&
      (stage === 1 ? p.hp < p.maxHp * .88 : p.en <= 73)) return direction(-p.x, -p.z, false);
  return null;
}

const iconPaths = {
  crown: 'M-24 12l-6-28 16 10 14-20 14 20 16-10-6 28z M-23 20h46',
  shield: 'M0-27l23 9v17q-3 15-23 26Q-20 14-23-1v-17z M-8-2l6 7 12-14',
  cross: 'M-7-24H7v16h16V7H7v17H-7V7h-16V-8h16z',
  anchor: 'M0-14v36m-10-25h20m-31 7c0 13 9 18 21 18s21-5 21-18m-42 0l-5 5m47-5l5 5 M0-26a6 6 0 1 0 0 12 6 6 0 1 0 0-12',
  snack: 'M18-21a25 25 0 1 0 6 32q-17 3-17-10-9-6 2-14 3 4 9 1z M-12-9h.1m-7 13h.1m11 10h.1m6-15h.1',
  bubble: 'M-4-23a23 23 0 1 0 0 46 23 23 0 1 0 0-46 M-18-7q3-8 10-9 M21-24a7 7 0 1 0 0 14 7 7 0 1 0 0-14',
  hand: 'M-11 22q-13-8-16-18-1-5 4-6 3-1 11 8v-26q0-5 4-5t5 5v15-18q0-5 4-5t4 5v18-14q0-5 4-5t4 5v15-10q0-4 4-4t4 4V2q0 17-11 20z',
  stretch: 'M-25 13c10-30 40-32 50-11M-25 20c13-27 35-28 45-16m-3-12 9 9-11 5',
  beat: 'M-26 8h9l5-14 7 22L2-22l7 28 5-11 5 11h8',
  star: 'M0-28l7 18 20 1-15 12 5 19L0 11l-17 11 5-19-15-12 20-1z',
  echo: 'M-17 0h.1M-8-10q14 10 0 20M0-17q22 17 0 34M8-24q33 24 0 48',
  mirror: 'M-7-24h22l10 11v26L15 24H-7l-10-11v-26z M7-16L-9 3m25-11L-4 14',
  flame: 'M0-27C16-14 10-6 15-5l7-5c16 31-16 44-34 32-19-12-11-27-3-34-1 9 6 7 8 3 5-6 8-10 7-18z M-4 17c-4-7 0-10 7-16 3 6 7 11 1 16z',
  ice: 'M0-27v54M-23-13l46 26M23-13l-46 26M-7-20l7 6 7-6M-7 20l7-6 7 6m-27-31 9 1-2-8m26 36-2-8 9 1m-40 0 9-1-2 8m26-36-2 8 9-1',
  fork: 'M-23 18 0 2m-4 4L15-20M0 2l24 10M7-22l10-1 1 10m-2 18 10 8-11 4',
  target: 'M0-18a18 18 0 1 0 0 36 18 18 0 1 0 0-36 M0-26v14m0 24v14m-26-26h14m24 0h14 M0-3a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  bolt: 'M4-26l-22 31h15l-3 21L19-8H3z',
  ricochet: 'M-21 20L5-8l15 17m-17-27 3 10-10-3M13 8l9 3-1-10m-3-22 5 4m-5 4 6 2',
  dash: 'M-12-15 4 0-12 15M3-15 19 0 3 15m-29-23h10m-13 16h10',
  ghost: 'M-21 23V-5a21 21 0 1 1 42 0v28l-7-6-7 6-7-6-7 6-7-6z M-8-3v5m16-5v5',
  counter: 'M-24 3q2-19 18-21h15m-7-8 9 8-9 8m22 7Q22 16 6 18H-9m7 8-9-8 9-8',
  spark: 'M0-26l5 18 17 8-17 6-5 20-5-20-17-6 17-8z',
  sun: 'M0-13a13 13 0 1 0 0 26 13 13 0 1 0 0-26 M0-26v7m0 38v7m-26-26h7m38 0h7M-19-19l5 5m28 28 5 5m0-38-5 5m-28 28-5 5',
  burst: 'M0-25v13m0 24v13m-25-25h13m24 0h13m-44-19 10 10m18 18 10 10m0-38-10 10m-18 18-10 10M-5-5l10 10m0-10L-5 5'
};
function paintSkillCard(canvas, skill, rank, t = 0) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = canvas.width, h = canvas.height;
  const color = '#' + skill.color.toString(16).padStart(6, '0');
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#19111f';
  c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(w / 2, h / 2, 3, w / 2, h / 2, w * .54);
  g.addColorStop(0, color + '60');
  g.addColorStop(.42, color + '24');
  g.addColorStop(1, color + '00');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.save();
  c.translate(w / 2, h / 2);
  for (let i = 0; i < rank; i++) {
    const r = 38 + i * 8 + (t ? Math.sin(t * 2.1 + i * .85) * 2 : 0);
    c.beginPath();
    c.arc(0, 0, r, i * .83 + t * (i % 2 ? .48 : -.32), TAU - .49 + i * .83 + t * (i % 2 ? .48 : -.32));
    c.strokeStyle = color + (i ? '75' : 'aa');
    c.lineWidth = 1.1;
    c.stroke();
  }
  for (let i = 0; i < 5 + rank * 3; i++) {
    const a = i * 2.4 + t * .54, r = 39 + (i * 17) % 48;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * .59;
    c.fillStyle = color + (i % 3 === 0 ? 'a9' : '56');
    c.fillRect(x, y, i % 3 === 0 ? 3 : 1.5, i % 3 === 0 ? 3 : 1.5);
  }
  if (t) c.scale(1 + Math.sin(t * 3) * .042, 1 - Math.sin(t * 3) * .045);
  if (typeof Path2D !== 'undefined') {
    c.lineWidth = 4.0;
    c.lineJoin = c.lineCap = 'round';
    c.strokeStyle = '#fff0de';
    c.shadowColor = color;
    c.shadowBlur = 11;
    c.stroke(new Path2D(iconPaths[skill.icon]));
  }
  c.restore();
}
let lastCardPaint = 0;
function animateDraftCard(now) {
  if (settings.reduced || $('draftPanel').hidden || now - lastCardPaint < 43) return;
  lastCardPaint = now;
  for (const card of $('draftCards').children) {
    const art = card.children[0];
    if (card.dataset.skill === draftSelection) {
      paintSkillCard(art, skills[card.dataset.skill], Number(card.dataset.rank), now / 1000);
      card.dataset.animated = 'true';
    } else if (card.dataset.animated) {
      paintSkillCard(art, skills[card.dataset.skill], Number(card.dataset.rank));
      delete card.dataset.animated;
    }
  }
}
function visualPillar(p) {
  const group = new T.Group();
  group.position.set(p.x, 0, p.z);
  const add = (geo, material, y, x, height, z) => {
    const piece = addMesh(geo, material, group, 0, y, 0);
    piece.scale.set(x, height, z);
    piece.castShadow = piece.receiveShadow = true;
  };
  const goldStone = standard(0x9a6554, { map: stoneTexture });
  const paleStone = standard(0xdab091, { map: stoneTexture });
  add(cylinder, goldStone, .20, 1.12, .40, 1.12);
  add(cylinder, paleStone, 1.51, .86, 2.28, .86);
  add(cylinder, goldStone, 2.76, .97, .25, .97);
  add(box, paleStone, 3.0, 1.90, .24, 1.90);
  group.visible = false;
  scene.add(group);
  return group;
}
const extraPillars = bonusCover.map(visualPillar);
const pickupModel = new T.Group();
const pickupGold = new T.MeshBasicMaterial({ color: 0xffbf65, toneMapped: false });
const pickupMain = addMesh(new T.OctahedronGeometry(.47, 0), pickupGold, pickupModel);
const pickupRing = addMesh(ring, fxMaterial(0xffbc67, .80), pickupModel);
pickupRing.rotation.x = -Math.PI / 2;
const pickupHalo = new T.Sprite(new T.SpriteMaterial({ map: radial, color: 0xffa556, transparent: true,
  opacity: .58, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
pickupHalo.scale.set(2.7, 2.7, 1);
pickupModel.add(pickupHalo);
scene.add(pickupModel);
const warningDiscs = [-1, 1].map(sign => {
  const disc = addMesh(new T.CircleGeometry(1, 48), fxMaterial(0xee553b, .28), scene);
  disc.rotation.x = -Math.PI / 2;
  const rim = addMesh(ring, fxMaterial(0xffbd77, .78), disc, 0, 0, .01);
  disc.visible = false;
  return { disc, rim, sign };
});
const waveCues = Array.from({ length: 12 }, () => {
  const mesh = addMesh(ring, fxMaterial(0xffacef, .5), scene, 0, .051);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
});
const defaultSand = new T.Color(0xffffff);
const iceSand = new T.Color(0x94d4ed);
const hotSand = new T.Color(0xffbd9c);
const stageTint = new T.Color();
function animateStage(time) {
  const live = state.run && mode !== 'lobby' && ['countdown', 'fight', 'round'].includes(state.phase);
  const inFight = live && state.phase === 'fight';
  const stage = stageIndex();
  for (const mesh of extraPillars) mesh.visible = !!live && stage === 3;
  stageTint.copy(live && stage === 2 ? iceSand : live && stage === 4 ? hotSand : defaultSand);
  const floor = inMeadow() ? meadowFloor : sand;
  floor.material.color.lerp(stageTint, .1);
  pickupModel.visible = !!inFight && !!state.run.pickup;
  if (pickupModel.visible) {
    pickupModel.position.y = .60 + Math.sin(time * 5) * .14;
    pickupMain.rotation.set(time * .8, time * 2.2, Math.PI / 4);
    pickupRing.scale.setScalar(.81 + Math.sin(time * 4.3) * .14);
  }
  const h = inFight && stage === 4 ? hazardAt(boutDuration() - state.timer) : null;
  for (const { disc, rim, sign } of warningDiscs) {
    disc.visible = !!h && h.age >= 4.35 && h.age < 6.6;
    if (disc.visible) {
      const charge = clamp((h.age - 4.35) / 2.25, 0, 1);
      disc.position.set(h.x * sign, .029, h.z * sign);
      disc.scale.setScalar(h.radius);
      disc.material.opacity = .15 + charge * .35 + Math.sin(time * (8 + charge * 13)) * .048;
      rim.material.opacity = .48 + charge * .42;
    }
  }
  for (const [i, mesh] of waveCues.entries()) {
    const wave = inFight ? state.run.waves[i] : null;
    mesh.visible = !!wave;
    if (!wave) continue;
    mesh.position.set(wave.x, .054, wave.z);
    mesh.scale.setScalar(wave.radius * (.92 + Math.sin(time * 10 + i) * .055));
    mesh.material.color.setHex(skills[wave.id].color);
    mesh.material.opacity = .37 + (1 - clamp(wave.delay * 1.5, 0, 1)) * .36;
  }
}

const skillGem = new T.OctahedronGeometry(1, 0);
function skillShape(points, depth) {
  const shape = new T.Shape();
  shape.moveTo(...points[0]);
  for (const point of points.slice(1)) shape.lineTo(...point);
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, bevelSize: .045, bevelThickness: .045 });
}
const healCross = skillShape([[-.23,-.7],[.23,-.7],[.23,-.23],[.70,-.23],[.70,.23],[.23,.23],
  [.23,.7],[-.23,.7],[-.23,.23],[-.70,.23],[-.70,-.23],[-.23,-.23]], .16);
const skillAnchor = skillShape([[-.14,.72],[.14,.72],[.14,.33],[.51,.33],[.51,.15],[.14,.15],[.14,-.46],
  [.51,-.35],[.48,-.16],[.86,-.32],[.67,-.63],[.57,-.49],[.17,-.71],[-.17,-.71],[-.57,-.49],
  [-.67,-.63],[-.86,-.32],[-.48,-.16],[-.51,-.35],[-.14,-.46],[-.14,.15],[-.51,.15],[-.51,.33],[-.14,.33]], .13);
const skillSnack = new T.CylinderGeometry(.68, .72, .23, 12);
const marblePlate = skillShape([[-.43,.59],[.43,.59],[.62,.36],[.52,-.36],[0,-.71],[-.52,-.36],[-.62,.36]], .13);

const rankEffects = {
  colossus: 'rise', armor: 'shield', second: 'healing', anchor: 'stomp', leech: 'snack', guard: 'bubble',
  power: 'mitt', reach: 'ribbon', tempo: 'pulse', finisher: 'stars', echo: 'echo', return: 'portal',
  fire: 'ember', frost: 'crystal', fork: 'fan', seeker: 'reticle', speed: 'bolt', boomer: 'pinball',
  swift: 'stream', phase: 'ghost', counter: 'mark', battery: 'crown', wide: 'sun', after: 'firework',
  earthwall:'stomp',embertrail:'ember',frostbloom:'crystal',stormcoil:'bolt',vortex:'echo',stoneburst:'fan',mending:'healing',starfall:'stars'
};
function skillEffect(q) {
  const { x, z, rank, skill: key } = q;
  const { color } = skills[key];
  const kind = rankEffects[key];
  const facing = q.angle || 0;
  const strength = q.upgrade ? 1.17 : 1;
  const ttl = (.37 + rank * .12) * strength;
  const size = (.66 + rank * .30) * strength;
  const showRing = (y, a, b, time = ttl, alpha = .75, tilted = false) =>
    shockRing(x, y, z, a * size, b * size, color, time, alpha, tilted);
  const gem = (geo, y, a, radius, height, scale, speed) => {
    const m = transient(geo, fxMaterial(color, .89), x, y, z);
    movingFx(m, ttl, { kind: 'skill', x, y, z, angle: a, radius, height, a: scale, b: scale * .34, opacity: .90, speed });
  };
  const spread = (geo, y, count, radius, height, scale, speed) => {
    for (let i = 0; i < count; i++) gem(geo, y, facing + TAU * i / count, radius, height, scale, speed);
  };
  switch (kind) {
    case 'rise':
      for (let i = 0; i < rank; i++) showRing(.09 + .37 * i, .56, 2.42 - i * .24, ttl + i * .17);
      if (rank === 3) spread(starGeo, 1.10, 5, 1.1, 1.7, 2.1, 4.6);
      break;
    case 'shield':
      spread(marblePlate, .83, rank, .82, rank === 3 ? 1.35 : .26, .53, rank * 2.1);
      if (rank === 3) showRing(.74, .61, 1.92, ttl, .75, true);
      break;
    case 'healing':
      for (let i = 0; i < rank; i++) showRing(.07 + i * .37, .38, 2.01, ttl + i * .12);
      spread(healCross, .42, rank === 1 ? 1 : rank * 3, 1.1, 1.55, .20, 4.4);
      break;
    case 'stomp':
      spread(skillAnchor, .48, rank, .78, -.13, .46, .5);
      showRing(.055, .70, 2.24 + rank * .31);
      if (rank === 3) particles(x, .12, z, 18, color, 5.8, .51, .45, 'line', facing);
      break;
    case 'snack':
      spread(skillSnack, 1.05, rank, .94, .65, .28, 4.5);
      if (rank === 3) particles(x, 1.2, z, 18, color, 4.5, 1.4, .51, 'drop');
      break;
    case 'bubble':
      spread(shellRings, .83, rank, .37, 1.24, .39, 4.3);
      if (rank === 3) showRing(.43, 1.2, 2.6, ttl, .76, true);
      break;
    case 'mitt':
    case 'ribbon':
    case 'pulse': {
      const amplitude = kind === 'mitt' ? .35 : kind === 'ribbon' ? .80 : .15;
      for (let i = 0; i < rank; i++) {
        const fx = transient(kind === 'pulse' ? thinArc : arc, fxMaterial(color, .79), x, .78 + i * .24, z);
        fx.rotation.set(-1.18 + .09 * i, facing + i * .44, -.35 - i * .56, 'YXZ');
        movingFx(fx, ttl * (.72 + i * .14), { kind: 'arc', a: .95 + amplitude, b: (2.15 + amplitude) * size, opacity: .79, side: i % 2 ? -1 : 1 });
      }
      if (rank === 3 && kind === 'mitt') starburst(x + Math.sin(facing) * 2, 1.27, z + Math.cos(facing) * 2, color, true);
      break;
    }
    case 'stars':
    case 'crown':
      spread(starGeo, kind === 'stars' ? .65 : 1.55, rank === 3 ? 7 : rank, .66, kind === 'stars' ? 2.1 : .85, 1.32, 3.5);
      break;
    case 'echo':
    case 'firework':
      for (let i = 0; i < rank; i++) showRing(.09 + i * .19, .32, 2.1 + i * .22, ttl + i * .1, .81, i % 2 !== 0);
      if (rank === 3 || kind === 'firework') spread(starGeo, .77, rank * 2, .96, 1.72, 1.42, 6);
      break;
    case 'portal':
    case 'reticle':
      spread(shellRings, .96, rank, .52, kind === 'portal' ? .6 : .18, kind === 'portal' ? .84 : .47, 6.2);
      if (rank === 3) starburst(x, 1.01, z, color, kind === 'portal');
      break;
    case 'ember':
      for (let i = 0; i < rank; i++) particles(x, .8 + i * .14, z, 5 + rank * 2, i % 2 ? 0xffdb71 : color, 5.6, 1.96, ttl, 'line', facing + (i - rank * .5) * .43);
      if (rank === 3) showRing(.87, .42, 1.80, ttl, .89, true);
      break;
    case 'crystal':
      spread(skillGem, .50, rank === 3 ? 7 : rank, .63, 1.24, .22 + rank * .025, 3.3);
      if (rank === 3) showRing(.1, .55, 2.04);
      break;
    case 'fan':
    case 'bolt':
    case 'stream':
      for (let i = 0; i < rank; i++) {
        const angle = facing + (i - (rank - 1) * .5) * (kind === 'fan' ? .54 : .23) + (kind === 'stream' ? Math.PI : 0);
        particles(x, .6 + i * .09, z, 5 + rank * 2, color, 5.5 + rank * 2.1, .75, ttl, 'line', angle);
      }
      if (rank === 3 && kind !== 'fan') showRing(.52, .54, 1.8, ttl, .78, true);
      break;
    case 'pinball':
      for (let i = 0; i < rank; i++) showRing(.59 + .17 * i, .40, 1.68, ttl, .84, true);
      if (rank > 1) particles(x, .67, z, rank * 6, color, 5.2, 2.8, .51, 'line', facing);
      break;
    case 'ghost':
      for (let i = 0; i < rank; i++) {
        const ghost = transient(skinGeometry, fxMaterial(color, .35), x - Math.sin(facing) * i * .45, .12, z - Math.cos(facing) * i * .45);
        movingFx(ghost, ttl + i * .13, { kind: 'skill', x: ghost.position.x, y: .12, z: ghost.position.z,
          angle: facing + Math.PI, radius: .36, height: .42, a: 1, b: .71, opacity: .43, speed: 0 });
      }
      break;
    case 'mark':
      spread(starGeo, 1.20, rank, .58, .93, 1.46, 5.4);
      if (rank === 3) showRing(.65, .88, 1.9, ttl, .79, true);
      break;
    case 'sun':
      for (let i = 0; i < rank; i++) showRing(.14 + i * .38, .35, 3.0 + i * .51, ttl + .11 * i, .85, i > 0);
      break;
  }
  if (q.upgrade) {
    playSound('upgrade', x, z, rank);
    if (q.i === localSlot) {
      vibrate('upgrade');
      callout(skills[key].name, 'Rank ' + ['I', 'II', 'III'][rank - 1], 1.75);
    }
  }
}

const protocolTag = WORLD.duelProtocol;
const inputTag = 73;
const motionTag = 77;
const INPUT_MS = 33;
const STATE_MS = 1000 / 30;
const FULL_MS = 200;
const NET_MOTION_LAG = 67;
const motionFields = ['x', 'z', 'r', 'vx', 'vz', 'kx', 'kz', 'air', 'vy'];
const receivedMotion = [];
const predictionHistory = [];
const priorMotion = [{}, {}];
let frameStateAt = 0;
let keyframeAt = 0;
let keyframePhase = '';
let keyframeRound = -1;
let networkDirty = false;
let lastCommand = 0;
let inputSequence = 0;
let lastRemoteSequence = 0;
let lastMotionTick = -1;
let simulationTick = 0;
let sentAt = 0;
let prediction = null;
let motionLink = null;
let watchedPeerConnection = null;
let watchMotionChannel = null;
let peerDataChannelHandler = null;
let lastFast = 0;
let projectileFrameAt = 0;
let localDashSoundAt = -Infinity;
let attackPreview = null;

function encodeInput(input, sequence) {
  const buffer = new ArrayBuffer(26);
  const v = new DataView(buffer);
  v.setUint8(0, inputTag);
  v.setUint8(1, protocolTag);
  v.setUint8(2, input.ready ? 1 : 0);
  v.setUint8(3, Math.round(input.assist * 255));
  v.setUint32(4, sequence);
  v.setInt16(8, Math.round(input.x * 16384));
  v.setInt16(10, Math.round(input.z * 16384));
  const aim = Number.isFinite(input.aim) ? Math.atan2(Math.sin(input.aim), Math.cos(input.aim)) : null;
  v.setInt16(12, aim === null ? -32768 : Math.round(aim * 10000));
  actions.forEach((key, i) => v.setUint16(14 + i * 2, input.a[key] % 65536));
  v.setUint8(24, Math.round(clamp(input.spitCharge || 0, 0, 1) * 255));
  return buffer;
}
function readFastInput(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 26) return;
  const v = new DataView(buffer);
  if (v.getUint8(0) !== inputTag || v.getUint8(1) !== protocolTag) return;
  const seq = v.getUint32(4);
  if (!seq || seq <= lastRemoteSequence) return;
  lastRemoteSequence = seq;
  lastRemote = lastFast = performance.now();
  const aim = v.getInt16(12);
  const a = {};
  actions.forEach((key, i) => { a[key] = v.getUint16(14 + i * 2); });
  remoteReady = v.getUint8(2) === 1;
  inputs[1] = {
    x: clamp(v.getInt16(8) / 16384, -1, 1),
    z: clamp(v.getInt16(10) / 16384, -1, 1),
    aim: aim === -32768 ? null : aim / 10000,
    assist: v.getUint8(3) / 255, a, ready: remoteReady, spitCharge: v.getUint8(24) / 255
  };
}
function packMotion() {
  const buffer = new ArrayBuffer(58);
  const v = new DataView(buffer);
  v.setUint8(0, motionTag);
  v.setUint8(1, protocolTag);
  v.setUint32(2, simulationTick);
  v.setUint32(6, state.roundKey);
  v.setUint32(10, lastRemoteSequence);
  v.setFloat32(14, state.timer);
  state.p.forEach((p, slot) => {
    let offset = 18 + 20 * slot;
    for (const field of motionFields) {
      const value = field === 'r' ? Math.atan2(Math.sin(p.r), Math.cos(p.r)) : p[field];
      const scale = field === 'r' ? 10000 : 384;
      v.setInt16(offset, Math.round(clamp(value * scale, -32767, 32767)));
      offset += 2;
    }
    v.setUint16(offset, Math.round(clamp(p.dashTime, 0, 1) * 10000));
  });
  return buffer;
}
function receiveMotion(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 58) return;
  const v = new DataView(buffer);
  if (v.getUint8(0) !== motionTag || v.getUint8(1) !== protocolTag || v.getUint32(6) !== state.roundKey) return;
  const tick = v.getUint32(2), timer = v.getFloat32(14);
  if (tick <= lastMotionTick || !Number.isFinite(timer)) return;
  const poses = [{}, {}];
  poses.forEach((p, slot) => {
    let offset = 18 + 20 * slot;
    for (const field of motionFields) {
      p[field] = v.getInt16(offset) / (field === 'r' ? 10000 : 384);
      offset += 2;
    }
    p.dashTime = v.getUint16(offset) / 10000;
  });
  if (!poses.every(validPoint)) return;
  const now = performance.now();
  lastSnapshot = lastFast = now;
  acceptMotion(tick, v.getUint32(10), poses, now);
  if (state.phase === 'fight') state.timer = timer;
}
function acceptMotion(tick, ack, poses, now) {
  if (tick <= lastMotionTick) return;
  lastMotionTick = tick;
  receivedMotion.push({ at: now, pose: poses[0] });
  if (receivedMotion.length > 8) receivedMotion.shift();
  for (const [i, pose] of poses.entries()) Object.assign(priorMotion[i], pose);
  reconcile(poses[1], ack);
}
function reconcile(pose, ack) {
  if (state.phase !== 'fight') return;
  const authoritative = state.p[1];
  if (!authoritative.active) return;
  const current = prediction;
  const localDash = current && current.predictedDash > performance.now() && pose.dashTime <= 0 && authoritative.stun <= 0;
  const corrected = {
    ...authoritative, ...pose,
    predictedDash: localDash ? current.predictedDash : 0,
    dashInput: current?.dashInput ?? inputCounts.dash
  };
  if (localDash) {
    corrected.dashTime = current.dashTime;
    corrected.kx = current.kx;
    corrected.kz = current.kz;
  }
  for (const item of predictionHistory) {
    if (item.sequence <= ack) continue;
    drivePlayer(corrected, item.input, item.dt);
  }
  while (predictionHistory[0]?.sequence <= ack) predictionHistory.shift();
  if (current && Math.hypot(current.x - corrected.x, current.z - corrected.z) < 1.12 && authoritative.stun <= .1) {
    corrected.x = lerp(current.x, corrected.x, .48);
    corrected.z = lerp(current.z, corrected.z, .48);
  }
  prediction = corrected;
}
function predictGuest(input, dt) {
  if (mode !== 'guest' || state.paused || state.phase !== 'fight' || !input.ready || !state.p[1].active) {
    prediction = null;
    predictionHistory.length = 0;
    return;
  }
  const server = state.p[1];
  if (!prediction) prediction = { ...server, ...priorMotion[1], dashInput: input.a.dash, predictedDash: 0 };
  const p = prediction;
  p.attack = server.attack;
  p.stun = server.stun;
  p.chill = server.chill;
  p.chillAmount = server.chillAmount;
  p.dashTime = Math.max(0, p.dashTime - dt);
  if (input.a.dash !== p.dashInput) {
    p.dashInput = input.a.dash;
    if (server.dash <= 0 && server.stun <= 0 && p.dashTime <= 0 && p.air <= .1 &&
        (!server.attack || (server.struck && server.duration - server.attackTime >= .20))) {
      const aim = aimOf(p, input), len = Math.hypot(input.x, input.z);
      p.kx = (len > .12 ? input.x / len : -Math.sin(aim)) * moves.dash.speed;
      p.kz = (len > .12 ? input.z / len : -Math.cos(aim)) * moves.dash.speed;
      p.dashTime = moves.dash.time;
      localDashSoundAt = performance.now();
      p.predictedDash = localDashSoundAt + 170;
      playSound('dash', p.x, p.z);
    }
  }
  drivePlayer(p, input, Math.min(.05, dt));
  if (!p.attack && p.stun <= 0) p.r = aimOf(p, input);
  predictionHistory.push({ sequence: inputSequence + 1, input, dt: Math.min(.05, dt) });
  if (predictionHistory.length > 36) predictionHistory.shift();
}
function predictAttack(attack) {
  const p = state.p[1];
  if (attack === 'dash' || p.attackTime > .045 || p.stun > 0 || p.air > .1 || p.dashTime > 0 ||
      (attack === 'nova' && p.en < 100) || attackPreview) return;
  const combo = attack === 'slap' && p.chain > 0 && p.comboLanded && p.combo < 2 ? p.combo + 1 : 0;
  const move = attack === 'slap' ? moves.slap[combo] : moves[attack];
  const pace = attack === 'slap' ? skillValue(p, 'tempo', 'time', 1) : 1;
  attackPreview = { attack, combo, duration: move.duration * pace, contactTime: move.contact * pace,
    started: performance.now(), countering: attack === 'slap' && p.counter > 0 };
}
function renderedPose(slot) {
  if (mode === 'public' && slot === 0) return publicPose();
  const p = state.p[slot];
  if (mode !== 'guest' || state.phase !== 'fight' || state.paused) return p;
  if (slot === 1) {
    const pose = prediction ? { ...prediction, ...p, x: prediction.x, z: prediction.z, r: prediction.r,
      vx: prediction.vx, vz: prediction.vz, air: prediction.air, dashTime: prediction.dashTime } : { ...p, ...priorMotion[1] };
    if (!attackPreview) return pose;
    const age = (performance.now() - attackPreview.started) / 1000;
    if (p.attackTime > .045 || p.stun > 0 || age > .29) {
      attackPreview = null;
      return pose;
    }
    const { attack, combo, duration, contactTime, countering } = attackPreview;
    return { ...pose, attack, combo, duration, contactTime, countering,
      attackTime: duration - Math.min(age, contactTime - .016) };
  }
  if (!receivedMotion.length) return p;
  const time = performance.now() - NET_MOTION_LAG;
  let a = receivedMotion[0], b = receivedMotion[0];
  for (let i = 1; i < receivedMotion.length; i++) {
    b = receivedMotion[i];
    if (b.at >= time) break;
    a = b;
  }
  const f = a === b ? 0 : clamp((time - a.at) / Math.max(1, b.at - a.at), 0, 1);
  return {
    ...p, x: lerp(a.pose.x, b.pose.x, f), z: lerp(a.pose.z, b.pose.z, f),
    r: a.pose.r + angleDiff(a.pose.r, b.pose.r) * f, air: lerp(a.pose.air, b.pose.air, f),
    vx: lerp(a.pose.vx, b.pose.vx, f), vz: lerp(a.pose.vz, b.pose.vz, f)
  };
}
function resetMotion() {
  prediction = null;
  attackPreview = null;
  localDashSoundAt = -Infinity;
  receivedMotion.length = 0;
  predictionHistory.length = 0;
  lastMotionTick = -1;
  for (const pose of priorMotion) for (const key of Object.keys(pose)) delete pose[key];
}
function stopFastChannel() {
  if (watchedPeerConnection?.ondatachannel === watchMotionChannel && watchMotionChannel) {
    watchedPeerConnection.ondatachannel = peerDataChannelHandler;
  }
  watchedPeerConnection = watchMotionChannel = peerDataChannelHandler = null;
  const old = motionLink;
  motionLink = null;
  lastFast = 0;
  old?.close();
  inputSequence = lastRemoteSequence = 0;
  simulationTick = 0;
  frameStateAt = keyframeAt = sentAt = 0;
  keyframePhase = '';
  keyframeRound = -1;
  networkDirty = true;
  lastCommand = 0;
  draftClock.id = -1;
  draftClock.end = 0;
  resetMotion();
}
function setupMotionChannel(connection, hostSide, token) {
  const pc = connection.peerConnection;
  if (!connection.relay && !pc?.createDataChannel) return;
  function attach(channel) {
    if (token !== netAttempt || link !== connection || motionLink) {
      channel.close();
      return;
    }
    motionLink = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', event => {
      if (token !== netAttempt || motionLink !== channel || !welcomed) return;
      if (hostSide) readFastInput(event.data);
      else receiveMotion(event.data);
    });
    const close = () => {
      if (motionLink === channel) {
        motionLink = null;
        lastFast = 0;
      }
    };
    channel.addEventListener('close', close);
    channel.addEventListener('error', close);
  }
  if(connection.relay){attach(connection.motion);return;}
  if (hostSide) {
    watchedPeerConnection = pc;
    const handlePeerChannel = pc.ondatachannel;
    peerDataChannelHandler = handlePeerChannel;
    watchMotionChannel = event => {
      if (event.channel.label === 'slime-motion') attach(event.channel);
      else handlePeerChannel?.call(pc, event);
    };
    // PeerJS's WebRTC adapter drops capture options when it wraps datachannel listeners.
    // Route the motion channel here so PeerJS keeps its reliable channel for match state.
    pc.ondatachannel = watchMotionChannel;
  } else {
    try { attach(pc.createDataChannel('slime-motion', { ordered: false, maxRetransmits: 0 })); }
    catch { /* Reliable state remains available. */ }
  }
}
function sendFast(buffer) {
  if (motionLink?.readyState !== 'open' || motionLink.bufferedAmount > 1024) return false;
  try {
    motionLink.send(buffer);
    return true;
  } catch { return false; }
}
function copyWireState(now) {
  const run = state.run;
  if (!run) return state;
  const { draft, ...rest } = run;
  if (!draft) return { ...state, run: { ...rest, draft: null } };
  return {
    ...state, run: {
      ...rest,
      draft: {
        id: draft.id, remaining: Math.max(0, draft.deadline - now),
        offers: [[], draft.offers[1]], locked: draft.locked, picks: ['', draft.picks[1]]
      }
    }
  };
}
function broadcastState(now = performance.now()) {
  if (!link?.open || !welcomed || (link.dataChannel?.bufferedAmount || 0) > 16384) return;
  const fresh = copyWireState(now);
  const paused = !gameReady() || !remoteReady;
  const packet = { t: 'state', tick: simulationTick, ack: lastRemoteSequence, s: { ...fresh, paused }, atomic: atomicWireSessions() };
  if(!send(packet))return;
  keyframeAt = now;
  keyframePhase = state.phase;
  keyframeRound = state.roundKey;
  networkDirty = false;
}
function acceptKeyframe(packet) {
  const s = packet.s;
  if (!validSnapshot(s)) return;
  const now = performance.now();
  const sameRound = s.roundKey === state.roundKey && s.phase === state.phase;
  if (!sameRound) resetMotion();
  syncDraftClock(s, now);
  if (sameRound && Number.isInteger(packet.tick) && packet.tick < lastMotionTick && s.phase === 'fight') s.timer = state.timer;
  state = s;
  syncAtomicSessions(packet.atomic);
  lastSnapshot = projectileFrameAt = now;
  const tick = Number.isInteger(packet.tick) ? packet.tick : lastMotionTick + 1;
  const ack = Number.isInteger(packet.ack) ? packet.ack : 0;
  if (!sameRound || tick > lastMotionTick || !receivedMotion.length) {
    const poses = s.p.map(p => Object.fromEntries([...motionFields, 'dashTime'].map(key => [key, p[key]])));
    acceptMotion(tick, ack, poses, now);
  } else if (prediction && s.p[1].stun > .08) {
    prediction.predictedDash = 0;
    reconcile(priorMotion[1], ack);
  }
}
function readCommand(data) {
  const seq = Number.isSafeInteger(data.seq) && data.seq > 0 ? data.seq : 0;
  if (seq && seq <= lastCommand) return;
  if (seq) lastCommand = seq;
  const axis = n => Number.isFinite(n) ? clamp(n, -1, 1) : 0;
  const a = {};
  for (const key of actions) {
    a[key] = Number.isSafeInteger(data.a?.[key]) && data.a[key] >= 0 ? data.a[key] : inputs[1].a[key];
  }
  if (seq && seq < lastRemoteSequence) return;
  remoteReady = data.ready !== false;
  inputs[1] = {
    x: axis(data.x), z: axis(data.z), a, ready: remoteReady,
    aim: Number.isFinite(data.aim) ? data.aim % TAU : null,
    assist: Number.isFinite(data.assist) ? clamp(data.assist, 0, 1) : 0,
    spitCharge: Number.isFinite(data.spitCharge) ? clamp(data.spitCharge, 0, 1) : 0
  };
  if (seq) lastRemoteSequence = seq;
}
function tickNet(now = performance.now(), urgent = false) {
  if (!link?.open || !welcomed) return;
  if (mode === 'guest') {
    if (!document.hidden && now - lastSnapshot > 22000) return failConnection('Host connection lost. Try joining again.');
    if (!urgent && now - sentAt < INPUT_MS) return;
    const input = document.hidden ? { ...inputs[1], x: 0, z: 0, ready: false } : readInput();
    const seq = ++inputSequence;
    const fast = sendFast(encodeInput(input, seq));
    if (urgent || !fast || !lastFast || now - lastFast > 500 || now - frameStateAt > 250) {
      send({ t: 'input', v: { ...input, seq } });
      frameStateAt = now;
    }
    sentAt = now;
    return;
  }
  if (!document.hidden && now - lastRemote > 22000) return dropRival('Connection lost. Your rival can rejoin.');
  const due = now - frameStateAt >= STATE_MS;
  const paused = !gameReady() || !remoteReady;
  const fast = motionLink?.readyState === 'open' && lastFast && now - lastFast < 500;
  if (urgent || networkDirty && now-keyframeAt>=50 || keyframePhase !== state.phase || keyframeRound !== state.roundKey ||
      now - keyframeAt >= (fast ? FULL_MS : STATE_MS)) {
    broadcastState(now);
  }
  if (due && fast && state.phase === 'fight' && !paused) {
    sendFast(packMotion());
    frameStateAt = now;
  }
}

function renderBullet(q) {
  const at = mode === 'public' ? publicRoom.updated : projectileFrameAt;
  if (!['guest', 'public'].includes(mode) || state.paused || state.phase !== 'fight' || !at) return q;
  const age = clamp((performance.now() - at) / 1000, 0, mode === 'public' ? .07 : .14);
  return { ...q, x: q.x + q.vx * age, z: q.z + q.vz * age };
}

let audio = null;
let lastVibration = -Infinity;
const lobbyTrack = 'meadow-music';
const fightTracks = ['fight-music-1', 'fight-music-2'];
const musicLevel = .62;
const slapSamples = ['smack-a', 'smack-b', 'smack-c', 'smack-d'];
const clipMap = {
  slap: 'swing', tap: 'smack-b', chargeSpit: 'swing', spit: 'spit-fx', splat: 'splat', dash: 'dodge', perfect: 'perfect-fx',
  return: 'perfect-fx', chargeNova: 'dodge', nova: 'nova-fx', ko: 'knockout', bounce: 'landing',
  upgrade: 'upgrade-fx', wave: 'nova-fx', start: 'start-fx', tick: 'tick-fx'
};
const generatedCues = new Set(['jump', 'chargeSpit', 'chargeNova', 'charged', 'ready', 'victory', 'defeat',
  'draw', 'lowHealth', 'heal', 'ui', 'back', 'spawn', 'combo']);
const centeredCues = new Set(['start', 'tick', 'charged', 'ready', 'victory', 'defeat', 'draw', 'lowHealth', 'ui', 'back']);
let savedMasterVolume = settings.vol || .85;
const audioCredits = [
  ['Slap hit on the face or shoulder', 'khenshom', 'https://freesound.org/people/khenshom/sounds/539163/'],
  ['Face slap sound effect', 'magicjoshua', 'https://freesound.org/people/magicjoshua/sounds/704179/'],
  ['Hits & Fight – Hand fight, slapping', 'Vrymaa', 'https://freesound.org/people/Vrymaa/sounds/753425/'],
  ['Woosh – Collection 01', 'Vrymaa', 'https://freesound.org/people/Vrymaa/sounds/767407/'],
  ['Water Splash 1', 'qubodup', 'https://freesound.org/people/qubodup/sounds/210428/'],
  ['Lip smack', 'mastermesh', 'https://commons.wikimedia.org/wiki/File:Lip_smack.ogg'],
  ['Dull thud', 'gregoryweir', 'https://commons.wikimedia.org/wiki/File:Dull_thud.ogg']
];

function loadAudioClip(name) {
  const owner = audio;
  if (!owner) return Promise.resolve(null);
  if (owner.buffers.has(name)) return Promise.resolve(owner.buffers.get(name));
  if (owner.loading.has(name)) return owner.loading.get(name);
  if (performance.now() < (owner.failedClips.get(name) || 0)) return Promise.resolve(null);
  const url = AUDIO_FILES[name];
  if (!url) return Promise.resolve(null);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const task = fetch(url, { signal: controller.signal }).then(response => {
    if (!response.ok) throw new Error(`Audio ${name}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }).then(bytes => owner.ctx.decodeAudioData(bytes)).then(buffer => {
    owner.buffers.set(name, buffer);
    owner.failedClips.delete(name);
    return buffer;
  }).catch(error => {
    owner.failedClips.set(name, performance.now() + 15000);
    console.warn('Could not load sound:', name, error);
    return null;
  }).finally(() => {
    clearTimeout(timeout);
    owner.loading.delete(name);
  });
  owner.loading.set(name, task);
  return task;
}
function prepareMusic() {
  // Start tracks only after a user interaction to respect mobile autoplay policies.
  for (const name of [lobbyTrack, ...fightTracks]) {
    const url = AUDIO_FILES[name];
    if (!url) continue;
    const track = document.createElement('audio');
    track.loop = true;
    track.playsInline = true;
    track.preload = 'metadata';
    track.src = url;
    const gain = audio.ctx.createGain();
    gain.gain.value = 0;
    audio.ctx.createMediaElementSource(track).connect(gain).connect(audio.music);
    const info = { track, gain, level: 0, fadeTimer: 0, starting: false, retryAt: 0, failures: 0, error: false };
    track.addEventListener('error', () => {
      info.error = true;
      info.retryAt = performance.now() + 15000;
      updateAudioControls();
    });
    audio.tracks.set(name, info);
  }
}
function startMusic(info, gesture = false) {
  if (!info || info.starting || !info.track.paused || (!gesture && performance.now() < info.retryAt)) return;
  info.starting = true;
  let task;
  try { task = info.track.play(); }
  catch (error) { task = Promise.reject(error); }
  Promise.resolve(task).then(() => {
    info.error = false;
    info.failures = 0;
    info.retryAt = 0;
    if (!info.level) info.track.pause();
  }).catch(() => {
    info.error = true;
    info.retryAt = performance.now() + Math.min(30000, 1000 * 2 ** Math.min(info.failures++, 5));
  }).finally(() => { info.starting = false; updateAudioControls(); });
}
function mixTrack(info, level, now) {
  const { track, gain } = info;
  if (info.level !== level) {
    info.level = level;
    clearTimeout(info.fadeTimer);
    gain.gain.setTargetAtTime(level, now, .20);
    if (!level) info.fadeTimer = setTimeout(() => { if (!info.level) track.pause(); }, 1000);
  }
  if (level) startMusic(info);
}
function primeMusic() {
  // Activate each media element during the gesture, before countdowns or network waits.
  for (const info of audio.tracks.values()) startMusic(info, true);
}
function unlockAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { updateAudioControls(); return; }
    if (audio?.ctx.state === 'closed') {
      for (const info of audio.tracks.values()) { clearTimeout(info.fadeTimer); info.track.pause(); }
      audio = null;
    }
    if (!audio) {
      const ctx = new Audio({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      const effects = ctx.createGain();
      const music = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -5;
      limiter.knee.value = 12;
      limiter.ratio.value = 7;
      limiter.attack.value = .002;
      limiter.release.value = .085;
      effects.connect(master);
      music.connect(master);
      master.connect(limiter).connect(ctx.destination);
      audio = {
        ctx, master, effects, music, buffers: new Map(), loading: new Map(), tracks: new Map(),
        generated: SlimoAudioSynth.createBank(ctx), failedClips: new Map(),
        voices: 0, smack: 0, selection: '', inRing: false, ringTrack: -1,
        musicAt: -Infinity, observed: null, resultKey: ''
      };
      ctx.addEventListener?.('statechange', updateAudioControls);
    }
    if (audio.ctx.state !== 'running' && !audio.resuming) {
      audio.resuming = audio.ctx.resume().catch(() => {}).finally(() => { audio.resuming = null; });
    }
    if (settings.vol > 0 && settings.sfx > 0) {
      for (const name of new Set([...slapSamples, ...Object.values(clipMap)])) loadAudioClip(name);
    }
    const prepare = settings.music > 0 && settings.vol > 0 && !audio.tracks.size;
    if (prepare) prepareMusic();
    refreshAudio();
    if (prepare) primeMusic();
    else if (settings.vol > 0 && settings.music > 0) startMusic(audio.tracks.get(audio.selection), true);
    updateAudioControls();
  } catch { /* Audio is optional for unsupported browsers. */ }
}
function ringHasRival() {
  const frame = publicRoom.frames.at(-1);
  if (!frame || !roomCanFight() || state.p[0].hp <= 0) return false;
  for (const rival of frame.poses.values()) {
    if (rival.id !== publicRoom.id && rival.hp > 0 && insideFightRing(rival.x, rival.z)) return true;
  }
  return false;
}
function selectMusic() {
  const inRing = mode === 'public' && ringHasRival();
  if (inRing && !audio.inRing) audio.ringTrack = (audio.ringTrack + 1) % fightTracks.length;
  audio.inRing = inRing;
  if (mode === 'lobby' || state.phase !== 'fight' || state.paused) return lobbyTrack;
  if (mode === 'public') return inRing ? fightTracks[audio.ringTrack] : lobbyTrack;
  const round = Number.isInteger(state.round) && state.round > 0 ? state.round : 1;
  return fightTracks[(round - 1) % fightTracks.length];
}
function refreshAudio(selection) {
  if (!audio) { updateAudioControls(); return; }
  const { ctx, master, effects, music, tracks } = audio;
  const now = ctx.currentTime;
  audio.selection = selection ?? selectMusic();
  const volume = document.hidden ? 0 : settings.vol;
  master.gain.setTargetAtTime(volume, now, .075);
  effects.gain.setTargetAtTime(settings.sfx, now, .05);
  music.gain.cancelScheduledValues(now);
  music.gain.setTargetAtTime(settings.music * musicLevel, now, .14);
  const audible = volume > 0 && settings.music > 0;
  for (const [name, track] of tracks) mixTrack(track, Number(audible && name === audio.selection), now);
  updateAudioControls();
}
function updateAudioControls() {
  const enabled = settings.vol > 0;
  for (const id of ['soundToggle', 'battleSound']) {
    const button = $(id);
    if (!button) continue;
    const text = enabled ? 'Sound on' : 'Sound off';
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Mute game audio' : 'Enable game audio');
  }
  const status = $('audioStatus');
  if (!status) return;
  const track = audio?.tracks.get(audio.selection);
  const message = !enabled ? 'Game audio is muted.' : !(window.AudioContext || window.webkitAudioContext) ? 'This browser does not support game audio.' : !audio ? 'Tap Test sound to enable audio.' :
    audio.ctx.state !== 'running' ? 'Audio paused by your browser. Tap Test sound to resume.' :
    track?.error ? 'Combat sounds ready. Music could not start; tap Test sound to retry.' :
    'Sound ready · music and combat have separate volume controls.';
  if (status.textContent !== message) status.textContent = message;
}
function toggleGameSound() {
  if (settings.vol > 0) { savedMasterVolume = settings.vol; settings.vol = 0; }
  else settings.vol = savedMasterVolume;
  saveSettings('vol');
  if (activeOverlay === 'setOverlay') buildSettings();
}
function audioCues(now) {
  const self = state.p[localSlot];
  const scope = mode + ':' + state.roundKey + ':' + state.duelMatch;
  const old = audio.observed;
  const current = { scope, air: self.air || 0, en: self.en || 0,
    danger: self.hp > 0 && self.hp / self.maxHp <= .25,
    charged: spitHold !== null && now - spitHold >= 840 };
  audio.observed = current;
  if (mode === 'lobby' || document.hidden || state.paused || !old || old.scope !== scope) return;
  if (state.phase === 'fight' && self.hp > 0) {
    if (current.air > .01 && old.air <= .01 && !(self.stun > 0)) playSound('jump', self.x, self.z);
    if (settings.alerts) {
      if (current.en >= 100 && old.en < 100) playSound('ready');
      if (current.danger && !old.danger) playSound('lowHealth');
      if (current.charged && !old.charged) playSound('charged');
    }
  }
  if (mode !== 'public' && ['round', 'over'].includes(state.phase)) {
    const winner = state.phase === 'over' ? state.run?.winner ?? state.winner : state.winner;
    const key = scope + ':' + state.round + ':' + winner;
    if (audio.resultKey !== key) {
      audio.resultKey = key;
      playSound(winner < 0 ? 'draw' : winner === localSlot ? 'victory' : 'defeat');
    }
  }
}
function audioFrame() {
  if (!audio) return;
  const now = performance.now();
  audioCues(now);
  // Music decisions can scan a 50-player room; they do not need render frequency.
  if (now - audio.musicAt < 100) return;
  audio.musicAt = now;
  const next = selectMusic();
  if (audio.selection !== next) refreshAudio(next);
  else if (!document.hidden && settings.vol > 0 && settings.music > 0) startMusic(audio.tracks.get(next));
}
function playSound(kind, x = null, z = null, heavy = false) {
  if (!audio || audio.ctx.state !== 'running' || document.hidden || !settings.vol || !settings.sfx || audio.voices >= 24) return false;
  const p = state.p[localSlot];
  const spatial = !centeredCues.has(kind) && Number.isFinite(x) && Number.isFinite(z);
  const d = spatial ? Math.hypot(x - p.x, z - p.z) : 0;
  if (mode === 'public' && d > 42) return false;
  const name = kind === 'smack' ? slapSamples[audio.smack++ % slapSamples.length] : clipMap[kind];
  const fallback = { tap: 'smack', return: 'perfect', wave: 'nova' }[kind] || kind;
  const buffer = (generatedCues.has(kind) ? audio.generated.get(kind) : audio.buffers.get(name)) || audio.generated.get(fallback);
  if (!buffer) return false;
  if (name && !audio.buffers.has(name)) void loadAudioClip(name);
  const owner = audio;
  const { ctx, effects } = owner;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const level = {
    tap: .49, smack: heavy ? 1.00 : .84, slap: heavy ? .66 : .43, chargeSpit: .25, spit: .68, splat: .71,
    dash: .53, perfect: .65, return: .63, chargeNova: .39, nova: .93, ko: .83,
    bounce: .56, upgrade: .64, wave: .57, start: .71, tick: .38,
    jump: .64, charged: .46, ready: .52, victory: .64, defeat: .55, draw: .48,
    lowHealth: .42, heal: .56, ui: .44, back: .38, spawn: .54, combo: .54
  }[kind] ?? .54;
  source.buffer = buffer;
  source.playbackRate.value = kind === 'smack' ? (heavy ? .88 : .97) + Math.random() * .09 :
    kind === 'upgrade' ? 1 + (Number(heavy) || 0) * .055 : kind === 'chargeSpit' ? 1.52 : kind === 'wave' ? 1.14 : .97 + Math.random() * .06;
  gain.gain.value = clamp(1 - d / 39, .10, 1) * level;
  source.connect(gain);
  let pan;
  if (ctx.createStereoPanner) {
    pan = ctx.createStereoPanner();
    pan.pan.value = spatial ? clamp((-(x - p.x) * Math.cos(view.yaw) + (z - p.z) * Math.sin(view.yaw)) / 14, -.8, .8) : 0;
    gain.connect(pan).connect(effects);
  } else gain.connect(effects);
  owner.voices++;
  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    owner.voices = Math.max(0, owner.voices - 1);
    source.disconnect();
    gain.disconnect();
    pan?.disconnect();
  };
  source.onended = cleanup;
  try { source.start(); }
  catch { cleanup(); return false; }
  if (kind === 'smack' && heavy && d < 16) {
    const now = ctx.currentTime;
    const level = settings.music * musicLevel;
    audio.music.gain.cancelScheduledValues(now);
    audio.music.gain.setTargetAtTime(level * .68, now, .024);
    audio.music.gain.setTargetAtTime(level, now + .095, .18);
  }
  return true;
}
function vibrate(kind) {
  if (!settings.haptic || !navigator.vibrate || document.hidden) return;
  const now = performance.now();
  if (kind !== 'ko' && now - lastVibration < 52) return;
  lastVibration = now;
  navigator.vibrate({ swing: 10, dash: 13, light: 24, heavy: [32, 16, 33], perfect: [16, 17, 18],
    nova: [28, 18, 48], ko: [42, 33, 82], upgrade: [13, 24, 21] }[kind] || 12);
}
function showAudioCredits() {
  const list = $('audioCredits');
  list.replaceChildren();
  for (const [title, author, url] of audioCredits) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = title;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(link, ' · ' + author);
    list.append(row);
  }
  const original = document.createElement('li');
  original.textContent = 'Original Slimo synthesized cues: jump, charge, Nova ready, low health, healing, combo, results and interface feedback. Generated locally without external audio services.';
  list.append(original);
  openOverlay('creditsOverlay');
}

const storedPractice = readStore('slimeMeadowPractice', {});
let practiceOptions = {
  format: ['rogue', 'classic', 'sandbox'].includes(storedPractice.format) ? storedPractice.format : 'rogue',
  arena: storedPractice.arena === 'rome' ? 'rome' : 'meadow',
  bouts: Number.isInteger(storedPractice.bouts) ? clamp(storedPractice.bouts, 1, 15) : 7,
  seconds: Number.isInteger(storedPractice.seconds) ? clamp(storedPractice.seconds, 20, 180) : 48,
  ai: ['active', 'dummy', 'mirror'].includes(storedPractice.ai) ? storedPractice.ai : 'active',
  difficulty: Number.isInteger(storedPractice.difficulty) ? clamp(storedPractice.difficulty, 0, 2) : settings.bot,
  rivals: ['standard', 'mirror', 'blaze', 'titan', 'phantom'].includes(storedPractice.rivals) ? storedPractice.rivals : 'standard',
  ranks: cleanBuild(storedPractice.ranks, skillIds.length*3)
};
let buildContext = 'practice';
let editableBuild = {};
let selectedBuildSkill = 'colossus';
let practiceDraft = null;
let buildButtons = new Map();
const buildShortcuts = [
  ['blaze', 'Blazing Volley'], ['titan', 'Colossus'], ['phantom', 'Ghost Counter']
];
function preservePractice() { writeStore('slimeMeadowPractice', practiceOptions); }
function practiceFormValues() {
  const r = practiceDraft || practiceOptions;
  $('practiceFormat').value = r.format;
  $('practiceArena').value = r.arena;
  $('practiceBouts').value = r.bouts;
  $('practiceSeconds').value = r.seconds;
  $('practiceAI').value = r.ai;
  $('practiceDifficulty').value = r.difficulty;
  $('practiceRival').value = r.rivals;
  setText($('practiceBuildCount'), buildCost(r.ranks) ? buildCost(r.ranks) + ' equipped ranks' : 'Choose skills');
  const sandbox = r.format === 'sandbox';
  $('practiceBouts').disabled = $('practiceSeconds').disabled = sandbox;
}
function collectPractice() {
  const whole = (id, min, max, fallback) => {
    const value = Number($(id).value);
    return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
  };
  const r = practiceDraft || practiceOptions;
  return {
    format: $('practiceFormat').value || r.format, arena: $('practiceArena').value || r.arena,
    bouts: whole('practiceBouts', 1, 15, 7), seconds: whole('practiceSeconds', 20, 180, 48),
    ai: $('practiceAI').value || r.ai, difficulty: whole('practiceDifficulty', 0, 2, settings.bot),
    rivals: $('practiceRival').value || r.rivals, ranks: { ...r.ranks }
  };
}
function openPractice() {
  unlockAudio();
  practiceDraft = { ...practiceOptions, ranks: { ...practiceOptions.ranks },
    format: mode === 'lobby' ? lobbyFormat : practiceOptions.format };
  practiceFormValues();
  openOverlay('practiceOverlay');
}
function startCustomPractice() {
  practiceOptions = collectPractice();
  practiceDraft = null;
  preservePractice();
  if (mode === 'bot') {
    unlockAudio();
    closeOverlay(false);
    beginPractice(practiceOptions.format);
    return;
  }
  requestEnter('bot', '', practiceOptions.format);
}
function runPracticeQuick() {
  practiceOptions = { ...practiceOptions, format: lobbyFormat };
  preservePractice();
  requestEnter('bot', '', lobbyFormat);
}
function beginPractice(format) {
  state = freshMatch(format);
  state.p[0] = freshPlayer(0, { active: true, name: profile.name, color: chosen });
  state.p[1] = freshPlayer(1, { active: true, name: 'Cassius', color: (chosen + 1) % 4 });
  inputs = [neutralInput(), neutralInput()];
  inputs[0].a = { ...inputCounts };
  if (practiceOptions.ai === 'mirror') inputs[1].a = { ...inputCounts };
  clearFx();
  restartMatch();
  snapFighters();
  resetViewForRound();
  lastBanner = '';
}
function boutTotal() { return mode === 'bot' ? practiceOptions.bouts : RUN_BOUTS; }
function boutDuration() { return mode === 'bot' ? practiceOptions.seconds : BOUT_SECONDS; }
function chooseBotBuild() {
  if (practiceOptions.rivals === 'mirror') return { ...practiceOptions.ranks };
  return { ...practiceKits[practiceOptions.rivals] };
}
function practiceRespawn() {
  if (state.format !== 'sandbox' || state.phase !== 'round') return false;
  state.round++;
  startRound();
  return true;
}
function buildLimit() { return buildContext === 'room' ? BUILD_POINTS : skillIds.length*3; }
function openBuild(context) {
  buildContext = context;
  if (context === 'practice') {
    if ($('practiceOverlay').hidden === false) practiceDraft = collectPractice();
    editableBuild = { ...(practiceDraft || practiceOptions).ranks };
  } else if (context === 'room' && mode === 'public') editableBuild = cleanBuild(publicRoom.roster.get(publicRoom.id)?.ranks);
  else editableBuild = roomBuild();
  selectedBuildSkill = Object.keys(editableBuild)[0] || 'colossus';
  buildButtons = new Map();
  const grid = $('buildGrid');
  grid.replaceChildren();
  for (const group of groups.filter(g => context !== 'room' || g !== 'Arcane')) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = group;
    section.append(heading);
    for (const key of (context === 'room' ? passiveSkillIds : skillIds).filter(id => skills[id].group === group)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'build-item';
      const title = document.createElement('span'), badge = document.createElement('b');
      title.textContent = skills[key].name;
      card.append(title, badge);
      card.style.setProperty('--skill', '#' + skills[key].color.toString(16).padStart(6, '0'));
      card.onclick = () => { selectedBuildSkill = key; drawBuild(); };
      section.append(card);
      buildButtons.set(key, { card, badge });
    }
    grid.append(section);
  }
  const presets = $('buildPresets');
  presets.replaceChildren();
  for (const [id, name] of buildShortcuts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.onclick = () => {
      editableBuild = { ...practiceKits[id] };
      selectedBuildSkill = Object.keys(editableBuild)[0];
      drawBuild();
    };
    presets.append(button);
  }
  if(context==='room') {
    const starter=document.createElement('button');starter.type='button';starter.textContent='Starter';
    starter.onclick=()=>{editableBuild={...WORLD.starterBuild};selectedBuildSkill='power';drawBuild();};presets.append(starter);
  }
  $('buildAll').hidden = context === 'room';
  setText($('buildTitle'), context === 'room' ? 'Open Meadow build' : 'Practice build');
  setText($('buildSave'), context === 'room' ? 'Equip build' : 'Save build');
  drawBuild();
  openOverlay('buildOverlay');
}
function drawBuild() {
  const key = selectedBuildSkill, data = skills[key], current = editableBuild[key] || 0;
  const cost = buildCost(editableBuild), limit = buildLimit();
  setText($('buildBudget'), cost + '/' + limit + ' ranks equipped');
  for (const [id, { card, badge }] of buildButtons) {
    const rank = editableBuild[id] || 0;
    setText(badge, ['—', 'I', 'II', 'III'][rank]);
    card.setAttribute('aria-pressed', String(id === key));
    card.classList.toggle('equipped', rank > 0);
  }
  const level = Math.max(1, current);
  paintSkillCard($('buildArt'), data, level);
  setText($('buildSkill'), data.name);
  setText($('buildDescription'), data.levels[level - 1].text);
  setText($('buildAnimation'), data.animations[level - 1]);
  for (const button of document.querySelectorAll('[data-build-rank]')) {
    const rank = Number(button.dataset.buildRank);
    button.disabled = cost - current + rank > limit;
    button.setAttribute('aria-pressed', String(rank === current));
  }
}
function setBuildRank(rank) {
  if (![0, 1, 2, 3].includes(rank) || buildCost(editableBuild) - (editableBuild[selectedBuildSkill] || 0) + rank > buildLimit()) return;
  if (rank) editableBuild[selectedBuildSkill] = rank;
  else delete editableBuild[selectedBuildSkill];
  drawBuild();
}
function finishBuild(save) {
  const context = buildContext;
  closeOverlay(false);
  if (context === 'practice') {
    if (save) {
      if (practiceDraft) practiceDraft.ranks = { ...editableBuild };
      else practiceOptions.ranks = { ...editableBuild };
      if (practiceDraft) practiceOptions.ranks = { ...practiceDraft.ranks };
      preservePractice();
    }
    if (!practiceDraft) practiceDraft = { ...practiceOptions };
    practiceFormValues();
    openOverlay('practiceOverlay');
  } else {
    if (save) {
      const ranks = cleanBuild(editableBuild);
      writeStore('slimeMeadowRoomBuild', ranks);
      if (mode === 'public' && publicRoom.ws?.readyState === 1) publicRoom.ws.send(JSON.stringify({ t: 'build', ranks }));
    }
    $(mode === 'lobby' ? 'roomBuild' : 'fieldBuild').focus({ preventScroll: true });
  }
}

// Stable browser identity prevents duplicate public-room slots across tabs.
const meadowBrowserKey = (() => {
  try {
    let key = localStorage.getItem('slimeoo_meadow_browser_key');
    if (!key || !/^[a-f0-9-]{16,64}$/.test(key)) {
      key = crypto.randomUUID();
      localStorage.setItem('slimeoo_meadow_browser_key', key);
    }
    return key;
  } catch { return crypto.randomUUID(); }
})();
let meadowSuspended = false;
let meadowRejoining = false;
function suspendMeadow(reason = '') {
  if (mode !== 'public') return;
  meadowSuspended = true;
  disconnectRoom();
  if (reason === 'settings') setText($('fieldCount'), 'Paused');
}
function resumeMeadow() {
  if (mode !== 'public' || !meadowSuspended || document.hidden || activeOverlay || meadowRejoining) return;
  meadowSuspended = false;
  meadowRejoining = true;
  openPublicConnection();
  meadowRejoining = false;
}
const publicRoom = {
  ws: null, id: 0, target: 0, locked: false, count: null, sequence: 0, lastSend: 0, lastTick: -1,
  updated: 0, roster: new Map(), frames: [], prediction: null, history: [], preview: null, events: [],
  models: new Map(), labels: new Map(), entry: 0, rtt: null,
  lastPing: 0, timeout: 0, lastKo: null, kills: 0
};

function roomUnavailable() {
  return location.protocol === 'file:' ? 'Start the Open Meadow server, then open the game at localhost:8080.' :
    'Open Meadow could not connect to Cloudflare. Check the multiplayer Worker deployment and GAME_ROOM binding.';
}
function displayRoomCount(count) {
  const text = (Number.isInteger(count) ? clamp(count, 0, ROOM_CAP) : '—') + '/' + ROOM_CAP;
  setText($('publicCount'), text);
  setText($('fieldCount'), text);
}
async function checkRoom() {
  const request = ++publicRoom.entry;
  try {
    const response = await fetch(new URL('/api/room', slimoWorker), { cache: 'no-store', signal: AbortSignal.timeout(2800) });
    if (!response.ok) throw Error('room');
    const data = await response.json();
    if (request !== publicRoom.entry || mode !== 'lobby') return;
    displayRoomCount(data.protocol === MEADOW_PROTOCOL && data.capacity === ROOM_CAP ? data.players : null);
  } catch {
    if (request === publicRoom.entry && mode === 'lobby') displayRoomCount(null);
  }
}
function disconnectRoom() {
  stopRoomVoice(true);
  const room = publicRoom;
  room.entry++;
  clearTimeout(room.timeout);
  const ws = room.ws;
  room.ws = null;
  if (ws && ws.readyState < 2) {
    if (ws.readyState === 1) try { ws.send(JSON.stringify({t:'leave'})); } catch {}
    ws.close(1000, 'Left public meadow');
  }
  clearRoomBatches();
  for (const el of room.labels.values()) el.remove();
  room.models.clear();
  room.labels.clear();
  room.roster.clear();
  room.frames.length = room.history.length = room.events.length = 0;
  room.id = room.target = room.lastSend = room.sequence = room.updated = room.lastPing = room.kills = 0;
  room.lastTick = -1;
  room.prediction = room.preview = room.lastKo = room.rtt = null;
  room.locked = false;
  room.warnedSnapshot = false;
  clearRoomSocial();
  document.body.classList.remove('public-play', 'hangout');
  $('fieldChat').hidden = $('fieldQuickChat').hidden = $('fieldMic').hidden = $('fieldEmotes').hidden = $('publicHint').hidden = true;
  closeQuickChat();
  $('aSpit').disabled = $('aNova').disabled = false;
  setText($('slapActionLabel'), 'Slap');
  $('publicHud').hidden = true;
  $('playerLabels').replaceChildren();
}

// Room-only push-to-talk. Audio is WebRTC peer-to-peer; the Worker relays
// signaling only. A maximum of four nearby listeners prevents 50-way mesh load.
const roomVoice = {stream:null,peers:new Map(),held:false,starting:false,generation:0};
const voiceIce = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
function voiceSend(to,data){
  const ws=publicRoom.ws;
  if(ws?.readyState===1&&publicRoom.id)ws.send(JSON.stringify({t:'voiceSignal',to,data}));
}
function voicePeer(id){
  if(roomVoice.peers.has(id))return roomVoice.peers.get(id);
  const pc=new RTCPeerConnection(voiceIce);
  roomVoice.peers.set(id,pc);
  pc.onicecandidate=e=>{if(e.candidate)voiceSend(id,{kind:'ice',candidate:e.candidate.toJSON()});};
  pc.ontrack=e=>{
    let audio=pc._voiceAudio;
    if(!audio){audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;pc._voiceAudio=audio;}
    audio.srcObject=e.streams[0]||new MediaStream([e.track]);
    audio.play().catch(()=>{});
  };
  pc.onconnectionstatechange=()=>{
    if(['closed','failed','disconnected'].includes(pc.connectionState)){
      pc._voiceAudio?.remove();pc.close();
      if (roomVoice.peers.get(id) === pc) roomVoice.peers.delete(id);
    }
  };
  return pc;
}
async function handleRoomVoiceSignal(packet){
  if(mode!=='public'||!publicRoom.id||!Number.isInteger(packet.from)||packet.from===publicRoom.id||!publicRoom.roster.has(packet.from))return;
  const id=packet.from,data=packet.data;
  if(!data||typeof data!=='object')return;
  try{
    if(data.kind==='offer'){
      if (!roomVoice.peers.has(id) && roomVoice.peers.size >= 4) return;
      const pc=voicePeer(id);
      await pc.setRemoteDescription({type:'offer',sdp:data.sdp});
      await pc.setLocalDescription(await pc.createAnswer());
      voiceSend(id,{kind:'answer',sdp:pc.localDescription.sdp});
    }else if(data.kind==='answer'){
      const pc=roomVoice.peers.get(id);
      if(pc?.signalingState==='have-local-offer')await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    }else if(data.kind==='ice'){
      const pc=roomVoice.peers.get(id);
      if(pc?.remoteDescription)await pc.addIceCandidate(data.candidate);
    }else if(data.kind==='end'){
      const pc=roomVoice.peers.get(id);
      if(pc){pc.close();pc._voiceAudio?.remove();roomVoice.peers.delete(id);}
    }
  }catch(e){console.warn('Voice connection:',e);}
}
async function startRoomVoice(event){
  event?.preventDefault();
  if(mode!=='public'||!publicRoom.id||roomVoice.held||roomVoice.starting)return;
  roomVoice.starting=true;
  const generation = ++roomVoice.generation;
  const entry = publicRoom.entry;
  const btn=$('fieldMic');
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS and browser permission.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:{
      echoCancellation:true,noiseSuppression:true,autoGainControl:true
    },video:false});
    if (mode !== 'public' || document.hidden || generation !== roomVoice.generation ||
        entry !== publicRoom.entry || !publicRoom.id) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    roomVoice.stream=stream;roomVoice.held=true;btn.classList.add('talking');setText(btn,'Talking');
    // Prefer nearby listeners, with a strict four-peer ceiling.
    const latest=publicRoom.frames.at(-1)?.poses;
    const own=latest?.get(publicRoom.id);
    const candidates=[...publicRoom.roster.keys()].filter(id=>id!==publicRoom.id)
      .map(id=>({id,dist:own&&latest?.get(id)?
        Math.hypot(own.x-latest.get(id).x,own.z-latest.get(id).z):1e6}))
      .sort((a,b)=>a.dist-b.dist).slice(0,4);
    for(const {id} of candidates){
      if(!roomVoice.held)break;
      if (!roomVoice.peers.has(id) && roomVoice.peers.size >= 4) continue;
      const pc=voicePeer(id);
      stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      await pc.setLocalDescription(await pc.createOffer());
      voiceSend(id,{kind:'offer',sdp:pc.localDescription.sdp});
    }
  }catch(e){toast('Microphone unavailable: '+(e?.message||'permission denied'));stopRoomVoice();}
  finally{roomVoice.starting=false;}
}
function stopRoomVoice(all=false){
  roomVoice.generation++;
  roomVoice.held=false;
  roomVoice.stream?.getTracks().forEach(t=>t.stop());
  roomVoice.stream=null;
  const btn=$('fieldMic');btn?.classList.remove('talking');
  if(btn)setText(btn,'Mic');
  for(const [id,pc] of roomVoice.peers){
    if(all||pc.getSenders().some(sender=>sender.track)){
      voiceSend(id,{kind:'end'});pc.close();pc._voiceAudio?.remove();roomVoice.peers.delete(id);
    }
  }
}
{
  const btn=$('fieldMic');
  btn.addEventListener('pointerdown',e=>{
    e.preventDefault();try{btn.setPointerCapture(e.pointerId);}catch{}
    startRoomVoice(e);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])
    btn.addEventListener(type,()=>stopRoomVoice());
  window.addEventListener('blur',()=>stopRoomVoice());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRoomVoice();});
}

async function openPublicConnection() {
  if (mode !== 'public' || document.hidden || meadowSuspended) return;
  const room = publicRoom;
  if (room.ws && room.ws.readyState < 2) return;
  const entry=++room.entry;
  let ticket;
  try {
    const config=await slimoApi('config');
    if(config.protocols?.meadow!==MEADOW_PROTOCOL)throw Error(slimoVersionMessage(MEADOW_PROTOCOL,config.protocols?.meadow));
    ({ticket}=await slimoApi('meadow',{}));
  }
  catch(error){ if(mode==='public'&&entry===room.entry) leave(error.message); return; }
  if(mode!=='public'||entry!==room.entry||meadowSuspended||document.hidden) return;
  const path = new URL('/room/OPEN-MEADOW', slimoWorker);
  path.searchParams.set('ticket',ticket);
  path.protocol = path.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws;
  try { ws = new WebSocket(path); }
  catch { leave(roomUnavailable()); return; }
  room.magic=null;room.cover=meadowCover;room.spellPending=new Map();
  room.ws = ws;
  ws.binaryType = 'arraybuffer';
  room.timeout = setTimeout(() => {
    if (room.ws === ws && !room.id) leave(roomUnavailable());
  }, 6300);
  ws.addEventListener('open', () => {
    if (room.ws !== ws) return;
    ws.send(JSON.stringify({ t: 'join', protocol: MEADOW_PROTOCOL, browserKey: meadowBrowserKey, name: profile.name, color: chosen, ranks: roomBuild() }));
  });
  ws.addEventListener('message', event => {
    if (room.ws !== ws) return;
    if (typeof event.data !== 'string') {
      const packet = decodeRoomState(event.data);
      if (packet && room.id) receiveRoomState(packet);
      return;
    }
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    if (!packet || typeof packet !== 'object') return;
    if (packet.t === 'error') return leave(Number.isInteger(packet.serverProtocol)?slimoVersionMessage(MEADOW_PROTOCOL,packet.serverProtocol):typeof packet.message === 'string' ? packet.message : 'The room is unavailable.');
    if ((packet.t === 'roster' || packet.t === 'joined') && Array.isArray(packet.roster) && packet.roster.length <= ROOM_CAP) {
      if (packet.t === 'joined') {
        clearTimeout(room.timeout);
        room.id = packet.id;
        // Begin local prediction immediately. Waiting for the first binary snapshot
        // used to disable both the movement loop and subsequent input transmissions.
        const initial = { ...state.p[0], x: -24, z: 15, r: .7 };
        state.p[0] = { ...initial, active: true };
        room.prediction = { ...initial, active: true, hp: 100, en: 0,
          attack: '', attackTime: 0, stun: 0, dashTime: 0, dash: 0,
          kx: 0, kz: 0, vx: 0, vz: 0, predictedDash: 0,
          dashInput: inputCounts.dash };
        room.updated = performance.now();
        room.locked = settings.autoLock;
        state.phase = 'fight';
        state.paused = false;
        $('publicHud').hidden = false;
        view.fresh = true;
        toast('You joined Open Meadow');
      }
      const players = new Map();
      for (const p of packet.roster) {
        if (!Number.isInteger(p.id) || p.id < 1 || p.id > 65535 || typeof p.name !== 'string') continue;
        const ranks = cleanBuild(p.ranks);
        players.set(p.id, {
          id: p.id, name: p.name.slice(0, 16), ranks, color: Number.isInteger(p.color) ? clamp(p.color, 0, 3) : 0,
          maxHp: 100 + skillValue({ ranks }, 'colossus', 'hp'), size: 1 + skillValue({ ranks }, 'colossus', 'size'),
          wins: Number.isInteger(p.wins) ? Math.max(0, p.wins) : 0, hat:p.hat, accent:p.accent, owner:p.owner===true
        });
      }
      for (const id of room.roster.keys()) {
        if (players.has(id)) continue;
        dropRoomModel(id);
        dropSpeechBubble(id);
      }
      room.roster = players;
      for(const p of packet.roster) if(players.has(p.id) && p.atomic) syncAtomicSession(p.id,p.atomic);
      room.kills = room.roster.get(room.id)?.wins || 0;
      if (packet.t === 'joined') sendRoomInput(true);
      room.count = Number.isInteger(packet.players) ? packet.players : players.size;
      displayRoomCount(room.count);
    } else if (packet.t === 'fx' && Array.isArray(packet.events)) {
      for (const q of packet.events.slice(0, 90)) {
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z) || !Number.isInteger(q.id) ||
            typeof q.type !== 'string' || Math.abs(q.x) > MEADOW_X+12 || Math.abs(q.z) > MEADOW_Z+12) continue;
        if ((q.type === 'skill' || q.type === 'wave' || q.type === 'waveCue') &&
            (!Object.hasOwn(skills, q.skill) || ![1, 2, 3].includes(q.rank))) continue;
        room.events.push(q);
      }
      if (room.events.length > 200) room.events.splice(0, room.events.length - 200);
    } else if (packet.t === 'atomic') {
      if(room.roster.has(packet.i)) startAtomic(packet.i,packet.castId,packet.ageMs);
    } else if (packet.t === 'atomicState') {
      if(Array.isArray(packet.casts))for(const cast of packet.casts.slice(0,ROOM_CAP))if(room.roster.has(cast?.i))syncAtomicSession(cast.i,cast);
    } else if (packet.t === 'voiceSignal') {
      handleRoomVoiceSignal(packet);
    } else if (packet.t === 'chat') {
      receiveRoomChat(packet);
    } else if (packet.t === 'chatWait') {
      setText($('roomChatStatus'), 'Wait a moment before sending another message.');
    } else if (packet.t === 'emoteWait') {
      toast('Wait until your slime finishes its move.');
    } else if (packet.t === 'pong' && Number.isFinite(packet.stamp)) {
      room.rtt = Math.round(clamp(performance.now() - packet.stamp, 0, 9999));
    } else if (packet.t === 'build') {
      toast(packet.ok ? 'Build equipped' : packet.message || 'You can change builds between fights.');
    }
  });
  ws.addEventListener('close', () => {
    if (room.ws === ws) leave(room.id ? 'You left Open Meadow because the connection closed.' : roomUnavailable());
  });
  ws.addEventListener('error', () => {
    if (room.ws === ws && !room.id) leave(roomUnavailable());
  });
}
function roomPose(meta, p) {
  return { ...p, ...meta, active: true, growth: 0, vy: 0 };
}
function receiveRoomState(packet) {
  const room = publicRoom;
  const advance = (packet.tick - room.lastTick) >>> 0;
  if (room.lastTick >= 0 && (advance === 0 || advance >= 0x80000000)) return;
  const now = performance.now();
  const poses = new Map(packet.players.map(p => [p.id, p]));
  const current = poses.get(room.id), meta = room.roster.get(room.id);
  if (!current || !meta) return;
  room.lastTick = packet.tick;
  room.updated = now;
  room.frames.push({ now, tick: packet.tick, poses });
  if (room.frames.length > 7) room.frames.shift();
  state.bullets = packet.bullets;
  const authoritative = roomPose(meta, current);
  const previous = room.prediction;
  const near = previous && Math.hypot(previous.x - current.x, previous.z - current.z) < 2.2 &&
    current.hp > 0 && !current.stun && previous.hp > 0;
  while (room.history[0]?.sequence <= packet.ack) room.history.shift();
  const simulated = { ...authoritative, predictedDash: 0, dashInput: previous?.dashInput ?? inputCounts.dash };
  if (near) {
    if (previous.predictedDash > now && current.dashTime <= 0) {
      simulated.dashTime = previous.dashTime;
      simulated.kx = previous.kx;
      simulated.kz = previous.kz;
      simulated.predictedDash = previous.predictedDash;
    }
    for (const frame of room.history) drivePlayer(simulated, frame.input, frame.dt);
    simulated.x = lerp(previous.x, simulated.x, .48);
    simulated.z = lerp(previous.z, simulated.z, .48);
  }
  if (!previous || previous.knockedOut !== current.knockedOut || !near && Math.hypot(previous.x - current.x, previous.z - current.z) > 5) {
    fighters[0].x = simulated.x;
    fighters[0].z = simulated.z;
    if (!current.knockedOut) fighters[0].rag = null;
    view.anchorX = simulated.x;
    view.anchorZ = simulated.z;
    view.fresh = true;
  }
  room.prediction = simulated;
  state.p[0] = { ...simulated, active: true };
  if (current.hp > 0) room.lastKo = null;
}
function predictPublicAttack(attack) {
  const room = publicRoom, p = room.prediction;
  if (!p || p.hp <= 0 || p.attack || p.stun > 0 || p.dashTime > 0 || attack === 'nova' && p.en < 100) return;
  if (attack === 'dash') {
    if (p.dash > 0) return;
    const aim = roomInput(), len = Math.hypot(aim.x, aim.z);
    p.dashTime = moves.dash.time;
    p.kx = (len > .12 ? aim.x / len : -Math.sin(aim.aim)) * moves.dash.speed;
    p.kz = (len > .12 ? aim.z / len : -Math.cos(aim.aim)) * moves.dash.speed;
    p.predictedDash = performance.now() + 175;
    playSound('dash', p.x, p.z);
    return;
  }
  const move = attack === 'slap' ? moves.slap[0] : moves[attack];
  const scale = attack === 'slap' && roomCanFight() ? skillValue(p, 'tempo', 'time', 1) : 1;
  room.preview = { attack, started: performance.now(), duration: move.duration * scale, contactTime: move.contact * scale };
}
function publicPose() {
  const room = publicRoom, p = room.prediction;
  if (!p) return state.p[0];
  const preview = room.preview;
  if (!preview) return p;
  if (p.attack || p.stun > 0 || p.hp <= 0) { room.preview = null; return p; }
  const age = (performance.now() - preview.started) / 1000;
  if (age > .24) { room.preview = null; return p; }
  return { ...p, ...preview, attackTime: preview.duration - Math.min(age, preview.contactTime - .012) };
}
function interpolatePublic(id) {
  const room = publicRoom;
  const frames = room.frames;
  if (!frames.length) return null;
  const t = performance.now() - 92;
  let a = frames[0], b = frames[0];
  for (let i = 1; i < frames.length; i++) {
    b = frames[i];
    if (b.now >= t) break;
    a = b;
  }
  const from = a.poses.get(id), to = b.poses.get(id);
  if (!from && !to) return frames.at(-1).poses.get(id) || null;
  if (!from || !to || a === b) return to || from;
  const f = clamp((t - a.now) / Math.max(1, b.now - a.now), 0, 1);
  if (from.knockedOut !== to.knockedOut || Math.hypot(from.x - to.x, from.z - to.z) > 8) return to;
  const emoteAge = from.emote === to.emote && to.emoteAge >= from.emoteAge ? lerp(from.emoteAge, to.emoteAge, f) : to.emoteAge;
  return { ...to, emoteAge, x: lerp(from.x, to.x, f), z: lerp(from.z, to.z, f),
    r: from.r + angleDiff(from.r, to.r) * f, air: lerp(from.air, to.air, f) };
}
function pickRoomTarget() {
  const room = publicRoom, own = publicPose(), last = room.frames.at(-1);
  if (!last) return;
  let target = room.target, best = 29;
  const current = last.poses.get(target);
  if (current && current.hp > 0 && Math.hypot(own.x - current.x, own.z - current.z) < 34) return;
  target = 0;
  for (const p of last.poses.values()) {
    if (p.id === room.id || p.hp <= 0) continue;
    const dx = p.x - own.x, dz = p.z - own.z;
    const d = Math.hypot(dx, dz);
    const deviation = Math.abs(angleDiff(view.yaw, Math.atan2(dx, dz)));
    const cost = d + deviation * 2.3;
    if (cost < best) { target = p.id; best = cost; }
  }
  room.target = target;
}
function roomInput() {
  const input = readInput();
  if (!publicRoom.locked || !publicRoom.target) return { ...input, aim: view.yaw, assist: settings.assist };
  return input;
}
function sendRoomInput(force = false) {
  const room=publicRoom,now=performance.now();
  if(!room.id||room.ws?.readyState!==1||room.ws.bufferedAmount>256)return;
  const input=roomInput(),key=SlimoNetwork.inputKey(input);
  if(!SlimoNetwork.inputDue(now,room.lastSend,key,room.lastInputKey,input,room.prediction,force))return;
  room.ws.send(inputPacket(input,++room.sequence));room.lastSend=now;room.lastInputKey=key;
  if(now-room.lastPing>1700){room.lastPing=now;room.ws.send(JSON.stringify({t:'ping',stamp:now}));}
}

function dropRoomModel(id) {
  const room = publicRoom;
  const pc = roomVoice.peers.get(id);
  if (pc) { pc.close(); pc._voiceAudio?.remove(); roomVoice.peers.delete(id); }
  room.models.delete(id);
  room.labels.get(id)?.remove();
  room.labels.delete(id);
}
function roomEffects() {
  const room = publicRoom, own = publicPose();
  for (const q of room.events.splice(0)) {
    if (q.type === 'ko') {
      const m = q.i === room.id ? fighters[0] : room.models.get(q.i);
      if (m) beginKnockout({ ...q, i: q.i === room.id ? 0 : 2 }, m, false);
      if (q.i === room.id) {
        room.lastKo = performance.now();
        vibrate('ko');
      } else if (q.j === room.id) callout('Splat!', 'Knockout', 1.45);
      continue;
    }
    if (q.type === 'spawn') {
      if (q.i === room.id) {
        room.lastKo = null;
        fighters[0].rag = null;
      } else {
        const m = room.models.get(q.i);
        if (m) m.rag = null;
      }
      shockRing(q.x, .061, q.z, .64, 3.4, 0xadebc0, .52, .70);
      playSound('spawn', q.x, q.z);
      continue;
    }
    if (Math.hypot(q.x - own.x, q.z - own.z) > 36 && q.i !== room.id && q.j !== room.id) continue;
    if (q.type === 'spell') {
      const definition=WORLD.spells[q.key];
      if(definition){playSound(q.key==='mending'?'heal':q.key==='earthwall'?'bounce':'chargeNova',q.x,q.z);
        if(q.i===room.id)word(q,definition.name,'#'+definition.color.toString(16).padStart(6,'0'));}
      continue;
    }
    if (q.type === 'playTap') {
      const target = q.i === room.id ? fighters[0] : room.models.get(q.i);
      if (target) target.playTapAt = performance.now();
      playSound(q.source==='spit'?'splat':q.source==='spell'?'ui':'tap', q.x, q.z);
      const tint = palette[q.color]?.light || 0xc6f6ad;
      particles(q.x, 1.05 + (q.height || 0), q.z, 10, tint, 2.8, 1.9, .43, 'drop');
      starburst(q.x, 1.1 + (q.height || 0), q.z, tint, false);
      if (q.i === room.id || q.j === room.id) word(q, q.source==='spit'?'SPLOT!':q.source==='spell'?'POOF!':'PAP!', '#d8f6b7');
      continue;
    }
    if (q.type === 'ringFizzle') {
      particles(q.x, .88, q.z, 7, 0xffcf7a, 2.4, 1.7, .4, 'drop');
      shockRing(q.x, .073, q.z, .3, 1.35, 0xffdb87, .25, .49);
      continue;
    }
    if (q.type === 'emote') {
      if (!settings.reduced && q.emote !== emoteCodes.sit) particles(q.x, .62, q.z, 5,
        palette[q.color]?.light || 0xc6f6ad, 1.6, 1.25, .42, 'drop');
      continue;
    }
    const involved = q.i === room.id || q.j === room.id;
    showEffect({ ...q, i: q.i === room.id ? 0 : 2, quiet: !involved, ownStrike: q.j === room.id,
      model: q.i === room.id ? fighters[0] : room.models.get(q.i) });
  }
}
function animatePublic(dt, time) {
  const room = publicRoom, now = performance.now();
  if (!room.id) return;
  // Keep transmitting input even if an authoritative state packet is missing.
  // Otherwise a lost first snapshot permanently freezes the player.
  if (!room.prediction) {
    room.prediction = { ...state.p[0], x: -24, z: 15, active: true, hp: 100, en: 0,
      attack: '', attackTime: 0, stun: 0, dashTime: 0, dash: 0,
      kx: 0, kz: 0, vx: 0, vz: 0, predictedDash: 0,
      dashInput: inputCounts.dash };
  }
  pickRoomTarget();
  const target = room.target ? interpolatePublic(room.target) : null;
  const info = room.roster.get(room.target);
  state.p[1] = target && info && target.hp > 0 ? roomPose(info, target) : { ...state.p[1], active: false };
  view.lock = room.locked && state.p[1].active;
  const p = room.prediction, input = roomInput();
  if (p.hp > 0) {
    p.dashTime = Math.max(0, p.dashTime - dt);
    const step = Math.min(.05, dt);
    if (p.emote && Math.hypot(input.x, input.z) > .12) p.emote = p.emoteAge = 0;
    else if (p.emote) p.emoteAge += step;
    drivePlayer(p, input, step);
    if (!p.attack && p.stun <= 0 && input.ready) p.r = input.aim;
    if(!SlimoNetwork.stationary(input,p))room.history.push({ sequence: room.sequence + 1, input, dt: step });
    else room.history.length=0;
    if (room.history.length > 40) room.history.shift();
  }
  state.p[0] = { ...p, active: true, hat:slimoAccount?.hat, accent:slimoAccount?.accent, owner:slimoAccount?.owner };
  sendRoomInput();
  const last = room.frames.at(-1);
  if (!last && now - room.updated > 3500 && !room.warnedSnapshot) {
    room.warnedSnapshot = true;
    toast('Connected, but no player-state updates. Check Cloudflare Worker logs.');
  }
  if (last) {
    for (const [id, meta] of room.roster) {
      if (id === room.id) continue;
      const pose = interpolatePublic(id);
      if (!pose) { if(room.models.has(id))dropRoomModel(id); continue; }
      const range = Math.hypot(pose.x - p.x, pose.z - p.z);
      if (range > 47) { dropRoomModel(id); continue; }
      let model = room.models.get(id);
      if (!model) {
        model = makeRoomFighter(meta, pose);
        room.models.set(id, model);
        const label = document.createElement('span');
        label.className = 'rival-tag';
        label.textContent = meta.name;
        $('playerLabels').append(label);
        room.labels.set(id, label);
      }
      animateRoomFighter(model, roomPose(meta, pose), dt, time, id === room.target);
      slimoLook(model,meta,time);
    }
  }
  roomEffects();
}
function refreshRoomLobby() {
  if (document.hidden || mode !== 'lobby') return;
  checkRoom();
}
function drawPublicHud() {
  const room = publicRoom, p = state.p[0];
  updateSocialControls();
  if (!room.id) {
    setText($('fieldStatus'), 'Connecting to Open Meadow…');
    return;
  }
  setText($('fieldStatus'), room.rtt === null ? '' : room.rtt + ' ms');
  setText($('fieldKills'), room.kills + (room.kills === 1 ? ' knockout' : ' knockouts'));
  const ko = p.hp <= 0 && room.lastKo !== null;
  const left = ko ? Math.max(1, Math.ceil((3600 - (performance.now() - room.lastKo)) / 1000)) : 0;
  $('fieldRespawn').hidden = !ko;
  if (ko) setText($('fieldRespawn'), 'Back in ' + left + 's');
  for (const [id, label] of room.labels) {
    const m = room.models.get(id);
    const spot = m && !m.dead ? project(m.x, m.root.position.y + 2.03 * m.size * (m.socialPose?.height || 1) + (m.socialPose?.y || 0), m.z) : null;
    label.hidden = !spot;
    if (!spot) continue;
    label.style.transform = 'translate(' + spot.x.toFixed(0) + 'px,' + spot.y.toFixed(0) + 'px) translate(-50%,-100%)';
    label.classList.toggle('target', id === room.target && room.locked);
  }
  drawRoomBubbles();
  drawMeadowMapHud();
}

const ROOM_CHAT_VISIBLE = 8000;
const ROOM_CHAT_ROWS = 48;
const roomBubbles = new Map();
let roomChatUnread = 0;
let lastChatId = 0;
let roomEmoteRequest = -Infinity;
const emoteButtons = new Map();

function roomCanFight() {
  return mode === 'public' && publicRoom.id !== 0 && insideFightRing(state.p[0].x, state.p[0].z);
}
function updateSocialControls() {
  const joined = mode === 'public' && publicRoom.id !== 0;
  const fighting = joined && roomCanFight();
  document.body.classList.toggle('hangout', joined && !fighting);
  $('fieldChat').hidden = $('fieldQuickChat').hidden = $('fieldMic').hidden = !joined;
  $('fieldEmotes').hidden = !joined;
  setText($('fieldZone'), joined ? fighting ? 'Fight ring · Damage on' : 'Hangout · Damage off' : '');
  const zone = $('fieldZone');
  if (zone.dataset.fighting !== String(fighting)) zone.dataset.fighting = String(fighting);
  const disabled = joined && !fighting;
  $('aSpit').disabled = false;
  $('aNova').disabled = disabled;
  $('aNova').title = disabled ? 'Nova is available inside the fight ring' : '';
  $('aSpit').title = disabled ? 'Playful spit · no damage outside the ring' : 'Spit';
  setText($('slapActionLabel'), disabled ? 'Play slap' : 'Slap');
  $('aSlap').setAttribute('aria-label', disabled ? 'Playful slap' : 'Slap');
  $('publicHint').hidden = !joined;
  if (joined) {
    const hint = $('publicHint');
    setText(hint, fighting ? 'J Slap · E Spit · Shift Dodge · Q Nova · 1–8 Spells · Damage inside ring only' :
      'J Slap · E Spit · 1–8 Spells · Safe zone: no damage · M Map');
  }
}
function updateUnread() {
  setText($('fieldChat'), roomChatUnread ? 'Chat (' + Math.min(48, roomChatUnread) + ')' : 'Chat');
}
function clearRoomSocial() {
  for (const { bubble } of roomBubbles.values()) bubble.remove();
  roomBubbles.clear();
  $('roomChatLog').replaceChildren();
  $('roomChatInput').value = '';
  $('quickChatInput').value = '';
  closeQuickChat();
  setText($('roomChatStatus'), '');
  roomChatUnread = 0;
  lastChatId = 0;
  roomEmoteRequest = -Infinity;
  updateUnread();
}
function closeQuickChat() {
  const bar = $('quickChatBar');
  if (!bar) return;
  bar.hidden = true;
  if (document.activeElement === $('quickChatInput')) $('quickChatInput').blur();
}
function openQuickChat() {
  if (mode !== 'public' || !publicRoom.id || activeOverlay) return;
  resetInputs();
  $('quickChatBar').hidden = false;
  const input = $('quickChatInput');
  input.focus({ preventScroll: true });
}
function sendQuickChat(event) {
  event.preventDefault();
  const input = $('quickChatInput');
  const text = cleanRoomChat(input.value);
  if (!text) { closeQuickChat(); return; }
  if (publicRoom.ws?.readyState !== 1 || !publicRoom.id) { toast('Chat is disconnected'); return; }
  publicRoom.ws.send(JSON.stringify({ t: 'chat', text }));
  input.value = '';
  closeQuickChat();
}
function openRoomChat() {
  if (mode !== 'public' || !publicRoom.id) return;
  roomChatUnread = 0;
  updateUnread();
  openOverlay('chatOverlay');
  const log = $('roomChatLog');
  log.scrollTop = log.scrollHeight;
  $('roomChatInput').focus({ preventScroll: true });
}
function sendRoomChat(event) {
  event?.preventDefault();
  const text = cleanRoomChat($('roomChatInput').value);
  if (!text || publicRoom.ws?.readyState !== 1 || !publicRoom.id) return;
  publicRoom.ws.send(JSON.stringify({ t: 'chat', text }));
  setText($('roomChatStatus'), '');
}
function receiveRoomChat(packet) {
  if (!Number.isSafeInteger(packet.id) || packet.id <= lastChatId || !Number.isInteger(packet.who) ||
    packet.who < 1 || packet.who > 65535 || !publicRoom.id) return;
  const text = cleanRoomChat(packet.text);
  if (!text) return;
  lastChatId = packet.id;
  const own = packet.who === publicRoom.id;
  const input = $('roomChatInput');
  if (own && cleanRoomChat(input.value) === text) input.value = '';
  const name = Array.from(cleanRoomChat(packet.name)).slice(0, 16).join('') || 'Slime';
  const color = Number.isInteger(packet.color) ? clamp(packet.color, 0, 3) : 0;
  const log = $('roomChatLog');
  const scrolledToEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const row = document.createElement('div');
  row.className = 'chat-line';
  row.style.setProperty('--slime', palette[color].hud);
  const author = document.createElement('bdi'), message = document.createElement('span');
  author.textContent = own ? name + ' (you)' : name;
  message.setAttribute('dir', 'auto');
  message.textContent = text;
  row.append(author, message);
  log.append(row);
  while (log.children.length > ROOM_CHAT_ROWS) log.firstElementChild.remove();
  if (scrolledToEnd || own) log.scrollTop = log.scrollHeight;

  const old = roomBubbles.get(packet.who);
  old?.bubble.remove();
  const bubble = document.createElement('div');
  bubble.className = 'speech-bubble';
  bubble.setAttribute('dir', 'auto');
  bubble.textContent = text;
  bubble.style.setProperty('--slime', palette[color].hud);
  $('speechBubbles').append(bubble);
  roomBubbles.set(packet.who, { bubble, until: performance.now() + ROOM_CHAT_VISIBLE });
  if (!own && activeOverlay !== 'chatOverlay') {
    roomChatUnread++;
    updateUnread();
  }
}
function dropSpeechBubble(id) {
  roomBubbles.get(id)?.bubble.remove();
  roomBubbles.delete(id);
}
function drawRoomBubbles() {
  const now = performance.now(), room = publicRoom;
  for (const [id, entry] of roomBubbles) {
    if (now >= entry.until) {
      dropSpeechBubble(id);
      continue;
    }
    const own = id === room.id, m = own ? fighters[0] : room.models.get(id);
    const knocked = own ? state.p[0].hp <= 0 : m?.dead;
    const show = m && !knocked && m.root.visible && !activeOverlay;
    const spot = show ? project(m.root.position.x, m.root.position.y + 2.15 * (m.size || state.p[0].size || 1) *
      (m.socialPose?.height || 1) + (m.socialPose?.y || 0), m.root.position.z) : null;
    const ownFallback = show && own && !spot;
    const bubble = entry.bubble;
    bubble.hidden = !spot && !ownFallback;
    bubble.classList.toggle('self', ownFallback);
    if (ownFallback) bubble.style.transform = '';
    else if (spot) bubble.style.transform = 'translate(' + spot.x.toFixed(0) + 'px,' + (spot.y - 17).toFixed(0) + 'px) translate(-50%,-100%)';
  }
}
function updateEmoteButtons() {
  const current = ROOM_EMOTES[publicRoom.prediction?.emote || 0]?.key;
  for (const [key, button] of emoteButtons) button.setAttribute('aria-pressed', String(current === key));
}
function openRoomEmotes() {
  if (mode !== 'public' || !publicRoom.id) return;
  updateEmoteButtons();
  openOverlay('emoteOverlay');
}
function sendRoomEmote(key) {
  if (!publicRoom.id || publicRoom.ws?.readyState !== 1) return;
  const now = performance.now();
  if (now - roomEmoteRequest < 245) return;
  roomEmoteRequest = now;
  publicRoom.ws.send(JSON.stringify({ t: 'emote', key }));
  closeOverlay(false);
}
function prepareSocialControls() {
  $('fieldChat').onclick = openRoomChat;
  $('fieldQuickChat').onclick = openQuickChat;
  $('quickChatBar').onsubmit = sendQuickChat;
  $('quickChatCancel').onclick = closeQuickChat;
  $('fieldEmotes').onclick = openRoomEmotes;
  $('roomChatForm').onsubmit = sendRoomChat;
  const options = [...ROOM_EMOTES.slice(1), { key: 'playSlap', label: 'Play slap' },
    { key: 'random', label: 'Random' }, ROOM_EMOTES[0]];
  for (const { key, label } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => sendRoomEmote(key);
    emoteButtons.set(key, button);
    $('emoteGrid').append(button);
  }
}
function publicSocialKey(event) {
  if (mode !== 'public' || !publicRoom.id || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const key = event.key.toLowerCase();
  if (key === 't') {
    openRoomChat();
  } else if (key === 'enter' && !event.target.closest?.('button')) {
    openQuickChat();
  } else if (key === 'b') {
    openRoomEmotes();
  } else return false;
  event.preventDefault();
  return true;
}

const PROTOCOL = protocolTag;
let peer = null, link = null, roomId = '', netAttempt = 0;
let peerTimer = 0, lastRemote = 0, lastSnapshot = 0;
let remoteReady = true;
let welcomed = false;

function parseRoom(value) {
  let code = value.trim();
  if (code.includes('://')) {
    try { code = new URL(code).hash; }
    catch { return ''; }
  }
  code = code.replace(/^#?room=/, '');
  return /^rome-[a-zA-Z0-9_-]{6,80}$/.test(code) ? code : '';
}
function send(packet) {
  if (!link?.open) return false;
  if(['input','state'].includes(packet.t)&&(link.dataChannel?.bufferedAmount||0)>(packet.t==='input'?1024:16384))return false;
  try { link.send(packet);return true; } catch { return false; }
}
function clearPeer() {
  netAttempt++;
  clearTimeout(peerTimer);
  stopFastChannel();
  const currentLink = link, currentPeer = peer;
  if(mode==='host'&&roomId)void slimoApi('duel/close',{room:roomId}).catch(()=>{});
  link = peer = null;
  welcomed = false;
  slimoDuel=slimoGuestGrant=null;
  currentLink?.close();
  currentPeer?.destroy();
}
function leave(message = '') {
  if (mode === 'public' || publicRoom.ws) { meadowSuspended = false; disconnectRoom(); }
  send({ t: 'leave' });
  clearPeer();
  entryNonce++;
  pending = null;
  mode = 'lobby';
  clearAllAtomic();
  roomId = '';
  closeOverlay(false);
  resetInputs();
  clearFx();
  document.body.classList.remove('playing', 'cinema');
  $('lobby').hidden = false;
  $('hud').hidden = true;
  $('touchControls').hidden = true;
  $('landscape').hidden = true;
  $('toast').hidden = true;
  setStatus(message);
  prepareLobby();
  refreshRoomLobby();
  refreshAudio();
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
function dropRival(message = 'Your rival left. The room is still open.') {
  clearAtomicCaster(1);
  if (mode !== 'host') return;
  const former = link;
  stopFastChannel();
  link = null;
  welcomed = false;
  slimoDuel=null;
  former?.close();
  const own = state.p[0];
  state = freshMatch(state.format);
  state.p[0] = freshPlayer(0, { ...own, active:true });
  state.p[1] = freshPlayer(1, { active: false });
  state.phase = 'waiting';
  state.paused = false;
  state.winner = -1;
  state.score = [0, 0];
  state.round = 1;
  state.timer = ROUND_SECONDS;
  state.bullets.length = state.fx.length = 0;
  state.rematch = [false, false];
  inputs[1] = neutralInput();
  remoteReady = true;
  snapFighters();
  resetViewForRound();
  clearFx();
  toast(message);
}
function failConnection(message) {
  if (mode !== 'lobby') leave(message);
}
async function connect(type, target) {
  const token=++netAttempt;
  roomId=type==='guest'?target:'rome-'+crypto.randomUUID();
  slimoDuel=null;welcomed=false;
  peerTimer=setTimeout(()=>{
    if(token===netAttempt&&!peer?.connected)failConnection('The duel server did not respond. Try again.');
  },18000);
  try {
    // Authorize after orientation/fullscreen is ready, not while a phone waits
    // at the rotate screen. Every attempt gets a fresh single-use relay ticket.
    const grant=await slimoApi(type==='host'?'duel/open':'duel/join',{room:roomId});
    if(token!==netAttempt)return;
    if(!grant.relayTicket)throw Error('Friend duels need the latest Slimo Worker. Deploy the Worker and reload both games.');
    if(type==='guest')slimoGuestGrant=grant;
    const url=new URL('/duel',slimoWorker);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    url.searchParams.set('ticket',grant.relayTicket);
    peer=SlimoDuelTransport.create({url:url.href,hostSide:type==='host',
      onReady(){
        if(token!==netAttempt)return;
        clearTimeout(peerTimer);
        if(type==='host'&&!link?.open)openShare();
      },
      onConnection(connection){
        if(token!==netAttempt){connection.close();return;}
        attach(connection,type==='host',token);
      },
      onError(message){if(token===netAttempt)failConnection(message);}
    });
  }catch(error){if(token===netAttempt)failConnection(error.message);}
}

function attach(connection, hostSide, token) {
  link = connection;
  lastRemote = lastSnapshot = performance.now();
  let authorizing=false;
  let rivalEmoteAt=-Infinity;
  const timeout = setTimeout(() => {
    if (token !== netAttempt || link !== connection || welcomed) return;
    if (hostSide) dropRival('Your rival’s connection timed out. The room is still open.');
    else failConnection('The duel handshake timed out. Try joining again.');
  }, 14500);
  connection.on('open', () => {
    if (token !== netAttempt || link !== connection) {
      connection.close();
      return;
    }
    lastRemote = lastSnapshot = performance.now();
    if (hostSide) setupMotionChannel(connection, true, token);
    if(!hostSide)send({ t: 'hello', version: PROTOCOL, name: profile.name, color: chosen, ready: gameReady(),
      motion: hostSide && (connection.relay || watchedPeerConnection === connection.peerConnection && !!watchMotionChannel),
      pass: hostSide ? undefined : slimoGuestGrant?.pass });
  });
  connection.on('data', async packet => {
    if (token !== netAttempt || link !== connection || !packet || typeof packet !== 'object') return;
    if (packet.t === 'full') return failConnection('This arena already has two players.');
    if (packet.t === 'version') return failConnection('Both players need the same Slime Circuit version.');
    if (packet.t === 'leave') {
      if (hostSide) dropRival();
      else failConnection('The host left. Ask them to open a new room.');
      return;
    }
    if (packet.t === 'hello') {
      if (packet.version !== PROTOCOL) {
        if (hostSide) {
          send({ t: 'version' });
          setTimeout(() => {
            if (link === connection) dropRival('Your rival needs the cinematic version of Slime Circuit.');
          }, 260);
        } else failConnection('Both players need the Roguelike update of Slime Circuit.');
        return;
      }
      if (welcomed || authorizing) return;
      if(hostSide){
        authorizing=true;
        try {
          const {id,guest}=await slimoApi('duel/accept',{pass:packet.pass,room:roomId});
          if(token!==netAttempt||link!==connection) return;
          slimoDuel={id,host:slimoAccount,guest};
        } catch(error){
          if(token===netAttempt && link===connection) dropRival(error.message);
          return;
        } finally {authorizing=false;}
      }else{
        if(!slimoGuestGrant?.host) return failConnection('This duel invite expired.');
        slimoDuel={id:slimoGuestGrant.id,host:slimoGuestGrant.host,guest:slimoAccount};
      }
      clearTimeout(timeout);
      clearTimeout(peerTimer);
      welcomed = true;
      const rival = state.p[hostSide ? 1 : 0];
      const account=hostSide?slimoDuel.guest:slimoDuel.host;
      Object.assign(rival,{name:account.username,color:account.color,hat:account.hat,accent:account.accent,owner:account.owner});
      rival.active = true;
      if (hostSide) {
        if (rival.color === chosen) rival.color = (chosen + 1) % 4;
        remoteReady = packet.ready !== false;
        if (['shareOverlay','friendsOverlay'].includes(activeOverlay)) closeOverlay();
        restartMatch();
        state.paused = !gameReady() || !remoteReady;
        // A host hello confirms backend authorization, rather than merely a
        // socket opening. The guest must not enter a match that was rejected.
        send({t:'hello',version:PROTOCOL,ready:gameReady(),motion:!!motionLink});
        broadcastState();
      } else {
        if(packet.motion===true)setupMotionChannel(connection,false,token);
        slimoCompleteJoin(roomId);
      }
      return;
    }
    if (!welcomed) return;
    if(hostSide && packet.t==='slimoEmote' && ['fight','round','over'].includes(state.phase)) {
      const now=performance.now(), rival=slimoDuel?.guest;
      if(packet.key==='atomic' && rival?.atomic && now-rivalEmoteAt>=20000){
        rivalEmoteAt=now; const castId=startAtomic(1); event('atomic',0,0,{i:1,color:rival.color,castId}); broadcastState();
      }else if(packet.key==='wave' && rival?.owner){
        event('ownerWave',0,0,{i:1,color:rival.color}); broadcastState();
      }
    }
    if (hostSide && packet.t === 'input') {
      lastRemote = performance.now();
      readCommand(packet.v || {});
    }
    if (hostSide && packet.t === 'draftPick') {
      lastRemote = performance.now();
      if (typeof packet.key === 'string' && lockDraft(1, packet.id, packet.key)) broadcastState();
    }
    if (hostSide && packet.t === 'rematch' && state.phase === 'over') {
      lastRemote = performance.now();
      state.rematch[1] = true;
      if (state.rematch[0]) restartMatch();
      broadcastState();
    }
    if (!hostSide && packet.t === 'state') acceptKeyframe(packet);
  });
  function end() {
    clearTimeout(timeout);
    if (token !== netAttempt || link !== connection) return;
    if (hostSide) dropRival();
    else failConnection('Disconnected from the host. Use the invitation to try again.');
  }
  connection.on('close', end);
  connection.on('error', end);
}
const phases = ['waiting', 'countdown', 'fight', 'round', 'draft', 'over'];
const eventTypes = ['spell','atomic','ownerWave','start', 'wind', 'slap', 'chargeSpit', 'spit', 'splat', 'dash', 'perfect', 'return', 'chargeNova', 'nova', 'hit', 'land', 'ko', 'skill', 'waveCue', 'wave', 'pickup', 'hazard', 'burn'];
const validColor = n => Number.isInteger(n) && n >= 0 && n < palette.length;
const validSlot = n => n === 0 || n === 1;
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < 100 && Math.abs(p.z) < 100;
function validSnapshot(s) {
  if (!s || !Array.isArray(s.p) || s.p.length !== 2 || !Array.isArray(s.score) || s.score.length !== 2 ||
      !Array.isArray(s.rematch) || s.rematch.length !== 2 || !Array.isArray(s.bullets) || s.bullets.length > 24 ||
      !Array.isArray(s.fx) || s.fx.length > 25 || !phases.includes(s.phase) || !Number.isInteger(s.roundKey) ||
      !Number.isInteger(s.duelMatch) || s.duelMatch < 1 || !Number.isInteger(s.round) || s.round < 1 || ![-1, 0, 1].includes(s.winner) ||
      !Number.isFinite(s.timer) || !Number.isFinite(s.wait) || typeof s.paused !== 'boolean') return false;
  if (!['classic', 'rogue'].includes(s.format) ||
      !s.score.every(n => Number.isInteger(n) && n >= 0 && n <= (s.format === 'classic' ? 3 : 8)) ||
      !s.rematch.every(n => typeof n === 'boolean')) return false;
  if (s.format === 'rogue') {
    const run = s.run;
    if (!run || !SlimoRogueSpells.validEffects(run.spellEffects) || !Number.isInteger(run.seed) || ![-1, 0, 1].includes(run.winner) || typeof run.pickup !== 'boolean' ||
        !Array.isArray(run.recent) || run.recent.length !== 2 || !run.recent.every(k => k === '' || Object.hasOwn(skills, k)) ||
        !Array.isArray(run.waves) || run.waves.length > 12 || !run.waves.every(w => validPoint(w) &&
          ['echo', 'after'].includes(w.id) && Number.isFinite(w.radius) && Number.isFinite(w.delay)) || s.round > 8) return false;
    if (s.phase === 'draft') {
      const d = run.draft;
      if (!d || !Number.isSafeInteger(d.id) || !Number.isFinite(d.remaining) || d.remaining < 0 || d.remaining > DRAFT_MS ||
          !Array.isArray(d.offers) || d.offers.length !== 2 || !Array.isArray(d.offers[1]) ||
          d.offers[1].length !== 3 || !d.offers[1].every(k => Object.hasOwn(skills, k) && skillRank(s.p[1], k) < 3) ||
          !Array.isArray(d.picks) || d.picks.length !== 2 || !Array.isArray(d.locked) || d.locked.length !== 2 ||
          !d.locked.every(v => typeof v === 'boolean') || (d.picks[1] && !d.offers[1].includes(d.picks[1]))) return false;
    } else if (run.draft) return false;
  } else if (s.run || s.phase === 'draft') return false;
  if (!s.p.every(p => validPoint(p) && typeof p.name === 'string' && p.name.length < 64 && typeof p.active === 'boolean' &&
      validColor(p.color) && p.ranks && typeof p.ranks === 'object' && Object.entries(p.ranks).length <= skillIds.length &&
      Object.entries(p.ranks).every(([k, v]) => Object.hasOwn(skills, k) && Number.isInteger(v) && v > 0 && v < 4) &&
      ['x', 'z', 'r', 'vx', 'vz', 'kx', 'kz', 'air', 'vy', 'hp', 'maxHp', 'size', 'en', 'dash', 'dashTime', 'stun',
        'hit', 'attackTime', 'duration', 'contactTime', 'combo', 'chill', 'chillAmount', 'growth'].every(key => Number.isFinite(p[key])) &&
      p.maxHp >= 100 && p.maxHp <= 154 && p.size >= 1 && p.size <= 1.3 && ['', 'slap', 'spit', 'nova'].includes(p.attack))) return false;
  if (!s.bullets.every(q => validPoint(q) && (q.scale === undefined || Number.isFinite(q.scale) && q.scale>=1 && q.scale<=2) && (q.charged === undefined || typeof q.charged === 'boolean') && validColor(q.color) && validSlot(q.owner) && Number.isSafeInteger(q.id) &&
      [0, 1, 2, 3].includes(q.returns) && Number.isFinite(q.vx) && Number.isFinite(q.vz) &&
      ['fire', 'frost', 'seeker', 'fork', 'cannon'].every(k => [0, 1, 2, 3].includes(q[k] ?? 0)))) return false;
  return s.fx.every(q => {
    if (!validPoint(q) || !eventTypes.includes(q.type) || !Number.isSafeInteger(q.id)) return false;
    if(q.type==='spell')return validSlot(q.i)&&Object.hasOwn(WORLD.spells,q.key)&&[1,2,3].includes(q.rank)&&validColor(q.color);
    if (q.type === 'start') return true;
    if (!validColor(q.color)) return false;
    if (['hit', 'ko'].includes(q.type) && (!validSlot(q.i) || !Number.isFinite(q.nx) || !Number.isFinite(q.nz) || !Number.isFinite(q.height))) return false;
    if (q.type === 'hit' && !Number.isFinite(q.damage)) return false;
    if (q.type === 'slap' && (!Number.isFinite(q.angle) || ![-1, 1].includes(q.side))) return false;
    if (q.type === 'burn' && (!validSlot(q.i) || !Number.isFinite(q.damage))) return false;
    if (['skill', 'wave', 'waveCue'].includes(q.type) && (!validSlot(q.i) || !Object.hasOwn(skills, q.skill) ||
        ![1, 2, 3].includes(q.rank))) return false;
    if (['wave', 'waveCue', 'hazard'].includes(q.type) && (!Number.isFinite(q.radius) || q.radius <= 0 || q.radius > 10)) return false;
    return true;
  });
}
function tickNetwork() {
  const now = performance.now();
  if (document.hidden) updateDraft(now);
  tickNet(now);
}
setInterval(tickNetwork, 40);

function invitation() {
  if (!roomId) return '';
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return roomId;
  const url = new URL(location.href);
  url.hash = 'room=' + roomId;
  return url.href;
}
function openShare() {
  if (!roomId || !peer?.open) return toast('Your room is still opening.');
  $('shareValue').value = invitation();
  $('shareHelp').textContent = location.protocol === 'file:' ?
    'Send this room code. Your rival can paste it into their copy of the game while you keep this window open.' :
    'Send this link and keep the arena open while your rival joins.';
  openOverlay('shareOverlay');
}
async function copyInvite() {
  const value = invitation();
  try {
    await navigator.clipboard.writeText(value);
    toast('Invitation copied');
  } catch {
    $('shareValue').focus();
    $('shareValue').select();
    try {
      if (document.execCommand('copy')) return toast('Invitation copied');
    } catch { /* The selection is available for manual copying. */ }
    toast('Copy the selected invitation');
  }
}
async function shareInvite() {
  const value = invitation();
  if (!navigator.share) return copyInvite();
  try {
    const url = value.startsWith('http');
    await navigator.share(url ? { title: 'Slime Circuit', url: value } : { title: 'Slime Circuit', text: value });
  } catch (error) {
    if (error.name !== 'AbortError') await copyInvite();
  }
}
async function fullscreen(toggle = false) {
  if (document.fullscreenElement && toggle) {
    await document.exitFullscreen?.().catch(() => {});
    return;
  }
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (document.fullscreenElement && screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch { /* Browsers that restrict fullscreen use the current viewport. */ }
}
function updateOrientation() {
  const blocked = (pending || mode !== 'lobby') && !isLandscape();
  $('landscape').hidden = !blocked;
  if (blocked) resetInputs();
  if (pending?.ready && !blocked) {
    const { type, code, format } = pending;
    pending = null;
    enter(type, code, format);
  }
}
async function requestEnter(type, code = '', format = lobbyFormat) {
  if (pending || mode !== 'lobby' || !slimoAccount?.username) return;
  unlockAudio();
  closeOverlay(false);
  profile = { name: $('playerName').value.trim().slice(0, 16) || 'Jade', color: chosen };
  writeStore('slimeRomeProfile', profile);
  setStatus('');
  const request = ++entryNonce;
  pending = { type, code, format, ready: false };
  updateOrientation();
  const openScreen=fullscreen();
  await openScreen;
  if (request !== entryNonce || !pending) return;
  pending.ready = true;
  updateOrientation();
}
function prepareLobby() {
  state = freshMatch();
  state.p[0] = Object.assign(freshPlayer(0,{hat:slimoAccount?.hat,accent:slimoAccount?.accent,owner:slimoAccount?.owner}), { x: 2.2, z: 2.1, r: .13 });
  state.p[1] = Object.assign(freshPlayer(1), { x: 4.16, z: -.45, r: -.61, active: true, color: (chosen + 1) % 4 });
  snapFighters();
  resetViewForRound();
  lastBanner = '';
}
function enter(type, code, format = lobbyFormat) {
  mode = type;
  localSlot = type === 'guest' ? 1 : 0;
  stopFastChannel();
  state = freshMatch(type === 'guest' || type === 'public' ? 'classic' : format);
  state.p[localSlot] = freshPlayer(localSlot, { active:true, name:profile.name, color:chosen, hat:slimoAccount?.hat, accent:slimoAccount?.accent, owner:slimoAccount?.owner });
  if (type === 'public') Object.assign(state.p[0], { x: -24, z: 15, r: .7 });
  state.p[1 - localSlot].active = false;
  inputs = [neutralInput(), neutralInput()];
  inputs[localSlot].a = { ...inputCounts };
  lastBanner = '';
  clearFx();
  snapFighters();
  resetInputs();
  resetViewForRound();
  lockOn(settings.autoLock);
  document.body.classList.add('playing');
  $('lobby').hidden = true;
  $('hud').hidden = false;
  $('touchControls').hidden = !coarse;
  $('invite').hidden = type === 'bot' || type === 'public';
  $('addFriend').hidden = type === 'bot' || type === 'public';
  $('practiceAdjust').hidden = type !== 'bot';
  $('fieldBuild').hidden = $('fieldMap').hidden = type !== 'public';
  if (type === 'bot') beginPractice(format);
  else if (type === 'public') {
    document.body.classList.add('public-play');
    $('publicHud').hidden = false;
    publicRoom.locked = settings.autoLock;
    openPublicConnection();
  } else connect(type, code);
  refreshAudio();
}

function chooseFormat(format) {
  lobbyFormat = format;
  $('rogueMode').setAttribute('aria-pressed', String(format === 'rogue'));
  $('classicMode').setAttribute('aria-pressed', String(format === 'classic'));
}
$('rogueMode').onclick = () => chooseFormat('rogue');
$('classicMode').onclick = () => chooseFormat('classic');
$('skillBook').onclick = $('battleSkills').onclick = showSkillBook;
$('draftLock').onclick = submitDraftChoice;
$('draftExit').onclick = () => leave();
$('practice').onclick = runPracticeQuick;
$('practiceSetup').onclick = $('practiceAdjust').onclick = openPractice;
$('practiceLaunch').onclick = startCustomPractice;
$('practiceBuild').onclick = () => openBuild('practice');
$('practiceFormat').onchange = () => {
  const sandbox = $('practiceFormat').value === 'sandbox';
  $('practiceBouts').disabled = $('practiceSeconds').disabled = sandbox;
};
$('openMeadow').onclick = () => requestEnter('public');
setInterval(refreshRoomLobby, 6000);
$('roomBuild').onclick = $('fieldBuild').onclick = () => openBuild('room');
$('buildSave').onclick = () => finishBuild(true);
$('buildCancel').onclick = () => finishBuild(false);
$('buildClear').onclick = () => { editableBuild = {}; drawBuild(); };
$('buildAll').onclick = () => {
  if (buildContext !== 'practice') return;
  editableBuild = Object.fromEntries(skillIds.map(id => [id, 3]));
  drawBuild();
};
for (const button of document.querySelectorAll('[data-build-rank]')) button.onclick = () => setBuildRank(Number(button.dataset.buildRank));
$('openAudioCredits').onclick = showAudioCredits;
$('soundToggle').onclick = $('battleSound').onclick = toggleGameSound;
$('testSound').onclick = () => {
  unlockAudio();
  if (!settings.vol || !settings.sfx) toast('Raise Master volume and Combat sounds to hear the test.');
  else if (!playSound('ready')) toast('Tap again to finish enabling audio.');
};
$('host').onclick = () => requestEnter('host');
$('joinForm').onsubmit = event => {
  event.preventDefault();
  const code = parseRoom($('joinCode').value);
  if (!code) return setStatus('Paste an invite link or a room code starting with rome-.');
  requestEnter('guest', code);
};
$('openGuide').onclick = () => openOverlay('guideOverlay');
$('openSet').onclick = $('setBtn').onclick = () => {
  unlockAudio();
  buildSettings();
  openOverlay('setOverlay');
};
$('setReset').onclick = () => {
  settings = { ...defaults };
  practiceOptions.difficulty = settings.bot;
  preservePractice();
  saveSettings();
  lockOn(settings.autoLock);
  buildSettings();
};
$('friends').onclick = slimoOpenSocial;
$('ownerWave').onclick=()=>slimoActivateEmote('wave');
$('atomicEmote').onclick=()=>slimoActivateEmote('atomic');
$('invite').onclick = openShare;
$('copyInvite').onclick = copyInvite;
$('shareInvite').onclick = shareInvite;
$('addFriend').onclick = slimoOpenSocial;
$('lock').onclick = () => lockOn(mode === 'public' ? !publicRoom.locked : !view.lock);
$('fs').onclick = () => fullscreen(true);
$('quit').onclick = $('cancelJoin').onclick = () => leave();
$('rotateFull').onclick = async () => {
  await fullscreen();
  updateOrientation();
};
$('rematch').onclick = () => {
  if (state.phase !== 'over') return;
  if (mode === 'bot') restartMatch();
  else if (mode === 'host') {
    state.rematch[0] = true;
    if (state.rematch[1]) restartMatch();
    broadcastState();
  } else {
    state.rematch[1] = true;
    send({ t: 'rematch' });
  }
};
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => {
    if (button.dataset.close === activeOverlay) closeOverlay();
  };
});
const swatches = [...document.querySelectorAll('.swatch')];
function updateSwatches() {
  for (const button of swatches) button.setAttribute('aria-pressed', String(Number(button.dataset.color) === chosen));
}
for (const button of swatches) button.onclick = () => {
  chosen = Number(button.dataset.color);
  state.p[0].color = chosen;
  state.p[1].color = (chosen + 1) % 4;
  updateSwatches();
};
const inviteCode = parseRoom(location.hash);
if (inviteCode) {
  $('joinCode').value = inviteCode;
  setStatus('Choose your slime and tap Join.');
}
updateSwatches();
function resumeAudioFromGesture() {
  const track = audio?.tracks.get(audio.selection);
  if (!audio || audio.ctx.state !== 'running' || (track?.level && track.track.paused)) unlockAudio();
}
// Capture activation before fullscreen, network waits, or a child handler.
document.addEventListener('pointerdown', resumeAudioFromGesture, { capture: true });
document.addEventListener('keydown', resumeAudioFromGesture, { capture: true });
document.addEventListener('click', resumeAudioFromGesture, { capture: true });
addEventListener('resize', () => {
  resizeView();
  updateOrientation();
});
document.addEventListener('fullscreenchange', updateOrientation);
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  graphicsLost = true;
  resetInputs();
  if (mode === 'host') tickNet(performance.now(), true);
  toast('Graphics paused. Waiting for the browser to restore WebGL.');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  graphicsLost = false;
  previous = performance.now();
  accumulator = 0;
  updateQuality();
  renderer.shadowMap.needsUpdate = true;
  toast('Graphics restored');
});
document.addEventListener('visibilitychange', () => {
  resetInputs();
  refreshAudio();
  if (document.hidden && mode === 'public') suspendMeadow('hidden');
  else if (!document.hidden && mode === 'public') resumeMeadow();
  else if (document.hidden) tickNet(performance.now(), true);
  else {
    lastRemote = lastSnapshot = performance.now();
    if (mode === 'public' && !meadowSuspended) sendRoomInput(true);
    previous = performance.now();
    accumulator = 0;
  }
});
addEventListener('pagehide', event => {
  if (!event.persisted) {
    if (mode === 'public') suspendMeadow('pagehide');
    send({ t: 'leave' });
    clearPeer();
  }
});
addEventListener('offline', () => {
  if (mode === 'public') leave('Connection lost. Rejoin Open Meadow when you’re back online.');
  else if (mode === 'guest') failConnection('Connection lost. Rejoin when you’re back online.');
  else if (mode === 'host' && welcomed) dropRival('Connection lost. Your rival can rejoin when you’re back online.');
});

const safeZone = addMesh(new T.RingGeometry(.986, 1, 100), fxMaterial(0xffae64, .9), scene, 0, .044, 0);
safeZone.rotation.x = -Math.PI / 2;
safeZone.visible = false;
meadowExpansion=SlimoMeadowMap.create(T,groveRoot,WORLD);
magicView=SlimoMagicVfx.create(T,scene,WORLD);
prepareMeadowMapControls();
const sunLighting=SlimoSunlight.create(T,renderer,scene,camera,sun);
prepareLobby();
prepareSocialControls();
applySettings();
refreshRoomLobby();
let previous = performance.now(), accumulator = 0, worldTime = 0, shadowAt = -Infinity;
function frame(now) {
  const elapsed = Math.max(0, (now - previous) / 1000);
  previous = now;
  if (document.hidden || graphicsLost) {
    accumulator = 0;
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(.145, elapsed);
  clock += dt;
  samplePerformance(elapsed);
  if (mode === 'public') {
    accumulator = 0;
    updateLook(dt);
    repeatInput();
    animatePublic(dt, worldTime);
  } else if (mode !== 'lobby') {
    updateLook(dt);
    repeatInput();
    inputs[localSlot] = readInput();
    if (mode !== 'guest') {
      state.paused = !inputs[localSlot].ready || (mode === 'host' && welcomed && !remoteReady);
      accumulator = state.paused ? 0 : Math.min(.15, accumulator + dt);
      while (accumulator >= STEP) {
        simulate(STEP);
        simulationTick++;
        accumulator -= STEP;
      }
      updateDraft(now);
    } else {
      accumulator = 0;
      predictGuest(inputs[localSlot], dt);
    }
    syncEvents();
    tickNet(now);
  } else accumulator = 0;

  meadowExpansion.visible = inMeadow();
  if(meadowExpansion.visible)meadowExpansion.update(state.p[localSlot],worldTime,settings);
  magicView.update(state.format==='rogue'&&mode!=='public'&&state.run?{effects:state.run.spellEffects||[],receivedAt:mode==='guest'&&!state.paused?lastSnapshot:performance.now()}:null,performance.now(),state.p[localSlot],settings);
  $('meadowMapPanel').hidden=mode!=='public'||!meadowMapOpen;
  const vdt = visualDelta(Math.min(.068, dt));
  worldTime += vdt;
  animateArena(worldTime, vdt);
  animateStage(worldTime);
  animateFightRing(worldTime);
  audioFrame();
  animateFighters(state.paused && mode !== 'lobby' ? 0 : vdt, worldTime);
  animateGlobs(state.paused ? 0 : vdt, worldTime);
  aimCamera(Math.min(dt, .068), dt);
  batchRoomFighters();
  animateEffects(vdt, dt);
  animateWords(dt);
  safeZone.visible = state.phase === 'fight' && safeScale() < .999;
  if (safeZone.visible) {
    const safe = safeScale();
    const bounds = arenaSize();
    safeZone.scale.set(bounds.x * safe, bounds.z * safe, 1);
  }
  drawHud();
  drawDraft();
  animateDraftCard(now);
  if (now - shadowAt >= (coarse ? 39 : 28)) {
    shadowAt = now;
    renderer.shadowMap.needsUpdate = true;
  }
  drawSlimoFinish(now);
  drawSlimoImpact(now);
  drawAtomic(now);
  if(inMeadow())groveSky.position.copy(camera.position);
  sunLighting.render({meadow:inMeadow(),player:state.p[localSlot],sunOffset:meadowSun,quality:settings.quality,reduced:settings.reduced});
  requestAnimationFrame(frame);
}
slimoInitAccount();
requestAnimationFrame(frame);
