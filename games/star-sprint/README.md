# Neon Crown Chess

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bnapsen/backend)

Neon Crown Chess is a browser chess game for Nova Arcade with:

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

## Deploy notes

- Public page path: `/games/star-sprint/`
- Backend root directory: `games/star-sprint`
- Render blueprint lives at the repo root in `render.yaml`
- Production WebSocket URL is configured in `game.js`
