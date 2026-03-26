#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Chess = require('./chess-core.js');
const Backgammon = require('./backgammon-core.js');
const Shooter = require('./space-shooter-core.js');
const Poker = require('./poker-core.js');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const DEFAULT_MAX_PLAYERS = 2;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['white', 'black'];
const TICK_MS = 50;
const rooms = new Map();
const CHESS_TIME_CONTROLS = Object.freeze({
  untimed: {
    id: 'untimed',
    label: 'Untimed',
    shortLabel: 'No clock',
    baseMs: 0,
    incrementMs: 0,
    summary: 'No countdown clock. Good for relaxed games and testing.',
  },
  '1m': {
    id: '1m',
    label: '1 minute bullet',
    shortLabel: '1+0',
    baseMs: 60 * 1000,
    incrementMs: 0,
    summary: 'Fast bullet chess with almost no think time.',
  },
  '2m': {
    id: '2m',
    label: '2 minute sprint',
    shortLabel: '2+0',
    baseMs: 2 * 60 * 1000,
    incrementMs: 0,
    summary: 'Quick sprint games where both players need to move with intent.',
  },
  '3m': {
    id: '3m',
    label: '3 minute blitz',
    shortLabel: '3+0',
    baseMs: 3 * 60 * 1000,
    incrementMs: 0,
    summary: 'Classic blitz pressure with just enough time for tactics.',
  },
  '5m': {
    id: '5m',
    label: '5 minute blitz',
    shortLabel: '5+0',
    baseMs: 5 * 60 * 1000,
    incrementMs: 0,
    summary: 'A balanced blitz preset for most fast online games.',
  },
  '10m': {
    id: '10m',
    label: '10 minute rapid',
    shortLabel: '10+0',
    baseMs: 10 * 60 * 1000,
    incrementMs: 0,
    summary: 'A calmer rapid game with room for longer plans.',
  },
});
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
  'space-shooter': {
    id: 'space-shooter',
    title: 'Starline Defense Co-Op',
    maxPlayers: 2,
    createGameState: () => Shooter.createGameState(),
    cloneState: (game) => Shooter.cloneState(game),
  },
  poker: {
    id: 'poker',
    title: 'Orbit Holdem Live',
    maxPlayers: 5,
    createGameState: () => Poker.createGameState(),
    cloneState: (game, viewerId) => Poker.cloneState(game, viewerId),
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
  if (raw === 'backgammon') {
    return 'backgammon';
  }
  if (raw === 'poker') {
    return 'poker';
  }
  if (raw === 'space-shooter') {
    return 'space-shooter';
  }
  return 'chess';
}

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

function normalizeChessTimeControlPreset(raw) {
  const value = String(raw || '').trim();
  return CHESS_TIME_CONTROLS[value] ? value : 'untimed';
}

function chessTimeControlProfile(raw) {
  return CHESS_TIME_CONTROLS[normalizeChessTimeControlPreset(raw)];
}

function createChessClock(presetId) {
  const profile = chessTimeControlProfile(presetId);
  return {
    enabled: profile.baseMs > 0,
    presetId: profile.id,
    label: profile.label,
    shortLabel: profile.shortLabel,
    summary: profile.summary,
    baseMs: profile.baseMs,
    incrementMs: profile.incrementMs,
    remainingMs: {
      white: profile.baseMs,
      black: profile.baseMs,
    },
    runningColor: null,
    lastStartedAt: 0,
  };
}

function syncChessClock(room, now) {
  if (
    !room ||
    room.gameType !== 'chess' ||
    !room.clock ||
    !room.clock.enabled ||
    !room.clock.runningColor ||
    !room.clock.lastStartedAt
  ) {
    return false;
  }

  const elapsed = Math.max(0, now - room.clock.lastStartedAt);
  if (!elapsed) {
    return false;
  }

  const activeColor = room.clock.runningColor;
  room.clock.remainingMs[activeColor] = Math.max(0, room.clock.remainingMs[activeColor] - elapsed);
  room.clock.lastStartedAt = now;
  return true;
}

function pauseChessClock(room, now) {
  if (!room || room.gameType !== 'chess' || !room.clock) {
    return;
  }
  syncChessClock(room, now);
  room.clock.runningColor = null;
  room.clock.lastStartedAt = 0;
}

function refreshChessClockTurn(room, now) {
  if (!room || room.gameType !== 'chess' || !room.clock) {
    return;
  }
  if (!room.clock.enabled) {
    room.clock.runningColor = null;
    room.clock.lastStartedAt = 0;
    return;
  }
  syncChessClock(room, now);
  if (room.players.size < 2 || room.game.winner || room.game.drawReason) {
    room.clock.runningColor = null;
    room.clock.lastStartedAt = 0;
    return;
  }
  room.clock.runningColor = room.game.turn;
  room.clock.lastStartedAt = now;
}

