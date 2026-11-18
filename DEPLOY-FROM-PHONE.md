# Deploy future Slimo updates from your phone

The current release is already deployed. Play at **https://slimo-ten.vercel.app/api/slimo/play**; no deployment setup is required to use it. The steps below are for future updates.


The website and multiplayer server deploy separately. The live website was confirmed to contain the expanded Meadow client with **protocol 4**. The server rejected its join; its exact live version could not be read from this environment. Changing a protocol number to bypass the check would corrupt the packet layout and would not add missing server combat.

This release requires **Meadow 4** and **friend duel 7** on the server. It includes the friend-duel connection repair, the expanded map and spells, and the earlier audio fixes.

## Deploy using GitHub in your phone browser

1. Commit the complete files from this ZIP to your Slimo repository’s default branch (usually `main`), preserving their paths. Include `wrangler.jsonc`, all JavaScript modules, and `.github/workflows/deploy-worker.yml`. Existing deployment credentials do not belong in the uploaded source.
2. In Cloudflare, create an API token using **Edit Cloudflare Workers**, scoped to your existing Slimo account. Copy your Cloudflare **Account ID**.
3. In GitHub, open the repository's **Settings → Secrets and variables → Actions**. Add repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use your browser's Desktop site view if these controls are hidden. Put the token in the secret field, not a code file or chat message.
4. Open **Actions → Deploy Slimo Worker → Run workflow**, select the branch containing this release, then run it. The workflow checks the source, runs tests, deploys the matching modules and v2 migration, and checks the deployed protocol versions. It runs only when you press Run workflow.
5. Deploy the same frontend files to your existing Vercel project. If your Vercel project deploys from this repository automatically, wait for that deployment to complete.
6. Reload the game on **both phones**, open a new friend-duel room and send a fresh invitation.

The Worker deployment must target the existing `slimo-meadow` Worker and account, keeping `GOOGLE_CLIENT_ID`, `OWNER_EMAIL`, and the existing `GAME_ROOM` / `ACCOUNTS` bindings. The configuration adds `DUEL_RELAY` and its v2 migration; do not delete the v1 migration. Do not paste just `worker.js` into a dashboard editor: it imports other source modules that must be deployed with it.

If you already use Cloudflare's Git integration, deploying this same source and `wrangler.jsonc` through that setup is also sufficient; you do not need to configure a second deployment system.

## Confirm the versions

A successful workflow ends with **Worker verified: Meadow 4; friend duel 7.** The public Worker `/health` endpoint reports `protocol: 4` and `duelProtocol: 7`. The account `/api/slimo/config` response also reports these versions. The game now checks Meadow compatibility before connecting and tells you whether to update the Worker or reload an older browser client.

The connected Cloudflare account was used to deploy the current Worker and matching browser client. Existing account secrets and Durable Object namespaces were preserved. GitHub write access was unavailable, so this source package must still be committed to the repository for future automated deployments. Live two-player and phone performance verification remains necessary.

Cloudflare's official setup reference: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
