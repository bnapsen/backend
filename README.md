# Multiplayer Town Builder (MVP)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bnapsen/backend)

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

### No backend? Use solo mode

If you just want to play locally without any server setup:

1. Serve static files from repo root: `python3 -m http.server 8000`
2. Open `http://localhost:8000/client/`
3. Enter any name, then click **Play Solo (No Server)**

Solo mode keeps the same building/resource rules in-browser so the game works even when WebSocket/backend is unavailable.

## How to point client to deployed server

In the join popup there is a **Server WS URL** field.

- Local: `ws://localhost:3000`
- Production (TLS): `wss://your-backend-domain.com`

The client stores this in `localStorage` as `town_ws_url`.

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

## Star Sprint backend

The Star Sprint multiplayer backend lives in `games/star-sprint/` and the repo root now includes a `render.yaml` that can create a Render web service for it.

Recommended production flow:

1. Create a Render Blueprint from this GitHub repo.
2. Let Render create the `star-sprint-backend` web service from `games/star-sprint/`.
3. Use the resulting `wss://...onrender.com` URL in the Star Sprint page.
4. Optionally add a custom domain such as `starsprint-api.classiccarcollectorshub.com`.

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

## Enhanced gameplay (client-side update)

The town builder now includes a richer in-browser simulation and visuals:

- Hand-drawn style building rendering on the canvas (houses, farms, roads, sawmills)
- New **Happiness** stat based on your layout (roads + connected neighborhoods + balanced industry)
- **Mayor Goals** checklist to provide progression milestones
- Tile inspector panel for better planning while hovering the map
- Solo mode economy depth: farm synergy and happiness-based tax efficiency

Controls remain the same:

- Left click to place selected building
- Shift+drag or middle mouse drag to pan
- Mouse wheel to zoom
