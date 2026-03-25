# Star Sprint

Star Sprint is a lightweight multiplayer browser game with a PowerShell backend. One player creates a room, shares the code, and everyone races to collect stars on the board.

## What it includes

- Browser UI for creating and joining rooms
- In-memory multiplayer game state
- Shared game board with score tracking
- Zero external dependencies
- Docker deployment support for cloud hosting

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
4. After deploy, open your public `onrender.com` URL and share it.

## How to play

- Create a room in the first browser tab
- Join that room from another tab, another browser, or another device once deployed
- Move with arrow keys or `W`, `A`, `S`, `D`
- First player to collect 5 stars wins the round

## Notes

- The game state lives in memory, so rooms reset when the server stops
- This is a simple starter project and a good base for adding chat, matchmaking, bots, persistence, or better realtime transport later
