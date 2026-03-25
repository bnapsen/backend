#!/usr/bin/env node
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const BOARD_SIZE = 10;
const MAX_PLAYERS = 2;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['white', 'black'];
const BACK_RANK = ['bastion', 'knight', 'seer', 'sentinel', 'crown', 'vanguard', 'sentinel', 'seer', 'knight', 'bastion'];
const PROMOTIONS = ['vanguard', 'bastion', 'seer', 'knight', 'sentinel'];
const PIECE_NAMES = {
  crown: 'Crown',
  bastion: 'Bastion',
  seer: 'Seer',
  knight: 'Knight',
  sentinel: 'Sentinel',
  vanguard: 'Vanguard',
  warden: 'Warden',
};
const files = 'abcdefghij';
const rooms = new Map();

function createPiece(type, color) {
  return {
    id: crypto.randomUUID(),
    type,
    color,
    moved: false,
  };
}

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));

  for (let x = 0; x < BOARD_SIZE; x += 1) {
    board[0][x] = createPiece(BACK_RANK[x], 'black');
    board[1][x] = createPiece('warden', 'black');
    board[BOARD_SIZE - 2][x] = createPiece('warden', 'white');
    board[BOARD_SIZE - 1][x] = createPiece(BACK_RANK[x], 'white');
  }

  return board;
}

function createGameState() {
  return {
    board: createInitialBoard(),
    turn: 'white',
    winner: null,
    moveCount: 1,
    captured: {
      white: [],
      black: [],
    },
    history: [],
  };
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
    maxPlayers: MAX_PLAYERS,
    players: new Map(),
    game: createGameState(),
  };
  rooms.set(code, room);
  return room;
}

function getRoomForJoin(code, mode) {
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

function getOpenColor(room) {
  const used = new Set(Array.from(room.players.values()).map((player) => player.color));
  return COLORS.find((color) => !used.has(color)) || null;
}

function insideBoard(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function getPiece(board, x, y) {
  if (!insideBoard(x, y)) return null;
  return board[y][x];
}

function coordToNotation(x, y) {
  return `${files[x]}${BOARD_SIZE - y}`;
}

function cloneMove(x, y) {
  return { x, y };
}

function pushStepMove(board, piece, moves, x, y) {
  if (!insideBoard(x, y)) return;
  const target = getPiece(board, x, y);
  if (!target || target.color !== piece.color) {
    moves.push(cloneMove(x, y));
  }
}

function pushSlidingMoves(board, piece, x, y, directions, maxSteps = BOARD_SIZE) {
  const moves = [];
  for (const [dx, dy] of directions) {
    for (let step = 1; step <= maxSteps; step += 1) {
      const nextX = x + (dx * step);
      const nextY = y + (dy * step);
      if (!insideBoard(nextX, nextY)) break;
      const target = getPiece(board, nextX, nextY);
      if (!target) {
        moves.push(cloneMove(nextX, nextY));
        continue;
      }
      if (target.color !== piece.color) {
        moves.push(cloneMove(nextX, nextY));
      }
      break;
    }
  }
  return moves;
}

function getLegalMoves(board, x, y) {
  const piece = getPiece(board, x, y);
  if (!piece) return [];

  const moves = [];
  switch (piece.type) {
    case 'crown':
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          pushStepMove(board, piece, moves, x + dx, y + dy);
        }
      }
      return moves;

    case 'bastion':
      return pushSlidingMoves(board, piece, x, y, [[1, 0], [-1, 0], [0, 1], [0, -1]]);

    case 'seer':
      return pushSlidingMoves(board, piece, x, y, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);

    case 'vanguard':
      return pushSlidingMoves(
        board,
        piece,
        x,
        y,
        [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
        2
      );

    case 'knight': {
      const deltas = [
        [1, 2], [2, 1], [2, -1], [1, -2],
        [-1, -2], [-2, -1], [-2, 1], [-1, 2],
      ];
      for (const [dx, dy] of deltas) {
        pushStepMove(board, piece, moves, x + dx, y + dy);
      }
      return moves;
    }

    case 'sentinel': {
      const deltas = [
        [2, 0], [-2, 0], [0, 2], [0, -2],
        [2, 2], [2, -2], [-2, 2], [-2, -2],
      ];
      for (const [dx, dy] of deltas) {
        pushStepMove(board, piece, moves, x + dx, y + dy);
      }
      return moves;
    }

    case 'warden': {
      const forward = piece.color === 'white' ? -1 : 1;
      const startRow = piece.color === 'white' ? BOARD_SIZE - 2 : 1;
      const nextY = y + forward;

      if (insideBoard(x, nextY) && !getPiece(board, x, nextY)) {
        moves.push(cloneMove(x, nextY));
        const jumpY = y + (forward * 2);
        if (y === startRow && !getPiece(board, x, jumpY)) {
          moves.push(cloneMove(x, jumpY));
        }
      }

      for (const dx of [-1, 1]) {
        const targetX = x + dx;
        const target = getPiece(board, targetX, nextY);
        if (target && target.color !== piece.color) {
          moves.push(cloneMove(targetX, nextY));
        }
      }

      return moves;
    }

    default:
      return [];
  }
}

function listPlayers(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
  }));
}

