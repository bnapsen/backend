#!/usr/bin/env node
'use strict';

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const rooms = new Map();

function roomState(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { host: null, guest: null });
  }
  return rooms.get(code);
}

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function relay(to, payload) {
  send(to, payload);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.meta = { room: null, role: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.room || 'PUBLIC').trim().toUpperCase().slice(0, 12) || 'PUBLIC';
      const room = roomState(code);

      if (!room.host) {
        room.host = ws;
        ws.meta = { room: code, role: 'host' };
        send(ws, { type: 'welcome', role: 'host', room: code, message: 'Hosting room' });
        return;
      }

      if (!room.guest) {
        room.guest = ws;
        ws.meta = { room: code, role: 'guest' };
        send(ws, { type: 'welcome', role: 'guest', room: code, message: 'Joined room' });
        send(room.host, { type: 'peerJoined' });
        return;
      }

      send(ws, { type: 'error', message: 'Room is full' });
      ws.close();
      return;
    }

    const code = ws.meta.room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (msg.type === 'input' && ws.meta.role === 'guest') {
      relay(room.host, { type: 'input', seq: msg.seq, input: msg.input || null });
      return;
    }

    if (msg.type === 'state' && ws.meta.role === 'host') {
      relay(room.guest, { type: 'state', snapshot: msg.snapshot || null });
    }
  });

  ws.on('close', () => {
    const { room: code, role } = ws.meta;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);

    if (role === 'host' && room.host === ws) room.host = null;
    if (role === 'guest' && room.guest === ws) room.guest = null;

    const peer = role === 'host' ? room.guest : room.host;
    send(peer, { type: 'peerLeft' });

    if (!room.host && !room.guest) rooms.delete(code);
  });
});

console.log(`Car Soccer Mini multiplayer server listening on :${PORT}`);
