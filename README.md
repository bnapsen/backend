# backend

This repo now includes a minimal multiplayer backend for `games/car-soccer-mini`.

## Car Soccer Mini backend quick start
```bash
cd games/car-soccer-mini
npm install
npm start
```

Then run a static server from repo root:
```bash
python3 -m http.server 8000
```

Open two clients with matching room codes:
- Host: `http://localhost:8000/games/car-soccer-mini/?mp=1&role=host&room=ABC&server=ws://localhost:8080`
- Guest: `http://localhost:8000/games/car-soccer-mini/?mp=1&role=guest&room=ABC&server=ws://localhost:8080`
