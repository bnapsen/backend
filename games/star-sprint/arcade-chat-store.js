'use strict';

const { Firestore } = require('@google-cloud/firestore');

const MAX_MESSAGES = 160;
const MAX_INVITES = 18;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeMessageEntry(entry) {
  return {
    id: String(entry && entry.id || ''),
    createdAt: String(entry && entry.createdAt || ''),
    kind: String(entry && entry.kind || 'chat'),
    text: String(entry && entry.text || ''),
    playerId: entry && entry.playerId ? String(entry.playerId) : undefined,
    playerName: entry && entry.playerName ? String(entry.playerName) : undefined,
    gameType: entry && entry.gameType ? String(entry.gameType) : undefined,
    gameTitle: entry && entry.gameTitle ? String(entry.gameTitle) : undefined,
    roomCode: entry && entry.roomCode ? String(entry.roomCode) : undefined,
    url: entry && entry.url ? String(entry.url) : undefined,
    note: entry && entry.note ? String(entry.note) : undefined,
  };
}

function sanitizeInviteEntry(entry) {
  return {
    id: String(entry && entry.id || ''),
    createdAt: String(entry && entry.createdAt || ''),
    kind: 'invite',
    playerId: entry && entry.playerId ? String(entry.playerId) : undefined,
    playerName: entry && entry.playerName ? String(entry.playerName) : undefined,
    gameType: entry && entry.gameType ? String(entry.gameType) : undefined,
    gameTitle: entry && entry.gameTitle ? String(entry.gameTitle) : undefined,
    roomCode: entry && entry.roomCode ? String(entry.roomCode) : undefined,
    url: entry && entry.url ? String(entry.url) : undefined,
    note: entry && entry.note ? String(entry.note) : undefined,
  };
}

function sanitizeRoomState(roomCode, game) {
  return {
    roomCode: String(roomCode || '').trim().toUpperCase(),
    topic: String(game && game.topic || 'AP Advantage Player Lounge'),
    status: String(game && game.status || ''),
    messages: Array.isArray(game && game.messages)
      ? game.messages.slice(-MAX_MESSAGES).map(sanitizeMessageEntry)
      : [],
    invites: Array.isArray(game && game.invites)
      ? game.invites.slice(0, MAX_INVITES).map(sanitizeInviteEntry)
      : [],
  };
}

function createArcadeChatStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  collectionName = process.env.ARCADE_CHAT_FIRESTORE_COLLECTION || 'arcadeChatRooms',
} = {}) {
  const enabled = Boolean(String(projectId || '').trim());
  const firestore = enabled
    ? new Firestore({
      projectId,
      ignoreUndefinedProperties: true,
    })
    : null;
  const roomCache = new Map();

  async function init() {
    if (!enabled) {
      return;
    }

    const snapshot = await firestore.collection(collectionName).get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!data || typeof data !== 'object') {
        continue;
      }
      const roomState = sanitizeRoomState(doc.id, data);
      roomCache.set(roomState.roomCode, roomState);
    }
  }

  function getRoom(roomCode) {
    const safeRoomCode = String(roomCode || '').trim().toUpperCase();
    if (!safeRoomCode || !roomCache.has(safeRoomCode)) {
      return null;
    }
    return cloneValue(roomCache.get(safeRoomCode));
  }

  async function saveRoom(roomCode, game) {
    if (!enabled) {
      return;
    }

    const nextState = sanitizeRoomState(roomCode, game);
    roomCache.set(nextState.roomCode, nextState);
    await firestore.collection(collectionName).doc(nextState.roomCode).set({
      ...nextState,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    enabled,
    init,
    getRoom,
    saveRoom,
  };
}

module.exports = {
  createArcadeChatStore,
};