function finalizeChessTimeout(room, expiredColor) {
  if (!room || room.gameType !== 'chess' || !room.clock) {
    return false;
  }
  const winner = expiredColor === 'white' ? 'black' : 'white';
  room.clock.remainingMs[expiredColor] = 0;
  room.clock.runningColor = null;
  room.clock.lastStartedAt = 0;
  room.game.winner = winner;
  room.game.winReason = 'timeout';
  room.game.drawReason = null;
  room.game.check = null;
  room.game.status = `${capitalize(expiredColor)} ran out of time. ${capitalize(winner)} wins on time.`;
  return true;
}

function maybeExpireChessClock(room, now) {
  if (
    !room ||
    room.gameType !== 'chess' ||
    !room.clock ||
    !room.clock.enabled ||
    room.players.size < 2 ||
    room.game.winner ||
    room.game.drawReason
  ) {
    return false;
  }

  syncChessClock(room, now);
  const activeColor = room.clock.runningColor;
  if (!activeColor) {
    return false;
  }
  if (room.clock.remainingMs[activeColor] > 0) {
    return false;
  }
  return finalizeChessTimeout(room, activeColor);
}

function serializeChessClock(room) {
  if (!room || room.gameType !== 'chess' || !room.clock) {
    return null;
  }
  return {
    enabled: Boolean(room.clock.enabled),
    presetId: room.clock.presetId,
    label: room.clock.label,
    shortLabel: room.clock.shortLabel,
    summary: room.clock.summary,
    baseMs: room.clock.baseMs,
    incrementMs: room.clock.incrementMs,
    remainingMs: {
      white: room.clock.remainingMs.white,
      black: room.clock.remainingMs.black,
    },
    runningColor: room.clock.enabled ? room.clock.runningColor : null,
  };
}

function generateRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code, gameType, options = {}) {
  const gameDef = GAME_DEFS[gameType] || GAME_DEFS.chess;
  const room = {
    code,
    gameType: gameDef.id,
    gameDef,
    maxPlayers: gameDef.maxPlayers || DEFAULT_MAX_PLAYERS,
    players: new Map(),
    game: gameDef.createGameState(),
    clock: gameDef.id === 'chess'
      ? createChessClock(options.timeControlPreset)
      : null,
    lastTickAt: Date.now(),
  };
  room.game.roomCode = code;
  rooms.set(code, room);
  return room;
}

function getRoomForJoin(code, mode, gameType, options = {}) {
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
      room: existing || createRoom(hostCode, gameType, options),
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
    seat: player.seat,
  }));
}

function snapshot(room, viewerId) {
  const game = room.gameDef.cloneState(room.game, viewerId);
  const base = {
    ...game,
    roomCode: room.code,
    maxPlayers: room.maxPlayers,
    service: 'nova-arcade-realtime',
    gameType: room.gameType,
    title: room.game.title,
  };
  if (room.gameType === 'space-shooter') {
    return {
      ...base,
      roster: listPlayers(room),
    };
  }
  if (room.gameType === 'poker') {
    return base;
  }
  return {
    ...base,
    clock: room.gameType === 'chess' ? serializeChessClock(room) : undefined,
    players: listPlayers(room),
  };
}

function broadcastState(room, message) {
  if (room.gameType === 'chess') {
    const now = Date.now();
    if (!maybeExpireChessClock(room, now)) {
      if (room.players.size < 2 || room.game.winner || room.game.drawReason) {
        pauseChessClock(room, now);
      } else {
        syncChessClock(room, now);
      }
    }
  }
  for (const player of room.players.values()) {
    const payload = {
      type: 'state',
      snapshot: snapshot(room, player.id),
    };
    if (message) {
      payload.message = message;
    }
    send(player.socket, payload);
  }
}

function addPlayerToGame(room, player) {
  if (room.gameType === 'space-shooter') {
    const result = Shooter.addPlayer(room.game, {
      id: player.id,
      name: player.name,
    });
    if (result) {
      player.color = result.color;
      player.seat = result.seat;
    }
    return result;
  }

  if (room.gameType === 'poker') {
    const result = Poker.addPlayer(room.game, {
      id: player.id,
      name: player.name,
    });
    if (result) {
      player.seat = result.seat;
    }
    return result;
  }

  return true;
}

function seatIdentityForRoom(room) {
  if (!(room.gameType === 'chess' || room.gameType === 'backgammon')) {
    return true;
  }
  return getOpenColor(room);
}

