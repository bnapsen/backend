# Multiplayer Town Builder (MVP)

A small multiplayer, tile-based town builder that you can host as:

- **Frontend**: static files (GitHub Pages-friendly)
- **Backend**: Node.js + Express + WebSocket (`ws`)

## File tree

```text
client/
  index.html
  style.css
  game.js
server/
  package.json
  server.js
  rooms.js
  data/
README.md
```

## Fast deploy (so the game "just works")

I added deployment config files in repo root:

- `render.yaml` (Blueprint deploy on Render)
- `railway.json` + `nixpacks.toml` (Railway deploy from repo root, runs `server/`)

### Render (recommended quickest)

1. Push this repo to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Select your repo; Render reads `render.yaml` automatically.
4. Deploy and copy URL, e.g. `https://town-builder-backend.onrender.com`.
5. Open `.../client/` and set server URL to:
   - `https://town-builder-backend.onrender.com` (client auto-converts to `wss://`)

### Railway

1. Create new project from GitHub repo.
2. Railway reads `railway.json` / `nixpacks.toml` and starts with `cd server && npm start`.
3. Copy public domain and paste it in client Server URL field.

> Note: Free tiers may sleep; first connect can take a few seconds.

## Local run

### 1) Start backend

```bash
cd server
npm install
npm start
```

Backend runs by default at `http://localhost:3000` and WebSocket URL is:

- `ws://localhost:3000`

### 2) Start frontend (static)

From repo root:

```bash
python3 -m http.server 8000
```

Open:

- `http://localhost:8000/client/`

Enter:

- Name: anything
- Room: `public` (or your own code)
- Server WS URL: `ws://localhost:3000`

Open two tabs to verify realtime sync.

## How to point client to deployed server

In the join popup there is a **Server WS URL** field.

- Local: `ws://localhost:3000`
- Production (TLS): `wss://your-backend-domain.com`

The client stores this in `localStorage` as `town_ws_url`.

The URL field accepts any of these:

- `wss://your-backend-domain.com`
- `https://your-backend-domain.com` (auto-converted to `wss://`)
- `your-backend-domain.com` (auto-converted based on page protocol)

You can also prefill via query string: `client/?server=wss://your-backend-domain.com`

## GitHub Pages for `/client`

### Option A: publish whole repo root

If your Pages site serves this repo root, visit:

- `https://<user>.github.io/<repo>/client/`

### Option B: publish just `client/`

If using a separate Pages repo, copy `client/*` into that repo and publish from root.

> Important: your backend must be deployed elsewhere and use `wss://`.

## Backend deployment notes (Render/Fly/Railway/VPS)

The backend is stateless except room save files under `server/data/*.json`.

### Required settings

- Start command: `npm start`
- Working directory: `server`
- Environment variable (optional): `PORT` (platform often injects this)

### Render/Railway/Fly generic flow

1. Create new web service from this repo.
2. Set service root/working dir to `server`.
3. Build/install: `npm install`
4. Start: `npm start`
5. Deploy and copy public URL.
6. In client join popup, set WS URL to `wss://<your-url>`.

### Persistence note

Many platforms have ephemeral disks. If container filesystem resets, room files may be lost.
For durable persistence, attach a volume (if supported) or swap to a database.

## Message schema used

- `join_room`: `{ type, name, room }`
- `welcome`: `{ type, yourId, room, map, players, resources, gridSize }`
- `place_building`: `{ type, x, y, buildingType }`
- `tile_update`: `{ type, x, y, tile }`
- `resources_update`: `{ type, resources }`
- `player_list`: `{ type, players }`
- `chat_send`: `{ type, text }`
- `chat_broadcast`: `{ type, name, text, ts }`
- `error`: `{ type, message }`

## Gameplay defaults

- Grid: `64x64`
- Start resources: `50 wood, 20 food, 10 gold`
- Buildings:
  - House: cost 10 wood, +0.2 gold/sec, +2 population
  - Farm: cost 10 wood, +1 food/sec
  - Sawmill: cost 20 wood, +2 wood/sec
  - Road: cost 1 wood

## Persistence

- Room state auto-saves every 10 seconds to `server/data/<room>.json`
- Room state also saves on SIGINT/SIGTERM shutdown
- Save/load errors are logged; server continues in-memory if disk fails
