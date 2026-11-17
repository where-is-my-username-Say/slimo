# Slimo

The game uses Vercel for the HTML and audio, a dedicated Cloudflare Worker named `slimo-meadow` for Google accounts and Open Meadow, and WebRTC for friend duels.

## Configure and deploy

1. In Google Cloud, configure Google Identity Services with a **Web application** OAuth client. Authorize the JavaScript origin `https://slimo-ten.vercel.app`. If the OAuth consent screen is in Testing, add the accounts that will play as test users, or publish the app.
2. From the extracted repo root, use one shell block. Wrangler prompts for authentication and each value as needed. Supply the Google **client ID** at the first secret prompt and the Gmail address that should be Owner at the second. Keep the Owner email out of public source. If your Cloudflare Workers subdomain differs from `balochnajool.workers.dev`, set the correct address in both `wrangler.jsonc` and `vercel.json` before deploying.

   ```sh
   npm install && npx wrangler login && npm run deploy:worker && npx wrangler secret put GOOGLE_CLIENT_ID && npx wrangler secret put OWNER_EMAIL
   ```

3. Copy the extracted files into the root of the **slimo** repo and deploy to the existing Vercel project with the Other preset. The API rewrite in `vercel.json` carries the session cookies through the same game origin. Keep this project pointed at the dedicated Worker, separate from Slimeoo's backend.
4. Sign in with two authorized Google accounts. Claim a unique username for each, add the other username under Friends, then have the host start Friend duel and invite that friend from the in-game Friends panel. The recipient can join from their notification. Open Meadow is separate from friend duels. Check that the host and guest both see the countdown, hits and finisher, then play an entire match against the Owner to check the achievement.

## Controls

- **F** or **Jump** jumps. Hold and release **E**, right-click, or **Spit** to charge in a duel. At full charge the shot homes in and goes through cover. Dodge timing or a timed slap can stop it.
- Black-and-white anime impact frames play on combo hits and finishers. Reduced motion disables the frames. Cinematic mode cycles through **Backstep**, **Skyhook**, and **Whirlwind** before the knockout ragdoll. Reduced motion skips these finishes and reduces Atomic’s particle effects.
- The Owner has a gold aura, Wave in duels, and Atomic. A player who wins a completed duel against the Owner unlocks Atomic after both signed-in clients confirm the result. **X** or the **Atomic** button starts a silent 16-second aura around the caster while play continues.
- Invites are in-game notifications. The game checks while its tab is visible. Friend-duel results are agreed by both clients. The backend does not simulate the duel or adjudicate client cheating. Open Meadow uses the Worker-authoritative combat and ring rules described below.

## Expanded Meadow and spells

The walking map is twice as wide and twice as deep (four times the area). Explore Crystal Grove, Sunken Ruins, Whisper Lake and Lantern Hollow along the new paths. Use **M** or the **Map** button for landmarks, nearby players and directions back to the ring.

Meadow has eight spells, each with three upgrade ranks: **Earthwake Wall**, **Ember Fault**, **Frost Bloom**, **Storm Coil**, **Gale Vortex**, **Pebble Barrage**, **Mending Spring** and **Starfall**. Earthwake raises animated stone blocks; inside the ring these block players and ordinary projectiles until they sink away. Other spells have distinct telegraphs, projectiles, particles or impact effects. Spells cost mana and have individual cooldowns. Mana regenerates automatically.

Use **1–8** or tap a spell slot. Open **Upgrade** outside the ring to allocate up to **18 build points** across passives and spells. Existing saved builds are retained; choose the **Spell starter** room preset to try all eight spells. Spell slots show learned ranks, mana and cooldown state. These new spells belong to Open Meadow; friend duels and practice retain their original moves and build selection.

Slaps and spits work throughout Meadow with sound, impact effects and playful text. Outside the ring they cause no damage, knockback, burn or slow. An attack must start inside the ring, and both its caster and target must still be inside when damage resolves. Entering the ring cannot arm a shot launched outside. Leaving clears lingering damage and slows. Spells outside are visual only, including walls and healing. Knocked-out players respawn at the safe spawn after a short delay.

### Deploy the frontend and Worker together

This update changes Meadow's network protocol to **4** and adds shared modules imported by the Worker. Deploy the entire extracted source, including all `slimo-*.js` files, then deploy the Worker with `npm run deploy:worker`. Deploy the frontend and Worker in the same maintenance window; older clients must reload. Updating only the HTML will not enable the new combat or spells. Existing Durable Object bindings and account secrets are retained; no new migration is required.

## Sound

Tap **Sound on/off** in the lobby or duel controls for a quick mute. In **Settings**, use **Test sound** and the separate Master, Music and Combat sliders. Charge, Nova-ready and low-health alerts can be switched off separately.

New jump, charge, healing, combo, result and interface cues are synthesized locally. Existing recorded effects are retained, with short synthesized fallbacks while samples download or if a download fails. Music crossfades between the existing tracks; blocked playback retries with backoff and can be retried immediately with a tap. Mobile browsers still require an initial interaction.

## Development and checks

Use Node.js 24 or newer. The regression checks require no dependency install:

```sh
npm run check
npm test
```

For a local preview, `npm run dev` requires Python 3 and serves at `http://127.0.0.1:8765`. Static serving does not provide the production account API or Cloudflare room service. Test signed-in multiplayer on the configured deployment with two accounts.

`slimo-game.js` contains the previously inline game code, making gameplay functions visible to JavaScript indexing tools such as Graphify. `slimo-audio-files.js` maps recorded assets; `slimo-audio-synth.js` contains original procedural sound definitions. The existing Three.js r128 and PeerJS 1.5.5 bundles are unchanged under `vendor/`. Their versioned filenames are immutable cache keys: use a new filename for a future library update.

See `CHANGES.md` for verified changes and remaining limitations. The slime model and friend-duel combat are preserved; public Meadow now has its own server-authoritative combat engine.
