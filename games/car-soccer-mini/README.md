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
