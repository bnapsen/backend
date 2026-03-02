const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const {
  GRID_SIZE,
  getOrCreateRoom,
  addPlayer,
  removePlayer,
  placeBuilding,
  getPlayerResources,
  listPlayers,
  broadcast,
  cleanupAllRooms
} = require('./rooms');

const PORT = process.env.PORT || 3000;
const app = express();
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'multiplayer-town-builder', gridSize: GRID_SIZE });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function sendSafe(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function parseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isString(v, max = 100) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

wss.on('connection', (ws) => {
  const player = {
    id: crypto.randomUUID(),
    name: '',
    roomCode: '',
    room: null,
    socket: ws,
    placeTimestamps: [],
    send: (payload) => sendSafe(ws, payload)
  };

  ws.on('message', (raw) => {
    const msg = parseJSON(raw.toString());
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'join_room') {
      if (!isString(msg.name, 24) || !isString(msg.room || 'public', 40)) {
        return player.send({ type: 'error', message: 'Invalid name or room.' });
      }

      player.name = msg.name.trim();
      player.roomCode = (msg.room || 'public').trim().toLowerCase();
      player.room = getOrCreateRoom(player.roomCode);
      addPlayer(player.room, player);

      player.send({
        type: 'welcome',
        yourId: player.id,
        room: player.roomCode,
        map: player.room.map,
        players: listPlayers(player.room),
        resources: getPlayerResources(player.room, player.id),
        gridSize: player.room.gridSize
      });

      broadcast(player.room, { type: 'player_list', players: listPlayers(player.room) });
      return;
    }

    if (!player.room) return;

    if (msg.type === 'place_building') {
      const { x, y, buildingType } = msg;
      const now = Date.now();
      player.placeTimestamps = player.placeTimestamps.filter((t) => now - t < 1000);
      if (player.placeTimestamps.length >= 5) {
        return player.send({ type: 'error', message: 'Rate limit: max 5 placements/sec.' });
      }
      player.placeTimestamps.push(now);

      const result = placeBuilding(player.room, player.id, x, y, buildingType);
      if (!result.ok) {
        return player.send({ type: 'error', message: result.error });
      }

      broadcast(player.room, { type: 'tile_update', x, y, tile: result.tile });
      player.send({ type: 'resources_update', resources: result.resources });
      return;
    }

    if (msg.type === 'chat_send') {
      if (!isString(msg.text, 240)) return;
      broadcast(player.room, {
        type: 'chat_broadcast',
        name: player.name,
        text: msg.text,
        ts: Date.now()
      });
    }
  });

  ws.on('close', () => {
    if (!player.room) return;
    removePlayer(player.room, player.id);
    broadcast(player.room, { type: 'player_list', players: listPlayers(player.room) });
  });
});

process.on('SIGINT', () => {
  cleanupAllRooms();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupAllRooms();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
