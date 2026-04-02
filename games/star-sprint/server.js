#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Chess = require('./chess-core.js');
const Backgammon = require('./backgammon-core.js');
const Shooter = require('./space-shooter-core.js');
const Blackjack = require('./blackjack-core.js');
const Poker = require('./poker-core.js');
const MiniPool = require('./mini-pool-core.js');
const ArcadeChat = require('./arcade-chat-core.js');
const CarSoccer = require('./car-soccer-core.js');
const ZombieSiege = require('./zombie-siege-core.js');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const DEFAULT_MAX_PLAYERS = 2;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['white', 'black'];
const TICK_MS = 50;
const ALLOWED_HTTP_ORIGIN_HOSTS = new Set([
  'classiccarcollectorshub.com',
  'www.classiccarcollectorshub.com',
  'bnapsen.github.io',
  'backend-ujaa.onrender.com',
  'localhost',
  '127.0.0.1',
]);
const DATA_DIR = path.join(__dirname, 'data');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const MAX_REVIEWS = 100;
const MAX_VISIBLE_REVIEWS = 30;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
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
  'zombie-siege': {
    id: 'zombie-siege',
    title: 'Zombie Siege 3D Live',
    maxPlayers: ZombieSiege.MAX_PLAYERS,
    createGameState: () => ZombieSiege.createGameState(),
    cloneState: (game) => ZombieSiege.cloneState(game),
  },
  blackjack: {
    id: 'blackjack',
    title: 'Royal SuperSplash Blackjack Live',
    maxPlayers: Blackjack.MAX_SEATS,
    createGameState: () => Blackjack.createGameState(),
    cloneState: (game, viewerId) => Blackjack.cloneState(game, viewerId),
  },
  poker: {
    id: 'poker',
    title: 'Orbit Holdem Live',
    maxPlayers: Poker.MAX_SEATS,
    createGameState: () => Poker.createGameState(),
    cloneState: (game, viewerId) => Poker.cloneState(game, viewerId),
  },
  'mini-pool': {
    id: 'mini-pool',
    title: 'Mini Pool Showdown',
    createGameState: (options = {}) => MiniPool.createGameState(options),
    cloneState: (game) => MiniPool.cloneState(game),
  },
  'car-soccer': {
    id: 'car-soccer',
    title: 'Car Soccer Mini - Turbo Arena Live',
    maxPlayers: CarSoccer.MAX_PLAYERS,
    createGameState: () => CarSoccer.createGameState(),
    cloneState: (game) => CarSoccer.cloneState(game),
  },
  'arcade-chat': {
    id: 'arcade-chat',
    title: 'Nova Arcade Lounge',
    maxPlayers: 60,
    createGameState: () => ArcadeChat.createGameState(),
    cloneState: (game) => ArcadeChat.cloneState(game),
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

function requestOriginHost(req) {
  const origin = String(req && req.headers && req.headers.origin || '').trim();
  if (!origin) {
    return '';
  }
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function isAllowedHttpOrigin(req) {
  const host = requestOriginHost(req);
  return !host || ALLOWED_HTTP_ORIGIN_HOSTS.has(host);
}

function corsHeaders(req) {
  const origin = String(req && req.headers && req.headers.origin || '').trim();
  if (!origin || !isAllowedHttpOrigin(req)) {
    return {
      Vary: 'Origin',
    };
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function sendJsonResponse(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sanitizeReviewField(raw, maxLength) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function readStoredReviews() {
  if (!fs.existsSync(REVIEWS_FILE)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, MAX_REVIEWS);
  } catch (error) {
    console.error('Failed to read stored reviews:', error.message);
    return [];
  }
}

function writeStoredReviews(reviews) {
  ensureDataDir();
  const nextReviews = reviews.slice(0, MAX_REVIEWS);
  const tempFile = `${REVIEWS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(nextReviews, null, 2));
  fs.renameSync(tempFile, REVIEWS_FILE);
  return nextReviews;
}

function visibleReviews() {
  return readStoredReviews().slice(0, MAX_VISIBLE_REVIEWS);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_REQUEST_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function handleReviewsRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  if (req.method === 'GET') {
    sendJsonResponse(req, res, 200, {
      ok: true,
      reviews: visibleReviews(),
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const statusCode = error.message === 'Request body too large.' ? 413 : 400;
    sendJsonResponse(req, res, statusCode, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const name = sanitizeReviewField(body.name, 40);
  const car = sanitizeReviewField(body.car, 60);
  const message = sanitizeReviewField(body.message, 500);
  const rating = Number(body.rating);

  if (!name || !message) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Name and review message are required.',
    });
    return;
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Rating must be an integer between 1 and 5.',
    });
    return;
  }

  const review = {
    id: crypto.randomUUID(),
    name,
    car,
    rating,
    message,
    createdAt: new Date().toISOString(),
  };

  try {
    const nextReviews = writeStoredReviews([review, ...readStoredReviews()]);
    sendJsonResponse(req, res, 201, {
      ok: true,
      review,
      reviews: nextReviews.slice(0, MAX_VISIBLE_REVIEWS),
    });
  } catch (error) {
    console.error('Failed to persist review:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to save the review right now.',
    });
  }
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
  if (raw === 'blackjack') {
    return 'blackjack';
  }
  if (raw === 'poker') {
    return 'poker';
  }
  if (raw === 'space-shooter') {
    return 'space-shooter';
  }
  if (raw === 'zombie-siege' || raw === 'zombie' || raw === 'zombies') {
    return 'zombie-siege';
  }
  if (raw === 'mini-pool' || raw === 'pool') {
    return 'mini-pool';
  }
  if (raw === 'car-soccer' || raw === 'car-soccer-mini' || raw === 'soccer') {
    return 'car-soccer';
  }
  if (raw === 'arcade-chat' || raw === 'chat' || raw === 'lounge') {
    return 'arcade-chat';
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
    options: { ...options },
    maxPlayers: gameDef.maxPlayers || DEFAULT_MAX_PLAYERS,
    players: new Map(),
    game: gameDef.createGameState(options),
    nextBotActionAt: 0,
    botActorId: '',
    backgammonUndo: gameDef.id === 'backgammon'
      ? {
          player: 0,
          states: [],
        }
      : null,
    clock: gameDef.id === 'chess'
      ? createChessClock(options.timeControlPreset)
      : null,
    lastTickAt: Date.now(),
  };
  room.game.roomCode = code;
  rooms.set(code, room);
  return room;
}

function clearBackgammonUndo(room) {
  if (!room || room.gameType !== 'backgammon' || !room.backgammonUndo) {
    return;
  }
  room.backgammonUndo.player = 0;
  room.backgammonUndo.states = [];
}

function serializeBackgammonUndo(room) {
  if (!room || room.gameType !== 'backgammon' || !room.backgammonUndo || !room.backgammonUndo.states.length) {
    return {
      color: null,
      count: 0,
    };
  }
  return {
    color: room.backgammonUndo.player === Backgammon.WHITE ? 'white' : 'black',
    count: room.backgammonUndo.states.length,
  };
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
    voiceJoined: Boolean(player.voiceJoined),
    voiceMuted: Boolean(player.voiceMuted),
    voicePreset: String(player.voicePreset || ''),
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
  if (room.gameType === 'zombie-siege') {
    return {
      ...base,
      roster: listPlayers(room),
    };
  }
  if (room.gameType === 'car-soccer') {
    return {
      ...base,
      roster: listPlayers(room),
    };
  }
  if (room.gameType === 'arcade-chat') {
    return {
      ...base,
      players: listPlayers(room),
    };
  }
  if (room.gameType === 'poker' || room.gameType === 'blackjack') {
    return base;
  }
  return {
    ...base,
    clock: room.gameType === 'chess' ? serializeChessClock(room) : undefined,
    undo: room.gameType === 'backgammon' ? serializeBackgammonUndo(room) : undefined,
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

  if (room.gameType === 'zombie-siege') {
    const result = ZombieSiege.addPlayer(room.game, {
      id: player.id,
      name: player.name,
      color: player.color,
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

  if (room.gameType === 'blackjack') {
    const result = Blackjack.addPlayer(room.game, {
      id: player.id,
      name: player.name,
    });
    if (result) {
      player.seat = result.seat;
    }
    return result;
  }

  if (room.gameType === 'car-soccer') {
    const result = CarSoccer.addPlayer(room.game, {
      id: player.id,
      name: player.name,
    });
    if (result) {
      player.color = result.team;
      player.seat = result.seat;
    }
    return result;
  }

  return true;
}

function seatIdentityForRoom(room) {
  if (!(room.gameType === 'chess' || room.gameType === 'backgammon' || room.gameType === 'mini-pool')) {
    return true;
  }
  return getOpenColor(room);
}

function handleJoin(socket, payload) {
  const mode = payload && payload.mode === 'join' ? 'join' : 'host';
  const gameType = normalizeGameType(payload && payload.game);
  const lookup = getRoomForJoin(payload.roomCode, mode, gameType, {
    timeControlPreset: normalizeChessTimeControlPreset(payload && payload.timeControlPreset),
    variantId: MiniPool.normalizeVariantId(payload && payload.variantId),
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
    voiceJoined: false,
    voiceMuted: false,
    voicePreset: 'Clean Comms',
  };

  if (!addPlayerToGame(room, player)) {
    sendError(socket, room.gameType === 'poker' || room.gameType === 'blackjack'
      ? 'That table is full.'
      : room.gameType === 'space-shooter' || room.gameType === 'zombie-siege'
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

  if (room.gameType === 'arcade-chat') {
    const isFirst = room.players.size === 1;
    ArcadeChat.addSystemMessage(
      room.game,
      isFirst
        ? room.code === 'ARCADECHAT'
          ? `${player.name} opened the public arcade lounge.`
          : `${player.name} opened lounge ${room.code}.`
        : `${player.name} joined lounge ${room.code}.`
    );
    broadcastState(room);
    return;
  }

  const message = room.gameType === 'poker'
    ? room.players.size === 1
      ? `${player.name} took the first seat. Invite more players to start the table.`
      : `${player.name} joined the table.`
    : room.gameType === 'blackjack'
      ? room.players.size === 1
        ? `${player.name} took the first blackjack seat. Set wagers and deal when ready.`
        : `${player.name} joined the blackjack table.`
    : room.gameType === 'zombie-siege'
      ? room.players.size === 1
        ? `${player.name} is in the yard. Share the room and brace for wave one.`
        : `${player.name} joined the zombie siege room.`
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
  if (room.gameType === 'zombie-siege') {
    sendError(socket, 'Zombie Siege uses realtime input, not turn-based moves.');
    return;
  }
  if (room.gameType === 'car-soccer') {
    sendError(socket, 'Turbo Arena uses realtime driving input, not turn-based moves.');
    return;
  }
  if (room.gameType === 'mini-pool') {
    sendError(socket, 'Mini Pool uses shots instead of board moves.');
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
    const actor = room.game.current;
    if (room.backgammonUndo && room.backgammonUndo.player !== actor) {
      clearBackgammonUndo(room);
    }
    const previousState = Backgammon.cloneState(room.game);
    result = Backgammon.applyMove(room.game, {
      from: payload.from,
      to: payload.to,
      di: payload.di,
      die: payload.die,
    });
    if (result.ok) {
      room.backgammonUndo.player = actor;
      room.backgammonUndo.states.push(previousState);
      if (room.backgammonUndo.states.length > 12) {
        room.backgammonUndo.states.shift();
      }
    }
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
  if (room.gameType === 'blackjack') {
    const result = Blackjack.applyAction(room.game, player.id, {
      type: payload.type,
    });
    if (!result.ok) {
      sendError(socket, result.error || 'That action could not be played.');
      return;
    }

    broadcastState(room, result.message);
    return;
  }

  if (room.gameType !== 'poker') {
    sendError(socket, 'Table actions are only used in poker and blackjack rooms.');
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

function handleSetBet(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'blackjack') {
    sendError(socket, 'Bet controls are only used in blackjack rooms.');
    return;
  }

  const result = Blackjack.setBet(room.game, player.id, payload && payload.amount, payload && payload.mode);
  if (!result.ok) {
    sendError(socket, result.error || 'That wager could not be set.');
    return;
  }

  broadcastState(room, result.message || `${player.name} changed their wager.`);
}

function handleStartHand(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'blackjack') {
    const result = Blackjack.startRound(room.game, player.id);
    if (!result.ok) {
      sendError(socket, result.error || 'The round could not be started.');
      return;
    }

    broadcastState(room, result.message || `${player.name} dealt a new blackjack round.`);
    return;
  }

  if (room.gameType !== 'poker') {
    sendError(socket, 'Starting a hand is only used in poker and blackjack rooms.');
    return;
  }

  const result = Poker.startHand(room.game, player.id);
  if (!result.ok) {
    sendError(socket, result.error || 'The hand could not be started.');
    return;
  }

  broadcastState(room, result.message || `${player.name} started a new hand.`);
}

function handleFillBots(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'poker') {
    sendError(socket, 'Bot seats are only available on poker tables.');
    return;
  }

  const result = Poker.fillWithBots(room.game, {
    targetSeats: payload && payload.targetSeats,
  });
  if (!result.ok) {
    sendError(socket, result.error || 'Bots could not join the table.');
    return;
  }

  room.nextBotActionAt = 0;
  room.botActorId = '';

  let message = result.message || `${player.name} filled the empty seats with bots.`;
  if (payload && payload.autoStart) {
    const startResult = Poker.startHand(room.game, player.id);
    if (startResult.ok) {
      message = startResult.message || message;
    }
  }

  broadcastState(room, message);
}

function handleClearBots(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room } = context;
  if (room.gameType !== 'poker') {
    sendError(socket, 'Bot seats are only available on poker tables.');
    return;
  }

  const result = Poker.removeBots(room.game);
  if (!result.ok) {
    sendError(socket, result.error || 'Bots could not leave the table.');
    return;
  }

  room.nextBotActionAt = 0;
  room.botActorId = '';
  broadcastState(room, result.message);
}

function handleChatMessage(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Chat messages are only used in Arcade Lounge rooms.');
    return;
  }

  const result = ArcadeChat.addChatMessage(room.game, {
    playerId: player.id,
    playerName: player.name,
    text: payload && payload.text,
  });
  if (!result.ok) {
    sendError(socket, result.error || 'That message could not be sent.');
    return;
  }

  broadcastState(room);
}

function handleShareInvite(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Invite sharing is only used in Arcade Lounge rooms.');
    return;
  }

  const result = ArcadeChat.addInvite(room.game, {
    playerId: player.id,
    playerName: player.name,
    gameType: normalizeGameType(payload && payload.gameType),
    roomCode: payload && payload.roomCode,
    url: payload && payload.url,
    note: payload && payload.note,
  });
  if (!result.ok) {
    sendError(socket, result.error || 'That invite could not be shared.');
    return;
  }

  broadcastState(room);
}

function handleVoiceJoin(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice chat is only available in Arcade Lounge rooms.');
    return;
  }

  player.voiceJoined = true;
  player.voiceMuted = Boolean(payload && payload.muted);
  player.voicePreset = String(payload && payload.preset || player.voicePreset || 'Clean Comms').trim().slice(0, 24) || 'Clean Comms';
  broadcastState(room);
}

function handleVoiceLeave(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice chat is only available in Arcade Lounge rooms.');
    return;
  }

  player.voiceJoined = false;
  player.voiceMuted = false;
  broadcastState(room);
}

function handleVoiceMute(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice chat is only available in Arcade Lounge rooms.');
    return;
  }

  if (!player.voiceJoined) {
    sendError(socket, 'Join voice chat before muting your mic.');
    return;
  }

  player.voiceMuted = Boolean(payload && payload.muted);
  broadcastState(room);
}

function handleVoiceStyle(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice Lab is only available in Arcade Lounge rooms.');
    return;
  }

  player.voicePreset = String(payload && payload.preset || 'Clean Comms').trim().slice(0, 24) || 'Clean Comms';
  broadcastState(room);
}

function handleVoiceSignal(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice chat is only available in Arcade Lounge rooms.');
    return;
  }

  if (!player.voiceJoined) {
    sendError(socket, 'Join voice chat before sending mic data.');
    return;
  }

  const toPlayerId = String(payload && payload.toPlayerId || '').trim();
  if (!toPlayerId || toPlayerId === player.id) {
    return;
  }

  const target = room.players.get(toPlayerId);
  if (!target || !target.voiceJoined) {
    return;
  }

  const signal = payload && payload.signal;
  if (!signal || typeof signal !== 'object') {
    return;
  }

  send(target.socket, {
    type: 'voice-signal',
    fromPlayerId: player.id,
    fromPlayerName: player.name,
    signal,
  });
}

function handleInput(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'space-shooter') {
    Shooter.setPlayerInput(room.game, player.id, payload && payload.input);
    return;
  }
  if (room.gameType === 'zombie-siege') {
    ZombieSiege.setPlayerInput(room.game, player.id, payload && payload.input);
    return;
  }
  if (room.gameType === 'car-soccer') {
    CarSoccer.setPlayerInput(room.game, player.id, payload && payload.input);
    return;
  }
  sendError(socket, 'Realtime input is only used in live action rooms.');
}

function handleShot(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'mini-pool') {
    sendError(socket, 'Shots are only used in Mini Pool rooms.');
    return;
  }
  if (room.players.size < 2) {
    sendError(socket, 'Wait for a second player before breaking the rack.');
    return;
  }

  const result = MiniPool.applyShot(room.game, player.color, {
    vectorX: payload && payload.vectorX,
    vectorY: payload && payload.vectorY,
    power: payload && payload.power,
  });
  if (!result.ok) {
    sendError(socket, result.error || 'That shot could not be played.');
    return;
  }

  broadcastState(room, `${player.name} takes the shot.`);
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
  if (room.backgammonUndo && room.backgammonUndo.player !== room.game.current) {
    clearBackgammonUndo(room);
  }

  const result = Backgammon.rollDice(room.game);
  if (!result.ok) {
    sendError(socket, result.error || 'The dice could not be rolled.');
    return;
  }

  broadcastState(room);
}

function handleUndo(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'backgammon') {
    sendError(socket, 'Undo is only available in backgammon rooms.');
    return;
  }

  const side = playerBackgammonSide(player);
  if (!room.backgammonUndo || room.backgammonUndo.player !== side || !room.backgammonUndo.states.length) {
    sendError(socket, 'There is no backgammon move to undo right now.');
    return;
  }

  const previousState = room.backgammonUndo.states.pop();
  room.game = Backgammon.cloneState(previousState);
  room.game.roomCode = room.code;
  if (!room.backgammonUndo.states.length) {
    room.backgammonUndo.player = 0;
  }

  broadcastState(room, `${player.name} undid the last move.`);
}

function handleRestart(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'arcade-chat') {
    sendError(socket, 'Arcade Lounge rooms do not use reset.');
    return;
  }
  if (room.gameType === 'space-shooter') {
    Shooter.resetMatch(room.game);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'zombie-siege') {
    ZombieSiege.resetMatch(room.game);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'car-soccer') {
    CarSoccer.resetMatch(room.game);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'poker') {
    Poker.resetTable(room.game);
    room.nextBotActionAt = 0;
    room.botActorId = '';
  } else if (room.gameType === 'blackjack') {
    Blackjack.resetTable(room.game);
  } else {
    room.game = room.gameDef.createGameState(room.options);
    room.game.roomCode = room.code;
    if (room.gameType === 'backgammon') {
      clearBackgammonUndo(room);
    }
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
      : room.gameType === 'zombie-siege'
        ? `${player.name} restarted the zombie siege run.`
      : room.gameType === 'car-soccer'
        ? `${player.name} reset the arena kickoff.`
      : room.gameType === 'poker'
        ? `${player.name} reset the table.`
        : room.gameType === 'blackjack'
          ? `${player.name} reset the blackjack table.`
        : room.gameType === 'mini-pool'
          ? `${player.name} reset the rack.`
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
  } else if (room.gameType === 'zombie-siege') {
    ZombieSiege.removePlayer(room.game, playerId);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'car-soccer') {
    CarSoccer.removePlayer(room.game, playerId);
    room.lastTickAt = Date.now();
  } else if (room.gameType === 'poker') {
    Poker.removePlayer(room.game, playerId);
    room.nextBotActionAt = 0;
    room.botActorId = '';
  } else if (room.gameType === 'blackjack') {
    Blackjack.removePlayer(room.game, playerId);
  } else if (room.gameType === 'arcade-chat') {
    if (player) {
      ArcadeChat.addSystemMessage(room.game, `${player.name} left lounge ${room.code}.`);
    }
  } else if (room.gameType === 'backgammon') {
    clearBackgammonUndo(room);
  } else if (room.gameType === 'chess') {
    refreshChessClockTurn(room, Date.now());
  }

  const message = player
    ? room.gameType === 'space-shooter'
      ? `${player.name} disconnected. The room stays open for a new wingmate.`
      : room.gameType === 'zombie-siege'
        ? `${player.name} disconnected. The yard stays open for another survivor.`
      : room.gameType === 'car-soccer'
        ? `${player.name} disconnected. The Turbo Arena room stays open for a new driver.`
      : room.gameType === 'poker'
        ? `${player.name} disconnected. The table stays open.`
        : room.gameType === 'blackjack'
          ? `${player.name} disconnected. The blackjack table stays open.`
      : room.gameType === 'mini-pool'
        ? `${player.name} disconnected. The table stays open for a new challenger.`
      : room.gameType === 'arcade-chat'
        ? null
      : `${player.name} disconnected. The room stays open for a new opponent.`
    : 'A player disconnected.';
  if (room.gameType === 'arcade-chat') {
    broadcastState(room);
  } else {
    broadcastState(room, message);
  }
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
    if (room.gameType === 'zombie-siege' && room.players.size > 0) {
      const elapsed = Math.max(16, Math.min(120, now - room.lastTickAt));
      room.lastTickAt = now;
      ZombieSiege.step(room.game, elapsed / 1000);
      broadcastState(room);
      continue;
    }
    if (room.gameType === 'car-soccer' && room.players.size > 0) {
      const elapsed = Math.max(16, Math.min(120, now - room.lastTickAt));
      room.lastTickAt = now;
      CarSoccer.step(room.game, elapsed / 1000);
      broadcastState(room);
      continue;
    }
    if (room.gameType === 'mini-pool' && room.players.size > 0) {
      const elapsed = Math.max(16, Math.min(120, now - room.lastTickAt));
      room.lastTickAt = now;
      if (MiniPool.step(room.game, elapsed / 1000)) {
        broadcastState(room);
      }
      continue;
    }
    if (room.gameType === 'poker' && room.players.size > 0) {
      const actor = Number.isInteger(room.game.actionSeat)
        ? Poker.findPlayerBySeat(room.game, room.game.actionSeat)
        : null;
      if (!actor || !actor.isBot || !(room.game.stage === 'preflop' || room.game.stage === 'flop' || room.game.stage === 'turn' || room.game.stage === 'river')) {
        room.nextBotActionAt = 0;
        room.botActorId = '';
        continue;
      }

      if (room.botActorId !== actor.id || !room.nextBotActionAt) {
        room.botActorId = actor.id;
        room.nextBotActionAt = now + 520 + Math.floor(Math.random() * 420);
        continue;
      }

      if (now < room.nextBotActionAt) {
        continue;
      }

      room.nextBotActionAt = 0;
      room.botActorId = '';
      const action = Poker.chooseBotAction(room.game, actor.id);
      if (!action) {
        continue;
      }
      const result = Poker.applyAction(room.game, actor.id, action);
      if (result.ok) {
        broadcastState(room, result.message || `${actor.name} acted.`);
      }
      continue;
    }
    if (room.gameType === 'chess' && maybeExpireChessClock(room, now)) {
      broadcastState(room);
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/healthz') {
    sendJsonResponse(req, res, 200, {
      ok: true,
      service: 'nova-arcade-realtime',
      games: Object.keys(GAME_DEFS),
      rooms: rooms.size,
    });
    return;
  }

  if (requestUrl.pathname === '/api/reviews') {
    await handleReviewsRequest(req, res);
    return;
  }

  sendJsonResponse(req, res, 200, {
    ok: true,
    service: 'nova-arcade-realtime',
    games: Object.keys(GAME_DEFS),
    websocket: true,
    reviewsApi: '/api/reviews',
  });
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
      case 'chat':
        handleChatMessage(socket, payload);
        break;
      case 'share-invite':
        handleShareInvite(socket, payload);
        break;
      case 'voice-join':
        handleVoiceJoin(socket, payload);
        break;
      case 'voice-leave':
        handleVoiceLeave(socket);
        break;
      case 'voice-mute':
        handleVoiceMute(socket, payload);
        break;
      case 'voice-signal':
        handleVoiceSignal(socket, payload);
        break;
      case 'voice-style':
        handleVoiceStyle(socket, payload);
        break;
      case 'shoot':
        handleShot(socket, payload);
        break;
      case 'roll':
        handleRoll(socket);
        break;
      case 'move':
        handleMove(socket, payload);
        break;
      case 'undo':
        handleUndo(socket);
        break;
      case 'act':
        handleTableAction(socket, payload);
        break;
      case 'set-bet':
        handleSetBet(socket, payload);
        break;
      case 'start-hand':
        handleStartHand(socket);
        break;
      case 'fill-bots':
        handleFillBots(socket, payload);
        break;
      case 'clear-bots':
        handleClearBots(socket);
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