function snapshot(room) {
  const board = room.game.board.map((row) => row.map((piece) => {
    if (!piece) return null;
    return {
      id: piece.id,
      type: piece.type,
      color: piece.color,
      moved: piece.moved,
    };
  }));

  return {
    title: 'Astral Dominion',
    roomCode: room.code,
    boardSize: BOARD_SIZE,
    board,
    maxPlayers: room.maxPlayers,
    players: listPlayers(room),
    turn: room.game.turn,
    winner: room.game.winner,
    moveCount: room.game.moveCount,
    captured: room.game.captured,
    history: room.game.history.slice(-18),
    promotions: PROMOTIONS,
    pieceInfo: PIECE_NAMES,
  };
}

function formatMove(piece, from, to, captured, promotion, turnColor) {
  const prefix = turnColor === 'white' ? `${Math.ceil(from.moveNumber / 2)}.` : '...';
  const captureMark = captured ? 'x' : '-';
  const promoText = promotion ? `=${PIECE_NAMES[promotion]}` : '';
  return `${prefix} ${PIECE_NAMES[piece.type]} ${coordToNotation(from.x, from.y)}${captureMark}${coordToNotation(to.x, to.y)}${promoText}`;
}

function applyMove(room, player, move) {
  const board = room.game.board;
  const from = move?.from || {};
  const to = move?.to || {};

  if (!insideBoard(from.x, from.y) || !insideBoard(to.x, to.y)) {
    return { ok: false, error: 'That move is out of bounds.' };
  }

  if (room.game.turn !== player.color) {
    return { ok: false, error: 'It is not your turn.' };
  }

  const piece = getPiece(board, from.x, from.y);
  if (!piece || piece.color !== player.color) {
    return { ok: false, error: 'Choose one of your own pieces.' };
  }

  const legal = getLegalMoves(board, from.x, from.y);
  const selectedMove = legal.find((entry) => entry.x === to.x && entry.y === to.y);
  if (!selectedMove) {
    return { ok: false, error: 'That move is not legal for this piece.' };
  }

  const target = getPiece(board, to.x, to.y);
  board[to.y][to.x] = piece;
  board[from.y][from.x] = null;
  piece.moved = true;

  let promotion = null;
  if (piece.type === 'warden' && (to.y === 0 || to.y === BOARD_SIZE - 1)) {
    promotion = PROMOTIONS.includes(move.promotion) ? move.promotion : 'vanguard';
    piece.type = promotion;
  }

  if (target) {
    room.game.captured[player.color].push(target.type);
    if (target.type === 'crown') {
      room.game.winner = {
        color: player.color,
        name: player.name,
        reason: 'crown-captured',
      };
    }
  }

  room.game.history.push(
    formatMove(
      piece,
      { x: from.x, y: from.y, moveNumber: room.game.moveCount },
      { x: to.x, y: to.y },
      target,
      promotion,
      player.color
    )
  );

  if (!room.game.winner) {
    room.game.turn = player.color === 'white' ? 'black' : 'white';
    room.game.moveCount += 1;
  }

  return { ok: true };
}

function restartGame(room) {
  room.game = createGameState();
}

function broadcastSnapshot(room) {
  const state = snapshot(room);
  for (const player of room.players.values()) {
    send(player.ws, { type: 'state', state });
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'astral-dominion', rooms: rooms.size }));
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
      const room = getRoomForJoin(msg.room, mode);

      if (!room) {
        send(ws, { type: 'error', message: 'That room does not exist yet. Ask the host to start it first.' });
        return;
      }

      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { type: 'error', message: 'This tactics room is already full.' });
        return;
      }

      const color = getOpenColor(room);
      if (!color) {
        send(ws, { type: 'error', message: 'No color slot is available in this room.' });
        return;
      }

      const player = {
        id: crypto.randomUUID(),
        name: String(msg.name || 'Player').trim().slice(0, 18) || 'Player',
        color,
        ws,
      };

      room.players.set(player.id, player);
      ws.meta = { roomCode: room.code, playerId: player.id };

      send(ws, {
        type: 'welcome',
        roomCode: room.code,
        playerId: player.id,
        yourColor: color,
        message: mode === 'host'
          ? 'Room created. Send the invite link so the second player can claim the opposing side.'
          : `Joined as ${color}.`,
        state: snapshot(room),
      });

      broadcastSnapshot(room);
      return;
    }

    if (!ws.meta.roomCode || !ws.meta.playerId) return;

    const room = rooms.get(ws.meta.roomCode);
    if (!room) return;
    const player = room.players.get(ws.meta.playerId);
    if (!player) return;

    if (msg.type === 'move') {
      const result = applyMove(room, player, msg);
      if (!result.ok) {
        send(ws, { type: 'error', message: result.error });
        return;
      }
      broadcastSnapshot(room);
      return;
    }

    if (msg.type === 'restart') {
      restartGame(room);
      broadcastSnapshot(room);
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

    broadcastSnapshot(room);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Astral Dominion backend listening on http://${HOST}:${PORT}`);
});
