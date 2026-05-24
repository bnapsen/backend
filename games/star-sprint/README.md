# Neon Crown Chess

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bnapsen/backend)

Neon Crown Chess is a browser chess game for AP Advantage Player with:

- real chess rules
- room-based online multiplayer over WebSockets
- copy-and-share invite links
- solo practice against a lightweight bot

## Frontend

The public game page is served statically from `games/star-sprint/`.

## Backend

```bash
npm install
npm start
```

The multiplayer backend listens on port `8081` by default and respects the `PORT` environment variable in production.

Health check:

```text
GET /healthz
```

## ScrapRunner Online

This backend also serves the realtime rooms and SIM economy APIs for
`/scraprunner-online.html`.

HTTP API:

- `GET /api/scraprunner/profile` - signed-in profile, wallet, zones, upgrades, missions, achievements
- `POST /api/scraprunner/upgrade` - spend SIM on a persistent upgrade
- `POST /api/scraprunner/unlock-zone` - spend SIM to unlock a harder zone
- `POST /api/scraprunner/daily` - claim the daily SIM reward and streak
- `POST /api/scraprunner/mission-claim` - claim a completed daily mission
- `GET /api/scraprunner/leaderboard` - top extracted runs

WebSocket game type:

- `join_room` with `{ "game": "scraprunner", "authToken": "...", "zoneId": "rust-yard" }`
- `input` with movement, aiming, firing, and boost state
- `extract` when the player reaches the extraction ring

The client never submits SIM rewards. The server owns the room simulation,
calculates rewards from authoritative scrap/kills/time values, clamps payout,
and writes the SIM wallet transaction after a valid extraction.

Environment starter:

```bash
cp .env.example .env
```

Set `NOVA_AUTH_REQUIRED=false` in `.env` for memory-backed local testing without
Firebase. Keep the production default `NOVA_AUTH_REQUIRED=true` and set the
Firebase/Google Cloud values so AP account sign-in, Firestore profiles, and SIM
wallet credits persist across deploys.

## Deploy notes

- Public page path: `/games/star-sprint/`
- Backend root directory: `games/star-sprint`
- Render service name: `backend`
- Render blueprint lives at the repo root in `render.yaml`
- Production WebSocket URL is configured in `game.js`
- City Raid lobby API path: `/api/cityraid/lobbies`
- AP Jukebox uploads should use a persistent disk-backed `DATA_DIR` on Render so songs survive restarts and deploys
