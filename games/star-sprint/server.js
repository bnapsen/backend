#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const firebaseAdmin = require('firebase-admin');
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
const { createArcadeChatStore } = require('./arcade-chat-store.js');
const { createSimWalletStore } = require('./sim-wallet-store.js');
const { createSimBitcoinPaperStore } = require('./sim-bitcoin-paper-store.js');
const { createReviewsStore } = require('./reviews-store.js');
const { createSongsStore } = require('./songs-store.js');
const {
  createSongMediaManager,
  sanitizeSongFileName,
  inferSongTitle,
  normalizeSongUploadType,
} = require('./song-media.js');
const { createClipsStore } = require('./clips-store.js');
const {
  CLIP_MAX_DURATION_SECONDS,
  CLIP_MAX_DURATION_LABEL,
  createClipMediaManager,
  sanitizeClipFileName,
  inferClipTitle,
  normalizeClipUploadType,
} = require('./clip-media.js');
const { createClipModerationService } = require('./clip-moderation.js');
const {
  WEATHER_LAB_LOCATIONS,
  getWeatherLiveObservations,
  resolveWeatherMarkets,
  scanWeatherMarkets,
} = require('./kalshi-weather-lab.js');
const {
  getBitcoin15mMarketSnapshot,
  placeBitcoin15mOrder,
  previewBitcoin15mOrder,
  scanBitcoin15m,
} = require('./kalshi-bitcoin-lab.js');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const DEFAULT_MAX_PLAYERS = 2;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['white', 'black'];
const TICK_MS = 50;
const BACKGAMMON_MAX_WAGER_CENTS = 100000;
const BACKGAMMON_MAX_POINTS = 3;
const BACKGAMMON_WAGER_SOURCE = 'backgammon';
const SIM_KILL_REWARD_CENTS = Math.max(1, Math.min(25, Math.round(Number(process.env.SIM_KILL_REWARD_CENTS || 1))));
const SIM_KILL_REWARD_KILLS_PER_CREDIT = Math.max(2, Math.min(
  500,
  Math.round(Number(process.env.SIM_KILL_REWARD_KILLS_PER_CREDIT || 10)),
));
const SIM_KILL_REWARD_MAX_KILLS_PER_REQUEST = 25;
const SIM_KILL_REWARD_TIME_ZONE = String(process.env.SIM_KILL_REWARD_TIME_ZONE || 'America/Los_Angeles').trim();
const SIM_KILL_REWARD_GAMES = Object.freeze({
  'zombie-siege': { label: 'Zombie Siege' },
  galaga: { label: 'Galaga' },
  'space-shooter': { label: 'Space Shooter' },
});
const ALLOWED_HTTP_ORIGIN_HOSTS = new Set([
  'bnapsen.com',
  'www.bnapsen.com',
  'classiccarcollectorshub.com',
  'www.classiccarcollectorshub.com',
  'bnapsen.github.io',
  'backend-ujaa.onrender.com',
  'nova-arcade-backend-1000121513328.us-central1.run.app',
  'nova-arcade-backend-2rpkpv7fpq-uc.a.run.app',
  'localhost',
  '127.0.0.1',
]);
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const SONG_UPLOAD_DIR = path.join(DATA_DIR, 'songs');
const CITY_RAID_DOWNLOAD_DIR = path.resolve(__dirname, '..', '..', 'assets', 'downloads', 'city-raid');
const CITY_RAID_ZIP_NAME = 'City-Raid-Win64.zip';
const MAX_REVIEWS = 100;
const MAX_VISIBLE_REVIEWS = 30;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_SONGS = 80;
const MAX_VISIBLE_SONGS = 40;
const MAX_SONG_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_CLIPS = 0;
const MAX_VISIBLE_CLIPS = 60;
const MAX_CLIP_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_DIRECT_CLIP_UPLOAD_BYTES = 1536 * 1024 * 1024;
const MAX_DIRECT_CLIP_UPLOAD_LABEL = formatUploadLimit(MAX_DIRECT_CLIP_UPLOAD_BYTES);
const CLIP_DIRECT_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
const GOOGLE_CLOUD_STORAGE_FREE_TIER_BYTES = 5 * 1024 * 1024 * 1024;
const CLIP_ADMIN_TOKEN = String(process.env.CLIP_ADMIN_TOKEN || '').trim();
const KALSHI_LAB_TOKEN = String(process.env.KALSHI_LAB_TOKEN || '').trim();
const KALSHI_TRADE_TOKEN = String(process.env.KALSHI_TRADE_TOKEN || process.env.KALSHI_LAB_TOKEN || '').trim();
const NOVA_AUTH_REQUIRED = String(process.env.NOVA_AUTH_REQUIRED || 'true').trim().toLowerCase() !== 'false';
const FIREBASE_PROJECT_ID = String(
  process.env.FIREBASE_PROJECT_ID
  || process.env.GCLOUD_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT
  || '',
).trim();
const FIREBASE_WEB_CONFIG = Object.freeze({
  apiKey: String(process.env.FIREBASE_WEB_API_KEY || '').trim(),
  authDomain: String(process.env.FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: String(process.env.FIREBASE_WEB_PROJECT_ID || FIREBASE_PROJECT_ID || '').trim(),
  appId: String(process.env.FIREBASE_APP_ID || '').trim(),
  messagingSenderId: String(process.env.FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  storageBucket: String(process.env.FIREBASE_STORAGE_BUCKET || '').trim(),
});
const FIREBASE_WEB_AUTH_ENABLED = Boolean(
  FIREBASE_WEB_CONFIG.apiKey
  && FIREBASE_WEB_CONFIG.authDomain
  && FIREBASE_WEB_CONFIG.projectId
);
const FIREBASE_GOOGLE_AUTH_ENABLED = String(
  process.env.FIREBASE_GOOGLE_AUTH_ENABLED || '',
).trim().toLowerCase() === 'true';
const FIREBASE_ADMIN_AUTH_ENABLED = Boolean(FIREBASE_PROJECT_ID);
const CLIP_UPLOAD_SIGNING_SECRET = String(
  process.env.CLIP_UPLOAD_SIGNING_SECRET
  || process.env.S3_SECRET_ACCESS_KEY
  || process.env.CLIP_ADMIN_TOKEN
  || 'nova-clips-upload-secret',
).trim();
const MAX_MODERATION_QUEUE_ITEMS = 60;
const CLIP_MODERATION_PROCESSING_STALE_MS = Math.max(
  60 * 1000,
  Number(process.env.CLIP_MODERATION_PROCESSING_STALE_MS || 10 * 60 * 1000),
);
const MAX_CITY_RAID_LOBBIES = 120;
const CITY_RAID_ROOM_CODE_LENGTH = 5;
const CITY_RAID_DEFAULT_PORT = 7777;
const CITY_RAID_LOBBY_TTL_MS = 2 * 60 * 1000;
const LIVE_ROOM_CODE_LENGTH = 6;
const MAX_LIVE_ROOMS = 60;
const MAX_LIVE_VIEWERS = 24;
const MAX_LIVE_CHAT_MESSAGES = 80;
const MAX_LIVE_CHAT_LENGTH = 240;
const LIVE_ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const LIVE_HOST_RECONNECT_GRACE_MS = 2 * 60 * 1000;
const WS_HEARTBEAT_INTERVAL_MS = 25 * 1000;
const SEEDED_SONGS = Object.freeze([
  {
    id: 'seed-sude',
    title: 'Sude',
    artist: 'Ben Wagner',
    uploaderName: 'Ben Wagner',
    description: 'The first track inside AP Jukebox.',
    createdAt: '2026-04-12T12:26:58.000Z',
    sizeBytes: 35835052,
    mimeType: 'audio/wav',
    storage: 'seeded',
    audioPath: '/assets/music/sude.wav',
    fileName: 'sude.wav',
  },
]);
const RETIRED_SONG_IDS = new Set([
  'a491df71-e9ee-41c3-ba7f-ca60e7572375',
]);
const rooms = new Map();
const cityRaidLobbies = new Map();
const liveRooms = new Map();
const arcadeChatStore = createArcadeChatStore();
const simWalletStore = createSimWalletStore({
  projectId: FIREBASE_PROJECT_ID,
});
const simBitcoinPaperStore = createSimBitcoinPaperStore({
  projectId: FIREBASE_PROJECT_ID,
  simWalletStore,
});
const reviewsStore = createReviewsStore({
  dataDir: DATA_DIR,
  maxReviews: MAX_REVIEWS,
  maxVisibleReviews: MAX_VISIBLE_REVIEWS,
});
const songMediaManager = createSongMediaManager({
  dataDir: DATA_DIR,
});
const songsStore = createSongsStore({
  dataDir: DATA_DIR,
  databaseUrl: process.env.DATABASE_URL || '',
  maxSongs: MAX_SONGS,
  maxVisibleSongs: MAX_VISIBLE_SONGS,
});
const clipMediaManager = createClipMediaManager({
  dataDir: DATA_DIR,
});
const clipModerationService = createClipModerationService({
  clipMediaManager,
  dataDir: DATA_DIR,
});
const clipsStore = createClipsStore({
  dataDir: DATA_DIR,
  databaseUrl: process.env.DATABASE_URL || '',
  maxClips: MAX_CLIPS,
  maxVisibleClips: MAX_VISIBLE_CLIPS,
});
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
    title: 'Space Shooter Defense',
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
    title: 'AP Advantage Player Lounge',
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Token, X-Kalshi-Lab-Token, X-Kalshi-Trade-Token',
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

function requestHeader(req, name) {
  return String(req.headers[String(name).toLowerCase()] || '').trim();
}

function publicFirebaseWebConfig() {
  if (!FIREBASE_WEB_AUTH_ENABLED) {
    return null;
  }

  return Object.fromEntries(Object.entries({
    apiKey: FIREBASE_WEB_CONFIG.apiKey,
    authDomain: FIREBASE_WEB_CONFIG.authDomain,
    projectId: FIREBASE_WEB_CONFIG.projectId,
    appId: FIREBASE_WEB_CONFIG.appId,
    messagingSenderId: FIREBASE_WEB_CONFIG.messagingSenderId,
    storageBucket: FIREBASE_WEB_CONFIG.storageBucket,
  }).filter(([, value]) => Boolean(value)));
}

function handleAuthConfigRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  sendJsonResponse(req, res, 200, {
    ok: true,
    enabled: FIREBASE_WEB_AUTH_ENABLED,
    required: NOVA_AUTH_REQUIRED,
    adminVerifierEnabled: FIREBASE_ADMIN_AUTH_ENABLED,
    providers: {
      google: FIREBASE_GOOGLE_AUTH_ENABLED,
      password: true,
      facebook: false,
    },
    firebaseConfig: publicFirebaseWebConfig(),
  });
}

function simWalletErrorStatus(error) {
  const code = String(error && error.code || '');
  if (code === 'sim/insufficient-funds') return 409;
  if (code.startsWith('sim/')) return 400;
  return 500;
}

function normalizeSimAdjustmentCents(body = {}) {
  const amountCents = Object.prototype.hasOwnProperty.call(body, 'amountCents')
    ? Number(body.amountCents)
    : Number(body.amount) * 100;
  return Number.isFinite(amountCents) ? Math.round(amountCents) : 0;
}

function canClientCreditSim(body = {}, amountCents = normalizeSimAdjustmentCents(body)) {
  if (amountCents <= 0) {
    return true;
  }
  const source = String(body.source || '').trim();
  const action = String(body.action || '').trim();
  if (source === 'backgammon-solo' && action === 'wager-payout') {
    return amountCents > 0 && amountCents <= BACKGAMMON_MAX_WAGER_CENTS * BACKGAMMON_MAX_POINTS * 2;
  }
  if (source === 'backgammon-solo' && action === 'stake-refund') {
    return amountCents > 0 && amountCents <= BACKGAMMON_MAX_WAGER_CENTS * BACKGAMMON_MAX_POINTS;
  }
  if (source === 'space-shooter' && action === 'sim-coin-pickup') {
    return amountCents === 1;
  }
  return false;
}

function simRewardDayKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SIM_KILL_REWARD_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).reduce((carry, part) => {
      carry[part.type] = part.value;
      return carry;
    }, {});
    if (parts.year && parts.month && parts.day) {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  } catch {
    // Fall back to UTC if the configured time zone is unavailable.
  }
  return date.toISOString().slice(0, 10);
}

function normalizeKillRewardState(source, dayKey = simRewardDayKey()) {
  const current = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const games = current.games && typeof current.games === 'object' && !Array.isArray(current.games)
    ? current.games
    : {};
  const nextGames = {};
  for (const [game, entry] of Object.entries(games)) {
    nextGames[String(game).slice(0, 60)] = {
      kills: Math.max(0, Math.floor(Number(entry && entry.kills) || 0)),
      rewardCents: Math.max(0, Math.round(Number(entry && entry.rewardCents) || 0)),
      pendingKills: Math.max(0, Math.floor(Number(entry && entry.pendingKills) || 0)),
    };
  }
  return {
    dayKey,
    lastUpdatedDayKey: String(current.lastUpdatedDayKey || current.dayKey || dayKey).slice(0, 30),
    totalRewardCents: Math.max(0, Math.round(Number(current.totalRewardCents) || 0)),
    games: nextGames,
  };
}

function normalizeKillRewardGame(rawGame) {
  return String(rawGame || '').trim().toLowerCase().replace(/_/g, '-').slice(0, 60);
}

function normalizeKillRewardCount(rawCount) {
  const count = Math.floor(Number(rawCount || 1));
  if (!Number.isFinite(count) || count < 1) {
    return 1;
  }
  return Math.min(SIM_KILL_REWARD_MAX_KILLS_PER_REQUEST, count);
}

async function handleSimWalletRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
    return;
  }

  try {
    const wallet = await simWalletStore.getOrCreateWallet(auth.user);
    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet,
      store: {
        enabled: simWalletStore.enabled,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simWalletErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to load SIM wallet.',
    });
  }
}

async function handleSimWalletAdjustRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Invalid JSON body.',
    });
    return;
  }

  try {
    if (String(body.source || '') === 'bitcoin-15m-paper') {
      sendJsonResponse(req, res, 400, {
        ok: false,
        error: 'Bitcoin 15-minute SIM paper trades must use the secure game endpoint.',
      });
      return;
    }
    const amountCents = normalizeSimAdjustmentCents(body);
    if (amountCents > 0 && !canClientCreditSim(body, amountCents)) {
      sendJsonResponse(req, res, 403, {
        ok: false,
        error: 'SIM credits must come from the starter grant or a secure game reward.',
      });
      return;
    }
    const wallet = await simWalletStore.adjustWallet(auth.user, {
      amount: body.amount,
      amountCents: body.amountCents,
      source: body.source,
      action: body.action,
      note: body.note,
      metadata: body.metadata,
      allowNegative: body.allowNegative === true,
    });
    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet,
      store: {
        enabled: simWalletStore.enabled,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simWalletErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to update SIM wallet.',
    });
  }
}

async function handleSimEnemyKillRewardRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Invalid JSON body.',
    });
    return;
  }

  const game = normalizeKillRewardGame(body.game);
  const gameDef = SIM_KILL_REWARD_GAMES[game];
  if (!gameDef) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'That game does not earn SIM enemy rewards.',
    });
    return;
  }

  const requestedKills = normalizeKillRewardCount(body.killCount);
  const dayKey = simRewardDayKey();

  try {
    const tx = await simWalletStore.transactWallet(auth.user, async (wallet, context) => {
      const rewardState = normalizeKillRewardState(wallet.killRewards, dayKey);
      const gameState = rewardState.games[game] || { kills: 0, rewardCents: 0, pendingKills: 0 };
      const pendingBefore = Math.max(0, Math.floor(Number(gameState.pendingKills) || 0));
      const bankedKills = pendingBefore + requestedKills;
      const rewardUnits = Math.floor(bankedKills / SIM_KILL_REWARD_KILLS_PER_CREDIT);
      const awardCents = Math.max(0, rewardUnits * SIM_KILL_REWARD_CENTS);
      const creditedKills = rewardUnits * SIM_KILL_REWARD_KILLS_PER_CREDIT;
      const pendingKills = bankedKills % SIM_KILL_REWARD_KILLS_PER_CREDIT;
      const nextRewardState = {
        dayKey,
        lastUpdatedDayKey: dayKey,
        totalRewardCents: rewardState.totalRewardCents + awardCents,
        games: {
          ...rewardState.games,
          [game]: {
            kills: gameState.kills + requestedKills,
            rewardCents: gameState.rewardCents + awardCents,
            pendingKills,
          },
        },
      };

      if (awardCents <= 0 || creditedKills <= 0) {
        return {
          walletData: {
            ...wallet,
            updatedAt: new Date().toISOString(),
            killRewards: nextRewardState,
          },
          result: {
            game,
            gameLabel: gameDef.label,
            killCount: requestedKills,
            creditedKills: 0,
            pendingKills,
            awardCents: 0,
            award: 0,
            capped: false,
            dayKey,
            rewardCents: SIM_KILL_REWARD_CENTS,
            killsPerReward: SIM_KILL_REWARD_KILLS_PER_CREDIT,
          },
        };
      }

      const nextWallet = context.applyAdjustment(wallet, {
        amountCents: awardCents,
        source: 'game-kill-reward',
        action: 'enemy-kill-reward',
        note: `${gameDef.label} enemy kill reward`,
        metadata: {
          game,
          gameLabel: gameDef.label,
          requestedKills,
          creditedKills,
          pendingKills,
          rewardCents: SIM_KILL_REWARD_CENTS,
          killsPerReward: SIM_KILL_REWARD_KILLS_PER_CREDIT,
          dayKey,
          score: Math.max(0, Math.round(Number(body.score) || 0)),
          runId: String(body.runId || '').slice(0, 80),
        },
      });
      nextWallet.killRewards = nextRewardState;

      return {
        walletData: nextWallet,
        result: {
          game,
          gameLabel: gameDef.label,
          killCount: requestedKills,
          creditedKills,
          pendingKills,
          awardCents,
          award: awardCents / 100,
          capped: false,
          dayKey,
          rewardCents: SIM_KILL_REWARD_CENTS,
          killsPerReward: SIM_KILL_REWARD_KILLS_PER_CREDIT,
        },
      };
    });

    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet: tx.wallet,
      reward: tx.result,
      store: {
        enabled: simWalletStore.enabled,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simWalletErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to award SIM.',
    });
  }
}

function firebaseAuthVerifier() {
  if (!FIREBASE_ADMIN_AUTH_ENABLED) {
    return null;
  }

  if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({
      projectId: FIREBASE_PROJECT_ID,
    });
  }

  return firebaseAdmin.auth();
}

function bearerTokenFromRequest(req) {
  const header = requestHeader(req, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim().slice(0, 4096) : '';
}

function tokenFromSocketPayload(payload) {
  return String(
    payload && (
      payload.authToken
      || payload.idToken
      || payload.firebaseToken
      || ''
    ) || '',
  ).trim().slice(0, 4096);
}

function normalizeAuthUser(decodedToken) {
  const email = String(decodedToken && decodedToken.email || '').trim();
  const name = String(
    decodedToken && (
      decodedToken.name
      || decodedToken.displayName
      || decodedToken.firebase && decodedToken.firebase.identities && decodedToken.firebase.identities.email && decodedToken.firebase.identities.email[0]
      || ''
    ) || '',
  ).trim();

  return {
    uid: String(decodedToken && (decodedToken.uid || decodedToken.sub) || '').trim(),
    email,
    displayName: name || (email ? email.split('@')[0] : 'AP member'),
    picture: String(decodedToken && decodedToken.picture || '').trim(),
    provider: String(decodedToken && decodedToken.firebase && decodedToken.firebase.sign_in_provider || '').trim(),
  };
}

async function verifyAuthToken(idToken) {
  if (!idToken) {
    return null;
  }

  const verifier = firebaseAuthVerifier();
  if (!verifier) {
    const error = new Error('Authentication is not configured yet.');
    error.code = 'auth/not-configured';
    throw error;
  }

  const decodedToken = await verifier.verifyIdToken(idToken);
  const user = normalizeAuthUser(decodedToken);
  if (!user.uid) {
    const error = new Error('Authentication token did not include a user id.');
    error.code = 'auth/missing-uid';
    throw error;
  }
  return user;
}

async function authenticateHttpRequest(req, res, { required = NOVA_AUTH_REQUIRED } = {}) {
  const token = bearerTokenFromRequest(req);
  if (!token) {
    if (!required) {
      return { user: null };
    }
    sendJsonResponse(req, res, 401, {
      ok: false,
      error: 'Sign in is required.',
    });
    return null;
  }

  try {
    return {
      user: await verifyAuthToken(token),
    };
  } catch (error) {
    sendJsonResponse(req, res, error.code === 'auth/not-configured' ? 503 : 401, {
      ok: false,
      error: error.code === 'auth/not-configured'
        ? 'Account sign-in is not configured on this server yet.'
        : 'Your sign-in session could not be verified.',
    });
    return null;
  }
}

async function authenticateSocketPayload(socket, payload, { required = NOVA_AUTH_REQUIRED } = {}) {
  const token = tokenFromSocketPayload(payload);
  if (!token) {
    if (!required) {
      return socket.authUser || null;
    }
    sendError(socket, 'Sign in is required.');
    return null;
  }

  try {
    socket.authUser = await verifyAuthToken(token);
    return socket.authUser;
  } catch (error) {
    sendError(socket, error.code === 'auth/not-configured'
      ? 'Account sign-in is not configured on this server yet.'
      : 'Your sign-in session could not be verified.');
    return null;
  }
}

function authDisplayName(user, fallback = 'AP member', maxLength = 48) {
  return sanitizeClipField(user && (user.displayName || user.email) || fallback, maxLength) || fallback;
}

function authOwnsClip(user, clip) {
  return Boolean(
    user
    && clip
    && clip.ownerUserId
    && String(clip.ownerUserId) === String(user.uid || ''),
  );
}

function hasKalshiWeatherLabAccess(req, requestUrl) {
  if (!KALSHI_LAB_TOKEN) {
    return true;
  }
  const providedToken = requestHeader(req, 'x-kalshi-lab-token') || String(requestUrl.searchParams.get('token') || '').trim();
  return providedToken === KALSHI_LAB_TOKEN;
}

function hasKalshiTradeAccess(req, requestUrl) {
  if (!KALSHI_TRADE_TOKEN) {
    return false;
  }
  const providedToken = requestHeader(req, 'x-kalshi-trade-token')
    || requestHeader(req, 'x-kalshi-lab-token')
    || String(requestUrl.searchParams.get('token') || '').trim();
  return providedToken === KALSHI_TRADE_TOKEN;
}

function readFloatParam(requestUrl, name, defaultValue) {
  const value = Number(requestUrl.searchParams.get(name));
  return Number.isFinite(value) ? value : defaultValue;
}

async function handleKalshiWeatherLocationsRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Weather Lab token is required.' });
    return;
  }
  sendJsonResponse(req, res, 200, { locations: WEATHER_LAB_LOCATIONS });
}

async function handleKalshiWeatherScanRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Weather Lab token is required.' });
    return;
  }

  try {
    const scan = await scanWeatherMarkets({
      date: requestUrl.searchParams.get('date'),
      minEdge: readFloatParam(requestUrl, 'minEdge', 0.03),
      maxCost: readFloatParam(requestUrl, 'maxCost', 3),
      includeNegative:
        requestUrl.searchParams.get('includeNegative') === '1'
        || requestUrl.searchParams.get('includePasses') === '1',
    });
    sendJsonResponse(req, res, 200, scan);
  } catch (error) {
    const payload = { error: 'Unable to scan Kalshi weather markets right now.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

async function handleKalshiWeatherLiveRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Weather Lab token is required.' });
    return;
  }

  try {
    const live = await getWeatherLiveObservations({
      date: requestUrl.searchParams.get('date'),
      series: requestUrl.searchParams.get('series'),
      stationId: requestUrl.searchParams.get('stationId'),
      location: requestUrl.searchParams.get('location'),
    });
    sendJsonResponse(req, res, 200, live);
  } catch (error) {
    const payload = { error: 'Unable to load live weather observations right now.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

async function handleKalshiWeatherResolveRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Weather Lab token is required.' });
    return;
  }

  const tickers = String(requestUrl.searchParams.get('tickers') || '')
    .split(',')
    .map((ticker) => ticker.trim())
    .filter(Boolean);
  if (!tickers.length) {
    sendJsonResponse(req, res, 400, { error: 'At least one ticker is required.' });
    return;
  }

  try {
    sendJsonResponse(req, res, 200, await resolveWeatherMarkets(tickers));
  } catch (error) {
    const payload = { error: 'Unable to resolve Kalshi weather markets right now.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

async function handleKalshiBitcoinScanRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Lab token is required.' });
    return;
  }

  try {
    sendJsonResponse(req, res, 200, await scanBitcoin15m({
      minEdge: readFloatParam(requestUrl, 'minEdge', 0.02),
      maxCost: readFloatParam(requestUrl, 'maxCost', 5),
      minutes: readFloatParam(requestUrl, 'minutes', 180),
    }));
  } catch (error) {
    const payload = { error: 'Unable to scan Kalshi Bitcoin 15-minute market right now.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

async function handleKalshiBitcoinStreamRequest(req, res, requestUrl) {
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { error: 'A valid Kalshi Lab token is required.' });
    return;
  }

  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  res.write('retry: 500\n\n');

  let closed = false;
  let refreshing = false;
  req.on('close', () => {
    closed = true;
  });

  const sendScan = async () => {
    if (closed || refreshing) return;
    refreshing = true;
    try {
      const payload = await scanBitcoin15m({
        minEdge: readFloatParam(requestUrl, 'minEdge', 0.02),
        maxCost: readFloatParam(requestUrl, 'maxCost', 5),
        minutes: readFloatParam(requestUrl, 'minutes', 180),
      });
      res.write(`event: scan\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Unable to refresh Bitcoin scan.' })}\n\n`);
    } finally {
      refreshing = false;
    }
  };

  await sendScan();
  const interval = setInterval(() => {
    sendScan().catch(() => {});
  }, 300);
  req.on('close', () => {
    clearInterval(interval);
  });
}

async function handleKalshiBitcoinOrderPreviewRequest(req, res, requestUrl) {
  if (req.method !== 'POST') {
    sendJsonResponse(req, res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiWeatherLabAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, { ok: false, error: 'A valid Kalshi Lab token is required.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const statusCode = error.message === 'Request body too large.' ? 413 : 400;
    sendJsonResponse(req, res, statusCode, { ok: false, error: error.message });
    return;
  }

  try {
    sendJsonResponse(req, res, 200, await previewBitcoin15mOrder({
      side: body.side,
      minEdge: readFloatParam(requestUrl, 'minEdge', Number(body.minEdge || 0.02)),
      maxCost: readFloatParam(requestUrl, 'maxCost', Number(body.maxCost || 5)),
      maxContracts: readFloatParam(requestUrl, 'maxContracts', Number(body.maxContracts || 25)),
      maxPriceCents: Number(body.maxPriceCents || 0),
      minutes: readFloatParam(requestUrl, 'minutes', Number(body.minutes || 180)),
    }));
  } catch (error) {
    const payload = { ok: false, error: 'Unable to prepare a Kalshi Bitcoin order ticket right now.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

async function handleKalshiBitcoinPlaceOrderRequest(req, res, requestUrl) {
  if (req.method !== 'POST') {
    sendJsonResponse(req, res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  if (!hasKalshiTradeAccess(req, requestUrl)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: KALSHI_TRADE_TOKEN
        ? 'A valid Kalshi trade token is required before an order can be sent.'
        : 'Kalshi trade token is not configured on the server. No order was sent.',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const statusCode = error.message === 'Request body too large.' ? 413 : 400;
    sendJsonResponse(req, res, statusCode, { ok: false, error: error.message });
    return;
  }

  try {
    sendJsonResponse(req, res, 200, await placeBitcoin15mOrder({
      side: body.side,
      confirm: body.confirm,
      minEdge: readFloatParam(requestUrl, 'minEdge', Number(body.minEdge || 0.02)),
      maxCost: readFloatParam(requestUrl, 'maxCost', Number(body.maxCost || 5)),
      maxContracts: readFloatParam(requestUrl, 'maxContracts', Number(body.maxContracts || 25)),
      maxPriceCents: Number(body.maxPriceCents || 0),
      minutes: readFloatParam(requestUrl, 'minutes', Number(body.minutes || 180)),
    }));
  } catch (error) {
    const payload = { ok: false, error: 'Kalshi rejected the order or the trading request failed.' };
    if (process.env.DEBUG_ERRORS === 'true') {
      payload.detail = error.stack || error.message;
    }
    sendJsonResponse(req, res, 502, payload);
  }
}

function simBitcoinErrorStatus(error) {
  const code = String(error && error.code || '');
  if (code === 'sim/insufficient-funds') return 409;
  if (code === 'sim-bitcoin/not-marketable') return 409;
  if (code === 'sim-bitcoin/position-not-open') return 404;
  if (code.startsWith('sim-bitcoin/') || code.startsWith('sim/')) return 400;
  return 500;
}

function bitcoinCandidateForSide(scan, side) {
  const wanted = String(side || '').toLowerCase() === 'no' ? 'no' : 'yes';
  return (Array.isArray(scan && scan.candidates) ? scan.candidates : [])
    .find((candidate) => candidate && candidate.side === wanted) || null;
}

function centsFromBody(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

async function readSignedSimBitcoinBody(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return null;
  }
  if (req.method !== 'POST') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return null;
  }
  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
    return null;
  }
  try {
    return {
      auth,
      body: await readJsonBody(req),
    };
  } catch (error) {
    sendJsonResponse(req, res, error.message === 'Request body too large.' ? 413 : 400, {
      ok: false,
      error: error.message || 'Invalid JSON body.',
    });
    return null;
  }
}

async function handleSimBitcoinPaperBuyRequest(req, res) {
  const signed = await readSignedSimBitcoinBody(req, res);
  if (!signed) return;
  const { auth, body } = signed;

  try {
    const side = String(body.side || '').toLowerCase() === 'no' ? 'no' : 'yes';
    const contracts = Math.max(1, Math.min(1000, Math.floor(Number(body.contracts || 0))));
    const limitCents = Math.max(1, Math.min(99, centsFromBody(body.limitCents, 0)));
    const scan = await scanBitcoin15m({
      maxCost: Math.max(0.5, Math.min(100, Number(body.maxCost || 100))),
      maxContracts: Math.max(1, Math.min(25, contracts)),
      minEdge: -0.5,
      minutes: 60,
    });
    const candidate = bitcoinCandidateForSide(scan, side);
    const askCents = Math.max(1, Math.min(99, centsFromBody(candidate && candidate.askCents, 0)));
    if (!scan.ticker || (body.ticker && String(body.ticker) !== scan.ticker)) {
      const error = new Error('That Bitcoin 15-minute ticker is no longer the active paper market.');
      error.code = 'sim-bitcoin/ticker-not-active';
      throw error;
    }
    if (!candidate || askCents > limitCents) {
      const error = new Error('The server ask is no longer at or below your paper limit.');
      error.code = 'sim-bitcoin/not-marketable';
      throw error;
    }

    const fill = await simBitcoinPaperStore.openPosition(auth.user, {
      ticker: scan.ticker,
      side,
      contracts,
      entryCents: askCents,
      closeTime: scan.market && scan.market.closeTime,
      targetPrice: scan.market && scan.market.targetPrice,
      entrySpot: scan.market && scan.market.currentPrice,
    });

    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet: fill.wallet,
      position: fill.position,
      fill: fill.fill,
      scan: {
        ticker: scan.ticker,
        generatedAt: scan.generatedAt,
        quoteSource: scan.market && scan.market.quoteSource,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simBitcoinErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to place secure SIM Bitcoin paper buy.',
    });
  }
}

async function handleSimBitcoinPaperSellRequest(req, res) {
  const signed = await readSignedSimBitcoinBody(req, res);
  if (!signed) return;
  const { auth, body } = signed;

  try {
    const position = await simBitcoinPaperStore.readPosition(auth.user, body.positionId);
    if (!position || position.status !== 'open') {
      const error = new Error('That SIM paper position is not open.');
      error.code = 'sim-bitcoin/position-not-open';
      throw error;
    }
    const scan = await scanBitcoin15m({
      maxCost: 100,
      maxContracts: Math.max(1, Math.min(25, Math.floor(Number(body.contracts || position.contracts || 1)))),
      minEdge: -0.5,
      minutes: 60,
    });
    if (scan.ticker !== position.ticker) {
      const error = new Error('That paper market is no longer active. Settle it instead of selling.');
      error.code = 'sim-bitcoin/ticker-not-active';
      throw error;
    }
    const candidate = bitcoinCandidateForSide(scan, position.side);
    const bidCents = Math.max(1, Math.min(99, centsFromBody(candidate && candidate.bidCents, 0)));
    const limitCents = Math.max(1, Math.min(99, centsFromBody(body.limitCents, 1)));
    if (!candidate || bidCents < limitCents) {
      const error = new Error('The server bid is no longer at or above your paper sell limit.');
      error.code = 'sim-bitcoin/not-marketable';
      throw error;
    }

    const fill = await simBitcoinPaperStore.sellPosition(auth.user, {
      positionId: position.id,
      contracts: Math.max(1, Math.min(position.contracts, Math.floor(Number(body.contracts || position.contracts)))),
      priceCents: bidCents,
    });

    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet: fill.wallet,
      position: fill.position,
      fill: fill.fill,
      scan: {
        ticker: scan.ticker,
        generatedAt: scan.generatedAt,
        quoteSource: scan.market && scan.market.quoteSource,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simBitcoinErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to place secure SIM Bitcoin paper sell.',
    });
  }
}

async function handleSimBitcoinPaperSettleRequest(req, res) {
  const signed = await readSignedSimBitcoinBody(req, res);
  if (!signed) return;
  const { auth, body } = signed;

  try {
    const position = await simBitcoinPaperStore.readPosition(auth.user, body.positionId);
    if (!position || position.status !== 'open') {
      const error = new Error('That SIM paper position is not open.');
      error.code = 'sim-bitcoin/position-not-open';
      throw error;
    }
    const snapshot = await getBitcoin15mMarketSnapshot(position.ticker);
    const closeMs = new Date(position.closeTime || snapshot.settlement.closeTime || 0).getTime();
    if (!Number.isFinite(closeMs) || Date.now() < closeMs) {
      const error = new Error('That Bitcoin paper position has not reached settlement yet.');
      error.code = 'sim-bitcoin/not-settled';
      throw error;
    }
    const fill = await simBitcoinPaperStore.settlePosition(auth.user, {
      positionId: position.id,
      finalSpot: snapshot.settlement.currentPrice,
      targetPrice: Number.isFinite(Number(position.targetPrice)) ? Number(position.targetPrice) : snapshot.settlement.targetPrice,
      method: snapshot.settlement.method,
    });

    sendJsonResponse(req, res, 200, {
      ok: true,
      wallet: fill.wallet,
      position: fill.position,
      fill: fill.fill,
      snapshot: {
        generatedAt: snapshot.generatedAt,
        ticker: snapshot.ticker,
        currentPrice: snapshot.settlement.currentPrice,
        targetPrice: snapshot.settlement.targetPrice,
        method: snapshot.settlement.method,
      },
    });
  } catch (error) {
    sendJsonResponse(req, res, simBitcoinErrorStatus(error), {
      ok: false,
      error: error && error.message ? error.message : 'Unable to settle secure SIM Bitcoin paper position.',
    });
  }
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDataDir() {
  ensureDirectory(DATA_DIR);
}

function bootstrapPersistentDataDir() {
  if (DATA_DIR === DEFAULT_DATA_DIR) {
    return;
  }

  ensureDataDir();

  const legacySongsFile = path.join(DEFAULT_DATA_DIR, 'songs.json');
  const legacySongUploadDir = path.join(DEFAULT_DATA_DIR, 'songs');

  try {
    if (!fs.existsSync(SONGS_FILE) && fs.existsSync(legacySongsFile)) {
      fs.copyFileSync(legacySongsFile, SONGS_FILE);
    }

    if (!fs.existsSync(SONG_UPLOAD_DIR) && fs.existsSync(legacySongUploadDir)) {
      fs.cpSync(legacySongUploadDir, SONG_UPLOAD_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('Failed to bootstrap persistent jukebox data:', error.message);
  }
}

function logStorageConfiguration() {
  const usesCustomDataDir = DATA_DIR !== DEFAULT_DATA_DIR;
  console.log(`AP Advantage Player data dir: ${DATA_DIR}`);

  if (usesCustomDataDir) {
    console.log('AP Advantage Player uploads are configured to persist in custom storage.');
    return;
  }

  const isLikelyRenderRuntime =
    Boolean(process.env.RENDER) ||
    Boolean(process.env.RENDER_INSTANCE_ID) ||
    Boolean(process.env.RENDER_SERVICE_ID);

  if (isLikelyRenderRuntime) {
    console.warn(
      'AP Advantage Player is using the default local data directory on Render. ' +
      'Uploads may be lost when the instance restarts unless DATA_DIR points to a mounted persistent disk.',
    );
  }
}

function sanitizeReviewField(raw, maxLength) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function sanitizeSongField(raw, maxLength) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function sanitizeClipField(raw, maxLength) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeClipOrigin(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'nova-live' || value === 'nova-clips' ? value : '';
}

function sanitizeClipEmoji(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 12);
}

function normalizeClipReactionType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'like' || value === 'dislike' || value === 'emoji'
    ? value
    : '';
}

function formatUploadLimit(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${Math.round(size / (1024 * 1024))} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function normalizeDeleteToken(raw) {
  return String(raw || '').trim().slice(0, 160);
}

function normalizeAdminToken(raw) {
  return String(raw || '').trim().slice(0, 240);
}

function requestAdminToken(req, body = null) {
  const headerToken = normalizeAdminToken(req && req.headers ? req.headers['x-admin-token'] : '');
  if (headerToken) {
    return headerToken;
  }
  return normalizeAdminToken(body && body.adminToken);
}

function base64UrlEncode(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function createClipUploadToken(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', CLIP_UPLOAD_SIGNING_SECRET)
    .update(encodedPayload)
    .digest('hex');
  return `${encodedPayload}.${signature}`;
}

function verifyClipUploadToken(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken || !safeToken.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = safeToken.split('.', 2);
  const expectedSignature = crypto
    .createHmac('sha256', CLIP_UPLOAD_SIGNING_SECRET)
    .update(encodedPayload)
    .digest('hex');

  if (
    !signature ||
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const expiresAt = Number(payload && payload.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return null;
    }
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function hasClipAdminAccess(req, body = null) {
  return Boolean(CLIP_ADMIN_TOKEN) && requestAdminToken(req, body) === CLIP_ADMIN_TOKEN;
}

function sanitizeCityRaidField(raw, maxLength) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeCityRaidRoomCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CITY_RAID_ROOM_CODE_LENGTH);
}

function normalizeCityRaidPort(raw) {
  const value = Number.parseInt(String(raw || CITY_RAID_DEFAULT_PORT), 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return CITY_RAID_DEFAULT_PORT;
  }
  return value;
}

function normalizeCityRaidJoinAddress(raw, fallbackPort = CITY_RAID_DEFAULT_PORT) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }

  const match = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(value);
  if (!match) {
    return '';
  }

  const host = match[1].toLowerCase();
  const port = normalizeCityRaidPort(match[2] || fallbackPort);
  return `${host}:${port}`;
}

function createUniqueCityRaidRoomCode() {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let code = '';
    for (let index = 0; index < CITY_RAID_ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CHARS.charAt(Math.floor(Math.random() * ROOM_CHARS.length));
    }
    if (!cityRaidLobbies.has(code)) {
      return code;
    }
  }

  return crypto.randomUUID().replace(/-/g, '').slice(0, CITY_RAID_ROOM_CODE_LENGTH).toUpperCase();
}

function pruneCityRaidLobbies() {
  const now = Date.now();
  for (const [roomCode, lobby] of cityRaidLobbies.entries()) {
    if (!lobby || now > Number(lobby.expiresAt || 0)) {
      cityRaidLobbies.delete(roomCode);
    }
  }

  if (cityRaidLobbies.size <= MAX_CITY_RAID_LOBBIES) {
    return;
  }

  const oldestEntries = [...cityRaidLobbies.entries()]
    .sort((left, right) => Number(left[1].createdAt || 0) - Number(right[1].createdAt || 0));
  while (oldestEntries.length > 0 && cityRaidLobbies.size > MAX_CITY_RAID_LOBBIES) {
    const [roomCode] = oldestEntries.shift();
    cityRaidLobbies.delete(roomCode);
  }
}

function cityRaidShareUrl(roomCode) {
  return `https://bnapsen.com/city-raid.html?room=${encodeURIComponent(roomCode)}`;
}

function publicCityRaidLobby(lobby) {
  return {
    roomCode: String(lobby.roomCode || ''),
    hostName: String(lobby.hostName || ''),
    note: String(lobby.note || ''),
    joinAddress: String(lobby.joinAddress || ''),
    publicAddressHint: String(lobby.publicAddressHint || ''),
    version: String(lobby.version || ''),
    isPublic: Boolean(lobby.isPublic),
    createdAt: new Date(Number(lobby.createdAt || Date.now())).toISOString(),
    updatedAt: new Date(Number(lobby.updatedAt || Date.now())).toISOString(),
    expiresAt: new Date(Number(lobby.expiresAt || Date.now())).toISOString(),
    shareUrl: cityRaidShareUrl(String(lobby.roomCode || '')),
  };
}

function activeCityRaidLobby(roomCode) {
  pruneCityRaidLobbies();
  const normalizedRoomCode = normalizeCityRaidRoomCode(roomCode);
  if (!normalizedRoomCode) {
    return null;
  }
  return cityRaidLobbies.get(normalizedRoomCode) || null;
}

async function handleCityRaidLobbiesRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  pruneCityRaidLobbies();

  if (req.method === 'GET') {
    const lobbies = [...cityRaidLobbies.values()]
      .filter((lobby) => lobby && lobby.isPublic)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 24)
      .map(publicCityRaidLobby);
    sendJsonResponse(req, res, 200, {
      ok: true,
      lobbies,
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

  const hostName = sanitizeCityRaidField(body.hostName, 48) || 'City Raid Host';
  const note = sanitizeCityRaidField(body.note, 120);
  const version = sanitizeCityRaidField(body.version, 32);
  const requestedRoomCode = normalizeCityRaidRoomCode(body.roomCode);
  const port = normalizeCityRaidPort(body.port);
  const joinAddress = normalizeCityRaidJoinAddress(body.joinAddress, port);
  const publicAddressHint = sanitizeCityRaidField(body.publicAddressHint, 80);
  const isPublic = body.isPublic !== false;

  if (!joinAddress) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'A public join address such as 203.0.113.10:7777 is required.',
    });
    return;
  }

  const roomCode = requestedRoomCode && !cityRaidLobbies.has(requestedRoomCode)
    ? requestedRoomCode
    : createUniqueCityRaidRoomCode();
  const heartbeatToken = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const lobby = {
    roomCode,
    heartbeatToken,
    hostName,
    note,
    version,
    port,
    joinAddress,
    publicAddressHint: publicAddressHint || joinAddress,
    isPublic,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + CITY_RAID_LOBBY_TTL_MS,
  };
  cityRaidLobbies.set(roomCode, lobby);
  pruneCityRaidLobbies();

  sendJsonResponse(req, res, 201, {
    ok: true,
    roomCode,
    heartbeatToken,
    shareUrl: cityRaidShareUrl(roomCode),
    lobby: publicCityRaidLobby(lobby),
  });
}

async function handleCityRaidLobbyHeartbeatRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const roomCode = normalizeCityRaidRoomCode(body.roomCode);
  const heartbeatToken = normalizeDeleteToken(body.heartbeatToken);
  const lobby = activeCityRaidLobby(roomCode);
  if (!lobby) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'City Raid lobby not found.',
    });
    return;
  }

  if (!heartbeatToken || heartbeatToken !== String(lobby.heartbeatToken || '')) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Heartbeat token did not match this City Raid room.',
    });
    return;
  }

  const note = sanitizeCityRaidField(body.note, 120);
  const version = sanitizeCityRaidField(body.version, 32);
  const publicAddressHint = sanitizeCityRaidField(body.publicAddressHint, 80);
  const joinAddress = normalizeCityRaidJoinAddress(body.joinAddress, lobby.port);
  lobby.updatedAt = Date.now();
  lobby.expiresAt = lobby.updatedAt + CITY_RAID_LOBBY_TTL_MS;
  if (note) {
    lobby.note = note;
  }
  if (version) {
    lobby.version = version;
  }
  if (publicAddressHint) {
    lobby.publicAddressHint = publicAddressHint;
  }
  if (joinAddress) {
    lobby.joinAddress = joinAddress;
  }
  cityRaidLobbies.set(roomCode, lobby);

  sendJsonResponse(req, res, 200, {
    ok: true,
    lobby: publicCityRaidLobby(lobby),
  });
}

async function handleCityRaidLobbyCloseRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const roomCode = normalizeCityRaidRoomCode(body.roomCode);
  const heartbeatToken = normalizeDeleteToken(body.heartbeatToken);
  const lobby = activeCityRaidLobby(roomCode);
  if (!lobby) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'City Raid lobby not found.',
    });
    return;
  }

  if (!heartbeatToken || heartbeatToken !== String(lobby.heartbeatToken || '')) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Heartbeat token did not match this City Raid room.',
    });
    return;
  }

  cityRaidLobbies.delete(roomCode);
  sendJsonResponse(req, res, 200, {
    ok: true,
    closedRoomCode: roomCode,
  });
}

async function handleCityRaidLobbyResolveRequest(req, res, requestUrl) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  const roomCode = normalizeCityRaidRoomCode(requestUrl.searchParams.get('roomCode'));
  const lobby = activeCityRaidLobby(roomCode);
  if (!lobby) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'City Raid lobby not found or expired.',
    });
    return;
  }

  sendJsonResponse(req, res, 200, {
    ok: true,
    roomCode,
    joinAddress: String(lobby.joinAddress || ''),
    lobby: publicCityRaidLobby(lobby),
  });
}

async function visibleReviews() {
  return reviewsStore.listVisibleReviews(MAX_VISIBLE_REVIEWS);
}

async function cleanupRetiredSongs() {
  const storedSongs = await songsStore.listStoredSongs(MAX_SONGS);
  const retiredSongs = storedSongs.filter((song) => RETIRED_SONG_IDS.has(String(song.id || '')));
  if (!retiredSongs.length) {
    return;
  }

  try {
    await Promise.all(retiredSongs.map(async (song) => {
      await songsStore.deleteSong(song.id);
      await songMediaManager.deleteSongAsset(song);
    }));
  } catch (error) {
    console.error('Failed to clean retired songs:', error.message);
  }
}

function publicSongEntry(song) {
  const isUploaded = !String(song.audioPath || '').trim();
  const media = isUploaded ? songMediaManager.publicSongMedia(song) : null;
  return {
    id: String(song.id || ''),
    title: String(song.title || ''),
    artist: String(song.artist || ''),
    uploaderName: String(song.uploaderName || ''),
    description: String(song.description || ''),
    createdAt: String(song.createdAt || ''),
    sizeBytes: Number(song.sizeBytes || 0),
    mimeType: String(song.mimeType || ''),
    source: isUploaded ? 'community' : 'featured',
    audioPath: isUploaded
      ? media.audioPath
      : String(song.audioPath || ''),
    originalFileName: String(song.fileName || ''),
  };
}

async function visibleSongs() {
  const storedSongs = await songsStore.listVisibleSongs(MAX_VISIBLE_SONGS);
  return publicSongsFromStored(storedSongs);
}

function publicSongsFromStored(storedSongs) {
  return [...storedSongs, ...SEEDED_SONGS]
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, MAX_VISIBLE_SONGS)
    .map(publicSongEntry);
}

function publicClipEntry(clip) {
  const media = clipMediaManager.publicClipMedia(clip);
  const status = String(clip.status || 'pending');
  const rawModerationState = String(clip.moderationState || '');
  const normalizedModerationState = status === 'active' && (!rawModerationState || rawModerationState === 'queued')
    ? 'approved'
    : rawModerationState;
  const normalizedModerationSummary = String(clip.moderationSummary || '')
    || (status === 'active' && normalizedModerationState === 'approved'
      ? 'This live clip predates the automated moderation metadata rollout.'
      : '');
  return {
    id: String(clip.id || ''),
    title: String(clip.title || ''),
    caption: String(clip.caption || ''),
    uploaderName: String(clip.uploaderName || ''),
    origin: normalizeClipOrigin(clip.origin || clip.sourceOrigin || clip.sourceContext),
    createdAt: String(clip.createdAt || ''),
    durationSeconds: Number(clip.durationSeconds || 0),
    sizeBytes: Number(clip.sizeBytes || 0),
    mimeType: String(clip.mimeType || ''),
    width: Number(clip.width || 0),
    height: Number(clip.height || 0),
    viewCount: Number(clip.viewCount || 0),
    likeCount: Number(clip.likeCount || 0),
    dislikeCount: Number(clip.dislikeCount || 0),
    commentCount: Number(clip.commentCount || 0),
    emojiCounts: clip && typeof clip.emojiCounts === 'object' ? clip.emojiCounts : {},
    comments: Array.isArray(clip.comments)
      ? clip.comments.map((comment) => ({
        id: String(comment.id || ''),
        authorName: String(comment.authorName || 'Guest viewer'),
        body: String(comment.body || ''),
        emoji: String(comment.emoji || ''),
        pinned: Boolean(comment.pinned),
        createdAt: String(comment.createdAt || ''),
      }))
      : [],
    videoPath: media.videoPath,
    posterPath: media.posterPath,
    status,
    moderationState: normalizedModerationState,
    moderationSummary: normalizedModerationSummary,
    moderationReasons: Array.isArray(clip.moderationReasons) ? clip.moderationReasons.map((value) => String(value || '')) : [],
    moderationUpdatedAt: String(clip.moderationUpdatedAt || ''),
    reportCount: Number(clip.reportCount || 0),
    appealStatus: String(clip.appealStatus || 'none'),
    appealRequestedAt: String(clip.appealRequestedAt || ''),
    appealMessage: String(clip.appealMessage || ''),
    source: 'community',
  };
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
      reviews: await visibleReviews(),
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
    const { visibleReviews: nextReviews } = await reviewsStore.insertReview(review);
    sendJsonResponse(req, res, 201, {
      ok: true,
      review,
      reviews: nextReviews,
    });
  } catch (error) {
    console.error('Failed to persist review:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to save the review right now.',
    });
  }
}

