# Slimeoo Cloudflare multiplayer backend

Files: `worker.js` and `wrangler.jsonc` go at the root of the `slimeoo` GitHub repository on the `main` branch.

Deploy from Cloudflare Builds using `npx wrangler deploy` with the repository root as working directory. This must deploy the Wrangler configuration (including the SQLite Durable Object migration); saving the Worker through the browser editor alone is insufficient for first-time namespace creation.

Tests:
- `https://slimeoo-multiplayer.<your-subdomain>.workers.dev/health` => JSON `ok: true`.
- `https://slimeoo-multiplayer.<your-subdomain>.workers.dev/room/TEST123` => JSON `ok: true`, `players: 0`, `maxPlayers: 50`.
- `wss://slimeoo-multiplayer.<your-subdomain>.workers.dev/room/TEST123` => WebSocket, welcome message.

WebSocket client messages:
- `{ "type": "name", "name": "My slime" }`
- `{ "type": "state", "seq": 1, "x": 0, "y": 0, "z": 0, "yaw": 0 }` (increment seq)
- `{ "type": "action", "action": "slap" }` (or spit/dodge/emote)
- `{ "type": "ping", "at": 123456789 }`

This is a prototype relay backend, not an authoritative physics/combat simulation. Existing Slimeoo `index.html` PeerJS networking needs to be replaced or adapted before multiplayer works through Cloudflare. Test two clients before scaling to 50.
