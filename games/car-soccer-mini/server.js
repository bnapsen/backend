#!/usr/bin/env node
'use strict';

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const HEARTBEAT_MS = 10000;
const rooms = new Map();


function sanitizeRoomCode(raw) {
  return String(raw || 'PUBLIC').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'PUBLIC';
}

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

const wss = new WebSocketServer({ port: PORT, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.meta = { room: null, role: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const code = sanitizeRoomCode(msg.room);
      const requestedRole = msg.requestedRole === 'host' || msg.requestedRole === 'guest' ? msg.requestedRole : null;
      const room = roomState(code);

      if (requestedRole === 'host') {
        if (room.host) {
          send(ws, { type: 'error', message: 'Room already has a host' });
          ws.close();
          return;
        }
        room.host = ws;
        ws.meta = { room: code, role: 'host' };
        send(ws, { type: 'welcome', role: 'host', room: code, message: 'Hosting room' });
        return;
      }

      if (requestedRole === 'guest') {
        if (!room.host) {
          send(ws, { type: 'error', message: 'Host not online yet for this room' });
          ws.close();
          return;
        }
        if (room.guest) {
          send(ws, { type: 'error', message: 'Room already has a guest' });
          ws.close();
          return;
        }
        room.guest = ws;
        ws.meta = { room: code, role: 'guest' };
        send(ws, { type: 'welcome', role: 'guest', room: code, message: 'Joined room' });
        send(room.host, { type: 'peerJoined' });
        return;
      }

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

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeatTimer));

console.log(`Car Soccer Mini multiplayer server listening on :${PORT}`);
