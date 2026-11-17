# Slimo expanded Meadow, spells, audio and mobile polish

Base revision: `2c7501d625f9ce54370a3e2a8f9178dcb1fbb1cd`.

## Expanded Meadow update

- Expand public walking bounds from 90 × 82 to 180 × 164, preserving the central ring and slime model. Add four landmarks, path stones, distance-culled forest chunks, village buildings, crystal spires and animated lake water. Reuse geometry/materials and use instancing for repeated scenery.
- Add eight Meadow spells with three ranks each, mana costs, cooldowns, upgrade descriptions and a mobile spell bar. Earthwake Wall has rising/sinking collision blocks; Ember Fault, Frost Bloom, Storm Coil, Gale Vortex, Pebble Barrage, Mending Spring and Starfall have distinct effects. Reduced-motion mode reduces nonessential animation.
- Share map bounds, colliders, ring rules, build validation and spell definitions between the browser and Worker in `slimo-world.js`.
- Implement authoritative public-room slaps, charged spits, Nova, passives, spells, damage, knockouts and safe respawns in `slimo-meadow-combat.js`. Friend-duel combat remains separate. Outside-ring attacks produce playful sound/effect/text feedback with no damage or status effects; queued and projectile damage checks both players' current ring positions and the attack's origin permission.
- Add map and ring navigation, keyboard shortcuts 1–8 and M, an 18-point Meadow build budget, and a Spell starter preset. Retain existing saved builds.
- Bound projectiles, effects and event history, spatially index static cover, restrict transmitted effects by distance, and dispose expired spell visuals. These are implementation safeguards, not measured GPU/FPS claims.
- Upgrade Meadow packets to protocol 4, carrying mana and projectile flags. Frontend and Worker must be deployed together; old clients must reload.

### Verification of this update

`npm run check` checks syntax, 203 unique HTML IDs, 11 ordered scripts and 18 recorded MP3 assets. `npm test` currently passes 50 tests covering audio/mobile controls, safe-zone and ring damage rules, all spell ranks, resource/cooldown/build limits, wall collisions, projectile boundary cases, healing and respawns, actual Worker/browser packet compatibility, out-of-order inputs, map construction and visual object cleanup. Visual construction tests use the pinned Three.js r128; they do not compile shaders on a GPU or verify device layout.

Graphify was consulted in `genghis-s-workspace` for this repository. Its promoted revision remains `2c7501d625f9ce54370a3e2a8f9178dcb1fbb1cd`: source evidence showed the original `GameRoom` only relayed movement/attack state and lacked authoritative damage/projectiles. Local implementation was based on the subsequent audio-polish checkout `49e877b3287cf360d668edb23e5fa2e1da08f393`. The graph does not yet index this update.

Browser preview was blocked by organization policy. Live rendering, shader compilation, real-device sound/performance and signed-in multiplayer remain unverified. The package has not been deployed. See README for the coordinated frontend/Worker update.

## Earlier audio and mobile changes

- Preserve the slime geometry, gel shader, model animation, damage, move timing, collision, projectile, movement, round resolution and bot implementations. Twenty key functions were compared with the base source after normalizing line endings; all were identical.
- Keep recorded combat samples and fight music. Add original locally synthesized jump, charging, fully charged, Nova ready, healing, combo, victory/defeat/draw and interface cues. Alerts are optional; results use the local player's perspective.
- Play immediate synthesized fallbacks while recorded effects load. Bound downloads with an eight-second timeout and failed-sample retries with a fifteen-second backoff. Do not replay stale combat events when their samples finish downloading.
- Retry blocked music with exponential backoff and on gestures, retain crossfades, guard fade timers, recover a closed audio context, and center countdown/interface sounds independently of the player's world position.
- Limit effects to 24 concurrent voices. Release nodes and counters when sources finish, including sources belonging to an older audio context. Discard distant Meadow effects. Synthesize cues only when requested and reuse each generated buffer.
- Add quick mute buttons, a sound test/status, optional alert controls and larger touch targets for modal/lobby actions.
- Include dropdowns and links in modal focus navigation, keep background controls inert while a dialog is open, clear stale input/charge state, and prevent one touch from releasing another touch's ability.
- Stop rendering/simulation work while hidden or WebGL is lost, send the host's paused state, reset accumulated time and refresh graphics on restoration. Networking keeps its existing independent timer.
- Cache connected HUD elements, reuse the touch-button list, and evaluate music/nearby-rival decisions at most ten times per second instead of at rendering frequency.
- Extract the existing scripts into standalone JavaScript files. HTML is reduced from 1,205,849 bytes to approximately 201 KB (83.4% smaller HTML). This is a change in HTML size and caching, not a measured FPS or total first-load-byte reduction. Vendor code is byte-preserved and uses versioned cacheable filenames.

## Verification

- `npm run check`: JavaScript syntax, unique HTML IDs, ordered script dependencies and all 18 recorded audio assets.
- `npm test`: automated audio, waveform, music-selection/retry, voice cleanup, modal-focus filtering, input cancellation and DOM caching checks using Node.js/Web Audio mocks. These do not establish real-device playback or browser layout correctness.
- Original sample files, vendor code and twenty core model/combat functions were compared against the base revision.
- Six thousand repeated HUD lookups issue one underlying DOM lookup while the cached node stays connected; replacement nodes invalidate the cache. This is an operation-count check, not a browser FPS measurement.

## Graphify and skill use

Graphify workspace: `genghis-s-workspace`; repository: `where-is-my-username-Say/slimo`. The promoted graph matched the base revision above. Repository listing, source queries, recall and cinematic-file neighbors were consulted. The graph returned backend and cinematic definitions but did not provide coverage of the inline game script. Audio and input findings therefore came from the matching checkout. Moving the main game into `slimo-game.js` makes it available to a future index refresh; the old graph does not verify these new changes.

The installed collection was searched for relevant guidance. Applicable guidance included game development, browser/mobile games, game audio, multiplayer boundaries, systematic debugging, JavaScript, accessibility, profiling, web performance, Three.js fundamentals/geometry/materials/lighting and verification. Unrelated frameworks and services were not added. Shared material/geometry ownership and the existing Three.js revision were respected.

## Earlier pass limitations (updated)

- Browser launch was blocked by the execution environment, and the separate preview browser could not reach the local server. Live playback, layout, GPU performance and authenticated two-player sessions were not verified. No real-device FPS improvement is claimed.
- The earlier missing Meadow simulation is implemented by this update; live multiplayer verification still requires a coordinated frontend/Worker deployment.
- Google accounts, friend-duel signaling and the Cloudflare Worker still require the deployment configuration described in the README. No external credentials or hosting changes are included.
- This is a targeted repair and polish pass, not a claim that every possible issue in the game is fixed.
