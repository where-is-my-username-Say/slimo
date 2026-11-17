'use strict';

// Shared world/ability contract used by the browser and the authoritative Worker.
globalThis.SlimoWorld = (() => {
  const x = 180, z = 164, ring = Object.freeze({ x: 0, z: 0, radius: 8.8 });
  const rocks = [
  { x: -12, z: -9.5, r: 1.65, height: 2.38 },
  { x: 15.2, z: 11.5, r: 1.76, height: 2.2 },
  { x: 1.5, z: -20.5, r: 1.48, height: 1.95 },
  { x: -21.2, z: 12, r: 1.77, height: 2.14 },
  { x: 29.1, z: -15.8, r: 1.75, height: 2.45 },
  { x: -34.4, z: -15.2, r: 1.87, height: 2.25 },
  { x: 32.9, z: 17.8, r: 1.83, height: 2.36 },
  { x: -9.2, z: 26.9, r: 1.45, height: 1.92 }
];
  const trees = [
  { x: -9, z: -13, s: 1.14 }, { x: 8, z: -15.2, s: 1.40 }, { x: 16.2, z: -8.5, s: .85 },
  { x: 25, z: -21, s: 1.0 }, { x: -18.6, z: -16, s: .84 }, { x: -23, z: -3.8, s: 1.15 },
  { x: 18, z: 16, s: 1.07 }, { x: 28.2, z: 9.6, s: 1.21 }, { x: 34, z: -5, s: 1.37 },
  { x: -17, z: 16, s: .95 }, { x: -29.2, z: 12, s: 1.17 }, { x: 2.8, z: 23, s: .97 },
  { x: -6.4, z: -28.4, s: 1.10 }, { x: 14, z: -27.2, s: .88 }, { x: 35, z: -25.4, s: 1.24 },
  { x: -34.8, z: -22.4, s: 1.07 }, { x: -37.6, z: 2.6, s: .90 }, { x: 43, z: 1, s: 1.13 },
  { x: -41, z: 13, s: 1.08 }, { x: 27, z: 26, s: .93 }, { x: -24.7, z: 25, s: .98 }
];
  const landmarks = [
    { id: 'ring', name: 'Duel Ring', x: 0, z: 0, color: 0xffd28a },
    { id: 'crystals', name: 'Crystal Grove', x: 108, z: -68, color: 0xba98ff },
    { id: 'ruins', name: 'Sunken Ruins', x: -110, z: -48, color: 0xe2bf82 },
    { id: 'lake', name: 'Whisper Lake', x: 91, z: 80, color: 0x7ee3ec },
    { id: 'village', name: 'Lantern Hollow', x: -77, z: 99, color: 0xffb567 }
  ];
  let seed = 721953;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 115; i++) {
    const angle = random() * Math.PI * 2, distance = .38 + Math.sqrt(random()) * .52;
    const tx = Math.cos(angle) * x * distance, tz = Math.sin(angle) * z * distance;
    if (landmarks.some(p => Math.hypot(tx - p.x, tz - p.z) < 16)) continue;
    trees.push({ x: tx, z: tz, s: .78 + random() * .8 });
  }
  const cover = [...rocks, ...trees.map(t => ({ x: t.x, z: t.z, r: .62 * t.s, height: 5.9 * t.s }))];
  const structures = [];
  for(const side of [-1,1])for(const offset of [-8,0,8])structures.push({kind:'ruin',x:-110+side*6,z:-48+offset,r:.9,height:5.2});
  for(let i=0;i<7;i++){const a=i*Math.PI*2/7;structures.push({kind:'crystal',x:108+Math.sin(a)*7,z:-68+Math.cos(a)*7,r:1.2,height:3.5+(i%3)*1.4});}
  for(const dx of [-8,8])for(const dz of [-7,7])structures.push({kind:'cottage',x:-77+dx,z:99+dz,r:2.4,height:4});
  cover.push(...structures);
  const insideRing = (px, pz) => Number.isFinite(px) && Number.isFinite(pz) &&
    (px - ring.x) ** 2 + (pz - ring.z) ** 2 <= ring.radius ** 2;
  const spells = {};
  function spell(id, name, color, icon, cost, cooldown, build) {
    spells[id] = { id, name, color, icon, group: 'Meadow spells',
      levels: [1, 2, 3].map(rank => ({ rank, cost, cooldown: cooldown - (rank - 1), ...build(rank) })) };
  }
  spell('earthwall', 'Earthwake Wall', 0xd9ad73, 'shield', 24, 14, r => ({
    width: 4 + r * 1.3, duration: 3.8 + r * 1.1, height: 1.7 + r * .45, damage: 0,
    text: `Raise a ${4 + r * 1.3} m stone wall for ${(3.8 + r * 1.1).toFixed(1)} s. Blocks players and ordinary shots in the ring; decorative outside.`
  }));
  spell('embertrail', 'Ember Fault', 0xff874b, 'flame', 24, 11, r => ({
    damage: 9 + r * 5, radius: 1.1 + r * .18, duration: 1.5, delay: .45,
    text: `A telegraphed line of ${3 + r} fire eruptions deals ${9 + r * 5} damage once per rival. Longer at each rank.`
  }));
  spell('frostbloom', 'Frost Bloom', 0x91e8ff, 'ice', 22, 13, r => ({
    damage: 7 + r * 4, radius: 2.8 + r * .65, slow: .20 + r * .08, duration: 1.8, delay: .6,
    text: `Ice blossoms in a ${(2.8 + r * .65).toFixed(1)} m radius: ${7 + r * 4} damage and ${20 + r * 8}% slow for 2 s.`
  }));
  spell('stormcoil', 'Storm Coil', 0xe0c6ff, 'bolt', 28, 13, r => ({
    damage: 9 + r * 4, radius: 5 + r, targets: 1 + r, duration: .8, delay: .18,
    text: `Lightning links up to ${1 + r} rivals within ${5 + r} m for ${9 + r * 4} damage each.`
  }));
  spell('vortex', 'Gale Vortex', 0x9df9df, 'ghost', 30, 17, r => ({
    damage: 2 + r, radius: 2.5 + r * .55, duration: 2.6 + r * .3, delay: .3,
    text: `A ${(2.5 + r * .55).toFixed(1)} m wind spiral draws in rivals and deals ${2 + r} damage every 0.4 s. Ring only.`
  }));
  spell('stoneburst', 'Pebble Barrage', 0xf4ce8b, 'crown', 20, 10, r => ({
    damage: 8 + r * 4, shots: 3 + r * 2, radius: 1, duration: .9, delay: 0,
    text: `Fan out ${3 + r * 2} glowing stones. One hit per rival per cast, for ${8 + r * 4} damage.`
  }));
  spell('mending', 'Mending Spring', 0x8ff1b1, 'cross', 30, 19, r => ({
    heal: 10 + r * 8, damage: 0, radius: 1.8, duration: 1.2, delay: .25,
    text: `Restore ${10 + r * 8} HP in the ring, with ascending green runes. Decorative outside; cannot revive a knockout.`
  }));
  spell('starfall', 'Starfall', 0xffc191, 'sun', 35, 18, r => ({
    damage: 14 + r * 6, radius: 1.9 + r * .5, duration: 1.7, delay: .95,
    text: `Mark the ground, then drop a meteor after 0.95 s: ${14 + r * 6} damage in a ${(1.9 + r * .5).toFixed(1)} m radius.`
  }));
  const passives = {"colossus":{"name":"Colossus Goo","group":"Body","color":16759147,"icon":"crown","levels":[{"hp":18,"size":0.1,"text":"+18 max HP and 10% larger."},{"hp":36,"size":0.19,"text":"+36 max HP and 19% larger."},{"hp":54,"size":0.29,"text":"+54 max HP and 29% larger."}],"animations":["One big jelly swell.","A double swell with a gold belt flash.","A stomp, a crown burst, and a full-body wobble."]},"armor":{"name":"Marble Shell","group":"Body","color":16769210,"icon":"shield","levels":[{"cut":0.09,"text":"Take 9% less direct damage."},{"cut":0.15,"text":"Take 15% less direct damage."},{"cut":0.22,"text":"Take 22% less direct damage."}],"animations":["A marble plate flashes on impact.","Two plates lock together.","A marble dome cracks into gold shards."]},"second":{"name":"Second Splat","group":"Body","color":9172158,"icon":"cross","levels":[{"heal":8,"text":"Heal 8 HP the first time you survive a hit below 34% HP."},{"heal":14,"text":"Heal 14 HP the first time you survive a hit below 34% HP."},{"heal":20,"text":"Heal 20 HP the first time you survive a hit below 34% HP."}],"animations":["A green pulse lifts off the ground.","Two green pulses spiral upward.","A green fountain scatters healing crosses."]},"anchor":{"name":"Anchor Goo","group":"Body","color":15181699,"icon":"anchor","levels":[{"cut":0.18,"text":"Reduce horizontal knockback by 18%."},{"cut":0.32,"text":"Reduce horizontal knockback by 32%."},{"cut":0.48,"text":"Reduce horizontal knockback by 48%."}],"animations":["An anchor slams down.","Two anchors pull against each other.","An anchor stomp sends cracks outward."]},"leech":{"name":"Snack Slap","group":"Body","color":16436097,"icon":"snack","levels":[{"heal":2,"text":"Heal 2 HP per landed slap."},{"heal":4,"text":"Heal 4 HP per landed slap."},{"heal":6,"text":"Heal 6 HP per landed slap."}],"animations":["A snack hops into your mouth.","Two snacks orbit before the bite.","A trail of crumbs follows a giant snack."]},"guard":{"name":"Bubble Wrap","group":"Body","color":11067135,"icon":"bubble","levels":[{"cut":0.22,"text":"Block 22% of the first direct hit each bout."},{"cut":0.36,"text":"Block 36% of the first direct hit each bout."},{"cut":0.5,"text":"Block 50% of the first direct hit each bout."}],"animations":["A bubble pops.","Twin bubbles pop in succession.","A bubble shell bursts outward."]},"power":{"name":"Heavy Hands","group":"Slap","color":16755054,"icon":"hand","levels":[{"damage":2,"text":"+2 damage per slap."},{"damage":4,"text":"+4 damage per slap."},{"damage":6,"text":"+6 damage per slap."}],"animations":["The mitt bulges on contact.","An oversize mitt leaves a second crescent.","A giant mitt sweeps through a gold impact crown."]},"reach":{"name":"Stretch Slap","group":"Slap","color":16041361,"icon":"stretch","levels":[{"reach":0.35,"text":"+0.35 m slap reach."},{"reach":0.65,"text":"+0.65 m slap reach."},{"reach":0.95,"text":"+0.95 m slap reach."}],"animations":["The palm stretches out.","The long palm snaps back through a ribbon.","An elastic whip sweeps through three arcs."]},"tempo":{"name":"Rapid Rhythm","group":"Slap","color":16100811,"icon":"beat","levels":[{"time":0.93,"text":"Slap windup and recovery are 7% shorter."},{"time":0.88,"text":"Slap windup and recovery are 12% shorter."},{"time":0.83,"text":"Slap windup and recovery are 17% shorter."}],"animations":["A single snap follows the swing.","A two-beat wrist flick.","Three staccato pulses trace the swing."]},"finisher":{"name":"Encore","group":"Slap","color":16763495,"icon":"star","levels":[{"damage":3,"lift":0.55,"text":"Third slap adds 3 damage and 0.55 launch speed."},{"damage":6,"lift":1.1,"text":"Third slap adds 6 damage and 1.10 launch speed."},{"damage":9,"lift":1.65,"text":"Third slap adds 9 damage and 1.65 launch speed."}],"animations":["A star rises from the uppercut.","Twin stars corkscrew upward.","A gold starburst follows the launch."]},"echo":{"name":"Slap Echo","group":"Slap","color":14658815,"icon":"echo","levels":[{"damage":3,"radius":2.2,"text":"Third slap leaves a 3-damage echo in a 2.2 m radius."},{"damage":5,"radius":2.7,"text":"Third slap leaves a 5-damage echo in a 2.7 m radius."},{"damage":7,"radius":3.2,"text":"Third slap leaves a 7-damage echo in a 3.2 m radius."}],"animations":["A delayed ripple replays the slap.","Two opposing ripples meet.","A three-lobed wave breaks out of the sand."]},"return":{"name":"Return to Sender","group":"Slap","color":14859263,"icon":"mirror","levels":[{"window":0.028,"damage":2,"text":"+28 ms reflection window on either side and +2 return damage."},{"window":0.052,"damage":4,"text":"+52 ms reflection window on either side and +4 return damage."},{"window":0.08,"damage":6,"text":"+80 ms reflection window on either side and +6 return damage."}],"animations":["One mirrored crescent turns the spit around.","Twin violet mirrors flip in opposite directions.","A violet portal opens and snaps shut."]},"fire":{"name":"Fire Spit","group":"Spit","color":16746834,"icon":"flame","levels":[{"burn":4,"text":"Spit burns for 4 damage over 2.4 s."},{"burn":7,"text":"Spit burns for 7 damage over 2.4 s."},{"burn":10,"text":"Spit burns for 10 damage over 2.4 s."}],"animations":["An ember tail follows the glob.","Two flames twist around the glob.","A bright flame core punches through a ring of sparks."]},"frost":{"name":"Frost Spit","group":"Spit","color":8907519,"icon":"ice","levels":[{"slow":0.12,"text":"Spit slows movement by 12% for 1.45 s."},{"slow":0.2,"text":"Spit slows movement by 20% for 1.45 s."},{"slow":0.28,"text":"Spit slows movement by 28% for 1.45 s."}],"animations":["One ice crystal forms on the hit.","Twin crystals spiral around the target.","An ice rosette shatters outward."]},"fork":{"name":"Split Spit","group":"Spit","color":9828293,"icon":"fork","levels":[{"count":1,"sideDamage":7,"spread":0.227,"text":"Add one side glob for 7 damage. One hit per volley."},{"count":2,"sideDamage":8,"spread":0.279,"text":"Add two wide side globs for 8 each. One hit per volley."},{"count":2,"sideDamage":9,"spread":0.175,"text":"Add two tighter side globs for 9 each. One hit per volley."}],"animations":["One trail forks from the shot.","Two wing trails open into a fan.","A tight three-pronged volley flickers in formation."]},"seeker":{"name":"Homing Spit","group":"Spit","color":16361961,"icon":"target","levels":[{"turn":14,"text":"Globs steer up to 14° per second."},{"turn":25,"text":"Globs steer up to 25° per second."},{"turn":38,"text":"Globs steer up to 38° per second."}],"animations":["One pink ring tracks the glob.","Two tracking rings counter-rotate.","A spinning reticle follows the curved trail."]},"speed":{"name":"Cannon Spit","group":"Spit","color":16766615,"icon":"bolt","levels":[{"speed":4,"damage":2,"text":"+4 m/s projectile speed and +2 direct damage."},{"speed":7,"damage":3,"text":"+7 m/s projectile speed and +3 direct damage."},{"speed":10,"damage":4,"text":"+10 m/s projectile speed and +4 direct damage."}],"animations":["A bright straight streak.","A second streak twists around the shot.","A sharp shock cone follows the shot."]},"boomer":{"name":"Pillar Pinball","group":"Spit","color":15053055,"icon":"ricochet","levels":[{"banks":1,"text":"Globs can bounce off a pillar once."},{"banks":2,"text":"Globs can bounce off pillars twice."},{"banks":3,"text":"Globs can bounce off pillars three times."}],"animations":["A single pinball spark at the wall.","Two rebound rings spin off the pillar.","A violet pinball burst sprays in both directions."]},"swift":{"name":"Slipstream","group":"Dodge & Nova","color":9565919,"icon":"dash","levels":[{"cooldown":0.85,"text":"Dodge cooldown drops to 0.85 s."},{"cooldown":0.72,"text":"Dodge cooldown drops to 0.72 s."},{"cooldown":0.59,"text":"Dodge cooldown drops to 0.59 s."}],"animations":["A short teal trail.","Two offset speed ribbons.","A triple wave peels off behind the dash."]},"phase":{"name":"Ghost Dodge","group":"Dodge & Nova","color":13223679,"icon":"ghost","levels":[{"inv":0.035,"text":"+35 ms dodge invulnerability."},{"inv":0.065,"text":"+65 ms dodge invulnerability."},{"inv":0.095,"text":"+95 ms dodge invulnerability."}],"animations":["A pale afterimage fades out.","Twin afterimages split sideways.","A ghost shell expands through three silhouettes."]},"counter":{"name":"Revenge Recipe","group":"Dodge & Nova","color":16751804,"icon":"counter","levels":[{"damage":3,"time":1.95,"text":"+3 counter damage and 1.95 s to use it after a perfect dodge."},{"damage":5,"time":2.2,"text":"+5 counter damage and 2.20 s to use it after a perfect dodge."},{"damage":8,"time":2.5,"text":"+8 counter damage and 2.50 s to use it after a perfect dodge."}],"animations":["A pink mark flashes on the dodge.","Two pink marks trade places.","A pink crown snaps shut on the counter."]},"battery":{"name":"Crowd Favorite","group":"Dodge & Nova","color":16765827,"icon":"spark","levels":[{"energy":1.13,"text":"Gain 13% more Nova energy from combat."},{"energy":1.25,"text":"Gain 25% more Nova energy from combat."},{"energy":1.4,"text":"Gain 40% more Nova energy from combat."}],"animations":["A gold spark marks full charge.","Two sparks spiral into the crown.","A crown of sparks salutes the full meter."]},"wide":{"name":"Big Bang","group":"Dodge & Nova","color":16756352,"icon":"sun","levels":[{"radius":0.6,"text":"Nova reaches 0.60 m farther."},{"radius":1.1,"text":"Nova reaches 1.10 m farther."},{"radius":1.65,"text":"Nova reaches 1.65 m farther."}],"animations":["A wide sun ring opens.","A second ring rises through the first.","A rising gold corona sweeps the full blast radius."]},"after":{"name":"Afterparty","group":"Dodge & Nova","color":16758513,"icon":"burst","levels":[{"damage":4,"radius":3.1,"text":"Nova leaves a delayed 4-damage wave in a 3.1 m radius."},{"damage":7,"radius":3.7,"text":"Nova leaves a delayed 7-damage wave in a 3.7 m radius."},{"damage":10,"radius":4.3,"text":"Nova leaves a delayed 10-damage wave in a 4.3 m radius."}],"animations":["A late pink ripple.","Two pink waves cross with confetti.","A firework detonates into a pink corona."]}};
  const stat = (p,key,field,fallback=0) => passives[key]?.levels[(p.ranks?.[key]||0)-1]?.[field] ?? fallback;
  const baseSkills = ['colossus','armor','second','anchor','leech','guard','power','reach','tempo','finisher','echo','return',
    'fire','frost','fork','seeker','speed','boomer','swift','phase','counter','battery','wide','after'];
  const buildKeys = [...baseSkills, ...Object.keys(spells)];
  function cleanBuild(raw, limit = 18) {
    const result = {}; let left = limit;
    for (const key of buildKeys) {
      const value = Number.isInteger(raw?.[key]) ? Math.max(0, Math.min(3, raw[key], left)) : 0;
      if (value) { result[key] = value; left -= value; }
    }
    return result;
  }
  function wallSegments(wall) {
    const level = spells.earthwall.levels[wall.rank - 1], count = 4 + wall.rank;
    return Array.from({length: count}, (_, i) => {
      const offset = (i / (count - 1) - .5) * level.width;
      return { x: wall.x + Math.cos(wall.aim) * offset, z: wall.z - Math.sin(wall.aim) * offset, r: .65, height: level.height };
    });
  }
  return Object.freeze({ x, z, ring, rocks, trees, cover, structures, landmarks, spells, passives, stat, buildKeys, cleanBuild, insideRing, wallSegments,
    starterBuild: Object.freeze({earthwall:1,embertrail:1,frostbloom:1,stormcoil:1,vortex:1,stoneburst:1,mending:1,starfall:1,power:2,swift:2,colossus:1,guard:1}),
    spawn: Object.freeze({x: -24, z: 15}), protocol: 4, playerBytes: 34, buildPoints: 18 });
})();
