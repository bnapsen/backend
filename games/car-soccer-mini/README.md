# Car Soccer Mini

Car Soccer Mini is a lightweight 2D top-down browser game inspired by Rocket League.

## How to play
- Score by sending the ball fully through the opponent goal mouth.
- Win by reaching **5 goals** first, or by having more goals when the **3:00** match timer ends.
- Press **P** to pause and open options.

## Controls
- **P1 movement:** `W A S D`
- **Boost:** `Shift` (consumes boost, auto-regenerates)
- **Drift / handbrake:** `Space`
- **Reset kickoff positions:** `R`
- **Pause:** `P`

Touch devices show on-screen controls automatically.

## Settings (saved in LocalStorage)
- Graphics quality: High / Low (particle effects)
- Volume
- Fullscreen preference

## Run locally
Because this game is static HTML/CSS/JS, you can run from any simple static server:

```bash
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000/games/car-soccer-mini/
```

## Files
- `index.html` – canvas container and UI
- `style.css` – HUD/menu/touch controls styling
- `game.js` – game loop, physics, AI, rendering, input, settings


## Multiplayer backend (new)
This project now includes a lightweight Node.js WebSocket backend that supports two players over the internet.

### Server setup
```bash
cd games/car-soccer-mini
npm install
npm start
```
By default it listens on `ws://localhost:8080` (override with `PORT=9000 npm start`).

### Connect clients
You now have two ways to connect online players:

1. **In-game menu (recommended):**
   - Press `P`, open **Online Multiplayer**, enter a room code, and click **Host** (player 1) or **Join** (player 2).
   - Use **Copy Invite** to share a ready-to-open guest URL.
2. **Direct URL query params:**

- Host:
  - `http://localhost:8000/games/car-soccer-mini/?mp=1&role=host&room=ABC&server=ws://localhost:8080`
- Guest:
  - `http://localhost:8000/games/car-soccer-mini/?mp=1&role=guest&room=ABC&server=ws://localhost:8080`


### Internet deployment tips
- Use `wss://` in production (TLS-enabled reverse proxy) so browsers on HTTPS pages can connect.
- Open/forward your multiplayer server port (default `8080`) or proxy `/ws` to the Node process.
- A room now enforces roles strictly:
  - **Host** must create the room first.
  - **Guest** can only join when a host is already online.
- Server includes heartbeat ping/pong to drop dead sockets faster and recover reconnects sooner.

### Notes
- Host runs the authoritative simulation.
- Guest sends controls and receives state snapshots.
- If network drops, gameplay falls back to local bot behavior until reconnection.
