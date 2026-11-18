# Slimo

Live updated game: **https://slimo-ten.vercel.app/api/slimo/play**. Reload this address on both phones before creating a fresh friend-duel invitation. The original Vercel root may still contain older frontend files.

The existing Cloudflare `slimo-meadow` Worker serves accounts, Open Meadow, an authenticated friend-duel relay, and a matching browser client through Vercel's existing API rewrite. Recorded audio remains under the unchanged Vercel `/audio/` paths. The slime model and basic slap/spit/dodge/Nova parameters are retained.

## Latest lighting and network changes

The flat triangular sun-ray meshes are removed. `slimo-sunlight.js` integrates sunlight through the actual directional shadow map, stopping at scene depth. Trees cast shadows into the scattering pass. The sky's sun direction matches the light, and the shadow region follows the player through the expanded map. A quarter-resolution, depth-aware composite limits work and light bleeding around foreground objects. Low quality, reduced motion and devices without depth textures use ordinary directional lighting directly.

Meadow simulation remains at 20 Hz. Active play receives up to 20 state updates per second; a completely idle room receives five, including an immediate initial snapshot. Each client receives actors/projectiles within 80 m, with its own player and projectiles retained. The visible-player radius is 47 m. Unchanged stationary input becomes a 180 ms heartbeat; movement retains the existing input cadence, and actions send immediately. Idle prediction history is cleared to avoid replaying old idle frames. Queue limits suppress stale movement packets and prevent a congested fast channel from growing a larger JSON-input backlog.

A Middle East placement hint is applied to the regional Meadow object. It is a best-effort hint, not a guarantee of a specific server city or ping. The displayed ping remains measured round-trip time; this update does not replace it with an edge-only or estimated number.

## Roguelike spells

All eight spells are regular roguelike skill-card choices with three upgrade ranks. They have internal cooldowns and **no separate spell bar or mana UI**. Choose them alongside existing skills; their card descriptions show their trigger:

| Existing move | Upgrade effects |
| --- | --- |
| Dodge | Earthwake Wall, Mending Spring |
| Slap | Ember Fault, Storm Coil |
| Spit | Pebble Barrage, Starfall |
| Nova | Frost Bloom, Gale Vortex |

Earthwake rises into temporary collision cover. Other spells have telegraphs, moving rocks, eruptions, lightning, frost or healing effects. The host simulates their damage and sends their state to the guest. Practice can equip these skills for its roguelike mode. Meadow builds contain the original passive skills; direct Meadow spell casts are rejected.

## Expanded Meadow

The walking map is twice as wide and twice as deep as the original, with Crystal Grove, Sunken Ruins, Whisper Lake and Lantern Hollow. Use **M** or **Map** for nearby players, landmarks and ring navigation. Slaps and spits produce sound, effects and playful text outside the ring without damage, knockback, burn or slow. Damage requires the attack to originate in the ring and both participants to remain inside at impact. Knocked-out players respawn safely.

## Deploy and develop

Use Node.js 24 or newer. Install pinned dependencies with `npm ci`.

```sh
npm run build:live-client
npm run check
npm test
```

`npm run dev` uses Python 3 to serve the static frontend at `http://127.0.0.1:8765`. Account and multiplayer APIs require the configured deployment. `npm run deploy:worker` first rebuilds `slimo-live-client.generated.js`, then deploys with the pinned Wrangler. Do not edit the generated client by hand.

Deploy to the existing Worker/account and retain its secrets and Durable Object namespaces. The configuration retains the v1 migration for `GameRoom`/`SlimoAccounts` and v2 for `DuelRelay`. Meadow protocol is **4**; friend-duel protocol is **7**. Google Identity Services must authorize `https://slimo-ten.vercel.app`; set the Google client ID and Owner email in Cloudflare configuration. Existing credentials were preserved by this update.

The manually triggered **Deploy Slimo Worker** GitHub workflow supports later deployments from a phone; see `DEPLOY-FROM-PHONE.md`. `npm run verify:worker` checks the configured Worker's public protocol versions.

## Validation limits

87 automated tests pass. Both sunlight shader programs compiled and linked with Mesa OpenGL ES. A rendered depth/shadow test produced scattering for visible light, none for blocked light, and less scattering when foreground depth shortened the ray. Optional reproduction on Linux with Mesa/EGL:

```sh
node scripts/export-sunlight-shaders.mjs /tmp/slimo-shaders.json
python3 scripts/check-sunlight-gl.py /tmp/slimo-shaders.json
```

The production Worker and all 15 versioned browser assets were read back and checked after deployment. Full browser/device rendering and signed-in two-player performance are not verified by these tests. No measured phone FPS gain or lower Oman ping is claimed.
