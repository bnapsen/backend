# Star Sprint

Star Sprint is a lightweight multiplayer browser game with a PowerShell backend. One player creates a room, shares the code, and everyone races to collect stars on the board.

## What it includes

- Browser UI for creating and joining rooms
- In-memory multiplayer game state
- Shared game board with score tracking
- Zero external dependencies
- Docker deployment support for cloud hosting
- A read-only Kalshi Weather Lab research dashboard

## Run locally

From this folder, launch:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

Then open [http://localhost:8080](http://localhost:8080) in one or more browser windows.

If you want the easiest option on Windows, double-click `start-game.bat` or run:

```powershell
.\start-game.bat
```

That opens a dedicated server window and then opens the game in your browser.

## Security defaults

The server now ships with safer defaults for public hosting:

- CORS is limited to `localhost`, `bnapsen.com`, `www.bnapsen.com`, and `*.github.io`
- Request bodies are capped at `65536` bytes unless you raise `MAX_REQUEST_BODY_BYTES`
- Internal exception details stay server-side unless `DEBUG_ERRORS=true`
- The `/etrade-api` proxy is **localhost-only by default**
- The Kalshi Weather Lab API can be protected with `KALSHI_LAB_TOKEN`

Environment variables you can use:

- `ALLOWED_ORIGINS`
  Comma-separated origin allowlist for browser clients.
- `MAX_REQUEST_BODY_BYTES`
  Maximum accepted request size in bytes. Defaults to `65536`.
- `DEBUG_ERRORS`
  Set to `true` only when you intentionally want detailed server errors in responses.
- `ETRADE_BRIDGE_URL`
  Base URL for the local bridge service. Defaults to `http://127.0.0.1:8765`.
- `ENABLE_PUBLIC_ETRADE_PROXY`
  Set to `true` only if you intentionally want remote access to `/etrade-api`.
- `ETRADE_PROXY_TOKEN`
  Optional extra protection for the E*TRADE proxy. When set, clients must send it in the `X-ETrade-Proxy-Token` header.
- `KALSHI_LAB_TOKEN`
  Optional protection for `/api/kalshi/weather/*`. When set, the Weather Lab page must send it in the access field.

## Publish to GitHub

Create an empty GitHub repository, then run:

```powershell
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

If you already created a remote for this repo, skip the `git remote add origin ...` step.

## Deploy on Render

This repo includes a `Dockerfile` and `render.yaml`, so you can deploy it as a Docker-based web service.

1. Push the repo to GitHub.
2. In Render, create a new Blueprint or Web Service from that GitHub repo.
3. Render should detect `render.yaml` and deploy the app.
4. After deploy, set any production env vars you need, especially `ALLOWED_ORIGINS`.
5. Keep `ENABLE_PUBLIC_ETRADE_PROXY` unset unless you are intentionally exposing the trading bridge.
6. After deploy, open your public `onrender.com` URL and share it.

## Serve the Frontend from GitHub Pages

If you want GitHub Pages to serve the browser UI while Render keeps the live game API:

1. Keep the backend deployed on Render.
2. Point `api.bnapsen.com` at your Render service.
3. Let GitHub Pages publish the `public/` directory using `.github/workflows/deploy-pages.yml`.
4. In your repository settings, configure the GitHub Pages custom domain as `bnapsen.com`.
5. Point `bnapsen.com` and `www.bnapsen.com` at GitHub Pages instead of Render.

The frontend in `public/app.js` automatically uses `https://api.bnapsen.com` when it is served from `bnapsen.com`, `www.bnapsen.com`, or a `github.io` Pages URL. Local development and Render-hosted same-origin mode still keep using relative `/api/*` requests.

## How to play

- Create a room in the first browser tab
- Join that room from another tab, another browser, or another device once deployed
- Move with arrow keys or `W`, `A`, `S`, `D`
- First player to collect 5 stars wins the round

## Notes

- The game state lives in memory, so rooms reset when the server stops
- This is a simple starter project and a good base for adding chat, matchmaking, bots, persistence, or better realtime transport later
