# Star Sprint

Star Sprint is a room-based multiplayer browser game for Nova Arcade. Players join the same room, move across a shared grid, and race to collect five stars before anyone else.

## Run the frontend

The game page is served as static files from `games/star-sprint/`.

## Run the multiplayer server

```bash
npm install
npm start
```

By default the WebSocket server listens on port `8081`. In production you can override that with the `PORT` environment variable.

## Deploy notes

- Frontend path: `/games/star-sprint/`
- WebSocket backend: separate Node process or service
- Update the in-game server URL field to match your deployed `wss://` endpoint if needed