function readSongUpload(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Song uploads require multipart/form-data.'));
      return;
    }

    let settled = false;
    let uploadedFile = null;
    let invalidFileType = false;
    let fileTooLarge = false;
    const fields = {};

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }

    function succeed(payload) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 8,
        fileSize: MAX_SONG_UPLOAD_BYTES,
      },
    });

    busboy.on('field', (name, value) => {
      if (!name) {
        return;
      }
      fields[String(name)] = String(value || '');
    });

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'songFile' || uploadedFile) {
        file.resume();
        return;
      }

      const originalFileName = sanitizeSongFileName(info.filename);
      const normalizedUpload = normalizeSongUploadType(originalFileName, info.mimeType);
      if (!originalFileName || !normalizedUpload) {
        invalidFileType = true;
        file.resume();
        return;
      }

      const chunks = [];
      let sizeBytes = 0;
      uploadedFile = {
        originalFileName,
        mimeType: normalizedUpload.mimeType,
        sizeBytes: 0,
        buffer: null,
      };

      file.on('data', (chunk) => {
        chunks.push(chunk);
        sizeBytes += chunk.length;
      });

      file.on('limit', () => {
        fileTooLarge = true;
      });

      file.on('end', () => {
        if (fileTooLarge) {
          return;
        }
        uploadedFile.sizeBytes = sizeBytes;
        uploadedFile.buffer = Buffer.concat(chunks);
      });
    });

    busboy.on('filesLimit', () => {
      fail(new Error('Upload only one song at a time.'));
    });

    busboy.on('error', fail);

    busboy.on('finish', () => {
      if (settled) {
        return;
      }

      if (fileTooLarge) {
        fail(new Error('Song uploads must be 24 MB or smaller.'));
        return;
      }

      if (invalidFileType) {
        fail(new Error('Upload a supported audio file: mp3, wav, ogg, m4a, aac, or flac.'));
        return;
      }

      if (!uploadedFile) {
        fail(new Error('Choose an audio file to upload.'));
        return;
      }

      if (!uploadedFile.buffer || uploadedFile.sizeBytes <= 0) {
        fail(new Error('That audio file could not be read.'));
        return;
      }

      succeed({
        fields,
        file: uploadedFile,
      });
    });

    req.pipe(busboy);
  });
}

function readClipUpload(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Clip uploads require multipart/form-data.'));
      return;
    }

    let settled = false;
    let uploadedFile = null;
    let invalidFileType = false;
    let fileTooLarge = false;
    const fields = {};

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }

    function succeed(payload) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 12,
        fileSize: MAX_CLIP_UPLOAD_BYTES,
      },
    });

    busboy.on('field', (name, value) => {
      if (!name) {
        return;
      }
      fields[String(name)] = String(value || '');
    });

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'clipFile' || uploadedFile) {
        file.resume();
        return;
      }

      const originalFileName = sanitizeClipFileName(info.filename);
      const normalizedUpload = normalizeClipUploadType(originalFileName, info.mimeType);
      if (!originalFileName || !normalizedUpload) {
        invalidFileType = true;
        file.resume();
        return;
      }

      const chunks = [];
      let sizeBytes = 0;
      uploadedFile = {
        originalFileName,
        mimeType: normalizedUpload.mimeType,
        sizeBytes: 0,
        buffer: null,
      };

      file.on('data', (chunk) => {
        chunks.push(chunk);
        sizeBytes += chunk.length;
      });

      file.on('limit', () => {
        fileTooLarge = true;
      });

      file.on('end', () => {
        if (fileTooLarge) {
          return;
        }
        uploadedFile.sizeBytes = sizeBytes;
        uploadedFile.buffer = Buffer.concat(chunks);
      });
    });

    busboy.on('filesLimit', () => {
      fail(new Error('Upload only one clip at a time.'));
    });

    busboy.on('error', fail);

    busboy.on('finish', () => {
      if (settled) {
        return;
      }

      if (fileTooLarge) {
        fail(new Error('Videos must be 30 MB or smaller through the legacy upload path.'));
        return;
      }

      if (invalidFileType) {
        fail(new Error('Upload a supported video file: mp4, webm, mov, or m4v.'));
        return;
      }

      if (!uploadedFile) {
        fail(new Error('Choose a video file to upload.'));
        return;
      }

      if (!uploadedFile.buffer || uploadedFile.sizeBytes <= 0) {
        fail(new Error('That video file could not be read.'));
        return;
      }

      succeed({
        fields,
        file: uploadedFile,
      });
    });

    req.pipe(busboy);
  });
}

async function handleClipUploadSessionRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
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

  const originalFileName = sanitizeClipFileName(body.fileName || body.originalFileName);
  const normalizedUpload = normalizeClipUploadType(originalFileName, body.mimeType);
  const sizeBytes = Number(body.sizeBytes || 0);
  const uploaderName = authDisplayName(auth.user, sanitizeClipField(body.uploaderName, 48) || 'AP member', 48);
  const title = sanitizeClipField(body.title, 80) || inferClipTitle(originalFileName);
  const caption = sanitizeClipField(body.caption, 240);
  const origin = normalizeClipOrigin(body.origin || body.sourceOrigin || body.sourceContext);

  if (!originalFileName || !normalizedUpload) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Choose a supported video file: mp4, webm, mov, m4v, or 3gp.',
    });
    return;
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip file size is required.',
    });
    return;
  }

  if (sizeBytes > MAX_DIRECT_CLIP_UPLOAD_BYTES) {
    sendJsonResponse(req, res, 413, {
      ok: false,
      error: `Videos must be ${MAX_DIRECT_CLIP_UPLOAD_LABEL} or smaller.`,
    });
    return;
  }

  const rawUploadKey = `${Date.now()}-${crypto.randomUUID()}${normalizedUpload.extension || '.mp4'}`;
  const uploadTokenPayload = {
    rawUploadKey,
    originalFileName,
    mimeType: normalizedUpload.mimeType,
    sizeBytes,
    uploaderName,
    ownerUserId: auth.user.uid,
    ownerEmail: auth.user.email,
    ownerProvider: auth.user.provider,
    title,
    caption,
    origin,
    issuedAt: Date.now(),
    expiresAt: Date.now() + CLIP_DIRECT_UPLOAD_TTL_MS,
  };

  try {
    const session = await clipMediaManager.createDirectUploadSession({
      rawUploadKey,
      mimeType: normalizedUpload.mimeType,
      sizeBytes,
      originalFileName,
    });

    sendJsonResponse(req, res, 200, {
      ok: true,
      uploadUrl: session.uploadUrl,
      uploadMethod: 'PUT',
      uploadContentType: normalizedUpload.mimeType,
      rawUploadKey,
      uploadToken: createClipUploadToken(uploadTokenPayload),
      uploadLimitBytes: MAX_DIRECT_CLIP_UPLOAD_BYTES,
      maxDurationSeconds: CLIP_MAX_DURATION_SECONDS,
      maxDurationLabel: CLIP_MAX_DURATION_LABEL,
    });
  } catch (error) {
    console.error('Failed to create direct clip upload session:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to start a direct upload right now.',
    });
  }
}

async function handleClipUploadFinalizeRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
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

  const rawUploadKey = sanitizeClipField(body.rawUploadKey, 180);
  const uploadToken = String(body.uploadToken || '').trim().slice(0, 4096);
  const uploadPayload = verifyClipUploadToken(uploadToken);

  if (!rawUploadKey || !uploadPayload || uploadPayload.rawUploadKey !== rawUploadKey) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Upload session expired or could not be verified.',
    });
    return;
  }

  if (uploadPayload.ownerUserId && uploadPayload.ownerUserId !== auth.user.uid) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'That upload session belongs to another signed-in account.',
    });
    return;
  }

  let storedClip = null;
  try {
    const uploadedAsset = await clipMediaManager.inspectRawUpload(rawUploadKey);
    if (!uploadedAsset.sizeBytes || uploadedAsset.sizeBytes > MAX_DIRECT_CLIP_UPLOAD_BYTES) {
      throw new Error(`Videos must be ${MAX_DIRECT_CLIP_UPLOAD_LABEL} or smaller.`);
    }

    const processedClip = await clipMediaManager.processRawUpload(rawUploadKey, uploadPayload.originalFileName);
    storedClip = await clipsStore.insertClip({
      id: crypto.randomUUID(),
      deleteToken: crypto.randomBytes(24).toString('hex'),
      title: sanitizeClipField(uploadPayload.title, 80) || inferClipTitle(uploadPayload.originalFileName),
      caption: sanitizeClipField(uploadPayload.caption, 240),
      uploaderName: authDisplayName(auth.user, sanitizeClipField(uploadPayload.uploaderName, 48) || 'AP member', 48),
      ownerUserId: auth.user.uid,
      ownerEmail: auth.user.email,
      ownerProvider: auth.user.provider,
      origin: normalizeClipOrigin(uploadPayload.origin),
      createdAt: new Date().toISOString(),
      durationSeconds: processedClip.durationSeconds,
      sizeBytes: processedClip.sizeBytes,
      mimeType: processedClip.mimeType,
      width: processedClip.width,
      height: processedClip.height,
      storageProvider: processedClip.storageProvider,
      videoStorageKey: processedClip.videoStorageKey,
      posterStorageKey: processedClip.posterStorageKey,
      reportCount: 0,
      status: 'pending',
      moderationState: 'queued',
      moderationSummary: 'Queued for automated moderation.',
      moderationReasons: [],
      moderationDetails: {},
      moderationUpdatedAt: new Date().toISOString(),
      appealStatus: 'none',
      appealMessage: '',
      appealRequestedAt: '',
    });

    await clipMediaManager.deleteRawUpload(rawUploadKey).catch(() => {});
    queueClipModeration(storedClip.id);

    sendJsonResponse(req, res, 201, {
      ok: true,
      clip: publicClipEntry(storedClip),
      deleteToken: storedClip.deleteToken,
      clips: await visibleClips(),
    });
  } catch (error) {
    console.error('Failed to finalize direct clip upload:', error.message);
    await clipMediaManager.deleteRawUpload(rawUploadKey).catch(() => {});
    const statusCode = /seconds|minutes|GB|MB or smaller|supported video file|could not be measured|readable video stream/i.test(String(error.message || ''))
      ? 400
      : 500;
    sendJsonResponse(req, res, statusCode, {
      ok: false,
      error: error.message || 'Unable to finalize that clip right now.',
    });
  }
}

async function visibleClips() {
  const clips = await clipsStore.listVisibleClips();
  return clips.map(publicClipEntry);
}

async function runClipModeration(clipId) {
  const clip = await clipsStore.findClipById(clipId);
  if (!clip) {
    return null;
  }

  if (clip.status === 'active' && clip.moderationState === 'approved') {
    return clip;
  }

  const processingUpdatedAt = Date.parse(String(clip.moderationUpdatedAt || ''));
  const processingIsFresh = Number.isFinite(processingUpdatedAt)
    && (Date.now() - processingUpdatedAt) < CLIP_MODERATION_PROCESSING_STALE_MS;

  if (clip.moderationState === 'processing' && processingIsFresh) {
    return clip;
  }

  await clipsStore.updateClipModeration(clipId, {
    moderationState: 'processing',
    moderationSummary: clip.moderationState === 'processing'
      ? 'Retrying a stalled moderation job now.'
      : 'Automated moderation is processing this clip now.',
    moderationUpdatedAt: new Date().toISOString(),
  });

  try {
    const moderationResult = await clipModerationService.moderateClip(clip);
    return await clipsStore.updateClipModeration(clipId, {
      status: moderationResult.status,
      moderationState: moderationResult.moderationState,
      moderationSummary: moderationResult.moderationSummary,
      moderationReasons: moderationResult.moderationReasons,
      moderationDetails: moderationResult.moderationDetails,
      moderationUpdatedAt: moderationResult.moderationUpdatedAt,
      appealStatus: moderationResult.status === 'active' ? 'none' : clip.appealStatus,
      appealMessage: moderationResult.status === 'active' ? '' : clip.appealMessage,
      appealRequestedAt: moderationResult.status === 'active' ? '' : clip.appealRequestedAt,
    });
  } catch (error) {
    console.error('Clip moderation failed:', error.message);
    return clipsStore.updateClipModeration(clipId, {
      status: 'review',
      moderationState: 'flagged',
      moderationSummary: 'Automated moderation could not finish. This clip needs review.',
      moderationReasons: [`Automated moderation failed: ${error.message}`],
      moderationDetails: {
        scanErrors: [error.message],
      },
      moderationUpdatedAt: new Date().toISOString(),
    });
  }
}

function queueClipModeration(clipId) {
  if (!clipId) {
    return;
  }

  setTimeout(() => {
    runClipModeration(clipId).catch((error) => {
      console.error('Queued clip moderation failed:', error.message);
    });
  }, 50);
}

function parseStorageFinalizeEvent(req, body = null) {
  const eventType = String(req && req.headers ? req.headers['ce-type'] || '' : '').trim();
  if (eventType !== 'google.cloud.storage.object.v1.finalized') {
    return null;
  }

  const eventData = body && typeof body === 'object' ? body : {};
  const bucket = String(eventData.bucket || '').trim();
  const objectName = String(eventData.name || '').trim();
  return bucket && objectName
    ? { bucket, objectName }
    : null;
}

async function handleClipStorageStatsRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  try {
    const stats = await clipsStore.getStorageStats();
    sendJsonResponse(req, res, 200, {
      ok: true,
      stats: {
        ...stats,
        storedClipCap: MAX_CLIPS > 0 ? MAX_CLIPS : null,
        visibleFeedCap: MAX_VISIBLE_CLIPS > 0 ? MAX_VISIBLE_CLIPS : null,
        uploadLimitBytes: MAX_DIRECT_CLIP_UPLOAD_BYTES,
        maxDurationSeconds: CLIP_MAX_DURATION_SECONDS,
        maxDurationLabel: CLIP_MAX_DURATION_LABEL,
        freeTierStorageBytes: GOOGLE_CLOUD_STORAGE_FREE_TIER_BYTES,
      },
    });
  } catch (error) {
    console.error('Failed to load clip storage stats:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to load clip storage stats right now.',
    });
  }
}

async function handleOwnedClipsRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const ownedEntries = Array.isArray(body.ownedClips)
    ? body.ownedClips.map((entry) => ({
      clipId: sanitizeClipField(entry && entry.clipId, 80),
      deleteToken: normalizeDeleteToken(entry && entry.deleteToken),
    }))
    : [];

  try {
    const clips = await clipsStore.listOwnedClips(ownedEntries);
    sendJsonResponse(req, res, 200, {
      ok: true,
      clips: clips.map(publicClipEntry),
    });
  } catch (error) {
    console.error('Failed to load owned clips:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to load your uploaded clips right now.',
    });
  }
}

async function handleClipAppealRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const deleteToken = normalizeDeleteToken(body.deleteToken);
  const appealMessage = sanitizeClipField(body.appealMessage, 280);
  if (!clipId || !deleteToken || !appealMessage) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id, delete token, and appeal message are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.requestAppeal(clipId, deleteToken, appealMessage);
    if (result.error === 'clip-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }
    if (result.error === 'forbidden') {
      sendJsonResponse(req, res, 403, {
        ok: false,
        error: 'Appeal permission not found for that clip.',
      });
      return;
    }
    if (!result.clip) {
      sendJsonResponse(req, res, 500, {
        ok: false,
        error: 'Unable to send that appeal right now.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      clip: publicClipEntry(result.clip),
    });
  } catch (error) {
    console.error('Failed to request clip appeal:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to send that appeal right now.',
    });
  }
}

