#!/usr/bin/env node
'use strict';

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8081);
const WIDTH = 12;
const HEIGHT = 12;
const GOAL = 5;
const MAX_PLAYERS = 6;
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#f783ac', '#b197fc'];
const rooms = new Map();

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function roomState(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      width: WIDTH,
      height: HEIGHT,
      goal: GOAL,
      players: new Map(),
      star: { x: 0, y: 0 },
      winnerId: null,
      winnerName: null,
    });
    rooms.get(code).star = spawnStar(rooms.get(code));
  }
  return rooms.get(code);
}

function sanitizeRoomCode(raw) {
  return String(raw || 'PUBLIC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PUBLIC';
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
  return {
    roomCode: room.code,
    width: room.width,
    height: room.height,
    goal: room.goal,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    star: room.star,
    players: listPlayers(room),
  };
}

function broadcastState(room) {
  const state = snapshot(room);
  for (const player of room.players.values()) {
    send(player.ws, { type: 'state', state });
  }
}

function randomOpenCell(room) {
  while (true) {
    const x = Math.floor(Math.random() * room.width);
    const y = Math.floor(Math.random() * room.height);
    const occupied = Array.from(room.players.values()).some((player) => player.x === x && player.y === y);
    if (!occupied) return { x, y };
  }
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

  const occupied = Array.from(room.players.values()).some((other) => other.id !== player.id && other.x === nextX && other.y === nextY);
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
  const used = new Set();

  for (const player of room.players.values()) {
    player.score = 0;
    let position = null;
    do {
      position = randomOpenCell(room);
    } while (used.has(`${position.x},${position.y}`));

    used.add(`${position.x},${position.y}`);
    player.x = position.x;
    player.y = position.y;
  }

  room.star = spawnStar(room);
}

const wss = new WebSocketServer({ port: PORT });

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
      const room = roomState(sanitizeRoomCode(msg.room));
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
        message: msg.mode === 'host' ? 'Room created. Share the code and start racing.' : 'Joined room successfully.',
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
    if (room.players.size === 0) {
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

console.log(`Star Sprint multiplayer server listening on :${PORT}`);

