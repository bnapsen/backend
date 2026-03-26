# Car Soccer Mini - Turbo Arena Live

Car Soccer Mini now runs on the shared Nova Arcade realtime backend, just like chess, backgammon, blackjack, poker, mini pool, and the co-op shooter.

## What changed

- Shared backend room hosting and joining
- Invite links and room codes
- Arcade Lounge sharing
- Solo mode against Turbo Bot
- Better arena HUD, roster cards, event feed, and touch-friendly controls
- Boost pads, overtime, and cleaner kickoff flow

## Local development

Run the shared realtime backend:

```bash
cd games/star-sprint
npm install
npm start
```

Then serve the site from the repo root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/games/car-soccer-mini/
```

For local testing, the page will use `ws://127.0.0.1:8081` by default when loaded from `localhost`.
