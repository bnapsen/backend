#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const MAX_MESSAGES = 160;
const MAX_INVITES = 18;
const MAX_MESSAGE_LENGTH = 360;
const MAX_NOTE_LENGTH = 140;
const INVITE_TTL_MS = 4 * 60 * 60 * 1000;
const GAME_TITLES = Object.freeze({
  chess: 'Neon Crown Chess',
  backgammon: 'Neon Backgammon Blitz',
  'space-shooter': 'Starline Defense Co-Op',
  'car-soccer': 'Car Soccer Mini - Turbo Arena Live',
  blackjack: 'Royal SuperSplash Blackjack Live',
  poker: 'Orbit Holdem Live',
  'mini-pool': 'Mini Pool Showdown',
});

function sanitizeText(raw, maxLength) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeRoomCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function sanitizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (error) {
    return '';
  }
  return '';
}

function nowIso() {
  return new Date().toISOString();
}

function createEntry(base) {
  return {
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    ...base,
  };
}

function pruneInvites(game) {
  const cutoff = Date.now() - INVITE_TTL_MS;
  game.invites = game.invites
    .filter((invite) => {
      const createdAt = Date.parse(invite.createdAt || '');
      return Number.isFinite(createdAt) && createdAt >= cutoff;
    })
    .slice(0, MAX_INVITES);
}

function pruneMessages(game) {
  if (game.messages.length > MAX_MESSAGES) {
    game.messages = game.messages.slice(game.messages.length - MAX_MESSAGES);
  }
}

function syncCollections(game) {
  pruneInvites(game);
  pruneMessages(game);
}

function setStatus(game, text) {
  game.status = text;
}

function createGameState() {
  const game = {
    roomCode: '',
    topic: 'Nova Arcade Lounge',
    status: 'Nova Arcade Lounge is live. Share a room and rally players.',
    messages: [],
    invites: [],
  };
  addSystemMessage(game, 'Nova Arcade Lounge is live. Share a game invite or say hello.');
  return game;
}

function cloneState(game) {
  syncCollections(game);
  return {
    topic: game.topic,
    status: game.status,
    messages: game.messages.map((message) => ({ ...message })),
    invites: game.invites.map((invite) => ({ ...invite })),
  };
}

function addSystemMessage(game, text) {
  const cleanText = sanitizeText(text, MAX_MESSAGE_LENGTH);
  if (!cleanText) {
    return null;
  }
  const entry = createEntry({
    kind: 'system',
    text: cleanText,
  });
  game.messages.push(entry);
  setStatus(game, cleanText);
  syncCollections(game);
  return entry;
}

function addChatMessage(game, payload) {
  const text = sanitizeText(payload && payload.text, MAX_MESSAGE_LENGTH);
  if (!text) {
    return {
      ok: false,
      error: 'Write a message before sending it.',
    };
  }

  const playerName = sanitizeText(payload && payload.playerName, 18) || 'Guest';
  const entry = createEntry({
    kind: 'chat',
    playerId: payload && payload.playerId,
    playerName,
    text,
  });
  game.messages.push(entry);
  setStatus(game, `${playerName} sent a message.`);
  syncCollections(game);
  return {
    ok: true,
    entry,
  };
}

function addInvite(game, payload) {
  const gameType = String(payload && payload.gameType || '').trim();
  if (!GAME_TITLES[gameType]) {
    return {
      ok: false,
      error: 'Choose a supported game before sharing an invite.',
    };
  }

  const url = sanitizeUrl(payload && payload.url);
  if (!url) {
    return {
      ok: false,
      error: 'That invite link is missing or invalid.',
    };
  }

  const playerName = sanitizeText(payload && payload.playerName, 18) || 'Guest';
  const invite = createEntry({
    kind: 'invite',
    playerId: payload && payload.playerId,
    playerName,
    gameType,
    gameTitle: GAME_TITLES[gameType],
    roomCode: sanitizeRoomCode(payload && payload.roomCode) || null,
    url,
    note: sanitizeText(payload && payload.note, MAX_NOTE_LENGTH),
  });

  game.invites = game.invites.filter((existing) => existing.url !== invite.url);
  game.invites.unshift({ ...invite });

  const message = createEntry({
    kind: 'invite',
    playerId: invite.playerId,
    playerName: invite.playerName,
    gameType: invite.gameType,
    gameTitle: invite.gameTitle,
    roomCode: invite.roomCode,
    url: invite.url,
    note: invite.note,
    text: `${invite.playerName} shared a ${invite.gameTitle} invite.`,
  });
  game.messages.push(message);
  setStatus(game, message.text);
  syncCollections(game);
  return {
    ok: true,
    invite,
    message,
  };
}

module.exports = {
  createGameState,
  cloneState,
  addSystemMessage,
  addChatMessage,
  addInvite,
};
