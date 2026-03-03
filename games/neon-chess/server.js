#!/usr/bin/env node
'use strict';

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8090);
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, guest: null, lastState: null });
  return rooms.get(code);
}

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.meta = { room: null, role: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'join') {
      const roomCode = String(msg.room || 'PUBLIC').trim().toUpperCase().slice(0, 12) || 'PUBLIC';
      const room = getRoom(roomCode);
      const wantsHost = msg.requestedRole === 'host';

      let role = null;
      if (wantsHost && !room.host) role = 'host';
      else if (!wantsHost && !room.guest) role = 'guest';
      else if (!room.host) role = 'host';
      else if (!room.guest) role = 'guest';

      if (!role) {
        send(ws, { type: 'error', message: 'Room is full.' });
        ws.close();
        return;
      }

      room[role] = ws;
      ws.meta = { room: roomCode, role };
      send(ws, { type: 'welcome', role, room: roomCode });

      if (room.lastState) send(ws, { type: 'sync', ...room.lastState });
      return;
    }

    const code = ws.meta.room;
    const role = ws.meta.role;
    if (!code || !role) return;
    const room = rooms.get(code);
    if (!room) return;

    if (msg.type === 'move') {
      if (role !== 'host' && role !== 'guest') return;
      room.lastState = {
        board: msg.board,
        turn: msg.turn,
        winner: msg.winner,
        history: msg.history || []
      };
      const other = role === 'host' ? room.guest : room.host;
      send(other, { type: 'sync', ...room.lastState });
    }
  });

  ws.on('close', () => {
    const { room: code, role } = ws.meta;
    if (!code || !role || !rooms.has(code)) return;
    const room = rooms.get(code);
    if (room[role] === ws) room[role] = null;
    if (!room.host && !room.guest) rooms.delete(code);
  });
});

console.log(`Neon Chess server listening on :${PORT}`);