async function handleClipModerationQueueRequest(req, res) {
  if (!hasClipAdminAccess(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Admin access required.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  try {
    const clips = await clipsStore.listModerationQueue(MAX_MODERATION_QUEUE_ITEMS);
    sendJsonResponse(req, res, 200, {
      ok: true,
      clips: clips.map(publicClipEntry),
    });
  } catch (error) {
    console.error('Failed to load moderation queue:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to load the moderation queue right now.',
    });
  }
}

async function handleClipModerationActionRequest(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  if (!hasClipAdminAccess(req, body)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Admin access required.',
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

  const clipId = sanitizeClipField(body.clipId, 80);
  const action = sanitizeClipField(body.action, 24).toLowerCase();
  const summary = sanitizeClipField(body.summary, 180);
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.map((value) => sanitizeClipField(value, 180)).filter(Boolean)
    : [];

  if (!clipId || !action) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id and action are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.applyModerationDecision(clipId, action, {
      moderationSummary: summary,
      moderationReasons: reasons,
      moderationUpdatedAt: new Date().toISOString(),
    });
    if (result.error === 'clip-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }
    if (result.error === 'invalid-action') {
      sendJsonResponse(req, res, 400, {
        ok: false,
        error: 'Choose approve, reject, or review.',
      });
      return;
    }
    if (!result.clip) {
      sendJsonResponse(req, res, 500, {
        ok: false,
        error: 'Unable to update moderation right now.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      clip: publicClipEntry(result.clip),
      queue: (await clipsStore.listModerationQueue(MAX_MODERATION_QUEUE_ITEMS)).map(publicClipEntry),
    });
  } catch (error) {
    console.error('Failed to update moderation decision:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to update moderation right now.',
    });
  }
}

async function handleClipModerationStorageEvent(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const event = parseStorageFinalizeEvent(req, body);
  if (!event) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Storage finalize event required.',
    });
    return;
  }

  if (event.bucket !== process.env.S3_BUCKET || !event.objectName.startsWith('clips/videos/')) {
    sendJsonResponse(req, res, 200, {
      ok: true,
      ignored: true,
    });
    return;
  }

  const videoStorageKey = event.objectName.slice('clips/videos/'.length);
  try {
    const clip = await clipsStore.findClipByVideoStorageKey(videoStorageKey);
    if (!clip) {
      sendJsonResponse(req, res, 200, {
        ok: true,
        ignored: true,
      });
      return;
    }

    const updatedClip = await runClipModeration(clip.id);
    sendJsonResponse(req, res, 200, {
      ok: true,
      clip: updatedClip ? publicClipEntry(updatedClip) : null,
    });
  } catch (error) {
    console.error('Failed to process clip moderation storage event:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to process the moderation event right now.',
    });
  }
}

async function handleClipsRequest(req, res) {
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
      clips: await visibleClips(),
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

  const auth = await authenticateHttpRequest(req, res);
  if (!auth) {
    return;
  }

  let upload;
  try {
    upload = await readClipUpload(req);
  } catch (error) {
    const statusCode = /MB or smaller/i.test(String(error.message || '')) ? 413 : 400;
    sendJsonResponse(req, res, statusCode, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const title = sanitizeClipField(upload.fields.title, 80) || inferClipTitle(upload.file.originalFileName);
  const caption = sanitizeClipField(upload.fields.caption, 240);
  const uploaderName = authDisplayName(auth.user, sanitizeClipField(upload.fields.uploaderName, 48) || 'AP member', 48);
  const origin = normalizeClipOrigin(upload.fields.origin || upload.fields.sourceOrigin || upload.fields.sourceContext);

  let storedClip = null;
  let processedClip = null;
  try {
    processedClip = await clipMediaManager.processUpload(upload.file);
    storedClip = await clipsStore.insertClip({
      id: crypto.randomUUID(),
      deleteToken: crypto.randomBytes(24).toString('hex'),
      title,
      caption,
      uploaderName,
      ownerUserId: auth.user.uid,
      ownerEmail: auth.user.email,
      ownerProvider: auth.user.provider,
      origin,
      createdAt: new Date().toISOString(),
      durationSeconds: processedClip.durationSeconds,
      sizeBytes: processedClip.sizeBytes,
      mimeType: processedClip.mimeType,
      width: processedClip.width,
      height: processedClip.height,
      storageProvider: processedClip.storageProvider,
      videoStorageKey: processedClip.videoStorageKey,
      posterStorageKey: processedClip.posterStorageKey,
      reportCount: 0,
      status: 'pending',
      moderationState: 'queued',
      moderationSummary: 'Queued for automated moderation.',
      moderationReasons: [],
      moderationDetails: {},
      moderationUpdatedAt: new Date().toISOString(),
      appealStatus: 'none',
      appealMessage: '',
      appealRequestedAt: '',
    });

    queueClipModeration(storedClip.id);

    sendJsonResponse(req, res, 201, {
      ok: true,
      clip: publicClipEntry(storedClip),
      deleteToken: storedClip.deleteToken,
      clips: await visibleClips(),
    });
  } catch (error) {
    if (storedClip) {
      await Promise.allSettled([
        clipsStore.deleteClip(storedClip.id),
        clipMediaManager.deleteClipAssets(storedClip),
      ]);
    } else if (processedClip) {
      await Promise.allSettled([
        clipMediaManager.deleteClipAssets(processedClip),
      ]);
    }

    console.error('Failed to persist clip upload:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: error.message || 'Unable to save that clip right now.',
    });
  }
}

async function handleClipDeleteRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const deleteToken = normalizeDeleteToken(body.deleteToken);
  const auth = await authenticateHttpRequest(req, res, { required: false });
  if (!auth) {
    return;
  }

  if (!clipId || (!deleteToken && !auth.user)) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id and delete permission are required.',
    });
    return;
  }

  const clip = await clipsStore.findClipById(clipId);
  if (!clip) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'Clip not found.',
    });
    return;
  }

  const tokenMatches = Boolean(deleteToken && clip.deleteToken === deleteToken);
  const ownerMatches = authOwnsClip(auth.user, clip);
  if (!tokenMatches && !ownerMatches) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Delete permission not found for that clip.',
    });
    return;
  }

  try {
    const removedClip = await clipsStore.deleteClip(clipId);
    if (removedClip) {
      await clipMediaManager.deleteClipAssets(removedClip);
    }
    sendJsonResponse(req, res, 200, {
      ok: true,
      removedClipId: clipId,
      clips: await visibleClips(),
    });
  } catch (error) {
    console.error('Failed to remove clip:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to remove that clip right now.',
    });
  }
}

async function handleClipReportRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const reporterKey = sanitizeClipField(body.reporterKey, 120);
  if (!clipId || !reporterKey) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id and reporter key are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.registerReport(clipId, reporterKey);
    if (!result.clip) {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      alreadyReported: result.alreadyReported,
      clipId,
    });
  } catch (error) {
    console.error('Failed to report clip:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to report that clip right now.',
    });
  }
}

async function handleClipViewRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const viewerKey = sanitizeClipField(body.viewerKey, 120);
  if (!clipId || !viewerKey) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id and viewer key are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.registerView(clipId, viewerKey);
    if (!result.clip) {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      countedView: result.countedView,
      clip: publicClipEntry(result.clip),
    });
  } catch (error) {
    console.error('Failed to register clip view:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to track that view right now.',
    });
  }
}

async function handleClipReactionRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const viewerKey = sanitizeClipField(body.viewerKey, 120);
  const reactionType = normalizeClipReactionType(body.reactionType);
  const emoji = sanitizeClipEmoji(body.emoji);
  if (!clipId || !viewerKey || !reactionType) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id, viewer key, and reaction type are required.',
    });
    return;
  }

  if (reactionType === 'emoji' && !emoji) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Choose an emoji reaction.',
    });
    return;
  }

  try {
    const result = await clipsStore.registerReaction(clipId, viewerKey, reactionType, emoji);
    if (!result.clip) {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      activeReaction: result.activeReaction,
      clip: publicClipEntry(result.clip),
    });
  } catch (error) {
    console.error('Failed to register clip reaction:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to save that reaction right now.',
    });
  }
}

async function handleClipCommentRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const viewerKey = sanitizeClipField(body.viewerKey, 120);
  const authorName = sanitizeClipField(body.authorName, 48) || 'Guest viewer';
  const comment = sanitizeClipField(body.comment, 180);
  const emoji = sanitizeClipEmoji(body.emoji);
  if (!clipId || !viewerKey || (!comment && !emoji)) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id, viewer key, and a comment or emoji are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.addComment(clipId, viewerKey, {
      authorName,
      body: comment,
      emoji,
    });
    if (!result.clip) {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      clip: publicClipEntry(result.clip),
      comment: result.comment,
    });
  } catch (error) {
    console.error('Failed to add clip comment:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to save that comment right now.',
    });
  }
}

async function handleClipCommentDeleteRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const commentId = sanitizeClipField(body.commentId, 80);
  const viewerKey = sanitizeClipField(body.viewerKey, 120);
  const deleteToken = normalizeDeleteToken(body.deleteToken);
  if (!clipId || !commentId) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id and comment id are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.deleteComment(clipId, commentId, {
      viewerToken: viewerKey,
      deleteToken,
    });

    if (result.error === 'clip-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    if (result.error === 'comment-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Comment not found.',
      });
      return;
    }

    if (result.error === 'forbidden') {
      sendJsonResponse(req, res, 403, {
        ok: false,
        error: 'Delete permission not found for that comment.',
      });
      return;
    }

    if (!result.clip || !result.comment) {
      sendJsonResponse(req, res, 500, {
        ok: false,
        error: 'Unable to remove that comment right now.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      deletedCommentId: result.comment.id,
      clip: publicClipEntry(result.clip),
    });
  } catch (error) {
    console.error('Failed to remove clip comment:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to remove that comment right now.',
    });
  }
}

async function handleClipCommentPinRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const clipId = sanitizeClipField(body.clipId, 80);
  const commentId = sanitizeClipField(body.commentId, 80);
  const deleteToken = normalizeDeleteToken(body.deleteToken);
  if (!clipId || !commentId || !deleteToken) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Clip id, comment id, and delete token are required.',
    });
    return;
  }

  try {
    const result = await clipsStore.pinComment(clipId, commentId, deleteToken);

    if (result.error === 'clip-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Clip not found.',
      });
      return;
    }

    if (result.error === 'comment-not-found') {
      sendJsonResponse(req, res, 404, {
        ok: false,
        error: 'Comment not found.',
      });
      return;
    }

    if (result.error === 'forbidden') {
      sendJsonResponse(req, res, 403, {
        ok: false,
        error: 'Pin permission not found for that clip.',
      });
      return;
    }

    if (!result.clip || !result.comment) {
      sendJsonResponse(req, res, 500, {
        ok: false,
        error: 'Unable to pin that comment right now.',
      });
      return;
    }

    sendJsonResponse(req, res, 200, {
      ok: true,
      pinnedCommentId: result.comment.id,
      clip: publicClipEntry(result.clip),
    });
  } catch (error) {
    console.error('Failed to pin clip comment:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to pin that comment right now.',
    });
  }
}

async function handleClipMediaRequest(req, res, requestUrl, assetType) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  const pathParts = requestUrl.pathname.split('/').filter(Boolean);
  const providerPathIndex = pathParts[1] === 'clips' && (pathParts[2] === 'local' || pathParts[2] === 's3')
    ? 2
    : -1;
  const storageProvider = providerPathIndex >= 0 ? pathParts[providerPathIndex] : 'local';
  const expectedTypeIndex = providerPathIndex >= 0 ? providerPathIndex + 1 : 2;
  const storageKeyIndex = expectedTypeIndex + 1;
  const storageKey = decodeURIComponent(pathParts[storageKeyIndex] || '');

  if (pathParts[expectedTypeIndex] !== `${assetType}s`) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'Clip media not found.',
    });
    return;
  }

  try {
    await clipMediaManager.streamAsset(req, res, assetType, storageProvider, storageKey, streamMediaFile);
  } catch (error) {
    sendJsonResponse(req, res, error.code === 'NOT_FOUND' ? 404 : 500, {
      ok: false,
      error: error.code === 'NOT_FOUND' ? 'Clip media not found.' : 'Unable to load clip media.',
    });
  }
}

async function handleSongsRequest(req, res) {
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
      songs: await visibleSongs(),
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

  let upload;
  try {
    upload = await readSongUpload(req);
  } catch (error) {
    const statusCode = /MB or smaller/i.test(String(error.message || '')) ? 413 : 400;
    sendJsonResponse(req, res, statusCode, {
      ok: false,
      error: error.message,
    });
    return;
  }

  const title = sanitizeSongField(upload.fields.title, 80) || inferSongTitle(upload.file.originalFileName);
  const artist = sanitizeSongField(upload.fields.artist, 80);
  const uploaderName = sanitizeSongField(upload.fields.uploaderName || artist, 48) || 'Guest upload';
  const description = sanitizeSongField(upload.fields.description, 280);

  try {
    const persistedMedia = await songMediaManager.persistUpload(upload.file);
    const song = {
      id: crypto.randomUUID(),
      deleteToken: crypto.randomBytes(24).toString('hex'),
      title,
      artist: artist || uploaderName,
      uploaderName,
      description,
      createdAt: new Date().toISOString(),
      sizeBytes: upload.file.sizeBytes,
      mimeType: upload.file.mimeType,
      storageProvider: persistedMedia.storageProvider,
      audioStorageKey: persistedMedia.audioStorageKey,
      fileName: upload.file.originalFileName,
      status: 'active',
    };
    await songsStore.insertSong(song);
    const nextSongs = await songsStore.listVisibleSongs(MAX_VISIBLE_SONGS);
    sendJsonResponse(req, res, 201, {
      ok: true,
      song: publicSongEntry(song),
      deleteToken: song.deleteToken,
      songs: publicSongsFromStored(nextSongs),
    });
  } catch (error) {
    console.error('Failed to persist song upload:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to save that song right now.',
    });
  }
}

async function handleSongDeleteRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
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

  const songId = sanitizeSongField(body.songId, 80);
  const deleteToken = normalizeDeleteToken(body.deleteToken);
  const legacyTitle = sanitizeSongField(body.legacyTitle, 80);
  const legacyUploaderName = sanitizeSongField(body.legacyUploaderName, 48);
  const legacyFileName = sanitizeSongFileName(body.legacyFileName);

  if (!songId) {
    sendJsonResponse(req, res, 400, {
      ok: false,
      error: 'Song id is required.',
    });
    return;
  }

  const song = await songsStore.findSongById(songId);
  if (!song) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'Song not found.',
    });
    return;
  }

  const storedDeleteToken = normalizeDeleteToken(song.deleteToken);
  const deleteByToken = Boolean(storedDeleteToken) && storedDeleteToken === deleteToken;
  const deleteLegacySong =
    !storedDeleteToken &&
    legacyTitle === sanitizeSongField(song.title, 80) &&
    legacyUploaderName === sanitizeSongField(song.uploaderName, 48) &&
    legacyFileName === sanitizeSongFileName(song.fileName);

  if (!deleteByToken && !deleteLegacySong) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Delete permission not found for that upload.',
    });
    return;
  }

  try {
    await songsStore.deleteSong(songId);
    await songMediaManager.deleteSongAsset(song);
    const nextSongs = await songsStore.listVisibleSongs(MAX_VISIBLE_SONGS);
    sendJsonResponse(req, res, 200, {
      ok: true,
      removedSongId: songId,
      songs: publicSongsFromStored(nextSongs),
    });
  } catch (error) {
    console.error('Failed to remove song:', error.message);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'Unable to remove that song right now.',
    });
  }
}

function streamMediaFile(req, res, filePath, contentType) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'Song not found.',
    });
    return;
  }

  if (!stats.isFile()) {
    sendJsonResponse(req, res, 404, {
      ok: false,
      error: 'Song not found.',
    });
    return;
  }

  const baseHeaders = {
    ...corsHeaders(req),
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };
  const rangeHeader = String(req.headers.range || '').trim();

  if (rangeHeader.startsWith('bytes=')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${stats.size}`,
      });
      res.end();
      return;
    }

    let start;
    let end;
    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(stats.size - suffixLength, 0);
      end = stats.size - 1;
    } else {
      start = Number(match[1] || 0);
      end = match[2] ? Number(match[2]) : stats.size - 1;
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      end >= stats.size
    ) {
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${stats.size}`,
      });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...baseHeaders,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': stats.size,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function handleSongMediaRequest(req, res, requestUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  const pathParts = requestUrl.pathname.split('/').filter(Boolean);
  const hasProvider = pathParts.length >= 4;
  const storageProvider = hasProvider ? pathParts[2] : 'local';
  const storageKey = decodeURIComponent(pathParts[hasProvider ? 3 : 2] || '');

  songMediaManager.streamAsset(req, res, storageProvider, storageKey, streamMediaFile)
    .catch((error) => {
      sendJsonResponse(req, res, error.code === 'NOT_FOUND' ? 404 : 500, {
        ok: false,
        error: error.code === 'NOT_FOUND' ? 'Song not found.' : 'Unable to load song media.',
      });
    });
}

