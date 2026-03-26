(() => {
  'use strict';

  const Core = window.StarlineDefenseCore;
  const STORAGE_KEYS = {
    name: 'starlineDefense.name',
    serverUrl: 'starlineDefense.serverUrl',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const ARENA = Core.ARENA;
  const PLAYER_SPEED = 360;
  const PLAYER_BOOST_SPEED = 520;
  const INPUT_SEND_MS = 50;
  const query = new URLSearchParams(window.location.search);
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    statusText: document.getElementById('statusText'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    waveLabel: document.getElementById('waveLabel'),
    scoreLabel: document.getElementById('scoreLabel'),
    conditionLabel: document.getElementById('conditionLabel'),
    missionText: document.getElementById('missionText'),
    objectiveText: document.getElementById('objectiveText'),
    squadLevelLabel: document.getElementById('squadLevelLabel'),
    controlHint: document.getElementById('controlHint'),
    presenceText: document.getElementById('presenceText'),
    playerCards: document.getElementById('playerCards'),
    canvas: document.getElementById('gameCanvas'),
    stage: document.getElementById('arenaStage'),
    toast: document.getElementById('toast'),
    movePad: document.getElementById('movePad'),
    moveKnob: document.getElementById('moveKnob'),
    aimPad: document.getElementById('aimPad'),
    aimKnob: document.getElementById('aimKnob'),
    boostBtn: document.getElementById('boostBtn'),
  };
  const ctx = ui.canvas.getContext('2d');

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    localGame: null,
    yourPlayerId: '',
    roomCode: '',
    serverUrl: '',
    statusMessage: '',
    toastTimer: 0,
    renderCache: {
      players: new Map(),
      enemies: new Map(),
      playerBullets: new Map(),
      enemyBullets: new Map(),
      pickups: new Map(),
    },
    pointer: {
      x: ARENA.width / 2,
      y: ARENA.height * 0.68,
      fire: false,
      active: false,
    },
    touch: {
      move: { active: false, pointerId: null, nx: 0, ny: 0 },
      aim: { active: false, pointerId: null, nx: 0, ny: 0 },
      boost: false,
    },
    keys: {
      up: false,
      down: false,
      left: false,
      right: false,
      fire: false,
      boost: false,
    },
    lastInputSentAt: 0,
    latestInput: {
      moveX: 0,
      moveY: 0,
      aimX: ARENA.width / 2,
      aimY: ARENA.height / 2,
      fire: false,
      boost: false,
    },
    stars: [],
    lastFrameAt: performance.now(),
    nextUiRefreshAt: 0,
    cameraShake: 0,
    knownHealth: new Map(),
    lastEnemyCount: 0,
    lastEventId: 0,
    lastLocalBulletCount: 0,
    audio: {
      ctx: null,
      unlocked: false,
      lastShotAt: 0,
      lastDamageAt: 0,
      lastEnemyDownAt: 0,
      lastEnemyBulletCount: 0,
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distanceSquared(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function lerpAngle(start, end, amount) {
    const delta = ((((end - start) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return start + delta * amount;
  }

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return PROD_SERVER_URL;
    }
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'Pilot';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
  }

  function ensureAudio() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      return null;
    }
    if (!state.audio.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audio.ctx = new AudioCtx();
    }
    if (state.audio.ctx.state === 'suspended') {
      state.audio.ctx.resume().catch(() => {});
    }
    state.audio.unlocked = true;
    return state.audio.ctx;
  }

  function scheduleTone(options) {
    const ctx = ensureAudio();
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime + (options.delay || 0);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = options.type || 'triangle';
    oscillator.frequency.setValueAtTime(options.from, now);
    if (typeof options.to === 'number') {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(10, options.to), now + options.duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(options.gain || 0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + options.duration + 0.02);
  }

  function scheduleNoise(duration, gainValue) {
    const ctx = ensureAudio();
    if (!ctx) {
      return;
    }
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'highpass';
    filter.frequency.value = 240;
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  function playShotSound() {
    const now = performance.now();
    if (now - state.audio.lastShotAt < 55) {
      return;
    }
    state.audio.lastShotAt = now;
    scheduleTone({ from: 540, to: 280, duration: 0.08, gain: 0.04, type: 'square' });
  }

  function playDamageSound() {
    const now = performance.now();
    if (now - state.audio.lastDamageAt < 120) {
      return;
    }
    state.audio.lastDamageAt = now;
    scheduleNoise(0.08, 0.035);
    scheduleTone({ from: 210, to: 120, duration: 0.12, gain: 0.03, type: 'sawtooth' });
  }

  function playEnemyDownSound() {
    const now = performance.now();
    if (now - state.audio.lastEnemyDownAt < 70) {
      return;
    }
    state.audio.lastEnemyDownAt = now;
    scheduleTone({ from: 320, to: 680, duration: 0.12, gain: 0.055, type: 'triangle' });
  }

  function playPickupSound() {
    scheduleTone({ from: 540, to: 720, duration: 0.12, gain: 0.05, type: 'triangle' });
    scheduleTone({ from: 720, to: 980, duration: 0.14, gain: 0.035, type: 'sine', delay: 0.03 });
  }

  function playLevelUpSound() {
    scheduleTone({ from: 420, to: 840, duration: 0.22, gain: 0.05, type: 'triangle' });
    scheduleTone({ from: 560, to: 1120, duration: 0.28, gain: 0.04, type: 'sine', delay: 0.05 });
  }

  function playBossAlertSound() {
    scheduleTone({ from: 180, to: 92, duration: 0.32, gain: 0.06, type: 'sawtooth' });
    scheduleTone({ from: 260, to: 130, duration: 0.3, gain: 0.04, type: 'triangle', delay: 0.08 });
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove('visible');
    }, 2400);
  }

  function setStatusMessage(message) {
    state.statusMessage = message;
    renderPanels();
  }

  function defaultStatusText() {
    if (state.statusMessage) {
      return state.statusMessage;
    }
    if (state.mode === 'connecting') {
      return 'Connecting to the squad room...';
    }
    if (state.mode === 'online') {
      const game = currentGame();
      const pilotCount = game?.players?.length || 0;
      return pilotCount >= 2
        ? 'Squad synced. Crossfire the waves, grab pickups, and level up before the boss arrives.'
        : 'Room live. Copy the invite link and send it to your wingmate.';
    }
    if (state.mode === 'solo') {
      return 'Solo run live with Wingmate AI. Build levels, fight boss waves, and test the ship feel while you wait for a real co-op room.';
    }
    return 'Host a squad to generate an invite, join a friend by code, or practice with the AI wingmate in solo mode.';
  }

  function setNetworkStatus(text, tone) {
    ui.networkStatus.textContent = text;
    ui.networkStatus.dataset.tone = tone;
  }

  function setModePill(text) {
    ui.modePill.textContent = text;
  }

  function currentGame() {
    if (state.mode === 'solo') {
      return state.localGame;
    }
    return state.snapshot;
  }

  function currentPlayers() {
    const game = currentGame();
    return Array.isArray(game?.players) ? [...game.players].sort((left, right) => left.seat - right.seat) : [];
  }

  function localPlayer(game) {
    if (!game || !state.yourPlayerId) {
      return null;
    }
    return game.players.find((player) => player.id === state.yourPlayerId) || null;
  }

  function nearestEnemy(game, from) {
    if (!game || !from || !game.enemies?.length) {
      return null;
    }
    let best = game.enemies[0];
    let bestDistance = distanceSquared(from.x, from.y, best.x, best.y);
    for (let index = 1; index < game.enemies.length; index += 1) {
      const enemy = game.enemies[index];
      const value = distanceSquared(from.x, from.y, enemy.x, enemy.y);
      if (value < bestDistance) {
        best = enemy;
        bestDistance = value;
      }
    }
    return best;
  }

  function defaultAimPoint(game, player) {
    const target = nearestEnemy(game, player);
    if (target) {
      return { x: target.x, y: target.y };
    }
    return {
      x: player ? player.x : ARENA.width / 2,
      y: player ? Math.max(40, player.y - 240) : ARENA.height * 0.35,
    };
  }

  function inviteUrl() {
    if (state.mode !== 'online' || !state.roomCode) {
      return '';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    if (state.serverUrl && state.serverUrl !== PROD_SERVER_URL) {
      url.searchParams.set('server', state.serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    return url.toString();
  }

  function updateInviteUi() {
    ui.inviteInput.value = inviteUrl();
    ui.copyBtn.disabled = !ui.inviteInput.value;
    ui.copyCodeBtn.disabled = !state.roomCode || state.mode !== 'online';
  }

  function copyText(value, successText) {
    if (!value) {
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      showToast(successText);
    }).catch(() => {
      showToast('Copy failed. You can still select the text manually.');
    });
  }

  function roomPointFromClient(clientX, clientY) {
    const rect = ui.stage.getBoundingClientRect();
    return {
      x: clamp(((clientX - rect.left) / Math.max(1, rect.width)) * ARENA.width, 0, ARENA.width),
      y: clamp(((clientY - rect.top) / Math.max(1, rect.height)) * ARENA.height, 0, ARENA.height),
    };
  }

  function composeInput(game) {
    const player = localPlayer(game);
    let moveX = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
    let moveY = (state.keys.down ? 1 : 0) - (state.keys.up ? 1 : 0);

    if (state.touch.move.active) {
      moveX += state.touch.move.nx;
      moveY += state.touch.move.ny;
    }

    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    let aimX = state.pointer.x;
    let aimY = state.pointer.y;
    let fire = state.keys.fire || state.pointer.fire;

    if (state.touch.aim.active && player) {
      aimX = clamp(player.x + state.touch.aim.nx * 320, 0, ARENA.width);
      aimY = clamp(player.y + state.touch.aim.ny * 320, 0, ARENA.height);
      fire = true;
    } else if ((!state.pointer.active || isCoarsePointer) && player) {
      const fallback = defaultAimPoint(game, player);
      aimX = fallback.x;
      aimY = fallback.y;
    }

    return {
      moveX,
      moveY,
      aimX,
      aimY,
      fire,
      boost: state.keys.boost || state.touch.boost,
    };
  }

  function updateBotPilot(game) {
    const bot = game.players.find((player) => player.id === 'solo-bot');
    const human = game.players.find((player) => player.id === state.yourPlayerId);
    if (!bot || !human) {
      return;
    }

    const target = nearestEnemy(game, bot) || nearestEnemy(game, human);
    let anchorX = human.x + 150;
    let anchorY = human.y + 10;
    let aimX = bot.x;
    let aimY = bot.y - 220;
    let fire = false;

    if (target) {
      anchorX = clamp(target.x + 140, 120, ARENA.width - 120);
      anchorY = clamp(target.y + 170, 120, ARENA.height - 120);
      aimX = target.x;
      aimY = target.y;
      fire = true;
    }

    const dx = anchorX - bot.x;
    const dy = anchorY - bot.y;
    const distance = Math.hypot(dx, dy) || 1;
    const boost = distance > 280 || (target && target.type === 'turret' && distance > 180);

    Core.setPlayerInput(game, bot.id, {
      moveX: dx / distance,
      moveY: dy / distance,
      aimX,
      aimY,
      fire,
      boost,
    });
  }

  function resetRenderCache() {
    state.renderCache.players.clear();
    state.renderCache.enemies.clear();
    state.renderCache.playerBullets.clear();
    state.renderCache.enemyBullets.clear();
    state.renderCache.pickups.clear();
    state.knownHealth.clear();
    state.cameraShake = 0;
    state.lastEventId = 0;
    state.lastLocalBulletCount = 0;
    state.lastEnemyCount = 0;
  }

  function startSolo() {
    disconnectSocket();
    resetRenderCache();
    const game = Core.createGameState();
    Core.addPlayer(game, { id: 'solo-human', name: getPlayerName() });
    Core.addPlayer(game, { id: 'solo-bot', name: 'Wingmate AI' });
    game.status = 'Solo run live. Wingmate AI is in formation.';
    state.mode = 'solo';
    state.localGame = game;
    state.snapshot = null;
    state.yourPlayerId = 'solo-human';
    state.roomCode = 'SOLO';
    state.statusMessage = '';
    state.lastInputSentAt = 0;
    updateInviteUi();
    renderPanels();
  }

  function disconnectSocket() {
    if (!state.socket) {
      return;
    }
    state.socket.onclose = null;
    state.socket.onerror = null;
    state.socket.onmessage = null;
    state.socket.close();
    state.socket = null;
  }

  function connectOnline(mode) {
    const joinMode = mode === 'join' ? 'join' : 'host';
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (joinMode === 'join' && !roomCode) {
      showToast('Enter a room code to join a squad.');
      return;
    }

    disconnectSocket();
    resetRenderCache();
    state.mode = 'connecting';
    state.localGame = null;
    state.snapshot = null;
    state.yourPlayerId = '';
    state.roomCode = roomCode;
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    renderPanels();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        action: 'join',
        mode: joinMode,
        roomCode,
        name: getPlayerName(),
        game: 'space-shooter',
      }));
    });

    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        return;
      }

      if (payload.type === 'welcome') {
        state.mode = 'online';
        state.yourPlayerId = payload.playerId;
        state.roomCode = payload.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        state.statusMessage = '';
        renderPanels();
        return;
      }

      if (payload.type === 'state') {
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        state.statusMessage = '';
        if (payload.message) {
          showToast(payload.message);
        }
        inspectDamage(payload.snapshot);
        renderPanels();
        return;
      }

      if (payload.type === 'error') {
        state.mode = 'idle';
        state.snapshot = null;
        state.yourPlayerId = '';
        setStatusMessage(payload.message || 'Connection error.');
        setNetworkStatus('Offline', 'offline');
        setModePill('No squad run active');
        disconnectSocket();
      }
    });

    socket.addEventListener('close', () => {
      const wasOnline = state.mode === 'online' || state.mode === 'connecting';
      state.socket = null;
      if (wasOnline) {
        state.mode = 'idle';
        state.yourPlayerId = '';
        state.snapshot = null;
        setStatusMessage('Connection closed. Host again or rejoin the room.');
      }
      renderPanels();
    });

    socket.addEventListener('error', () => {
      if (state.mode === 'connecting') {
        state.mode = 'idle';
        state.socket = null;
        state.snapshot = null;
        setStatusMessage('Could not reach the squad server.');
        renderPanels();
      }
    });
  }

  function restartRun() {
    if (state.mode === 'solo') {
      startSolo();
      showToast('Solo run restarted.');
      return;
    }
    if (state.mode === 'online' && state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ action: 'restart' }));
    }
  }

  function inspectDamage(game) {
    if (!game || !Array.isArray(game.players)) {
      state.knownHealth.clear();
      return;
    }
    const present = new Set();
    for (const player of game.players) {
      present.add(player.id);
      const previous = state.knownHealth.get(player.id);
      if (typeof previous === 'number' && player.hp < previous) {
        state.cameraShake = Math.min(18, state.cameraShake + (previous - player.hp) * 2.2);
        if (player.id === state.yourPlayerId) {
          playDamageSound();
        }
      }
      state.knownHealth.set(player.id, player.hp);
    }
    for (const id of Array.from(state.knownHealth.keys())) {
      if (!present.has(id)) {
        state.knownHealth.delete(id);
      }
    }
  }

  function processGameEvents(game) {
    if (!game) {
      state.lastEventId = 0;
      state.lastLocalBulletCount = 0;
      state.audio.lastEnemyBulletCount = 0;
      return;
    }

    const events = Array.isArray(game.events) ? game.events : [];
    for (const event of events) {
      if (event.id <= state.lastEventId) {
        continue;
      }
      state.lastEventId = event.id;
      if (event.type === 'pickup') {
        playPickupSound();
      } else if (event.type === 'level_up') {
        playLevelUpSound();
        showToast(`${event.name} reached level ${event.level}`);
      } else if (event.type === 'boss_spawn') {
        playBossAlertSound();
        showToast(`Boss wave ${event.wave} incoming`);
      } else if (event.type === 'boss_down') {
        playLevelUpSound();
      } else if (event.type === 'player_down' && event.playerId === state.yourPlayerId) {
        playDamageSound();
      } else if (event.type === 'game_over') {
        playBossAlertSound();
      }
    }

    const localBulletCount = (game.playerBullets || []).filter((bullet) => bullet.ownerId === state.yourPlayerId).length;
    if (localBulletCount > state.lastLocalBulletCount) {
      playShotSound();
    }
    state.lastLocalBulletCount = localBulletCount;

    const enemyCount = (game.enemies || []).length;
    if (typeof state.lastEnemyCount === 'number' && enemyCount < state.lastEnemyCount) {
      playEnemyDownSound();
    }
    state.lastEnemyCount = enemyCount;
    state.audio.lastEnemyBulletCount = (game.enemyBullets || []).length;
  }

  function syncRenderable(kind, items, factor, transform) {
    const cache = state.renderCache[kind];
    const seen = new Set();
    const renderable = [];

    for (const item of items) {
      const target = transform ? transform(item) : item;
      let next = cache.get(item.id);
      if (!next) {
        next = { ...target };
        cache.set(item.id, next);
      } else {
        for (const [key, value] of Object.entries(target)) {
          if ((key === 'x' || key === 'y') && typeof value === 'number') {
            next[key] = lerp(next[key], value, factor);
          } else if (key === 'angle' && typeof value === 'number') {
            next[key] = lerpAngle(next[key], value, factor);
          } else if ((key === 'flash' || key === 'hp' || key === 'shield' || key === 'boostMeter' || key === 'respawnTimer' || key === 'overdriveTimer') && typeof value === 'number') {
            next[key] = lerp(next[key], value, clamp(factor * 1.2, 0.15, 0.85));
          } else {
            next[key] = value;
          }
        }
      }
      seen.add(item.id);
      renderable.push(next);
    }

    for (const id of Array.from(cache.keys())) {
      if (!seen.has(id)) {
        cache.delete(id);
      }
    }

    return renderable;
  }

  function predictedTarget(player) {
    const next = { ...player };
    if (state.mode === 'online' && player.id === state.yourPlayerId && player.alive) {
      const lead = (state.latestInput.boost ? PLAYER_BOOST_SPEED : PLAYER_SPEED) * 0.06;
      next.x = clamp(player.x + state.latestInput.moveX * lead, 48, ARENA.width - 48);
      next.y = clamp(player.y + state.latestInput.moveY * lead, 70, ARENA.height - 54);
    }
    return next;
  }

  function renderState(game) {
    if (!game) {
      return {
        players: [],
        enemies: [],
        playerBullets: [],
        enemyBullets: [],
        pickups: [],
      };
    }

    if (state.mode === 'solo') {
      return game;
    }

    return {
      ...game,
      players: syncRenderable('players', game.players || [], 0.34, predictedTarget),
      enemies: syncRenderable('enemies', game.enemies || [], 0.24),
      playerBullets: syncRenderable('playerBullets', game.playerBullets || [], 0.48),
      enemyBullets: syncRenderable('enemyBullets', game.enemyBullets || [], 0.44),
      pickups: syncRenderable('pickups', game.pickups || [], 0.3),
    };
  }

  function resizeCanvas() {
    const rect = ui.stage.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(2, Math.floor(rect.width * dpr));
    const height = Math.max(2, Math.floor(rect.height * dpr));
    if (ui.canvas.width !== width || ui.canvas.height !== height) {
      ui.canvas.width = width;
      ui.canvas.height = height;
    }
  }

  function initStars() {
    state.stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * ARENA.width,
      y: Math.random() * ARENA.height,
      r: 0.8 + Math.random() * 2.3,
      speed: 26 + Math.random() * 120,
      twinkle: Math.random() * Math.PI * 2,
    }));
  }

  function updateStars(dt) {
    for (const star of state.stars) {
      star.y += star.speed * dt;
      star.twinkle += dt * (1.2 + star.r * 0.1);
      if (star.y > ARENA.height + 12) {
        star.y = -12;
        star.x = Math.random() * ARENA.width;
      }
    }
  }

  function drawBackground(game) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ARENA.height);
    gradient.addColorStop(0, '#08172e');
    gradient.addColorStop(0.55, '#061120');
    gradient.addColorStop(1, '#03070f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    const ring = ctx.createRadialGradient(ARENA.width * 0.5, ARENA.height * 0.18, 80, ARENA.width * 0.5, ARENA.height * 0.18, ARENA.width * 0.7);
    ring.addColorStop(0, 'rgba(89, 216, 255, 0.14)');
    ring.addColorStop(1, 'rgba(89, 216, 255, 0)');
    ctx.fillStyle = ring;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    if (game?.bossActive) {
      const bossGlow = ctx.createRadialGradient(ARENA.width * 0.5, 120, 40, ARENA.width * 0.5, 120, ARENA.width * 0.55);
      bossGlow.addColorStop(0, 'rgba(255, 92, 210, 0.16)');
      bossGlow.addColorStop(1, 'rgba(255, 92, 210, 0)');
      ctx.fillStyle = bossGlow;
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    }

    ctx.save();
    for (const star of state.stars) {
      const alpha = 0.35 + ((Math.sin(star.twinkle) + 1) * 0.18);
      ctx.fillStyle = `rgba(230, 245, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(125, 187, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 80; x < ARENA.width; x += 160) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ARENA.height);
      ctx.stroke();
    }
    for (let y = 70; y < ARENA.height; y += 140) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA.width, y);
      ctx.stroke();
    }
    ctx.restore();

    if (game?.gameOver) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.05)';
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    }
  }

  function drawShip(player) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);

    if (!player.alive) {
      ctx.strokeStyle = 'rgba(255, 122, 144, 0.65)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 122, 144, 0.14)';
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (player.overdriveTimer > 0) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 18;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.lineTo(-14, -16);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-14, 16);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();

    if (player.flash > 0.02) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 28 + player.flash * 28, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    if (player.shield > 0 && player.alive) {
      ctx.strokeStyle = `rgba(103, 232, 249, ${0.16 + Math.min(0.3, player.shield * 0.05)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 30 + Math.min(8, player.shield * 2), 0, Math.PI * 2);
      ctx.stroke();
    }

    const hpWidth = 64;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(player.x - hpWidth / 2, player.y - 42, hpWidth, 6);
    ctx.fillStyle = player.hp <= 3 ? '#ff7a90' : '#68f0a8';
    ctx.fillRect(player.x - hpWidth / 2, player.y - 42, hpWidth * clamp(player.hp / player.maxHp, 0, 1), 6);

    ctx.fillStyle = 'rgba(232, 243, 255, 0.96)';
    ctx.font = '600 16px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x, player.y - 52);

    if (!player.alive) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.92)';
      ctx.fillText(`${player.respawnTimer.toFixed(1)}s`, player.x, player.y + 5);
    }
  }

  function drawEnemy(enemy) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.shadowBlur = 16;
    ctx.shadowColor = enemy.color;
    ctx.fillStyle = enemy.color;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;

    if (enemy.type === 'boss') {
      const outer = enemy.r;
      const inner = enemy.r * 0.68;
      ctx.rotate(Math.sin(enemy.phase || 0) * 0.08);
      ctx.beginPath();
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const radius = index % 2 === 0 ? outer : inner;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (index === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 232, 248, 0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, enemy.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.type === 'juggernaut') {
      ctx.beginPath();
      ctx.moveTo(enemy.r * 0.7, 0);
      ctx.lineTo(enemy.r * 0.18, -enemy.r * 0.62);
      ctx.lineTo(-enemy.r * 0.66, -enemy.r * 0.56);
      ctx.lineTo(-enemy.r * 0.9, 0);
      ctx.lineTo(-enemy.r * 0.66, enemy.r * 0.56);
      ctx.lineTo(enemy.r * 0.18, enemy.r * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(-enemy.r * 0.26, -enemy.r * 0.5, enemy.r * 0.32, enemy.r);
    } else if (enemy.type === 'turret') {
      ctx.beginPath();
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI * 2 * index) / 6;
        const radius = index % 2 === 0 ? enemy.r : enemy.r * 0.78;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (enemy.type === 'striker') {
      ctx.beginPath();
      ctx.moveTo(enemy.r, 0);
      ctx.lineTo(-enemy.r * 0.7, -enemy.r * 0.6);
      ctx.lineTo(-enemy.r * 0.22, 0);
      ctx.lineTo(-enemy.r * 0.7, enemy.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-enemy.r * 0.82, -enemy.r * 0.82, enemy.r * 1.64, enemy.r * 1.64);
      ctx.strokeRect(-enemy.r * 0.82, -enemy.r * 0.82, enemy.r * 1.64, enemy.r * 1.64);
    }

    ctx.restore();

    const barWidth = Math.max(48, enemy.r * (enemy.type === 'boss' ? 1.8 : 1.05));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.r - 14, barWidth, 5);
    ctx.fillStyle = 'rgba(255, 166, 124, 0.9)';
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.r - 14, barWidth * clamp(enemy.hp / enemy.maxHp, 0, 1), 5);
  }

  function drawBossHud(game) {
    if (!game || !game.bossActive) {
      return;
    }
    const boss = (game.enemies || []).find((enemy) => enemy.type === 'boss');
    if (!boss) {
      return;
    }

    const width = 460;
    const x = ARENA.width / 2 - width / 2;
    const y = 26;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 20, 0.78)';
    ctx.fillRect(x, y, width, 22);
    ctx.strokeStyle = 'rgba(255, 92, 210, 0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, 22);
    ctx.fillStyle = 'rgba(255, 92, 210, 0.82)';
    ctx.fillRect(x, y, width * clamp(boss.hp / boss.maxHp, 0, 1), 22);
    ctx.fillStyle = '#fff3fb';
    ctx.font = '700 18px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(boss.label || `Dreadnought ${game.wave}`, ARENA.width / 2, y - 8);
    ctx.restore();
  }

  function drawPickup(pickup) {
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.shadowBlur = 18;
    ctx.shadowColor = pickup.type === 'heal' ? '#68f0a8' : '#ffd166';
    ctx.fillStyle = pickup.type === 'heal' ? '#68f0a8' : '#ffd166';
    ctx.beginPath();
    ctx.arc(0, 0, pickup.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(8, 16, 30, 0.72)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (pickup.type === 'heal') {
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
    } else {
      ctx.moveTo(-5, -6);
      ctx.lineTo(1, -1);
      ctx.lineTo(-2, -1);
      ctx.lineTo(5, 7);
      ctx.lineTo(1, 1);
      ctx.lineTo(4, 1);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectile(projectile, enemy) {
    ctx.save();
    ctx.fillStyle = projectile.color || (enemy ? '#ffd3f3' : '#59d8ff');
    ctx.shadowBlur = enemy ? 14 : 16;
    ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCrosshair(game) {
    const player = localPlayer(game);
    if (!player || !player.alive) {
      return;
    }
    const aim = state.latestInput;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(aim.aimX, aim.aimY, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(aim.aimX - 18, aim.aimY);
    ctx.lineTo(aim.aimX - 8, aim.aimY);
    ctx.moveTo(aim.aimX + 8, aim.aimY);
    ctx.lineTo(aim.aimX + 18, aim.aimY);
    ctx.moveTo(aim.aimX, aim.aimY - 18);
    ctx.lineTo(aim.aimX, aim.aimY - 8);
    ctx.moveTo(aim.aimX, aim.aimY + 8);
    ctx.lineTo(aim.aimX, aim.aimY + 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawOverlay(game) {
    if (game) {
      if (game.gameOver) {
        ctx.save();
        ctx.fillStyle = 'rgba(4, 8, 15, 0.66)';
        ctx.fillRect(0, 0, ARENA.width, ARENA.height);
        ctx.fillStyle = '#fff4f7';
        ctx.font = '700 58px Syncopate, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SQUAD DOWN', ARENA.width / 2, ARENA.height / 2 - 30);
        ctx.font = '500 24px "Space Grotesk", sans-serif';
        ctx.fillStyle = 'rgba(232, 243, 255, 0.85)';
        ctx.fillText(`Wave ${game.wave}  •  Score ${game.score}`, ARENA.width / 2, ARENA.height / 2 + 18);
        ctx.fillText('Press Restart run to launch again.', ARENA.width / 2, ARENA.height / 2 + 56);
        ctx.restore();
      }
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(4, 8, 15, 0.58)';
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    ctx.fillStyle = '#f3fbff';
    ctx.textAlign = 'center';
    ctx.font = '700 54px Syncopate, sans-serif';
    ctx.fillText('STARLINE DEFENSE', ARENA.width / 2, ARENA.height / 2 - 26);
    ctx.font = '500 24px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(232, 243, 255, 0.82)';
    ctx.fillText('Host a squad room, join with an invite code, or launch solo.', ARENA.width / 2, ARENA.height / 2 + 22);
    ctx.restore();
  }

  function renderCanvas() {
    resizeCanvas();
    const game = currentGame();
    const visible = renderState(game);
    const shake = state.cameraShake;
    state.cameraShake = Math.max(0, shake - 0.72);

    const tx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const ty = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const scaleX = ui.canvas.width / ARENA.width;
    const scaleY = ui.canvas.height / ARENA.height;

    ctx.setTransform(scaleX, 0, 0, scaleY, tx * scaleX, ty * scaleY);
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);

    drawBackground(game);
    for (const pickup of visible.pickups || []) {
      drawPickup(pickup);
    }
    for (const bullet of visible.playerBullets || []) {
      drawProjectile(bullet, false);
    }
    for (const bullet of visible.enemyBullets || []) {
      drawProjectile(bullet, true);
    }
    for (const enemy of visible.enemies || []) {
      drawEnemy(enemy);
    }
    for (const player of visible.players || []) {
      drawShip(player);
    }
    if (game) {
      drawCrosshair(game);
      drawBossHud(game);
    }
    drawOverlay(game);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function emptySeatCard(label) {
    return `
      <div class="player-card">
        <div class="player-head">
          <div>
            <div class="player-name">Open seat</div>
            <div class="player-role">${label}</div>
          </div>
          <span class="inline-chip empty-chip">Waiting</span>
        </div>
      </div>
    `;
  }

  function playerCard(player, tag) {
    const hpPct = clamp((player.hp / Math.max(1, player.maxHp)) * 100, 0, 100);
    const boostPct = clamp((player.boostMeter || 0) * 100, 0, 100);
    const xpPct = clamp(((player.xp || 0) / Math.max(1, player.nextLevelXp || 1)) * 100, 0, 100);
    const status = !player.alive ? `Respawn ${player.respawnTimer.toFixed(1)}s` : player.overdriveTimer > 0 ? 'Overdrive' : 'Alive';
    return `
      <div class="player-card" style="border-color:${player.color}33">
        <div class="player-head">
          <div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="player-role">Pilot ${player.seat + 1} • Level ${player.level || 1}</div>
          </div>
          <span class="inline-chip">${tag}</span>
        </div>
        <div class="player-stats">
          <div>
            <div class="stat-row"><span>Hull</span><span>${player.hp}/${player.maxHp}</span></div>
            <div class="meter"><span class="meter-fill ${player.hp <= 3 ? 'danger' : ''}" style="width:${hpPct}%"></span></div>
          </div>
          <div>
            <div class="stat-row"><span>Boost</span><span>${Math.round(boostPct)}%</span></div>
            <div class="meter"><span class="meter-fill boost" style="width:${boostPct}%"></span></div>
          </div>
          <div>
            <div class="stat-row"><span>XP to next level</span><span>${Math.round(player.xp || 0)}/${Math.round(player.nextLevelXp || 1)}</span></div>
            <div class="meter"><span class="meter-fill xp" style="width:${xpPct}%"></span></div>
          </div>
          <div class="stat-row"><span>Shield ${Math.round(player.shield)}</span><span>Score ${player.score}</span></div>
          <div class="stat-row"><span>Weapon tier ${player.weaponTier || 1}</span><span>${status}</span></div>
        </div>
      </div>
    `;
  }

  function renderPlayersPanel(game) {
    const players = currentPlayers();
    if (!game || !players.length) {
      ui.playerCards.innerHTML = `${emptySeatCard('Pilot 1')}${emptySeatCard('Pilot 2')}`;
      ui.presenceText.textContent = 'Waiting for a launch.';
      return;
    }

    const ordered = [];
    for (const player of players) {
      ordered[player.seat] = player;
    }

    ui.playerCards.innerHTML = ordered.map((player, index) => {
      if (!player) {
        return emptySeatCard(`Pilot ${index + 1}`);
      }
      let tag = 'Ready';
      if (player.id === state.yourPlayerId) {
        tag = 'You';
      } else if (state.mode === 'solo' && player.id === 'solo-bot') {
        tag = 'AI';
      }
      return playerCard(player, tag);
    }).join('');

    if (state.mode === 'online') {
      ui.presenceText.textContent = players.length >= 2 ? 'Squad synced online.' : 'Invite ready. Waiting for wingmate.';
      return;
    }
    if (state.mode === 'solo') {
      ui.presenceText.textContent = 'Wingmate AI active.';
      return;
    }
    ui.presenceText.textContent = 'Waiting for a launch.';
  }

  function renderPanels() {
    const game = currentGame();
    ui.statusText.textContent = defaultStatusText();
    ui.missionText.textContent = game?.status || 'Spin up a room and launch the squad.';
    ui.objectiveText.textContent = game?.objective || 'Survive the first surge and build squad momentum.';
    ui.squadLevelLabel.textContent = `Lv ${game?.squadLevel || 1}`;
    ui.roomCodeLabel.textContent = state.roomCode || '-';
    ui.waveLabel.textContent = `Wave ${game?.wave || 1}`;
    ui.scoreLabel.textContent = String(game?.score || 0);

    let condition = 'Stand by';
    const player = localPlayer(game);
    if (game?.gameOver) {
      condition = 'Squad down';
    } else if (game?.bossActive) {
      condition = 'Boss wave';
    } else if (state.mode === 'online' && (game?.players?.length || 0) < 2) {
      condition = 'Await wingmate';
    } else if (player && !player.alive) {
      condition = `Respawn ${player.respawnTimer.toFixed(1)}s`;
    } else if (player && player.overdriveTimer > 0) {
      condition = 'Overdrive';
    } else if (player) {
      condition = 'Holding';
    }
    ui.conditionLabel.textContent = condition;

    if (state.mode === 'online' && state.socket?.readyState === WebSocket.OPEN) {
      setNetworkStatus('Online', 'online');
      setModePill(state.roomCode ? `Room ${state.roomCode}` : 'Online squad');
    } else if (state.mode === 'connecting') {
      setNetworkStatus('Connecting', 'busy');
      setModePill('Connecting');
    } else if (state.mode === 'solo') {
      setNetworkStatus('Local', 'busy');
      setModePill('Solo + AI wingmate');
    } else {
      setNetworkStatus('Offline', 'offline');
      setModePill('No squad run active');
    }

    ui.controlHint.textContent = isCoarsePointer
      ? 'Touch controls: left pad moves, right pad aims and fires, and Boost is separate. Desktop controls still work if you connect a keyboard.'
      : 'Move with WASD or arrows. Aim with the mouse. Hold click or Space to fire. Hold Shift to boost.';

    updateInviteUi();
    ui.restartBtn.disabled = !game;
    renderPlayersPanel(game);
  }

  function sendInputIfNeeded(now) {
    if (state.mode !== 'online' || !state.socket || state.socket.readyState !== WebSocket.OPEN || !state.snapshot) {
      return;
    }
    if (now - state.lastInputSentAt < INPUT_SEND_MS) {
      return;
    }
    state.lastInputSentAt = now;
    state.socket.send(JSON.stringify({
      action: 'input',
      input: state.latestInput,
    }));
  }

  function tick(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameAt) / 1000));
    state.lastFrameAt = now;
    updateStars(dt);

    const game = currentGame();
    if (state.mode === 'solo' && state.localGame) {
      state.latestInput = composeInput(state.localGame);
      Core.setPlayerInput(state.localGame, state.yourPlayerId, state.latestInput);
      updateBotPilot(state.localGame);
      Core.step(state.localGame, dt);
      inspectDamage(state.localGame);
    } else if (game) {
      state.latestInput = composeInput(game);
    }

    processGameEvents(currentGame());
    sendInputIfNeeded(now);
    renderCanvas();

    if (now >= state.nextUiRefreshAt) {
      renderPanels();
      state.nextUiRefreshAt = now + (state.mode === 'solo' ? 120 : 180);
    }

    window.requestAnimationFrame(tick);
  }

  function setKeyState(code, pressed) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        state.keys.up = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        state.keys.down = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        state.keys.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        state.keys.right = pressed;
        break;
      case 'Space':
        state.keys.fire = pressed;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        state.keys.boost = pressed;
        break;
      default:
        return false;
    }
    return true;
  }

  function updatePointer(clientX, clientY) {
    const point = roomPointFromClient(clientX, clientY);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.active = true;
  }

  function bindStick(element, knob, key) {
    const stick = state.touch[key];

    function updateFromEvent(event) {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width * 0.28;
      let nx = (event.clientX - centerX) / radius;
      let ny = (event.clientY - centerY) / radius;
      const magnitude = Math.hypot(nx, ny);
      if (magnitude > 1) {
        nx /= magnitude;
        ny /= magnitude;
      }
      stick.nx = clamp(nx, -1, 1);
      stick.ny = clamp(ny, -1, 1);
      knob.style.transform = `translate(calc(-50% + ${stick.nx * 40}px), calc(-50% + ${stick.ny * 40}px))`;
    }

    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ensureAudio();
      stick.active = true;
      stick.pointerId = event.pointerId;
      element.setPointerCapture(event.pointerId);
      updateFromEvent(event);
    });

    element.addEventListener('pointermove', (event) => {
      if (!stick.active || stick.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      updateFromEvent(event);
    });

    function release(event) {
      if (!stick.active || stick.pointerId !== event.pointerId) {
        return;
      }
      stick.active = false;
      stick.pointerId = null;
      stick.nx = 0;
      stick.ny = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    }

    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', release);
  }

  function bindEvents() {
    ui.nameInput.addEventListener('input', () => {
      persistSettings();
      renderPanels();
    });

    ui.roomInput.addEventListener('input', () => {
      ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    });

    ui.serverUrlInput.addEventListener('change', () => {
      state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
      ui.serverUrlInput.value = state.serverUrl;
      persistSettings();
    });

    ui.hostBtn.addEventListener('click', () => {
      ensureAudio();
      connectOnline('host');
    });

    ui.joinBtn.addEventListener('click', () => {
      ensureAudio();
      connectOnline('join');
    });

    ui.soloBtn.addEventListener('click', () => {
      ensureAudio();
      startSolo();
      showToast('Solo run launched.');
    });

    ui.copyBtn.addEventListener('click', () => {
      copyText(ui.inviteInput.value, 'Invite link copied.');
    });

    ui.copyCodeBtn.addEventListener('click', () => {
      copyText(state.roomCode, 'Room code copied.');
    });

    ui.restartBtn.addEventListener('click', restartRun);

    window.addEventListener('keydown', (event) => {
      ensureAudio();
      const consumed = setKeyState(event.code, true);
      if (consumed) {
        event.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      const consumed = setKeyState(event.code, false);
      if (consumed) {
        event.preventDefault();
      }
    }, { passive: false });

    ui.stage.addEventListener('mousemove', (event) => {
      updatePointer(event.clientX, event.clientY);
    });

    ui.stage.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || isCoarsePointer) {
        return;
      }
      ensureAudio();
      updatePointer(event.clientX, event.clientY);
      state.pointer.fire = true;
    });

    ui.stage.addEventListener('mouseup', () => {
      state.pointer.fire = false;
    });

    ui.stage.addEventListener('mouseleave', () => {
      state.pointer.fire = false;
      state.pointer.active = false;
    });

    window.addEventListener('mouseup', () => {
      state.pointer.fire = false;
    });

    ui.stage.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    bindStick(ui.movePad, ui.moveKnob, 'move');
    bindStick(ui.aimPad, ui.aimKnob, 'aim');

    ui.boostBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ensureAudio();
      state.touch.boost = true;
    });
    ui.boostBtn.addEventListener('pointerup', () => {
      state.touch.boost = false;
    });
    ui.boostBtn.addEventListener('pointercancel', () => {
      state.touch.boost = false;
    });
    ui.boostBtn.addEventListener('pointerleave', () => {
      state.touch.boost = false;
    });

    window.addEventListener('beforeunload', () => {
      disconnectSocket();
    });
  }

  function loadSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || query.get('server') || PROD_SERVER_URL);
    ui.serverUrlInput.value = state.serverUrl;
    const inviteRoom = sanitizeRoomCode(query.get('room'));
    if (inviteRoom) {
      ui.roomInput.value = inviteRoom;
      state.statusMessage = `Invite loaded for room ${inviteRoom}. Press Join room when you are ready.`;
    }
  }

  initStars();
  loadSettings();
  bindEvents();
  renderPanels();
  window.requestAnimationFrame(tick);
})();
