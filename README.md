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
- Invites are in-game notifications. The game checks while its tab is visible. Friend-duel results are agreed by both clients. The backend does not simulate the duel or adjudicate client cheating. Open Meadow retains its existing public-room combat behavior, with account gating, jump, appearance, and Atomic added.
