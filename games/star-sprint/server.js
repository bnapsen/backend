#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Chess = require('./chess-core.js');
const Backgammon = require('./backgammon-core.js');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const MAX_PLAYERS = 2;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['white', 'black'];
const rooms = new Map();
const GAME_DEFS = {
  chess: {
    id: 'chess',
    title: 'Neon Crown Chess',
    createGameState: () => Chess.createGameState(),
    cloneState: (game) => Chess.cloneState(game),
  },
  backgammon: {
    id: 'backgammon',
    title: 'Neon Backgammon Blitz',
    createGameState: () => Backgammon.createGameState(),
    cloneState: (game) => Backgammon.cloneState(game),
  },
};

function send(socket, payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function sendError(socket, message) {
  send(socket, {
    type: 'error',
    message,
  });
}

function sanitizeName(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  return value.slice(0, 18) || 'Guest';
}

function sanitizeRoomCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function normalizeGameType(raw) {
  return raw === 'backgammon' ? 'backgammon' : 'chess';
}

function generateRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code, gameType) {
  const gameDef = GAME_DEFS[gameType] || GAME_DEFS.chess;
  const room = {
    code,
    gameType: gameDef.id,
    gameDef,
    maxPlayers: MAX_PLAYERS,
    players: new Map(),
    game: gameDef.createGameState(),
  };
  rooms.set(code, room);
  return room;
}

function getRoomForJoin(code, mode, gameType) {
  const normalized = sanitizeRoomCode(code);

  if (mode === 'host') {
    const hostCode = normalized || generateRoomCode();
    const existing = rooms.get(hostCode);
    if (existing && existing.gameType !== gameType) {
      return {
        error: `That room code is already in use by ${existing.game.title}. Host again for a fresh code.`,
      };
    }
    return {
      room: existing || createRoom(hostCode, gameType),
    };
  }

  if (!normalized || !rooms.has(normalized)) {
    return {
      error: 'That room does not exist yet. Ask the host to start it first.',
    };
  }

  const room = rooms.get(normalized);
  if (room.gameType !== gameType) {
    return {
      error: `That room is running ${room.game.title}. Open the matching game to join it.`,
    };
  }
  return { room };
}

function getOpenColor(room) {
  const used = new Set(Array.from(room.players.values()).map((player) => player.color));
  return COLORS.find((color) => !used.has(color)) || null;
}

function listPlayers(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
  }));
}

function snapshot(room) {
  const game = room.gameDef.cloneState(room.game);
  return {
    ...game,
    roomCode: room.code,
    players: listPlayers(room),
    maxPlayers: room.maxPlayers,
    service: 'nova-arcade-realtime',
    gameType: room.gameType,
    title: room.game.title,
  };
}

function broadcastState(room, message) {
  const payload = {
    type: 'state',
    snapshot: snapshot(room),
  };
  if (message) {
    payload.message = message;
  }

  for (const player of room.players.values()) {
    send(player.socket, payload);
  }
}

function handleJoin(socket, payload) {
  const mode = payload && payload.mode === 'join' ? 'join' : 'host';
  const gameType = normalizeGameType(payload && payload.game);
  const lookup = getRoomForJoin(payload.roomCode, mode, gameType);
  if (lookup.error) {
    sendError(socket, lookup.error);
    return;
  }
  const room = lookup.room;

  if (room.players.size >= room.maxPlayers) {
    sendError(socket, 'That room is already full.');
    return;
  }

  const color = getOpenColor(room);
  if (!color) {
    sendError(socket, 'No seat is available in that room.');
    return;
  }

  const player = {
    id: crypto.randomUUID(),
    name: sanitizeName(payload.name),
    color,
    socket,
  };

  room.players.set(player.id, player);
  socket.playerId = player.id;
  socket.roomCode = room.code;

  send(socket, {
    type: 'welcome',
    playerId: player.id,
    roomCode: room.code,
    color: player.color,
    title: room.game.title,
    gameType: room.gameType,
  });

  const message = room.players.size === 1
    ? `${player.name} is ready. Share the invite to start playing.`
    : `${player.name} joined. Match ready.`;

  broadcastState(room, message);
}

function requirePlayer(socket) {
  const room = rooms.get(socket.roomCode);
  if (!room) {
    sendError(socket, 'Room not found.');
    return null;
  }

  const player = room.players.get(socket.playerId);
  if (!player) {
    sendError(socket, 'You are not seated in this room.');
    return null;
  }

  return { room, player };
}

function playerBackgammonSide(player) {
  return player.color === 'white' ? Backgammon.WHITE : Backgammon.BLACK;
}

function handleMove(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  let result;

  if (room.gameType === 'backgammon') {
    if (room.game.current !== playerBackgammonSide(player)) {
      sendError(socket, `It is ${Backgammon.playerName(room.game.current)}'s turn.`);
      return;
    }
    result = Backgammon.applyMove(room.game, {
      from: payload.from,
      to: payload.to,
      di: payload.di,
      die: payload.die,
    });
  } else {
    if (room.game.turn !== player.color) {
      sendError(socket, `It is ${room.game.turn}'s turn.`);
      return;
    }
    result = Chess.applyMove(room.game, {
      from: payload.from,
      to: payload.to,
      promotion: payload.promotion,
    });
  }

  if (!result.ok) {
    sendError(socket, result.error || 'That move could not be played.');
    return;
  }

  broadcastState(room);
}

function handleRoll(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'backgammon') {
    sendError(socket, 'Rolling dice is only used in backgammon rooms.');
    return;
  }

  if (room.game.current !== playerBackgammonSide(player)) {
    sendError(socket, `It is ${Backgammon.playerName(room.game.current)}'s turn.`);
    return;
  }

  const result = Backgammon.rollDice(room.game);
  if (!result.ok) {
    sendError(socket, result.error || 'The dice could not be rolled.');
    return;
  }

  broadcastState(room);
}

function handleRestart(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  room.game = room.gameDef.createGameState();
  broadcastState(room, `${player.name} reset the board.`);
}

function handleDisconnect(socket) {
  const roomCode = socket.roomCode;
  const playerId = socket.playerId;
  if (!roomCode || !playerId) {
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  const player = room.players.get(playerId);
  room.players.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  const message = player
    ? `${player.name} disconnected. The room stays open for a new opponent.`
    : 'A player disconnected.';
  broadcastState(room, message);
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      service: 'nova-arcade-realtime',
      games: Object.keys(GAME_DEFS),
      rooms: rooms.size,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  const body = JSON.stringify({
    ok: true,
    service: 'nova-arcade-realtime',
    games: Object.keys(GAME_DEFS),
    websocket: true,
  });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.on('message', (buffer) => {
    let payload;
    try {
      payload = JSON.parse(String(buffer));
    } catch (error) {
      sendError(socket, 'That message was not valid JSON.');
      return;
    }

    switch (payload.action) {
      case 'join':
        handleJoin(socket, payload);
        break;
      case 'roll':
        handleRoll(socket);
        break;
      case 'move':
        handleMove(socket, payload);
        break;
      case 'restart':
        handleRestart(socket);
        break;
      default:
        sendError(socket, 'Unknown action.');
        break;
    }
  });

  socket.on('close', () => {
    handleDisconnect(socket);
  });

  socket.on('error', () => {
    handleDisconnect(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Neon Crown Chess server running at ws://${HOST}:${PORT}`);
});
