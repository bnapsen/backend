#!/usr/bin/env node
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const WIDTH = 12;
const HEIGHT = 12;
const GOAL = 5;
const MAX_PLAYERS = 6;
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#f783ac', '#b197fc'];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sanitizeRoomCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function generateRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  const room = {
    code,
    width: WIDTH,
    height: HEIGHT,
    goal: GOAL,
    maxPlayers: MAX_PLAYERS,
    players: new Map(),
    star: { x: 0, y: 0 },
    winnerId: null,
    winnerName: null,
  };
  room.star = spawnStar(room);
  rooms.set(code, room);
  return room;
}

function roomState(code, mode) {
  const normalized = sanitizeRoomCode(code);
  if (mode === 'host') {
    const hostCode = normalized || generateRoomCode();
    return rooms.get(hostCode) || createRoom(hostCode);
  }

  if (!normalized || !rooms.has(normalized)) {
    return null;
  }
  return rooms.get(normalized);
}

function listPlayers(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    score: player.score,
    color: player.color,
  }));
}

function snapshot(room) {
  const players = listPlayers(room);
  const leader = players
    .slice()
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))[0] || null;

  return {
    roomCode: room.code,
    width: room.width,
    height: room.height,
    goal: room.goal,
    maxPlayers: room.maxPlayers,
    playerCount: players.length,
    leaderId: leader?.id || null,
    leaderName: leader?.name || null,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    star: room.star,
    players,
  };
}

function broadcastState(room) {
  const state = snapshot(room);
  for (const player of room.players.values()) {
    send(player.ws, { type: 'state', state });
  }
}

function listAllCells(room) {
  const cells = [];
  for (let y = 0; y < room.height; y += 1) {
    for (let x = 0; x < room.width; x += 1) {
      cells.push({ x, y });
    }
  }

  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = cells[index];
    cells[index] = cells[swapIndex];
    cells[swapIndex] = temp;
  }

  return cells;
}

function randomOpenCell(room) {
  const occupied = new Set(Array.from(room.players.values()).map((player) => `${player.x},${player.y}`));
  const cells = listAllCells(room);
  return cells.find((cell) => !occupied.has(`${cell.x},${cell.y}`)) || { x: 0, y: 0 };
}

function spawnStar(room) {
  return randomOpenCell(room);
}

function addPlayer(room, ws, rawName) {
  const name = String(rawName || 'Player').trim().slice(0, 18) || 'Player';
  const position = randomOpenCell(room);
  const player = {
    id: crypto.randomUUID(),
    name,
    x: position.x,
    y: position.y,
    score: 0,
    color: COLORS[room.players.size % COLORS.length],
    ws,
    roomCode: room.code,
  };
  room.players.set(player.id, player);
  return player;
}

function movePlayer(room, player, direction) {
  if (!player || room.winnerId) return;

  let nextX = player.x;
  let nextY = player.y;
  if (direction === 'up') nextY -= 1;
  if (direction === 'down') nextY += 1;
  if (direction === 'left') nextX -= 1;
  if (direction === 'right') nextX += 1;

  if (nextX < 0 || nextY < 0 || nextX >= room.width || nextY >= room.height) return;

  const occupied = Array.from(room.players.values()).some(
    (other) => other.id !== player.id && other.x === nextX && other.y === nextY
  );
  if (occupied) return;

  player.x = nextX;
  player.y = nextY;

  if (room.star.x === player.x && room.star.y === player.y) {
    player.score += 1;
    if (player.score >= room.goal) {
      room.winnerId = player.id;
      room.winnerName = player.name;
    } else {
      room.star = spawnStar(room);
    }
  }
}

function resetRoom(room) {
  room.winnerId = null;
  room.winnerName = null;

  const cells = listAllCells(room);
  let cursor = 0;
  for (const player of room.players.values()) {
    const nextCell = cells[cursor];
    cursor += 1;
    player.score = 0;
    player.x = nextCell.x;
    player.y = nextCell.y;
  }

  room.star = cells[cursor] || spawnStar(room);
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'star-sprint', rooms: rooms.size }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.meta = { roomCode: null, playerId: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const mode = msg.mode === 'join' ? 'join' : 'host';
      const room = roomState(msg.room, mode);

      if (!room) {
        send(ws, { type: 'error', message: 'That room does not exist yet. Ask the host to start it first.' });
        return;
      }

      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { type: 'error', message: 'That room is already full.' });
        return;
      }

      const player = addPlayer(room, ws, msg.name);
      ws.meta = { roomCode: room.code, playerId: player.id };
      send(ws, {
        type: 'welcome',
        roomCode: room.code,
        playerId: player.id,
        message: mode === 'host'
          ? 'Room created. Copy the invite link and send it to your second player.'
          : 'Joined room successfully. Race starts as soon as you move.',
        state: snapshot(room),
      });
      broadcastState(room);
      return;
    }

    if (!ws.meta.roomCode || !ws.meta.playerId) return;
    const room = rooms.get(ws.meta.roomCode);
    if (!room) return;
    const player = room.players.get(ws.meta.playerId);
    if (!player) return;

    if (msg.type === 'move') {
      movePlayer(room, player, String(msg.direction || ''));
      broadcastState(room);
      return;
    }

    if (msg.type === 'reset') {
      resetRoom(room);
      broadcastState(room);
    }
  });

  ws.on('close', () => {
    const { roomCode, playerId } = ws.meta;
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(playerId);
    if (!room.players.size) {
      rooms.delete(roomCode);
      return;
    }

    if (room.winnerId === playerId) {
      room.winnerId = null;
      room.winnerName = null;
    }

    broadcastState(room);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Star Sprint multiplayer server listening on http://${HOST}:${PORT}`);
});