function handleJoin(socket, payload) {
  const mode = payload && payload.mode === 'join' ? 'join' : 'host';
  const gameType = normalizeGameType(payload && payload.game);
  const lookup = getRoomForJoin(payload.roomCode, mode, gameType, {
    timeControlPreset: normalizeChessTimeControlPreset(payload && payload.timeControlPreset),
  });
  if (lookup.error) {
    sendError(socket, lookup.error);
    return;
  }
  const room = lookup.room;

  if (room.players.size >= room.maxPlayers) {
    sendError(socket, 'That room is already full.');
    return;
  }

  const identity = seatIdentityForRoom(room);
  if (!identity) {
    sendError(socket, 'No seat is available in that room.');
    return;
  }

  const player = {
    id: crypto.randomUUID(),
    name: sanitizeName(payload.name),
    color: identity === true ? null : identity,
    socket,
  };

  if (!addPlayerToGame(room, player)) {
    sendError(socket, room.gameType === 'poker'
      ? 'That table is full.'
      : room.gameType === 'space-shooter'
        ? 'That squad room is full.'
        : 'No seat is available in that room.');
    return;
  }

  room.players.set(player.id, player);
  socket.playerId = player.id;
  socket.roomCode = room.code;
  room.lastTickAt = Date.now();
  if (room.gameType === 'chess') {
    refreshChessClockTurn(room, room.lastTickAt);
  }

  send(socket, {
    type: 'welcome',
    playerId: player.id,
    roomCode: room.code,
    color: player.color,
    seat: player.seat,
    title: room.game.title,
    gameType: room.gameType,
  });

  const message = room.gameType === 'poker'
    ? room.players.size === 1
      ? `${player.name} took the first seat. Invite more players to start the table.`
      : `${player.name} joined the table.`
    : room.players.size === 1
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
  if (room.gameType === 'space-shooter') {
    sendError(socket, 'Movement in Starline Defense uses realtime input, not turn-based moves.');
    return;
  }
  if (room.gameType === 'poker') {
    sendError(socket, 'Poker uses table actions instead of board moves.');
    return;
  }
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
    const now = Date.now();
    if (maybeExpireChessClock(room, now)) {
      broadcastState(room);
      return;
    }
    if (room.game.turn !== player.color) {
      sendError(socket, `It is ${room.game.turn}'s turn.`);
      return;
    }
    syncChessClock(room, now);
    result = Chess.applyMove(room.game, {
      from: payload.from,
      to: payload.to,
      promotion: payload.promotion,
    });
    if (result.ok) {
      refreshChessClockTurn(room, now);
    }
  }

  if (!result.ok) {
    sendError(socket, result.error || 'That move could not be played.');
    return;
  }

  broadcastState(room);
}

function handleTableAction(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'poker') {
    sendError(socket, 'Table actions are only used in poker rooms.');
    return;
  }

  const result = Poker.applyAction(room.game, player.id, {
    type: payload.type,
    amount: payload.amount,
  });
  if (!result.ok) {
    sendError(socket, result.error || 'That action could not be played.');
    return;
  }

  broadcastState(room, result.message);
}

function handleStartHand(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'poker') {
    sendError(socket, 'Starting a hand is only used in poker rooms.');
    return;
  }

  const result = Poker.startHand(room.game, player.id);
  if (!result.ok) {
    sendError(socket, result.error || 'The hand could not be started.');
    return;
  }

  broadcastState(room, result.message || `${player.name} started a new hand.`);
}

function handleInput(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'space-shooter') {
    sendError(socket, 'Realtime input is only used in Starline Defense rooms.');
    return;
  }

  Shooter.setPlayerInput(room.game, player.id, payload && payload.input);
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
  if (room.gameType === 'space-shooter') {
    Shooter.resetMatch(room.game);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'poker') {
    Poker.resetTable(room.game);
  } else {
    room.game = room.gameDef.createGameState();
    room.game.roomCode = room.code;
    room.clock = room.gameType === 'chess'
      ? createChessClock(room.clock ? room.clock.presetId : 'untimed')
      : room.clock;
    if (room.gameType === 'chess') {
      refreshChessClockTurn(room, Date.now());
    }
  }
  broadcastState(
    room,
    room.gameType === 'space-shooter'
      ? `${player.name} launched a fresh squad run.`
      : room.gameType === 'poker'
        ? `${player.name} reset the table.`
        : `${player.name} reset the board.`
  );
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
  if (room.gameType === 'chess') {
    pauseChessClock(room, Date.now());
  }
  room.players.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (room.gameType === 'space-shooter') {
    Shooter.removePlayer(room.game, playerId);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'poker') {
    Poker.removePlayer(room.game, playerId);
  } else if (room.gameType === 'chess') {
    refreshChessClockTurn(room, Date.now());
  }

  const message = player
    ? room.gameType === 'space-shooter'
      ? `${player.name} disconnected. The room stays open for a new wingmate.`
      : room.gameType === 'poker'
        ? `${player.name} disconnected. The table stays open.`
      : `${player.name} disconnected. The room stays open for a new opponent.`
    : 'A player disconnected.';
  broadcastState(room, message);
}

function tickRealtimeRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.gameType === 'space-shooter' && room.players.size > 0) {
      const elapsed = Math.max(16, Math.min(120, now - room.lastTickAt));
      room.lastTickAt = now;
      Shooter.step(room.game, elapsed / 1000);
      broadcastState(room);
      continue;
    }
    if (room.gameType === 'chess' && maybeExpireChessClock(room, now)) {
      broadcastState(room);
    }
  }
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
      case 'act':
        handleTableAction(socket, payload);
        break;
      case 'start-hand':
        handleStartHand(socket);
        break;
      case 'input':
        handleInput(socket, payload);
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

setInterval(tickRealtimeRooms, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Nova Arcade realtime server running at ws://${HOST}:${PORT}`);
});