async function getCityRaidZipPartStats() {
  const partNames = (await fs.promises.readdir(CITY_RAID_DOWNLOAD_DIR))
    .filter((fileName) => fileName.startsWith(`${CITY_RAID_ZIP_NAME}.part`))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  if (!partNames.length) {
    throw new Error('Missing City Raid package parts.');
  }

  return Promise.all(partNames.map(async (partName) => {
    const filePath = path.join(CITY_RAID_DOWNLOAD_DIR, partName);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`Missing City Raid package part: ${partName}`);
    }
    return {
      filePath,
      size: stats.size,
    };
  }));
}

function streamCityRaidZipParts(res, partStats) {
  let index = 0;

  const pipeNext = () => {
    if (index >= partStats.length) {
      res.end();
      return;
    }

    const current = partStats[index];
    const stream = fs.createReadStream(current.filePath);

    stream.on('error', (error) => {
      res.destroy(error);
    });

    stream.on('end', () => {
      index += 1;
      pipeNext();
    });

    stream.pipe(res, { end: false });
  };

  pipeNext();
}

async function handleCityRaidZipDownload(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Use GET or HEAD for the City Raid zip.',
    });
    return;
  }

  try {
    const partStats = await getCityRaidZipPartStats();
    const totalSize = partStats.reduce((sum, part) => sum + part.size, 0);
    res.writeHead(200, {
      ...corsHeaders(req),
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${CITY_RAID_ZIP_NAME}"`,
      'Content-Length': totalSize,
      'Cache-Control': 'public, max-age=300',
      'Accept-Ranges': 'none',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    streamCityRaidZipParts(res, partStats);
  } catch (error) {
    console.error('Failed to serve City Raid zip:', error);
    sendJsonResponse(req, res, 500, {
      ok: false,
      error: 'The City Raid zip is not available right now.',
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
  const arcadeChatState = gameDef.id === 'arcade-chat'
    ? arcadeChatStore.getRoom(code)
    : null;
  const room = {
    code,
    gameType: gameDef.id,
    gameDef,
    options: { ...options },
    maxPlayers: gameDef.maxPlayers || DEFAULT_MAX_PLAYERS,
    players: new Map(),
    game: arcadeChatState || gameDef.createGameState(options),
    nextBotActionAt: 0,
    botActorId: '',
    backgammonUndo: gameDef.id === 'backgammon'
      ? {
          player: 0,
          states: [],
        }
      : null,
    backgammonWager: gameDef.id === 'backgammon'
      ? createBackgammonWagerState(options)
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

function persistArcadeChatRoom(room) {
  if (!room || room.gameType !== 'arcade-chat' || !arcadeChatStore.enabled) {
    return;
  }

  arcadeChatStore.saveRoom(room.code, room.game).catch((error) => {
    console.error(`Failed to persist arcade chat room ${room.code}:`, error.message);
  });
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

function normalizeBackgammonStakeCents(raw) {
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(BACKGAMMON_MAX_WAGER_CENTS, Math.round(number)));
}

function normalizeBackgammonAmountCents(raw) {
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function backgammonStakeCentsFromPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const wager = source.wager && typeof source.wager === 'object' ? source.wager : {};
  return normalizeBackgammonStakeCents(
    Object.prototype.hasOwnProperty.call(wager, 'stakeCents')
      ? wager.stakeCents
      : source.stakeCents,
  );
}

function formatSimCents(amountCents) {
  const amount = normalizeBackgammonAmountCents(Math.abs(amountCents)) / 100;
  return `${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} SIM`;
}

function colorForBackgammonSide(side) {
  return side === Backgammon.WHITE ? 'white' : 'black';
}

function backgammonMaxLossCents(stakeCents) {
  return normalizeBackgammonStakeCents(stakeCents) * BACKGAMMON_MAX_POINTS;
}

function backgammonResultForGame(game) {
  const fallback = game && game.winner
    ? {
        winner: game.winner,
        loser: game.winner * -1,
        points: 1,
        resultType: 'single',
        label: 'Single game',
        reason: '',
      }
    : null;
  if (!game || !game.winner) {
    return null;
  }
  if (game.gamePoints && typeof game.gamePoints === 'object') {
    const storedPoints = Math.max(1, Math.min(BACKGAMMON_MAX_POINTS, Math.round(Number(game.gamePoints.points) || 1)));
    return {
      winner: game.gamePoints.winner || game.winner,
      loser: game.gamePoints.loser || game.winner * -1,
      points: storedPoints,
      resultType: String(game.gamePoints.resultType || 'single'),
      label: String(game.gamePoints.label || (storedPoints === 3 ? 'Backgammon' : storedPoints === 2 ? 'Gammon' : 'Single game')),
      reason: String(game.gamePoints.reason || ''),
    };
  }
  const result = typeof Backgammon.calculateGamePoints === 'function'
    ? Backgammon.calculateGamePoints(game, game.winner)
    : fallback;
  if (!result) {
    return fallback;
  }
  const points = Math.max(1, Math.min(BACKGAMMON_MAX_POINTS, Math.round(Number(result.points) || 1)));
  return {
    winner: result.winner || game.winner,
    loser: result.loser || game.winner * -1,
    points,
    resultType: String(result.resultType || 'single'),
    label: String(result.label || (points === 3 ? 'Backgammon' : points === 2 ? 'Gammon' : 'Single game')),
    reason: String(result.reason || ''),
  };
}

function createBackgammonWagerState(options = {}) {
  const stakeCents = normalizeBackgammonStakeCents(
    options.backgammonStakeCents !== undefined ? options.backgammonStakeCents : options.stakeCents,
  );
  const createdAt = new Date().toISOString();
  const maxLossCents = backgammonMaxLossCents(stakeCents);
  return {
    stakeCents,
    maxPoints: BACKGAMMON_MAX_POINTS,
    maxLossCents,
    potCents: 0,
    status: stakeCents > 0 ? 'pending' : 'off',
    started: false,
    lockedAt: '',
    settledAt: '',
    refundedAt: '',
    winnerColor: '',
    loserColor: '',
    points: 0,
    resultType: '',
    resultLabel: '',
    transferCents: 0,
    message: stakeCents > 0
      ? `${formatSimCents(stakeCents)} per point. Each player escrows up to ${formatSimCents(maxLossCents)} for a 1/2/3-point result.`
      : 'No SIM wager on this match.',
    escrowed: {
      white: false,
      black: false,
    },
    participants: {
      white: null,
      black: null,
    },
    createdAt,
  };
}

function playerByBackgammonColor(room, color) {
  if (!room || room.gameType !== 'backgammon') {
    return null;
  }
  return Array.from(room.players.values()).find((player) => player.color === color) || null;
}

function publicBackgammonParticipant(participant, player, escrowed) {
  const source = participant || player || {};
  return source && (source.name || source.id || player)
    ? {
        name: sanitizeName(source.name || (player && player.name) || 'Player'),
        ready: Boolean(escrowed),
        signedIn: Boolean((player && player.authUser && player.authUser.uid) || (participant && participant.user && participant.user.uid)),
      }
    : null;
}

function serializeBackgammonWager(room) {
  const wager = room && room.backgammonWager;
  if (!room || room.gameType !== 'backgammon' || !wager) {
    return undefined;
  }
  const stakeCents = normalizeBackgammonStakeCents(wager.stakeCents);
  const maxLossCents = backgammonMaxLossCents(stakeCents);
  return {
    enabled: stakeCents > 0,
    stake: stakeCents / 100,
    stakeCents,
    stakePerPoint: stakeCents / 100,
    stakePerPointCents: stakeCents,
    maxPoints: BACKGAMMON_MAX_POINTS,
    maxLoss: maxLossCents / 100,
    maxLossCents,
    pot: normalizeBackgammonAmountCents(wager.potCents) / 100,
    potCents: normalizeBackgammonAmountCents(wager.potCents),
    transfer: normalizeBackgammonAmountCents(wager.transferCents) / 100,
    transferCents: normalizeBackgammonAmountCents(wager.transferCents),
    points: Math.max(0, Math.min(BACKGAMMON_MAX_POINTS, Number(wager.points) || 0)),
    resultType: String(wager.resultType || ''),
    resultLabel: String(wager.resultLabel || ''),
    status: String(wager.status || (stakeCents > 0 ? 'pending' : 'off')),
    locked: wager.status === 'locked' || wager.status === 'settled',
    settled: wager.status === 'settled',
    refunded: wager.status === 'refunded',
    started: Boolean(wager.started),
    winnerColor: String(wager.winnerColor || ''),
    loserColor: String(wager.loserColor || ''),
    message: String(wager.message || ''),
    participants: {
      white: publicBackgammonParticipant(wager.participants.white, playerByBackgammonColor(room, 'white'), wager.escrowed.white),
      black: publicBackgammonParticipant(wager.participants.black, playerByBackgammonColor(room, 'black'), wager.escrowed.black),
    },
  };
}

async function adjustBackgammonWallet(user, amountCents, action, room, color, note) {
  return simWalletStore.adjustWallet(user, {
    amountCents,
    source: BACKGAMMON_WAGER_SOURCE,
    action,
    note,
    metadata: {
      roomCode: room && room.code,
      color,
      game: 'backgammon',
    },
  });
}

async function refundBackgammonWager(room, reason = 'refund') {
  const wager = room && room.backgammonWager;
  if (!wager || !wager.stakeCents || wager.status !== 'locked') {
    return '';
  }
  const refundCents = backgammonMaxLossCents(wager.stakeCents);
  const refunds = [];
  for (const color of COLORS) {
    const participant = wager.participants[color];
    if (wager.escrowed[color] && participant && participant.user) {
      refunds.push(adjustBackgammonWallet(
        participant.user,
        refundCents,
        'stake-refund',
        room,
        color,
        `Backgammon stake refunded for room ${room.code}.`,
      ));
    }
  }
  await Promise.all(refunds);
  wager.status = 'refunded';
  wager.refundedAt = new Date().toISOString();
  wager.message = `SIM point stake refunded (${reason}).`;
  return wager.message;
}

async function tryLockBackgammonWager(room) {
  const wager = room && room.backgammonWager;
  if (!wager || !wager.stakeCents || wager.status === 'locked' || wager.status === 'settled') {
    return true;
  }
  if (room.players.size < 2) {
    wager.status = 'pending';
    wager.message = `${formatSimCents(wager.stakeCents)} per point. Waiting for the second signed-in player.`;
    return false;
  }

  const white = playerByBackgammonColor(room, 'white');
  const black = playerByBackgammonColor(room, 'black');
  if (!white || !black) {
    wager.status = 'pending';
    wager.message = 'Waiting for both backgammon seats before locking the SIM point stake.';
    return false;
  }
  if (!white.authUser || !black.authUser) {
    wager.status = 'pending';
    wager.message = 'Both players need signed-in accounts before a SIM wager can start.';
    return false;
  }

  const stakeCents = normalizeBackgammonStakeCents(wager.stakeCents);
  const maxLossCents = backgammonMaxLossCents(stakeCents);
  const seats = [
    { color: 'white', player: white },
    { color: 'black', player: black },
  ];
  const debited = [];
  wager.status = 'locking';
  wager.message = 'Locking the SIM point stakes...';

  try {
    for (const seat of seats) {
      await adjustBackgammonWallet(
        seat.player.authUser,
        -maxLossCents,
        'stake-escrow',
        room,
        seat.color,
        `Backgammon max point stake escrowed for room ${room.code}.`,
      );
      debited.push(seat);
      wager.escrowed[seat.color] = true;
      wager.participants[seat.color] = {
        id: seat.player.id,
        name: seat.player.name,
        user: seat.player.authUser,
      };
    }
  } catch (error) {
    await Promise.all(debited.map((seat) => adjustBackgammonWallet(
      seat.player.authUser,
      maxLossCents,
      'stake-refund',
      room,
      seat.color,
      `Backgammon point stake rollback for room ${room.code}.`,
    ).catch(() => null)));
    for (const seat of debited) {
      wager.escrowed[seat.color] = false;
      wager.participants[seat.color] = null;
    }
    wager.status = 'failed';
    wager.message = error && error.code === 'sim/insufficient-funds'
      ? 'A player does not have enough SIM for this stake.'
      : 'The SIM point stake could not be locked. Try a smaller stake.';
    return false;
  }

  wager.status = 'locked';
  wager.maxLossCents = maxLossCents;
  wager.potCents = maxLossCents * 2;
  wager.lockedAt = new Date().toISOString();
  wager.message = `${formatSimCents(stakeCents)} per point locked. Max loss is ${formatSimCents(maxLossCents)} each; single/gammon/backgammon pays 1/2/3 points.`;
  return true;
}

function backgammonWagerPlayBlock(room) {
  const wager = room && room.backgammonWager;
  if (!wager || !wager.stakeCents) {
    return '';
  }
  if (wager.status === 'locked') {
    return '';
  }
  if (wager.status === 'settled') {
    return 'This SIM wager is already settled. Start a new match.';
  }
  if (wager.status === 'failed') {
    return wager.message || 'The SIM point stake could not be locked.';
  }
  return wager.message || 'Wait for the SIM point stake to lock before rolling.';
}

async function settleBackgammonWager(room) {
  const wager = room && room.backgammonWager;
  if (!wager || !wager.stakeCents || !room.game.winner || wager.status === 'settled') {
    return '';
  }
  if (wager.status !== 'locked') {
    wager.status = 'failed';
    wager.message = 'The match ended before the SIM point stake was locked, so no payout was made.';
    return wager.message;
  }
  const winnerColor = colorForBackgammonSide(room.game.winner);
  const loserColor = winnerColor === 'white' ? 'black' : 'white';
  const winnerParticipant = wager.participants[winnerColor] || {};
  const loserParticipant = wager.participants[loserColor] || {};
  if (!winnerParticipant.user || !loserParticipant.user) {
    wager.status = 'failed';
    wager.message = 'A player account could not be found, so the SIM stake is still locked for review.';
    return wager.message;
  }

  const result = backgammonResultForGame(room.game);
  const points = result ? result.points : 1;
  const stakeCents = normalizeBackgammonStakeCents(wager.stakeCents);
  const maxLossCents = backgammonMaxLossCents(stakeCents);
  const transferCents = Math.min(maxLossCents, stakeCents * points);
  const loserRefundCents = Math.max(0, maxLossCents - transferCents);
  const winnerCreditCents = maxLossCents + transferCents;
  const settlementJobs = [
    adjustBackgammonWallet(
      winnerParticipant.user,
      winnerCreditCents,
      'wager-payout',
      room,
      winnerColor,
      `Backgammon ${result.resultType} payout for room ${room.code}: ${points} point${points === 1 ? '' : 's'}.`,
    ),
  ];
  if (loserRefundCents > 0) {
    settlementJobs.push(adjustBackgammonWallet(
      loserParticipant.user,
      loserRefundCents,
      'stake-refund',
      room,
      loserColor,
      `Backgammon unused point stake refunded for room ${room.code}.`,
    ));
  }
  await Promise.all(settlementJobs);

  wager.status = 'settled';
  wager.settledAt = new Date().toISOString();
  wager.winnerColor = winnerColor;
  wager.loserColor = loserColor;
  wager.maxLossCents = maxLossCents;
  wager.potCents = maxLossCents * 2;
  wager.points = points;
  wager.resultType = result.resultType;
  wager.resultLabel = result.label;
  wager.transferCents = transferCents;
  wager.message = `${winnerParticipant.name || winnerColor} won a ${result.label.toLowerCase()} (${points} point${points === 1 ? '' : 's'}). ${loserParticipant.name || loserColor} loses ${formatSimCents(transferCents)} to the opponent.`;
  return wager.message;
}

async function resolveBackgammonWagerOnDisconnect(room, disconnectedPlayer) {
  const wager = room && room.backgammonWager;
  if (!wager || !wager.stakeCents || wager.status !== 'locked' || room.game.winner) {
    return '';
  }
  if (!wager.started || room.players.size === 0) {
    return refundBackgammonWager(room, 'player disconnected before the wagered match finished');
  }
  if (room.players.size === 1) {
    const winner = Array.from(room.players.values())[0];
    room.game.winner = playerBackgammonSide(winner);
    room.game.gamePoints = {
      winner: room.game.winner,
      loser: room.game.winner * -1,
      points: 1,
      resultType: 'single',
      label: 'Single game',
      reason: 'Won by forfeit.',
    };
    room.game.dice = [];
    room.game.status = `${winner.name} wins by forfeit after ${disconnectedPlayer ? disconnectedPlayer.name : 'the opponent'} disconnected.`;
    clearBackgammonUndo(room);
    return settleBackgammonWager(room);
  }
  return '';
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
    signedIn: Boolean(player.authUser && player.authUser.uid),
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
    wager: room.gameType === 'backgammon' ? serializeBackgammonWager(room) : undefined,
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
      walletCents: player.walletCents,
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

async function handleJoin(socket, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const mode = source.mode === 'join' ? 'join' : 'host';
  const gameType = normalizeGameType(source.game);
  const requestedBackgammonStakeCents = gameType === 'backgammon'
    ? backgammonStakeCentsFromPayload(source)
    : 0;
  const lookup = getRoomForJoin(source.roomCode, mode, gameType, {
    timeControlPreset: normalizeChessTimeControlPreset(source.timeControlPreset),
    variantId: MiniPool.normalizeVariantId(source.variantId),
    backgammonStakeCents: requestedBackgammonStakeCents,
  });
  if (lookup.error) {
    sendError(socket, lookup.error);
    return;
  }
  const room = lookup.room;
  const roomWagerStakeCents = room.gameType === 'backgammon' && room.backgammonWager
    ? normalizeBackgammonStakeCents(room.backgammonWager.stakeCents)
    : 0;
  if (room.gameType === 'backgammon') {
    const authUser = await authenticateSocketPayload(socket, source, {
      required: roomWagerStakeCents > 0,
    });
    if (roomWagerStakeCents > 0 && !authUser) {
      return;
    }
  }
  let blackjackWallet = null;
  if (room.gameType === 'blackjack') {
    const authUser = await authenticateSocketPayload(socket, source, {
      required: true,
    });
    if (!authUser) {
      return;
    }
    try {
      blackjackWallet = await simWalletStore.getOrCreateWallet(authUser);
    } catch (error) {
      sendError(socket, error && error.message ? error.message : 'Unable to load your SIM wallet for blackjack.');
      return;
    }
  }

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
    name: sanitizeName(source.name),
    color: identity === true ? null : identity,
    socket,
    authUser: socket.authUser || null,
    walletCents: blackjackWallet ? Math.max(0, Math.round(Number(blackjackWallet.balanceCents) || 0)) : null,
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
  if (room.gameType === 'backgammon') {
    await tryLockBackgammonWager(room);
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
    persistArcadeChatRoom(room);
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

async function handleMove(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'space-shooter') {
    sendError(socket, 'Movement in Space Shooter Defense uses realtime input, not turn-based moves.');
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

  const wagerMessage = room.gameType === 'backgammon' && room.game.winner
    ? await settleBackgammonWager(room)
    : '';
  broadcastState(room, wagerMessage || undefined);
}

function clonePlainGameState(game) {
  return JSON.parse(JSON.stringify(game));
}

function restoreRoomGame(room, snapshotState) {
  room.game = snapshotState;
  room.game.roomCode = room.code;
}

async function refreshBlackjackPlayerWallet(room, player) {
  if (!player || !player.authUser) {
    const error = new Error('Sign in is required to bet SIM at blackjack.');
    error.code = 'sim/missing-user';
    throw error;
  }
  const wallet = await simWalletStore.getOrCreateWallet(player.authUser);
  const balanceCents = Math.max(0, Math.round(Number(wallet.balanceCents) || 0));
  player.walletCents = balanceCents;
  Blackjack.syncPlayerWallet(room.game, player.id, balanceCents);
  return wallet;
}

async function refreshBlackjackWallets(room) {
  const jobs = [];
  for (const player of room.players.values()) {
    if (player.authUser) {
      jobs.push(refreshBlackjackPlayerWallet(room, player).catch(() => null));
    }
  }
  await Promise.all(jobs);
}

async function rollbackBlackjackWalletEvents(room, appliedEvents) {
  for (const entry of appliedEvents.slice().reverse()) {
    try {
      const wallet = await simWalletStore.adjustWallet(entry.player.authUser, {
        amountCents: -entry.amountCents,
        source: 'blackjack',
        action: 'blackjack-rollback',
        note: `Rollback for blackjack hand in room ${room.code}.`,
        metadata: {
          roomCode: room.code,
          game: 'blackjack',
          originalAction: entry.action,
          originalAmountCents: entry.amountCents,
        },
      });
      const balanceCents = Math.max(0, Math.round(Number(wallet.balanceCents) || 0));
      entry.player.walletCents = balanceCents;
    } catch (error) {
      console.warn('Blackjack wallet rollback failed:', error && error.message ? error.message : error);
    }
  }
}

async function applyBlackjackWalletEvents(room, events) {
  const applied = [];
  for (const event of events) {
    const player = room.players.get(event.playerId);
    if (!player || !player.authUser) {
      const error = new Error('A signed-in blackjack player could not be matched to a SIM wallet.');
      error.code = 'sim/missing-user';
      throw error;
    }
    const wallet = await simWalletStore.adjustWallet(player.authUser, {
      amountCents: event.amountCents,
      source: 'blackjack',
      action: event.action,
      note: event.note || `Blackjack SIM update in room ${room.code}.`,
      metadata: {
        roomCode: room.code,
        game: 'blackjack',
        ...event.metadata,
      },
    });
    const balanceCents = Math.max(0, Math.round(Number(wallet.balanceCents) || 0));
    player.walletCents = balanceCents;
    Blackjack.syncPlayerWallet(room.game, player.id, balanceCents);
    applied.push({
      player,
      amountCents: event.amountCents,
      action: event.action,
    });
  }
  return applied;
}

async function runBlackjackWalletMutation(room, mutate) {
  const previousState = clonePlainGameState(room.game);
  const result = mutate();
  if (!result || !result.ok) {
    Blackjack.drainWalletEvents(room.game);
    return result;
  }
  const events = Blackjack.drainWalletEvents(room.game);
  if (!events.length) {
    return result;
  }
  const applied = [];
  try {
    applied.push(...await applyBlackjackWalletEvents(room, events));
  } catch (error) {
    await rollbackBlackjackWalletEvents(room, applied);
    restoreRoomGame(room, previousState);
    throw error;
  }
  return result;
}

async function handleTableAction(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'blackjack') {
    let result;
    try {
      await refreshBlackjackPlayerWallet(room, player);
      result = await runBlackjackWalletMutation(room, () => Blackjack.applyAction(room.game, player.id, {
        type: payload.type,
      }));
    } catch (error) {
      sendError(socket, error && error.message ? error.message : 'That SIM blackjack action could not be stored.');
      return;
    }
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

  refreshBlackjackPlayerWallet(room, player)
    .then(() => {
      const result = Blackjack.setBet(room.game, player.id, payload && payload.amount, payload && payload.mode);
      if (!result.ok) {
        sendError(socket, result.error || 'That wager could not be set.');
        return;
      }
      broadcastState(room, result.message || `${player.name} changed their SIM wager.`);
    })
    .catch((error) => {
      sendError(socket, error && error.message ? error.message : 'Unable to refresh your SIM wallet.');
    });
}

async function handleStartHand(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType === 'blackjack') {
    let result;
    try {
      await refreshBlackjackWallets(room);
      result = await runBlackjackWalletMutation(room, () => Blackjack.startRound(room.game, player.id));
    } catch (error) {
      sendError(socket, error && error.message ? error.message : 'The SIM wagers could not be locked for that hand.');
      return;
    }
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
    sendError(socket, 'Chat messages are only used in AP Lounge rooms.');
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

  persistArcadeChatRoom(room);
  broadcastState(room);
}

function handleShareInvite(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Invite sharing is only used in AP Lounge rooms.');
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

  persistArcadeChatRoom(room);
  broadcastState(room);
}

function handleVoiceJoin(socket, payload) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (room.gameType !== 'arcade-chat') {
    sendError(socket, 'Voice chat is only available in AP Lounge rooms.');
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
    sendError(socket, 'Voice chat is only available in AP Lounge rooms.');
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
    sendError(socket, 'Voice chat is only available in AP Lounge rooms.');
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
    sendError(socket, 'Voice Lab is only available in AP Lounge rooms.');
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
    sendError(socket, 'Voice chat is only available in AP Lounge rooms.');
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

function sanitizeLiveText(value, fallback, maxLength) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return cleaned || fallback;
}

function sanitizeLiveChatText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LIVE_CHAT_LENGTH);
}

function normalizeLiveRoomCode(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, LIVE_ROOM_CODE_LENGTH);
}

function generateLiveRoomCode() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    let code = '';
    for (let index = 0; index < LIVE_ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    if (!liveRooms.has(code)) {
      return code;
    }
  }
  return crypto.randomUUID().replace(/-/g, '').slice(0, LIVE_ROOM_CODE_LENGTH).toUpperCase();
}

function liveViewerList(room) {
  return Array.from(room.viewers.values()).map((viewer) => ({
    id: viewer.id,
    name: viewer.name,
    joinedAt: viewer.joinedAt,
  }));
}

function liveChatHistory(room) {
  return Array.isArray(room.chatMessages) ? room.chatMessages.slice(-MAX_LIVE_CHAT_MESSAGES) : [];
}

function hasActiveLiveHost(room) {
  return Boolean(room && room.hostSocket && room.hostSocket.readyState === 1);
}

function clearLiveHostReconnectTimer(room) {
  if (room && room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
    delete room.hostReconnectTimer;
  }
}

function sendLiveViewers(room, payload) {
  if (!room || !room.viewers) {
    return;
  }
  for (const viewer of room.viewers.values()) {
    send(viewer.socket, payload);
  }
}

function sendLiveRoomMembers(room, payload) {
  if (!room) {
    return;
  }
  send(room.hostSocket, payload);
  sendLiveViewers(room, payload);
}

function clearStaleLiveRooms() {
  const now = Date.now();
  for (const [roomCode, room] of liveRooms.entries()) {
    if (now - room.createdAt > LIVE_ROOM_TTL_MS) {
      closeLiveRoom(roomCode, 'stale');
      continue;
    }
    if (!hasActiveLiveHost(room)) {
      const disconnectedAt = Number(room.hostDisconnectedAt || 0);
      if (disconnectedAt && now - disconnectedAt <= LIVE_HOST_RECONNECT_GRACE_MS) {
        continue;
      }
      closeLiveRoom(roomCode, 'stale');
    }
  }
}

function closeLiveRoom(roomCode, reason) {
  const room = liveRooms.get(roomCode);
  if (!room) {
    return;
  }

  clearLiveHostReconnectTimer(room);

  for (const viewer of room.viewers.values()) {
    send(viewer.socket, {
      type: 'live-ended',
      action: 'live-ended',
      roomCode,
      reason,
    });
    delete viewer.socket.liveRole;
    delete viewer.socket.liveRoomCode;
    delete viewer.socket.liveId;
  }

  if (room.hostSocket) {
    delete room.hostSocket.liveRole;
    delete room.hostSocket.liveRoomCode;
    delete room.hostSocket.liveId;
  }

  liveRooms.delete(roomCode);
}

function markLiveHostDisconnected(roomCode, room, reason) {
  if (!room) {
    return;
  }

  clearLiveHostReconnectTimer(room);
  if (room.hostSocket) {
    delete room.hostSocket.liveRole;
    delete room.hostSocket.liveRoomCode;
    delete room.hostSocket.liveId;
  }

  room.hostSocket = null;
  room.hostDisconnectedAt = Date.now();
  sendLiveViewers(room, {
    type: 'live-host-reconnecting',
    action: 'live-host-reconnecting',
    roomCode,
    reason,
    graceMs: LIVE_HOST_RECONNECT_GRACE_MS,
  });

  room.hostReconnectTimer = setTimeout(() => {
    const latestRoom = liveRooms.get(roomCode);
    if (latestRoom && !hasActiveLiveHost(latestRoom)) {
      closeLiveRoom(roomCode, 'host-timeout');
    }
  }, LIVE_HOST_RECONNECT_GRACE_MS);
}

function sendLiveViewerList(room) {
  if (!room || !room.hostSocket) {
    return;
  }
  send(room.hostSocket, {
    type: 'live-viewer-list',
    action: 'live-viewer-list',
    roomCode: room.code,
    viewers: liveViewerList(room),
  });
  for (const viewer of room.viewers.values()) {
    send(viewer.socket, {
      type: 'live-viewer-count',
      action: 'live-viewer-count',
      roomCode: room.code,
      count: room.viewers.size,
    });
  }
}

function publicLiveRoom(room) {
  return {
    roomCode: room.code,
    hostName: room.hostName,
    title: room.title,
    viewerCount: room.viewers ? room.viewers.size : 0,
    createdAt: new Date(room.createdAt || Date.now()).toISOString(),
    sharePath: `/nova-live.html?room=${encodeURIComponent(room.code)}`,
  };
}

function liveRoomDirectory() {
  clearStaleLiveRooms();
  return Array.from(liveRooms.values())
    .filter((room) => hasActiveLiveHost(room))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .map(publicLiveRoom);
}

async function handleLiveRoomsRequest(req, res) {
  if (!isAllowedHttpOrigin(req)) {
    sendJsonResponse(req, res, 403, {
      ok: false,
      error: 'Origin not allowed.',
    });
    return;
  }
  if (req.method !== 'GET') {
    sendJsonResponse(req, res, 405, {
      ok: false,
      error: 'Method not allowed.',
    });
    return;
  }

  sendJsonResponse(req, res, 200, {
    ok: true,
    rooms: liveRoomDirectory(),
    maxRooms: MAX_LIVE_ROOMS,
    maxViewers: MAX_LIVE_VIEWERS,
    asOf: new Date().toISOString(),
  });
}

function cleanupLiveSocket(socket, reason = 'leave') {
  const roomCode = normalizeLiveRoomCode(socket.liveRoomCode || '');
  const liveId = String(socket.liveId || '');
  const role = String(socket.liveRole || '');
  if (!roomCode || !liveId || !role) {
    return;
  }

  const room = liveRooms.get(roomCode);
  delete socket.liveRole;
  delete socket.liveRoomCode;
  delete socket.liveId;

  if (!room) {
    return;
  }

  if (role === 'host' && room.hostId === liveId) {
    if (reason === 'leave' || reason === 'replace') {
      closeLiveRoom(roomCode, reason);
      return;
    }
    markLiveHostDisconnected(roomCode, room, reason);
    return;
  }

  if (role === 'viewer' && room.viewers.has(liveId)) {
    const viewer = room.viewers.get(liveId);
    room.viewers.delete(liveId);
    send(room.hostSocket, {
      type: 'live-viewer-left',
      action: 'live-viewer-left',
      roomCode,
      viewerId: liveId,
      viewerName: viewer ? viewer.name : 'Viewer',
    });
    sendLiveViewerList(room);
  }
}

async function handleLiveHost(socket, payload) {
  const auth = await authenticateSocketPayload(socket, payload);
  if (!auth) {
    return;
  }

  clearStaleLiveRooms();
  cleanupLiveSocket(socket, 'replace');

  let roomCode = normalizeLiveRoomCode(payload && payload.roomCode);
  if (!roomCode) {
    roomCode = generateLiveRoomCode();
  }

  const existingRoom = liveRooms.get(roomCode);
  if (existingRoom) {
    if (hasActiveLiveHost(existingRoom)) {
      sendError(socket, 'That live room code is already on air.');
      return;
    }

    clearLiveHostReconnectTimer(existingRoom);
    if (existingRoom.hostUserId && existingRoom.hostUserId !== auth.uid) {
      sendError(socket, 'That live room belongs to another signed-in account.');
      return;
    }
    existingRoom.hostSocket = socket;
    existingRoom.hostName = sanitizeLiveText(authDisplayName(auth, existingRoom.hostName || 'AP Host', 40), existingRoom.hostName || 'AP Host', 40);
    existingRoom.title = sanitizeLiveText(payload && payload.title, existingRoom.title || 'Live from AP Advantage Player', 70);
    existingRoom.hostUserId = auth.uid;
    existingRoom.hostDisconnectedAt = 0;

    socket.liveRole = 'host';
    socket.liveRoomCode = roomCode;
    socket.liveId = existingRoom.hostId;

    send(socket, {
      type: 'live-ready',
      action: 'live-ready',
      role: 'host',
      roomCode,
      hostId: existingRoom.hostId,
      hostName: existingRoom.hostName,
      title: existingRoom.title,
      viewers: liveViewerList(existingRoom),
      chatMessages: liveChatHistory(existingRoom),
      resumed: true,
    });
    sendLiveViewers(existingRoom, {
      type: 'live-host-resumed',
      action: 'live-host-resumed',
      roomCode,
      hostId: existingRoom.hostId,
      hostName: existingRoom.hostName,
      title: existingRoom.title,
    });
    return;
  }

  if (liveRooms.size >= MAX_LIVE_ROOMS) {
    sendError(socket, 'Live rooms are full right now.');
    return;
  }

  const hostId = crypto.randomUUID();
  const room = {
    code: roomCode,
    hostId,
    hostUserId: auth.uid,
    hostName: sanitizeLiveText(authDisplayName(auth, 'AP Host', 40), 'AP Host', 40),
    title: sanitizeLiveText(payload && payload.title, 'Live from AP Advantage Player', 70),
    hostSocket: socket,
    viewers: new Map(),
    chatMessages: [],
    createdAt: Date.now(),
  };

  liveRooms.set(roomCode, room);
  socket.liveRole = 'host';
  socket.liveRoomCode = roomCode;
  socket.liveId = hostId;

  send(socket, {
    type: 'live-ready',
    action: 'live-ready',
    role: 'host',
    roomCode,
    hostId,
    hostName: room.hostName,
    title: room.title,
    viewers: [],
    chatMessages: [],
  });
}

async function handleLiveViewer(socket, payload) {
  const auth = await authenticateSocketPayload(socket, payload);
  if (!auth) {
    return;
  }

  clearStaleLiveRooms();
  cleanupLiveSocket(socket, 'replace');

  const roomCode = normalizeLiveRoomCode(payload && payload.roomCode);
  if (!roomCode) {
    sendError(socket, 'A live room code is required.');
    return;
  }

  const room = liveRooms.get(roomCode);
  if (!room || !room.hostSocket || room.hostSocket.readyState !== 1) {
    sendError(socket, 'That live room is not on air.');
    return;
  }
  if (room.viewers.size >= MAX_LIVE_VIEWERS) {
    sendError(socket, 'That live room is full.');
    return;
  }

  const viewer = {
    id: crypto.randomUUID(),
    userId: auth.uid,
    name: sanitizeLiveText(authDisplayName(auth, 'Viewer', 40), 'Viewer', 40),
    socket,
    joinedAt: new Date().toISOString(),
  };

  room.viewers.set(viewer.id, viewer);
  socket.liveRole = 'viewer';
  socket.liveRoomCode = roomCode;
  socket.liveId = viewer.id;

  send(socket, {
    type: 'live-ready',
    action: 'live-ready',
    role: 'viewer',
    roomCode,
    viewerId: viewer.id,
    hostId: room.hostId,
    hostName: room.hostName,
    title: room.title,
    count: room.viewers.size,
    chatMessages: liveChatHistory(room),
  });

  send(room.hostSocket, {
    type: 'live-viewer-joined',
    action: 'live-viewer-joined',
    roomCode,
    viewer: {
      id: viewer.id,
      name: viewer.name,
      joinedAt: viewer.joinedAt,
    },
  });
  sendLiveViewerList(room);
}

function handleLiveSignal(socket, payload) {
  const roomCode = normalizeLiveRoomCode(socket.liveRoomCode || payload && payload.roomCode);
  const liveId = String(socket.liveId || '');
  const role = String(socket.liveRole || '');
  const signal = payload && payload.signal;
  const targetId = String(payload && (payload.targetId || payload.toId) || '').trim();

  if (!roomCode || !liveId || !role || !signal || typeof signal !== 'object') {
    return;
  }

  const room = liveRooms.get(roomCode);
  if (!room) {
    return;
  }

  if (role === 'host') {
    const viewer = room.viewers.get(targetId);
    if (!viewer) {
      return;
    }
    send(viewer.socket, {
      type: 'live-signal',
      action: 'live-signal',
      roomCode,
      fromId: liveId,
      fromName: room.hostName,
      signal,
    });
    return;
  }

  if (role === 'viewer' && targetId === room.hostId) {
    const viewer = room.viewers.get(liveId);
    send(room.hostSocket, {
      type: 'live-signal',
      action: 'live-signal',
      roomCode,
      fromId: liveId,
      fromName: viewer ? viewer.name : 'Viewer',
      signal,
    });
  }
}

async function handleLiveChat(socket, payload) {
  const auth = socket.authUser || await authenticateSocketPayload(socket, payload);
  if (!auth) {
    return;
  }

  const roomCode = normalizeLiveRoomCode(socket.liveRoomCode || payload && payload.roomCode);
  const liveId = String(socket.liveId || '');
  const role = String(socket.liveRole || '');
  if (!roomCode || !liveId || !role) {
    sendError(socket, 'Join a live room before chatting.');
    return;
  }

  const room = liveRooms.get(roomCode);
  if (!room) {
    sendError(socket, 'That live room is not on air.');
    return;
  }

  let senderName = '';
  if (role === 'host' && room.hostId === liveId && (!room.hostUserId || room.hostUserId === auth.uid)) {
    senderName = room.hostName;
  } else if (role === 'viewer' && room.viewers.has(liveId)) {
    const viewer = room.viewers.get(liveId);
    if (!viewer.userId || viewer.userId === auth.uid) {
      senderName = viewer.name;
    }
  }

  if (!senderName) {
    sendError(socket, 'Join a live room before chatting.');
    return;
  }

  const text = sanitizeLiveChatText(payload && payload.message);
  if (!text) {
    return;
  }

  const chatMessage = {
    id: crypto.randomUUID(),
    roomCode,
    senderId: liveId,
    senderName,
    senderRole: role,
    message: text,
    createdAt: new Date().toISOString(),
  };

  if (!Array.isArray(room.chatMessages)) {
    room.chatMessages = [];
  }
  room.chatMessages.push(chatMessage);
  if (room.chatMessages.length > MAX_LIVE_CHAT_MESSAGES) {
    room.chatMessages.splice(0, room.chatMessages.length - MAX_LIVE_CHAT_MESSAGES);
  }

  sendLiveRoomMembers(room, {
    type: 'live-chat',
    action: 'live-chat',
    roomCode,
    message: chatMessage,
  });
}

function handleLiveLeave(socket) {
  cleanupLiveSocket(socket, 'leave');
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
  const wagerBlock = backgammonWagerPlayBlock(room);
  if (wagerBlock) {
    sendError(socket, wagerBlock);
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
  if (room.backgammonWager && room.backgammonWager.stakeCents) {
    room.backgammonWager.started = true;
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
  if (room.backgammonWager && room.backgammonWager.stakeCents && room.backgammonWager.status === 'locked') {
    sendError(socket, 'Undo is disabled once a SIM wager is locked.');
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

async function handleRestart(socket) {
  const context = requirePlayer(socket);
  if (!context) {
    return;
  }

  const { room, player } = context;
  if (
    room.gameType === 'backgammon'
    && room.backgammonWager
    && room.backgammonWager.stakeCents
    && room.backgammonWager.status === 'locked'
    && !room.game.winner
  ) {
    sendError(socket, 'Finish the locked SIM wager before starting a new backgammon match.');
    return;
  }
  if (room.gameType === 'arcade-chat') {
    sendError(socket, 'AP Lounge rooms do not use reset.');
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
    await refreshBlackjackWallets(room);
    Blackjack.resetTable(room.game);
  } else {
    room.game = room.gameDef.createGameState(room.options);
    room.game.roomCode = room.code;
    if (room.gameType === 'backgammon') {
      clearBackgammonUndo(room);
      const stakeCents = room.backgammonWager
        ? normalizeBackgammonStakeCents(room.backgammonWager.stakeCents)
        : normalizeBackgammonStakeCents(room.options && room.options.backgammonStakeCents);
      room.backgammonWager = createBackgammonWagerState({ stakeCents });
      await tryLockBackgammonWager(room);
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

async function handleDisconnect(socket) {
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
    if (room.gameType === 'backgammon') {
      await refundBackgammonWager(room, 'room closed');
    }
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
    persistArcadeChatRoom(room);
  } else if (room.gameType === 'backgammon') {
    clearBackgammonUndo(room);
    await resolveBackgammonWagerOnDisconnect(room, player);
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
    broadcastState(room, room.gameType === 'backgammon' && room.backgammonWager && room.backgammonWager.message
      ? room.backgammonWager.message
      : message);
  }
}

function cleanupDisconnectedSocket(socket, reason) {
  if (socket.didDisconnectCleanup) {
    return;
  }
  socket.didDisconnectCleanup = true;
  cleanupLiveSocket(socket, reason);
  handleDisconnect(socket).catch((error) => {
    console.error('Disconnect cleanup failed:', error.message);
  });
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
      liveRooms: liveRooms.size,
    });
    return;
  }

  if (requestUrl.pathname === '/api/auth/config') {
    handleAuthConfigRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/wallet') {
    await handleSimWalletRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/wallet/adjust') {
    await handleSimWalletAdjustRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/enemy-kill') {
    await handleSimEnemyKillRewardRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/bitcoin-15m/buy') {
    await handleSimBitcoinPaperBuyRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/bitcoin-15m/sell') {
    await handleSimBitcoinPaperSellRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/sim/bitcoin-15m/settle') {
    await handleSimBitcoinPaperSettleRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/reviews') {
    await handleReviewsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/songs') {
    await handleSongsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips') {
    await handleClipsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/live/rooms') {
    await handleLiveRoomsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/weather/locations') {
    await handleKalshiWeatherLocationsRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/weather/scan') {
    await handleKalshiWeatherScanRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/weather/live') {
    await handleKalshiWeatherLiveRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/weather/resolve') {
    await handleKalshiWeatherResolveRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/bitcoin/scan') {
    await handleKalshiBitcoinScanRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/bitcoin/stream') {
    await handleKalshiBitcoinStreamRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/bitcoin/order-preview') {
    await handleKalshiBitcoinOrderPreviewRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/kalshi/bitcoin/place-order') {
    await handleKalshiBitcoinPlaceOrderRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === '/api/clips/upload-session') {
    await handleClipUploadSessionRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/finalize-upload') {
    await handleClipUploadFinalizeRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/admin/storage') {
    await handleClipStorageStatsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/admin/moderation-queue') {
    await handleClipModerationQueueRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/owned') {
    await handleOwnedClipsRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/songs/delete') {
    await handleSongDeleteRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/delete') {
    await handleClipDeleteRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/report') {
    await handleClipReportRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/view') {
    await handleClipViewRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/react') {
    await handleClipReactionRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/comment') {
    await handleClipCommentRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/appeal') {
    await handleClipAppealRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/admin/moderation-action') {
    await handleClipModerationActionRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/comment/delete') {
    await handleClipCommentDeleteRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/api/clips/comment/pin') {
    await handleClipCommentPinRequest(req, res);
    return;
  }

  if (requestUrl.pathname === '/internal/moderate-storage-event') {
    await handleClipModerationStorageEvent(req, res);
    return;
  }

  if (requestUrl.pathname.startsWith('/media/songs/')) {
    handleSongMediaRequest(req, res, requestUrl);
    return;
  }

  if (
    requestUrl.pathname.startsWith('/media/clips/videos/') ||
    requestUrl.pathname.startsWith('/media/clips/local/videos/') ||
    requestUrl.pathname.startsWith('/media/clips/s3/videos/')
  ) {
    await handleClipMediaRequest(req, res, requestUrl, 'video');
    return;
  }

  if (
    requestUrl.pathname.startsWith('/media/clips/posters/') ||
    requestUrl.pathname.startsWith('/media/clips/local/posters/') ||
    requestUrl.pathname.startsWith('/media/clips/s3/posters/')
  ) {
    await handleClipMediaRequest(req, res, requestUrl, 'poster');
    return;
  }

  if (requestUrl.pathname === '/downloads/city-raid/City-Raid-Win64.zip') {
    await handleCityRaidZipDownload(req, res);
    return;
  }

  sendJsonResponse(req, res, 200, {
    ok: true,
    service: 'nova-arcade-realtime',
    games: Object.keys(GAME_DEFS),
    websocket: true,
    reviewsApi: '/api/reviews',
    songsApi: '/api/songs',
    clipsApi: '/api/clips',
    liveRoomsApi: '/api/live/rooms',
    kalshiWeatherApi: '/api/kalshi/weather/scan',
    kalshiBitcoinApi: '/api/kalshi/bitcoin/scan',
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (buffer) => {
    let payload;
    try {
      payload = JSON.parse(String(buffer));
    } catch (error) {
      sendError(socket, 'That message was not valid JSON.');
      return;
    }

    const action = payload.action || payload.type;
    switch (action) {
      case 'join':
        handleJoin(socket, payload).catch((error) => {
          console.error('Join failed:', error.message);
          sendError(socket, 'Unable to join that room right now.');
        });
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
      case 'live-host':
        handleLiveHost(socket, payload).catch((error) => {
          console.error('Live host auth failed:', error.message);
          sendError(socket, 'Unable to start that live room right now.');
        });
        break;
      case 'live-viewer':
        handleLiveViewer(socket, payload).catch((error) => {
          console.error('Live viewer auth failed:', error.message);
          sendError(socket, 'Unable to join that live room right now.');
        });
        break;
      case 'live-signal':
        handleLiveSignal(socket, payload);
        break;
      case 'live-chat':
        handleLiveChat(socket, payload).catch((error) => {
          console.error('Live chat auth failed:', error.message);
          sendError(socket, 'Unable to send that chat message right now.');
        });
        break;
      case 'live-leave':
        handleLiveLeave(socket);
        break;
      case 'shoot':
        handleShot(socket, payload);
        break;
      case 'roll':
        handleRoll(socket);
        break;
      case 'move':
        handleMove(socket, payload).catch((error) => {
          console.error('Move failed:', error.message);
          sendError(socket, 'Unable to play that move right now.');
        });
        break;
      case 'undo':
        handleUndo(socket);
        break;
      case 'act':
        handleTableAction(socket, payload).catch((error) => {
          console.error('Table action failed:', error.message);
          sendError(socket, 'Unable to play that table action right now.');
        });
        break;
      case 'set-bet':
        handleSetBet(socket, payload);
        break;
      case 'start-hand':
        handleStartHand(socket).catch((error) => {
          console.error('Start hand failed:', error.message);
          sendError(socket, 'Unable to start that hand right now.');
        });
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
        handleRestart(socket).catch((error) => {
          console.error('Restart failed:', error.message);
          sendError(socket, 'Unable to restart that match right now.');
        });
        break;
      default:
        sendError(socket, 'Unknown action.');
        break;
    }
  });

  socket.on('close', () => {
    cleanupDisconnectedSocket(socket, 'disconnect');
  });

  socket.on('error', () => {
    cleanupDisconnectedSocket(socket, 'error');
  });
});

const wsHeartbeatTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      cleanupDisconnectedSocket(socket, 'heartbeat-timeout');
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch (error) {
      cleanupDisconnectedSocket(socket, 'heartbeat-error');
      socket.terminate();
    }
  }
}, WS_HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(wsHeartbeatTimer);
});

setInterval(tickRealtimeRooms, TICK_MS);
bootstrapPersistentDataDir();
logStorageConfiguration();
songMediaManager.ensureSongDirs();
songMediaManager.logConfiguration();
clipMediaManager.ensureClipDirs();
clipMediaManager.logConfiguration();

Promise.all([
  reviewsStore.init(),
  arcadeChatStore.init(),
  songsStore.init(),
  clipsStore.init(),
])
  .then(async () => {
    await Promise.all([
      songMediaManager.ensureBucket(),
      clipMediaManager.ensureBucket(),
    ]);
    await cleanupRetiredSongs();
    console.log(
      `Song metadata store: ${
        songsStore.usesObjectStorage ? 's3-compatible object storage' : songsStore.usesPostgres ? 'postgres' : 'local json'
      }`,
    );
    console.log(
      `Clip metadata store: ${
        clipsStore.usesObjectStorage ? 's3-compatible object storage' : clipsStore.usesPostgres ? 'postgres' : 'local json'
      }`,
    );
    console.log(
      `Review metadata store: ${reviewsStore.usesObjectStorage ? 's3-compatible object storage' : 'local json'}`,
    );
    console.log(
      `Arcade chat persistence: ${arcadeChatStore.enabled ? 'firestore' : 'in-memory only'}`,
    );
    server.listen(PORT, HOST, () => {
      console.log(`AP Advantage Player realtime server running at ws://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize media services:', error.message);
    process.exit(1);
  });
