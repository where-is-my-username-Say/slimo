# Current Slimo release

Published to the existing `slimo-meadow` Worker on 18 November 2026 (Asia/Muscat). Updated browser entry: https://slimo-ten.vercel.app/api/slimo/play.

## Lighting

- Remove the decorative triangular beam mesh and its visibility controls.
- Integrate single-scattering sunlight using scene depth and the existing packed directional shadow map. Foreground depth stops the ray march; shadow samples block light. Use 12 samples on medium and 20 on high, a quarter-resolution target and depth-aware upsampling. Encode low-intensity light to preserve precision in the color target.
- Match the sky sun to the directional light, keep the sky centered on the camera, and move the shadow region with the player. Enable shadows on nearby instanced forest/solid landmark geometry. Reduce the old uniform haze slightly to balance the added scattering.
- Retain direct-light fallback for low quality, reduced motion and unsupported depth textures. Release old targets on resize and restore renderer state after each pass.

## Network

- Keep 20 Hz Meadow simulation and active snapshots. Send five snapshots per second when everyone is idle, while always sending a first snapshot immediately and reacting to gameplay events.
- Copy only player/projectile rows within 80 m into each recipient's snapshot, always retaining the local player and owned projectiles. Preserve protocol, byte layouts and per-client input ACKs. Remove models whose poses leave the interest set.
- Send unchanged stationary input as a 180 ms heartbeat, retaining normal movement cadence and immediate action sends. Avoid idle input replay in prediction.
- Bound input queues and reliable-input fallback so congestion cannot keep adding larger input packets behind delayed motion. Lower state queue thresholds where the runtime exposes buffered byte counts.
- Preserve measured room RTT. The existing Middle East location hint remains best effort. Latency from the user's network has not been measured after this release.

## Included previous repairs

- Authenticated room-scoped friend-duel relay, post-rotation join authorization, host confirmation before guest welcome, retryable invitations and safe guest replacement.
- Eight roguelike spell upgrades in the regular draft, with three ranks, existing move triggers, host simulation and visual effects. No independent spell HUD or mana bar.
- Four-times-larger Meadow, new landmarks/map navigation, safe-zone feedback and ring-only damage.
- Earlier audio fallbacks, optional synthesized cues, music retry/crossfade repair, mobile input/focus fixes and cached rendering/HUD work.

## Evidence

- `npm run check`: syntax, 198 unique HTML IDs, 14 ordered scripts and 18 audio files.
- `npm test`: 87 passing tests covering audio, controls, Worker/browser packets, idle and active cadence, spatial interest, queue limits, relay authorization/replacement, roguelike drafts/spells, map construction and effect/resource cleanup.
- Both sunlight shaders compile/link in Mesa OpenGL ES. Controlled rendering gives RGB-sum 45 for lit scattering, 0 for a blocked shadow map and 6 with closer foreground depth. This validates shader behavior, not phone appearance or frame rate.
- Wrangler dry-run bundles the Worker with all three existing Durable Object bindings.
- Production upload succeeded; read-back confirms all 15 asset hashes, removal of the beam mesh, integration of the volumetric renderer and network helpers, unchanged protocols (Meadow 4 / duel 7), and preserved account/Meadow/duel namespaces and secrets.
- The local browser could not launch in this environment. Real-device visuals and authenticated multi-phone performance remain to be checked.

Graphify was consulted during the earlier repair in `genghis-s-workspace` for `where-is-my-username-Say/slimo`. Its promoted graph was at `2c7501d625f9ce54370a3e2a8f9178dcb1fbb1cd`, older than these changes; it is not evidence that this release has been indexed. The current source and deployment read-back are authoritative for this update.
