# Upload the flat Slimo game from your phone

Extract `slimo-complete-flat.zip`. Open its `slimo` folder: every included file is directly inside it. Upload the CONTENTS to the root of your existing GitHub Slimo repository, beside `index.html`. Do not upload the outer `slimo` folder as another nested directory.

Replace the existing files when asked. GitHub uploads do not remove old folders automatically: delete the old `scripts`, `tests`, and `vendor` folders after uploading, and remove the old `.github/workflows/deploy-worker.yml` workflow, which uses the previous folder layout. This flat package does not need those folders. Do not upload credentials or `node_modules`.

## Website

Keep your existing Vercel GitHub deployment. The static game, Three.js, PeerJS and all MP3s are at the repository root. The supplied `vercel.json` forwards `/api/slimo/*` to your existing Cloudflare Worker. Uploading the files updates the website when Vercel finishes deploying.

The current jump-combat release is already installed on the existing Worker; the following server steps apply to future source changes.

## Multiplayer server and matching hosted client

The server must also deploy. A GitHub upload alone does not deploy a Worker unless Cloudflare is already connected to that repository.

If Cloudflare Workers Builds is already connected to your repository, use build command `npm ci && npm run check && npm test && npm run build:live-client` and deploy command `npm run deploy:worker`. Use the existing `slimo-meadow` Worker and account. Otherwise deploy this source with Node.js 24+ using:

```sh
npm ci
npm run check
npm test
npm run deploy:worker
npm run verify:worker
```

The deploy command rebuilds `slimo-live-client.generated.js` automatically. A current generated copy is also included; edit the original source files rather than that generated file.

The config sets `keep_vars: true` so future Wrangler deployments retain dashboard variables. Preserve existing `GOOGLE_CLIENT_ID`, `OWNER_EMAIL`, `GAME_ROOM`, `ACCOUNTS` and `DUEL_RELAY` settings and namespaces. Keep the v1 and v2 migrations in `wrangler.jsonc`. Never paste just `worker.js` into the dashboard: it imports other supplied modules. Do not change protocol numbers to bypass a mismatch.

Both phones must reload the same version and use a fresh friend-duel invitation. Meadow protocol is 5; friend-duel protocol is 8. Atomic uses the existing authenticated cast events; the server validates casts, and each phone draws the animation locally.

Play the matching Worker-hosted version through your Vercel site at https://slimo-ten.vercel.app/api/slimo/play after deploying both sides.
