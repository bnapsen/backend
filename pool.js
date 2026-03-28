(() => {
  'use strict';

  const STORAGE_KEYS = {
    name: 'miniPoolShowdown.name',
    serverUrl: 'miniPoolShowdown.serverUrl',
    variantId: 'miniPoolShowdown.variantId',
    setupCollapsed: 'miniPoolShowdown.setupCollapsed',
    sidebarCollapsed: 'miniPoolShowdown.sidebarCollapsed',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const query = new URLSearchParams(window.location.search);

  const canvas = document.getElementById('poolTable');
  const ctx = canvas.getContext('2d');

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    variantSelect: document.getElementById('variantSelect'),
    variantNote: document.getElementById('variantNote'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    rackLabel: document.getElementById('rackLabel'),
    variantLabel: document.getElementById('variantLabel'),
    turnLabel: document.getElementById('turnLabel'),
    phaseLabel: document.getElementById('phaseLabel'),
    whiteScore: document.getElementById('whiteScore'),
    blackScore: document.getElementById('blackScore'),
    whiteMeta: document.getElementById('whiteMeta'),
    blackMeta: document.getElementById('blackMeta'),
    whiteCard: document.getElementById('whiteCard'),
    blackCard: document.getElementById('blackCard'),
    shotCount: document.getElementById('shotCount'),
    matchMeta: document.getElementById('matchMeta'),
    turnNote: document.getElementById('turnNote'),
    restartBtn: document.getElementById('restartBtn'),
    playerList: document.getElementById('playerList'),
    presenceText: document.getElementById('presenceText'),
    eventList: document.getElementById('eventList'),
    eventSummary: document.getElementById('eventSummary'),
    powerFill: document.getElementById('powerFill'),
    powerText: document.getElementById('powerText'),
    tableStage: document.getElementById('tableStage'),
    layout: document.getElementById('layout'),
  };

  const state = {
    socket: null,
    snapshot: null,
    yourColor: null,
    roomCode: '',
    playerId: '',
    serverUrl: '',
    mode: 'online',
    statusMessage: '',
    aiming: false,
    pointerId: null,
    pointer: { x: 0, y: 0 },
    power: 0,
    aimAngle: 0,
    aimAnchor: { x: 0, y: 0 },
    aimLocked: false,
    aimFromStick: false,
    localGame: null,
    localPlayers: [],
    soloBotDueAt: 0,
    lastFrameAt: 0,
    summarySignature: '',
    setupCollapsed: false,
    sidebarCollapsed: false,
    view: {
      width: 0,
      height: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      dpr: 1,
    },
  };

  const CUE_UI = Object.freeze({
    anchorCap: 108,
    powerRange: 92,
    maxPower: 2.05,
    minPower: 0.04,
    cuePullback: 144,
    boostPullback: 134,
    cueLength: 264,
    guideLength: 640,
    guideBounceLength: 124,
    gripRadius: 32,
    lockPullback: 12,
    unlockPullback: 5,
    lockLateral: 54,
    unlockLateral: 122,
    aimDeadZone: 26,
    aimSmoothing: 0.34,
    stickAimSmoothing: 0.22,
  });
  const SOLO_BOT_NAME = 'Orbit Bot';

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sanitizeRoomCode(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  }

  function normalizeServerUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return defaultServerUrl();
    }
    if (/^wss?:\/\//i.test(value)) {
      return value;
    }
    if (/^https?:\/\//i.test(value)) {
      return value.replace(/^http/i, 'ws');
    }
    return value;
  }

  function defaultServerUrl() {
    const explicit = query.get('server');
    if (explicit) {
      return normalizeServerUrl(explicit);
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'ws://127.0.0.1:8081';
    }
    return PROD_SERVER_URL;
  }

  function currentServerUrl() {
    const value = normalizeServerUrl(ui.serverUrlInput.value || state.serverUrl || defaultServerUrl());
    state.serverUrl = value;
    return value;
  }

  function localCore() {
    return window.NovaMiniPoolCore || null;
  }

  function availableVariants() {
    const core = localCore();
    if (!core || !core.VARIANTS) {
      return [];
    }
    return Object.values(core.VARIANTS);
  }

  function defaultVariantId() {
    const core = localCore();
    return core && core.DEFAULT_VARIANT_ID ? core.DEFAULT_VARIANT_ID : 'showdown';
  }

  function normalizeVariantId(raw) {
    const core = localCore();
    if (core && typeof core.normalizeVariantId === 'function') {
      return core.normalizeVariantId(raw);
    }
    return defaultVariantId();
  }

  function selectedVariantId() {
    return normalizeVariantId(ui.variantSelect ? ui.variantSelect.value : defaultVariantId());
  }

  function selectedVariant() {
    return availableVariants().find((variant) => variant.id === selectedVariantId()) || availableVariants()[0] || null;
  }

  function currentVariantContext() {
    if (state.snapshot && state.snapshot.variantId) {
      return {
        id: normalizeVariantId(state.snapshot.variantId),
        label: state.snapshot.variantLabel || 'Showdown',
        description: state.snapshot.variantDescription || '',
        maxRacks: state.snapshot.maxRacks || 3,
      };
    }
    const variant = selectedVariant();
    if (!variant) {
      return null;
    }
    return {
      id: variant.id,
      label: variant.label,
      description: variant.description,
      maxRacks: variant.maxRacks || 3,
    };
  }

  function inviteVariantId() {
    const variant = currentVariantContext();
    return variant ? normalizeVariantId(variant.id) : defaultVariantId();
  }

  function formatMatchMeta(variant, soloMode) {
    if (!variant) {
      return soloMode ? 'Solo table' : 'Live duel';
    }
    if (soloMode) {
      return `Solo ${variant.label}`;
    }
    return `${variant.maxRacks || 3}-rack ${variant.label}`;
  }

  function isSoloMode() {
    return state.mode === 'solo';
  }

  function resetAimState() {
    state.aiming = false;
    state.pointerId = null;
    state.power = 0;
    state.aimAnchor.x = 0;
    state.aimAnchor.y = 0;
    state.aimLocked = false;
    state.aimFromStick = false;
  }

  function normalizeAngle(value) {
    let angle = Number(value) || 0;
    while (angle <= -Math.PI) {
      angle += Math.PI * 2;
    }
    while (angle > Math.PI) {
      angle -= Math.PI * 2;
    }
    return angle;
  }

  function lerpAngle(current, target, amount) {
    const delta = normalizeAngle(target - current);
    return normalizeAngle(current + delta * clamp(amount, 0, 1));
  }

  function resolveAimAngle(cue, point, fromStick) {
    const rawAngle = Math.atan2(point.y - cue.y, point.x - cue.x);
    return fromStick ? normalizeAngle(rawAngle + Math.PI) : rawAngle;
  }

  function updateAimAngleFromPoint(cue, point, fromStick, options = {}) {
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const distance = Math.hypot(dx, dy);
    if (distance < CUE_UI.aimDeadZone) {
      return false;
    }
    const targetAngle = resolveAimAngle(cue, point, fromStick);
    if (options.immediate) {
      state.aimAngle = targetAngle;
      return true;
    }
    const smoothing = fromStick ? CUE_UI.stickAimSmoothing : CUE_UI.aimSmoothing;
    state.aimAngle = lerpAngle(state.aimAngle, targetAngle, smoothing);
    return true;
  }

  function disconnectSocket() {
    if (state.socket && state.socket.readyState < WebSocket.CLOSING) {
      state.socket.close();
    }
    state.socket = null;
  }

  function savePanelPrefs() {
    localStorage.setItem(STORAGE_KEYS.setupCollapsed, state.setupCollapsed ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, state.sidebarCollapsed ? '1' : '0');
  }

  function updateLayoutChrome() {
    if (!ui.layout) {
      return;
    }
    ui.layout.classList.toggle('setup-collapsed', state.setupCollapsed);
    ui.layout.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    if (ui.toggleSetupBtn) {
      ui.toggleSetupBtn.textContent = state.setupCollapsed ? 'Show setup' : 'Hide setup';
    }
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = state.sidebarCollapsed ? 'Show feed' : 'Hide feed';
    }
    requestAnimationFrame(resizeCanvas);
  }

  function describeVariant(variant) {
    if (!variant) {
      return '';
    }
    return `${variant.label}: ${variant.description}`;
  }

  function populateVariantSelect() {
    if (!ui.variantSelect) {
      return;
    }
    const variants = availableVariants();
    if (!variants.length) {
      return;
    }
    ui.variantSelect.innerHTML = variants.map((variant) => `
      <option value="${variant.id}">${variant.label}</option>
    `).join('');
    const preferred = normalizeVariantId(
      query.get('variant')
      || localStorage.getItem(STORAGE_KEYS.variantId)
      || defaultVariantId()
    );
    ui.variantSelect.value = preferred;
    if (ui.variantNote) {
      const variant = selectedVariant();
      ui.variantNote.textContent = describeVariant(variant);
    }
  }

  function snapshotSignature(snapshot) {
    if (!snapshot) {
      return 'empty';
    }
    const latestEvent = Array.isArray(snapshot.events) && snapshot.events.length ? snapshot.events[0].id : '';
    const players = Array.isArray(snapshot.players) ? snapshot.players.length : 0;
    return [
      snapshot.rackNumber,
      snapshot.variantId || '',
      snapshot.turn,
      snapshot.shotCount,
      snapshot.moving ? 'moving' : 'still',
      snapshot.scores ? snapshot.scores.white : 0,
      snapshot.scores ? snapshot.scores.black : 0,
      snapshot.winner || '',
      snapshot.drawReason || '',
      snapshot.status || '',
      latestEvent,
      players,
    ].join('|');
  }

  function buildSoloPlayers() {
    const yourName = ui.nameInput.value.trim().slice(0, 18) || 'Guest';
    return [
      { id: 'solo-white', name: yourName, color: 'white' },
      { id: 'solo-black', name: SOLO_BOT_NAME, color: 'black' },
    ];
  }

  function buildSoloSnapshot() {
    const core = localCore();
    if (!core || !state.localGame) {
      return null;
    }
    const snapshot = core.cloneState(state.localGame);
    snapshot.players = state.localPlayers.map((player) => ({ ...player }));
    snapshot.roomCode = state.roomCode || 'SOLO';
    return snapshot;
  }

  function refreshLocalSnapshot(options = {}) {
    const snapshot = buildSoloSnapshot();
    state.snapshot = snapshot;
    if (!snapshot) {
      return;
    }
    if (options.message) {
      setStatus(options.message);
    }
    const nextSignature = snapshotSignature(snapshot);
    if (options.forceRender || nextSignature !== state.summarySignature) {
      state.summarySignature = nextSignature;
      renderUi();
    }
  }

  function activeTable() {
    return state.snapshot && state.snapshot.table
      ? state.snapshot.table
      : { width: 1000, height: 560, rail: 46, pocketR: 28 };
  }

  function isConnected() {
    return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
  }

  function canShoot() {
    if (!state.snapshot || !state.yourColor) {
      return false;
    }
    if (!isSoloMode() && !isConnected()) {
      return false;
    }
    if (state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    if (state.snapshot.moving) {
      return false;
    }
    const players = Array.isArray(state.snapshot.players) ? state.snapshot.players : [];
    if (!isSoloMode() && players.length < 2) {
      return false;
    }
    return state.snapshot.turn === state.yourColor;
  }

  function setNetworkStatus(tone, text) {
    ui.networkStatus.dataset.tone = tone;
    ui.networkStatus.textContent = text;
  }

  function setStatus(message) {
    state.statusMessage = message || 'Host a duel or join by room code. The first player to arrive waits at the live table for a challenger.';
    ui.statusText.textContent = state.statusMessage;
  }

  function savePrefs() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim().slice(0, 18));
    localStorage.setItem(STORAGE_KEYS.serverUrl, currentServerUrl());
    if (ui.variantSelect) {
      localStorage.setItem(STORAGE_KEYS.variantId, selectedVariantId());
    }
  }

  function copyToClipboard(value, successMessage) {
    const text = String(value || '').trim();
    if (!text) {
      setStatus('There is nothing to copy yet.');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => setStatus(successMessage))
        .catch(() => setStatus('Copy failed. You can still select the text manually.'));
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    try {
      document.execCommand('copy');
      setStatus(successMessage);
    } catch (error) {
      setStatus('Copy failed. You can still select the text manually.');
    }
    helper.remove();
  }

  function buildInviteUrl() {
    if (!state.roomCode || isSoloMode()) {
      return '';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    const serverUrl = currentServerUrl();
    if (serverUrl !== defaultServerUrl()) {
      url.searchParams.set('server', serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    if (inviteVariantId() !== defaultVariantId()) {
      url.searchParams.set('variant', inviteVariantId());
    } else {
      url.searchParams.delete('variant');
    }
    return url.toString();
  }

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      setStatus('Arcade Lounge bridge is not available.');
      return;
    }
    if (autoShare && (isSoloMode() || !state.roomCode)) {
      setStatus('Host or join a live duel before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: ui.nameInput.value.trim().slice(0, 18) || 'Guest',
      serverUrl: currentServerUrl(),
      gameType: 'mini-pool',
      roomCode: state.roomCode,
      inviteUrl: state.roomCode ? buildInviteUrl() : '',
      note: state.roomCode
        ? `Join my ${currentVariantContext() ? currentVariantContext().label : 'Mini Pool'} table in room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    setStatus(autoShare ? 'Opening Arcade Lounge with your duel ready to share.' : 'Opening Arcade Lounge in a new tab.');
  }

  function sendJson(payload) {
    if (!isConnected()) {
      setStatus('Connect to a live table first.');
      return false;
    }
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function activeCue() {
    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return null;
    }
    return state.snapshot.balls.find((ball) => ball.kind === 'cue' && !ball.sunk) || null;
  }

  function normalizedShotPower(rawPower) {
    return clamp(Number(rawPower) || 0, 0, CUE_UI.maxPower);
  }

  function startSoloGame() {
    const core = localCore();
    if (!core) {
      setStatus('Solo mode is still loading. Refresh once and try again.');
      return;
    }
    disconnectSocket();
    resetAimState();
    state.mode = 'solo';
    state.localGame = core.createGameState({ variantId: selectedVariantId() });
    state.localPlayers = buildSoloPlayers();
    state.roomCode = 'SOLO';
    state.playerId = state.localPlayers[0].id;
    state.yourColor = 'white';
    state.soloBotDueAt = 0;
    state.lastFrameAt = performance.now();
    ui.roomInput.value = '';
    setNetworkStatus('online', 'Solo');
    const variant = selectedVariant();
    refreshLocalSnapshot({
      forceRender: true,
      message: `${variant ? variant.label : 'Solo'} table is ready. Orbit Bot is waiting on the other end of the rack.`,
    });
  }

  function resetSoloGame() {
    if (!isSoloMode()) {
      return;
    }
    const core = localCore();
    if (!core) {
      return;
    }
    resetAimState();
    state.localGame = core.createGameState({ variantId: selectedVariantId() });
    state.localPlayers = buildSoloPlayers();
    state.playerId = state.localPlayers[0].id;
    state.yourColor = 'white';
    state.soloBotDueAt = 0;
    state.lastFrameAt = performance.now();
    const variant = selectedVariant();
    refreshLocalSnapshot({
      forceRender: true,
      message: `Fresh ${variant ? variant.label : 'solo'} rack ready. You break first.`,
    });
  }

  function playSoloShot(color, payload, message) {
    const core = localCore();
    if (!core || !state.localGame) {
      setStatus('Solo mode is not ready yet.');
      return false;
    }
    const result = core.applyShot(state.localGame, color, payload);
    if (!result.ok) {
      setStatus(result.error || 'That shot could not be played.');
      refreshLocalSnapshot({ forceRender: true });
      return false;
    }
    state.soloBotDueAt = 0;
    refreshLocalSnapshot({
      forceRender: true,
      message: message || `${color === state.yourColor ? 'You' : SOLO_BOT_NAME} took the shot.`,
    });
    return true;
  }

  function chooseSoloBotShot() {
    const cue = state.localGame && Array.isArray(state.localGame.balls)
      ? state.localGame.balls.find((ball) => ball.kind === 'cue' && !ball.sunk)
      : null;
    if (!cue) {
      return null;
    }
    const candidates = state.localGame.balls.filter((ball) => !ball.sunk && (ball.kind === 'target' || ball.kind === 'crown'));
    if (!candidates.length) {
      return {
        vectorX: 1,
        vectorY: 0,
        power: 0.72,
      };
    }

    let best = null;
    for (const ball of candidates) {
      const dx = ball.x - cue.x;
      const dy = ball.y - cue.y;
      const distance = Math.hypot(dx, dy) || 1;
      const shotLinePenalty = Math.abs(dy) * 0.11;
      const score = ball.points * 11 - distance * 0.24 - shotLinePenalty;
      if (!best || score > best.score) {
        best = { ball, score, dx, dy, distance };
      }
    }

    if (!best) {
      return null;
    }

    const noiseAngle = (Math.random() - 0.5) * 0.18;
    const angle = Math.atan2(best.dy, best.dx) + noiseAngle;
    const distancePower = 0.3 + clamp(best.distance / 340, 0, 0.68);
    const crownBoost = best.ball.kind === 'crown' ? 0.12 : 0;
    return {
      vectorX: Math.cos(angle),
      vectorY: Math.sin(angle),
      power: normalizedShotPower(distancePower + crownBoost + Math.random() * 0.08),
    };
  }

  function maybeTakeSoloBotTurn(now) {
    if (!isSoloMode() || !state.localGame || !state.snapshot) {
      return;
    }
    if (state.snapshot.winner || state.snapshot.drawReason || state.snapshot.moving || state.localGame.activeShot) {
      state.soloBotDueAt = 0;
      return;
    }
    if (state.localGame.turn === state.yourColor) {
      state.soloBotDueAt = 0;
      return;
    }
    if (!state.soloBotDueAt) {
      state.soloBotDueAt = now + 720;
      return;
    }
    if (now < state.soloBotDueAt) {
      return;
    }
    const shot = chooseSoloBotShot();
    if (!shot) {
      state.soloBotDueAt = 0;
      return;
    }
    playSoloShot('black', shot, `${SOLO_BOT_NAME} leans in and fires.`);
  }

  function feltBounds(table = activeTable()) {
    return {
      minX: table.rail,
      minY: table.rail,
      maxX: table.width - table.rail,
      maxY: table.height - table.rail,
    };
  }

  function cueDirection() {
    return {
      x: Math.cos(state.aimAngle),
      y: Math.sin(state.aimAngle),
    };
  }

  function reflectDirection(direction, normal) {
    const dot = direction.x * normal.x + direction.y * normal.y;
    return {
      x: direction.x - 2 * dot * normal.x,
      y: direction.y - 2 * dot * normal.y,
    };
  }

  function rayCircleIntersection(origin, direction, center, radius) {
    const offsetX = origin.x - center.x;
    const offsetY = origin.y - center.y;
    const projection = offsetX * direction.x + offsetY * direction.y;
    const discriminant = projection * projection - (offsetX * offsetX + offsetY * offsetY - radius * radius);
    if (discriminant < 0) {
      return null;
    }
    const distance = -projection - Math.sqrt(discriminant);
    if (distance <= 0) {
      return null;
    }
    return distance;
  }

  function projectAimGuide(cue, direction) {
    const bounds = feltBounds();
    const maxDistance = CUE_UI.guideLength;
    let bestHit = {
      type: 'open',
      distance: maxDistance,
      point: {
        x: cue.x + direction.x * maxDistance,
        y: cue.y + direction.y * maxDistance,
      },
      normal: null,
    };

    const candidates = [];
    if (direction.x > 0.0001) {
      const distance = (bounds.maxX - cue.r - cue.x) / direction.x;
      candidates.push({ distance, normal: { x: -1, y: 0 } });
    } else if (direction.x < -0.0001) {
      const distance = (bounds.minX + cue.r - cue.x) / direction.x;
      candidates.push({ distance, normal: { x: 1, y: 0 } });
    }
    if (direction.y > 0.0001) {
      const distance = (bounds.maxY - cue.r - cue.y) / direction.y;
      candidates.push({ distance, normal: { x: 0, y: -1 } });
    } else if (direction.y < -0.0001) {
      const distance = (bounds.minY + cue.r - cue.y) / direction.y;
      candidates.push({ distance, normal: { x: 0, y: 1 } });
    }

    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.distance) || candidate.distance <= 0 || candidate.distance >= bestHit.distance) {
        continue;
      }
      const hitX = cue.x + direction.x * candidate.distance;
      const hitY = cue.y + direction.y * candidate.distance;
      if (hitX < bounds.minX || hitX > bounds.maxX || hitY < bounds.minY || hitY > bounds.maxY) {
        continue;
      }
      bestHit = {
        type: 'rail',
        distance: candidate.distance,
        point: { x: hitX, y: hitY },
        normal: candidate.normal,
      };
    }

    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return bestHit;
    }

    for (const ball of state.snapshot.balls) {
      if (ball.sunk || ball.kind === 'cue') {
        continue;
      }
      const distance = rayCircleIntersection(cue, direction, ball, cue.r + ball.r);
      if (!distance || distance >= bestHit.distance) {
        continue;
      }
      const cueImpact = {
        x: cue.x + direction.x * distance,
        y: cue.y + direction.y * distance,
      };
      const normalX = ball.x - cueImpact.x;
      const normalY = ball.y - cueImpact.y;
      const normalLength = Math.hypot(normalX, normalY) || 1;
      bestHit = {
        type: 'ball',
        distance,
        point: cueImpact,
        objectBall: ball,
        normal: {
          x: normalX / normalLength,
          y: normalY / normalLength,
        },
      };
    }

    return bestHit;
  }

  function resizeCanvas() {
    const stageRect = ui.tableStage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const rect = canvasRect.width > 0 && canvasRect.height > 0 ? canvasRect : stageRect;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = '';
    canvas.style.height = '';

    const table = activeTable();
    const scale = Math.min(rect.width / table.width, rect.height / table.height);
    state.view = {
      width: rect.width,
      height: rect.height,
      scale,
      offsetX: (rect.width - table.width * scale) / 2,
      offsetY: (rect.height - table.height * scale) / 2,
      dpr,
    };
  }

  function boardPointFromClient(clientX, clientY, clampToTable = false) {
    const rect = canvas.getBoundingClientRect();
    const table = activeTable();
    const x = (clientX - rect.left - state.view.offsetX) / state.view.scale;
    const y = (clientY - rect.top - state.view.offsetY) / state.view.scale;
    if (!clampToTable && (x < 0 || x > table.width || y < 0 || y > table.height)) {
      return null;
    }
    return {
      x: clamp(x, 0, table.width),
      y: clamp(y, 0, table.height),
    };
  }

  function updatePowerUi() {
    ui.powerFill.style.width = `${Math.round(clamp(state.power / CUE_UI.maxPower, 0, 1) * 100)}%`;
    if (state.aiming && canShoot()) {
      const percent = Math.max(5, Math.round(state.power * 100));
      ui.powerText.textContent = percent > 100
        ? `Release to fire at ${percent}% boost power. Grab the cue and pull straight back for a heavy break.`
        : `Release to fire at ${percent}% power. Aim from the table or the cue, then pull straight back to load more speed.`;
      return;
    }
    if (!state.snapshot) {
      ui.powerText.textContent = 'Open a live table or start solo mode to bring the cue online.';
      return;
    }
    if (state.snapshot.winner || state.snapshot.drawReason) {
      ui.powerText.textContent = 'This match is finished. Start a new one for another race.';
      return;
    }
    if (state.snapshot.moving) {
      ui.powerText.textContent = 'Balls are still rolling. Wait for the table to settle.';
      return;
    }
    if (canShoot()) {
    ui.powerText.textContent = 'Click or touch to aim from the table or grab the cue itself, then pull straight backward to load power.';
      return;
    }
    ui.powerText.textContent = isSoloMode()
      ? `${SOLO_BOT_NAME} is at the table. You will get the cue back when the rack settles.`
      : 'Watch the live table until it is your turn.';
  }

  function renderPlayers() {
    const players = Array.isArray(state.snapshot && state.snapshot.players)
      ? state.snapshot.players
      : [];
    ui.presenceText.textContent = isSoloMode()
      ? 'Solo table online'
      : `${players.length}/2 seats filled`;
    if (!players.length) {
      ui.playerList.innerHTML = `<div class="empty-state">${isSoloMode() ? 'Start a solo table and the bot seat will appear here.' : 'Host a duel and the live seats will appear here.'}</div>`;
      return;
    }

    ui.playerList.innerHTML = ['white', 'black'].map((color) => {
      const player = players.find((entry) => entry.color === color);
      if (!player) {
        return `
          <article class="player-card">
            <strong>${capitalize(color)} seat open</strong>
            <p>Waiting for a challenger to take the ${color} cue.</p>
            <div class="chips"><span class="chip">Open seat</span></div>
          </article>
        `;
      }
      const chips = [
        player.id === state.playerId ? '<span class="chip">You</span>' : '',
        state.snapshot && state.snapshot.turn === color && !state.snapshot.winner && !state.snapshot.drawReason
          ? '<span class="chip">At table</span>'
          : '',
      ].filter(Boolean).join('');
      return `
        <article class="player-card">
          <strong>${player.name}</strong>
          <p>${capitalize(color)} cue</p>
          <div class="chips">${chips || '<span class="chip">Ready</span>'}</div>
        </article>
      `;
    }).join('');
  }

  function renderEvents() {
    const events = Array.isArray(state.snapshot && state.snapshot.events) ? state.snapshot.events : [];
    ui.eventSummary.textContent = events.length
      ? 'Latest rack and shot summaries from the shared table.'
      : 'The latest racks and shot results will show here.';
    if (!events.length) {
      ui.eventList.innerHTML = '<div class="empty-state">Break the first rack and the table feed will start updating.</div>';
      return;
    }
    ui.eventList.innerHTML = events.map((event) => `
      <article class="event-item">
        <strong>${event.text}</strong>
      </article>
    `).join('');
  }

  function renderSummary() {
    const snapshot = state.snapshot;
    const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
    const byColor = new Map(players.map((player) => [player.color, player]));
    const variant = currentVariantContext();
    const defaultRackText = variant ? `1 / ${variant.maxRacks || 3}` : '1 / 3';

    ui.roomCodeLabel.textContent = isSoloMode() ? 'SOLO' : (state.roomCode || '-');
    ui.rackLabel.textContent = snapshot ? `${snapshot.rackNumber} / ${snapshot.maxRacks}` : defaultRackText;
    ui.turnLabel.textContent = snapshot
      ? snapshot.winner
        ? `${capitalize(snapshot.winner)} wins`
        : snapshot.drawReason
          ? 'Match drawn'
          : `${capitalize(snapshot.turn)} to shoot`
      : 'Waiting to start';
    ui.phaseLabel.textContent = snapshot
      ? snapshot.status
      : (variant ? variant.description : 'Open a table to begin.');

    const whitePlayer = byColor.get('white');
    const blackPlayer = byColor.get('black');
    ui.whiteScore.textContent = snapshot ? String(snapshot.scores.white) : '0';
    ui.blackScore.textContent = snapshot ? String(snapshot.scores.black) : '0';
    ui.whiteMeta.textContent = byColor.get('white')
      ? `${byColor.get('white').name}${byColor.get('white').id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.blackMeta.textContent = byColor.get('black')
      ? `${byColor.get('black').name}${byColor.get('black').id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.whiteMeta.textContent = whitePlayer
      ? `${whitePlayer.name}${whitePlayer.id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.blackMeta.textContent = blackPlayer
      ? `${blackPlayer.name}${blackPlayer.id === state.playerId ? ' • You' : ''}`
      : 'Waiting for seat';
    ui.variantLabel.textContent = variant ? variant.label : 'Showdown';
    ui.whiteMeta.textContent = whitePlayer
      ? `${whitePlayer.name}${whitePlayer.id === state.playerId ? ' - You' : ''}`
      : 'Waiting for seat';
    ui.blackMeta.textContent = blackPlayer
      ? `${blackPlayer.name}${blackPlayer.id === state.playerId ? ' - You' : ''}`
      : 'Waiting for seat';
    ui.whiteCard.classList.toggle('active', Boolean(snapshot && snapshot.turn === 'white' && !snapshot.winner && !snapshot.drawReason));
    ui.blackCard.classList.toggle('active', Boolean(snapshot && snapshot.turn === 'black' && !snapshot.winner && !snapshot.drawReason));

    ui.shotCount.textContent = snapshot ? `${snapshot.shotCount} shot${snapshot.shotCount === 1 ? '' : 's'}` : '0 shots';
    ui.matchMeta.textContent = snapshot
      ? snapshot.winner
        ? `Final score ${snapshot.scores.white}-${snapshot.scores.black}`
        : snapshot.drawReason
          ? `Drawn ${snapshot.scores.white}-${snapshot.scores.black}`
          : formatMatchMeta(variant, isSoloMode())
      : formatMatchMeta(variant, isSoloMode());

    if (!snapshot) {
      ui.turnNote.textContent = variant
        ? `${variant.description} Host a live table or start solo to take the first break.`
        : 'Pocket a scoring ball to stay at the table. Scratches and jammers pass control.';
      ui.modePill.textContent = 'No table running';
      return;
    }

    if (snapshot.winner) {
      ui.turnNote.textContent = `${capitalize(snapshot.winner)} wins the table ${snapshot.scores.white}-${snapshot.scores.black}.`;
      ui.modePill.textContent = 'Match finished';
    } else if (snapshot.drawReason) {
      ui.turnNote.textContent = `The table finishes level at ${snapshot.scores.white}-${snapshot.scores.black}.`;
      ui.modePill.textContent = 'Match drawn';
    } else if (snapshot.moving) {
      ui.turnNote.textContent = 'Balls are live. Wait for the table to settle before the next shot.';
      ui.modePill.textContent = 'Balls in motion';
    } else if (!isSoloMode() && players.length < 2) {
      ui.turnNote.textContent = 'One player is at the table. Share the invite to bring in a second cue.';
      ui.modePill.textContent = 'Waiting for opponent';
    } else if (canShoot()) {
      ui.turnNote.textContent = isSoloMode()
        ? 'You have the cue. Aim on the table or grab the stick, pull it straight back to load power, and release to shoot. Pull longer for a boosted break.'
        : 'You have the cue. Aim on the table or grab the stick, pull it straight back to load power, and release to shoot.';
      ui.modePill.textContent = isSoloMode() ? 'Solo turn' : 'Your turn';
    } else {
      ui.turnNote.textContent = isSoloMode()
        ? `${SOLO_BOT_NAME} is lining up the next shot.`
        : `${capitalize(snapshot.turn)} is lining up the next shot.`;
      ui.modePill.textContent = isSoloMode() ? 'Bot turn' : 'Live duel';
    }
  }

  function renderUi() {
    ui.inviteInput.value = state.roomCode ? buildInviteUrl() : '';
    ui.copyBtn.disabled = !state.roomCode || isSoloMode();
    ui.copyCodeBtn.disabled = !state.roomCode || isSoloMode();
    ui.shareLoungeBtn.disabled = !state.roomCode || isSoloMode();
    ui.restartBtn.disabled = !(isConnected() || isSoloMode());
    if (ui.variantSelect) {
      ui.variantSelect.disabled = Boolean(isConnected() && !isSoloMode());
    }
    if (ui.variantNote) {
      const variant = currentVariantContext();
      ui.variantNote.textContent = variant
        ? isConnected() && !isSoloMode()
          ? `Current room: ${describeVariant(variant)} Host a new table to switch formats.`
          : describeVariant(variant)
        : 'Pick the kind of table you want before you host or start solo play.';
    }
    updateLayoutChrome();
    renderSummary();
    renderPlayers();
    renderEvents();
    updatePowerUi();
  }

  function setDrawTransform() {
    const { dpr, scale, offsetX, offsetY } = state.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.view.width, state.view.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
  }

  function drawTable() {
    const table = activeTable();
    const feltX = table.rail;
    const feltY = table.rail;
    const feltW = table.width - table.rail * 2;
    const feltH = table.height - table.rail * 2;
    const breakX = feltX + feltW * 0.27;

    ctx.fillStyle = '#3e2817';
    ctx.fillRect(0, 0, table.width, table.height);

    const woodGradient = ctx.createLinearGradient(0, 0, table.width, table.height);
    woodGradient.addColorStop(0, '#5e3d22');
    woodGradient.addColorStop(0.5, '#2c1b10');
    woodGradient.addColorStop(1, '#654327');
    ctx.fillStyle = woodGradient;
    ctx.fillRect(0, 0, table.width, table.height);

    const feltGradient = ctx.createLinearGradient(feltX, feltY, feltX, feltY + feltH);
    feltGradient.addColorStop(0, '#138b93');
    feltGradient.addColorStop(0.5, '#0f6470');
    feltGradient.addColorStop(1, '#0a4551');
    ctx.fillStyle = feltGradient;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    const sheen = ctx.createRadialGradient(table.width * 0.45, table.height * 0.2, 40, table.width * 0.45, table.height * 0.3, table.width * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    ctx.strokeStyle = 'rgba(244, 246, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(breakX, feltY + 14);
    ctx.lineTo(breakX, feltY + feltH - 14);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(breakX, table.height / 2, 62, Math.PI / 2, -Math.PI / 2, true);
    ctx.stroke();

    for (const pocket of pocketCoords(table)) {
      const pocketGradient = ctx.createRadialGradient(pocket.x - 4, pocket.y - 4, 1, pocket.x, pocket.y, table.pocketR);
      pocketGradient.addColorStop(0, '#505050');
      pocketGradient.addColorStop(1, '#050505');
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR, 0, Math.PI * 2);
      ctx.fillStyle = pocketGradient;
      ctx.fill();
    }
  }

  function pocketCoords(table = activeTable()) {
    const minX = table.rail;
    const minY = table.rail;
    const maxX = table.width - table.rail;
    const maxY = table.height - table.rail;
    return [
      { x: minX, y: minY },
      { x: (minX + maxX) / 2, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: (minX + maxX) / 2, y: maxY },
      { x: maxX, y: maxY },
    ];
  }

  function shade(hex, percent) {
    const value = hex.replace('#', '');
    const num = Number.parseInt(value, 16);
    const amt = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 0x00ff) + amt, 0, 255);
    const b = clamp((num & 0x0000ff) + amt, 0, 255);
    return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  function drawBall(ball) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r * 1.35);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.22, ball.kind === 'cue' ? '#f7f7f7' : ball.color);
    gradient.addColorStop(1, ball.kind === 'cue' ? '#dbdbdb' : shade(ball.color, -30));
    ctx.fillStyle = gradient;
    ctx.fill();

    if (ball.kind === 'target' || ball.kind === 'crown') {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = ball.kind === 'crown' ? 'rgba(32, 22, 6, 0.85)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
    }

    if (ball.kind === 'blocker') {
      ctx.strokeStyle = 'rgba(255, 106, 106, 0.88)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.x - ball.r * 0.55, ball.y - ball.r * 0.55);
      ctx.lineTo(ball.x + ball.r * 0.55, ball.y + ball.r * 0.55);
      ctx.moveTo(ball.x + ball.r * 0.55, ball.y - ball.r * 0.55);
      ctx.lineTo(ball.x - ball.r * 0.55, ball.y + ball.r * 0.55);
      ctx.stroke();
    }

    if (ball.label) {
      ctx.fillStyle = ball.kind === 'crown' ? '#ffeaa8' : '#0f1822';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(10, Math.round(ball.r * 0.95))}px system-ui`;
      ctx.fillText(ball.label, ball.x, ball.y + 0.5);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawBalls() {
    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      return;
    }
    for (const ball of state.snapshot.balls) {
      if (!ball.sunk) {
        drawBall(ball);
      }
    }
  }

  function drawCueAndGuide() {
    const cue = activeCue();
    if (!cue || !canShoot()) {
      return;
    }

    const direction = cueDirection();
    const guide = projectAimGuide(cue, direction);
    const power = state.aiming ? normalizedShotPower(state.power) : 0;
    const basePull = Math.min(power, 1) * CUE_UI.cuePullback;
    const boostPull = Math.max(0, power - 1) * CUE_UI.boostPullback;
    const cueTipDistance = cue.r + 6 + basePull + boostPull;
    const cueTip = {
      x: cue.x - direction.x * cueTipDistance,
      y: cue.y - direction.y * cueTipDistance,
    };
    const cueButt = {
      x: cueTip.x - direction.x * CUE_UI.cueLength,
      y: cueTip.y - direction.y * CUE_UI.cueLength,
    };
    const grip = {
      x: cueButt.x + direction.x * 42,
      y: cueButt.y + direction.y * 42,
    };
    const cueGhost = {
      x: cue.x + direction.x * Math.min(guide.distance, CUE_UI.guideLength),
      y: cue.y + direction.y * Math.min(guide.distance, CUE_UI.guideLength),
    };

    ctx.beginPath();
    ctx.arc(cue.x, cue.y, cue.r + 16, 0, Math.PI * 2);
    ctx.strokeStyle = power > 1
      ? 'rgba(255, 213, 124, 0.82)'
      : state.aiming
        ? 'rgba(113, 241, 209, 0.65)'
        : 'rgba(131, 181, 255, 0.34)';
    ctx.lineWidth = power > 1 ? 4.2 : state.aiming ? 3.4 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(guide.point.x, guide.point.y);
    ctx.strokeStyle = power > 1 ? 'rgba(255, 245, 214, 0.96)' : state.aiming ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.58)';
    ctx.lineWidth = power > 1 ? 3 : state.aiming ? 2.5 : 1.8;
    ctx.setLineDash(state.aiming ? [12, 8] : [8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (guide.type === 'ball' && guide.objectBall) {
      ctx.beginPath();
      ctx.arc(cueGhost.x, cueGhost.y, cue.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1.7;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(guide.objectBall.x, guide.objectBall.y);
      ctx.lineTo(
        guide.objectBall.x + guide.normal.x * 120,
        guide.objectBall.y + guide.normal.y * 120
      );
      ctx.strokeStyle = 'rgba(255, 213, 124, 0.78)';
      ctx.lineWidth = 1.7;
      ctx.setLineDash([7, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (guide.type === 'rail' && guide.normal) {
      const bounce = reflectDirection(direction, guide.normal);
      ctx.beginPath();
      ctx.moveTo(guide.point.x, guide.point.y);
      ctx.lineTo(
        guide.point.x + bounce.x * CUE_UI.guideBounceLength,
        guide.point.y + bounce.y * CUE_UI.guideBounceLength
      );
      ctx.strokeStyle = 'rgba(113, 241, 209, 0.6)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const cueGradient = ctx.createLinearGradient(cueButt.x, cueButt.y, cueTip.x, cueTip.y);
    cueGradient.addColorStop(0, '#4c2411');
    cueGradient.addColorStop(0.24, '#24130c');
    cueGradient.addColorStop(0.62, '#e5c28c');
    cueGradient.addColorStop(0.9, '#f1ddbd');
    cueGradient.addColorStop(1, '#8cc7ff');

    ctx.beginPath();
    ctx.moveTo(cueButt.x, cueButt.y);
    ctx.lineTo(cueTip.x, cueTip.y);
    ctx.strokeStyle = cueGradient;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cueButt.x, cueButt.y);
    ctx.lineTo(grip.x, grip.y);
    ctx.strokeStyle = '#11161d';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cueTip.x, cueTip.y);
    ctx.lineTo(cueTip.x + direction.x * 14, cueTip.y + direction.y * 14);
    ctx.strokeStyle = '#eef7ff';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    if (state.aiming) {
      ctx.beginPath();
      ctx.arc(grip.x, grip.y, CUE_UI.gripRadius * (0.56 + Math.min(power, 1.2) * 0.22), 0, Math.PI * 2);
      ctx.strokeStyle = power > 1 ? 'rgba(255, 213, 124, 0.52)' : 'rgba(113, 241, 209, 0.34)';
      ctx.lineWidth = power > 1 ? 2.8 : 2.2;
      ctx.stroke();
    }
  }

  function drawOverlay() {
    const snapshot = state.snapshot;
    const table = activeTable();
    let title = '';
    let subtitle = '';

    if (!snapshot) {
      title = 'Mini Pool Showdown';
      subtitle = 'Open a live table to start playing.';
    } else if (snapshot.winner) {
      title = `${capitalize(snapshot.winner)} wins`;
      subtitle = `Final score ${snapshot.scores.white} - ${snapshot.scores.black}`;
    } else if (snapshot.drawReason) {
      title = 'Match drawn';
      subtitle = `Final score ${snapshot.scores.white} - ${snapshot.scores.black}`;
    } else if (!isSoloMode() && (snapshot.players || []).length < 2) {
      title = 'Waiting for challenger';
      subtitle = 'Share the invite link to fill the second seat.';
    }

    if (!title) {
      return;
    }

    const boxW = 360;
    const boxH = 132;
    const boxX = table.width / 2 - boxW / 2;
    const boxY = table.height / 2 - boxH / 2;

    ctx.fillStyle = 'rgba(4, 9, 16, 0.72)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#f5f8ff';
    ctx.textAlign = 'center';
    ctx.font = '700 28px "Space Grotesk", sans-serif';
    ctx.fillText(title, table.width / 2, boxY + 48);
    ctx.font = '500 17px Inter, sans-serif';
    ctx.fillStyle = 'rgba(238,245,255,0.8)';
    ctx.fillText(subtitle, table.width / 2, boxY + 84);
  }

  function stepSoloMode(now) {
    if (!isSoloMode() || !state.localGame) {
      state.lastFrameAt = now;
      return;
    }
    const core = localCore();
    if (!core) {
      state.lastFrameAt = now;
      return;
    }
    const last = state.lastFrameAt || now;
    const deltaSeconds = clamp((now - last) / 1000, 1 / 120, 0.08);
    state.lastFrameAt = now;
    if (core.step(state.localGame, deltaSeconds)) {
      refreshLocalSnapshot();
    }
    maybeTakeSoloBotTurn(now);
  }

  function drawFrame(now = performance.now()) {
    stepSoloMode(now);
    resizeCanvas();
    setDrawTransform();
    drawTable();
    drawBalls();
    drawCueAndGuide();
    drawOverlay();
    requestAnimationFrame(drawFrame);
  }

  function handleSnapshot(payload) {
    state.mode = 'online';
    state.localGame = null;
    state.localPlayers = [];
    state.soloBotDueAt = 0;
    state.snapshot = payload.snapshot || null;
    if (state.snapshot && state.snapshot.roomCode) {
      state.roomCode = sanitizeRoomCode(state.snapshot.roomCode);
      ui.roomInput.value = state.roomCode;
    }
    if (state.snapshot && state.snapshot.variantId && ui.variantSelect) {
      ui.variantSelect.value = normalizeVariantId(state.snapshot.variantId);
    }
    state.summarySignature = snapshotSignature(state.snapshot);
    setNetworkStatus('online', 'Online');
    setStatus(payload.message || (state.snapshot && state.snapshot.status) || 'Connected to the live table.');
    renderUi();
  }

  function connect(mode) {
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (mode === 'join' && !roomCode) {
      setStatus('Enter a room code before joining.');
      return;
    }

    savePrefs();
    resetAimState();
    state.mode = 'online';
    state.localGame = null;
    state.localPlayers = [];
    state.soloBotDueAt = 0;
    const socket = new WebSocket(currentServerUrl());
    const previous = state.socket;
    if (previous && previous.readyState < WebSocket.CLOSING) {
      previous.close();
    }

    state.socket = socket;
    state.snapshot = null;
    state.playerId = '';
    state.yourColor = null;
    state.summarySignature = snapshotSignature(null);
    state.lastFrameAt = performance.now();
    if (mode === 'host') {
      state.roomCode = roomCode;
    }
    setNetworkStatus('connecting', 'Connecting');
    setStatus(`${mode === 'host' ? 'Hosting' : 'Joining'} a live table...`);
    renderUi();

    socket.addEventListener('open', () => {
      if (state.socket !== socket) {
        return;
      }
      socket.send(JSON.stringify({
        action: 'join',
        game: 'mini-pool',
        mode,
        roomCode,
        variantId: selectedVariantId(),
        name: ui.nameInput.value.trim().slice(0, 18) || 'Guest',
      }));
    });

    socket.addEventListener('message', (event) => {
      if (state.socket !== socket) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        setStatus('The table sent back an unreadable update.');
        return;
      }

      if (payload.type === 'welcome') {
        state.playerId = payload.playerId || '';
        state.yourColor = payload.color || null;
        state.roomCode = sanitizeRoomCode(payload.roomCode || roomCode);
        ui.roomInput.value = state.roomCode;
        renderUi();
        return;
      }

      if (payload.type === 'state') {
        handleSnapshot(payload);
        return;
      }

      if (payload.type === 'error') {
        setStatus(payload.message || 'The table rejected that action.');
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) {
        return;
      }
      state.socket = null;
      setNetworkStatus('offline', 'Offline');
      setStatus('The live table disconnected. Rejoin when you are ready.');
      renderUi();
    });

    socket.addEventListener('error', () => {
      if (state.socket !== socket) {
        return;
      }
      setStatus('The live table hit a network error.');
    });
  }

  function beginAim(event) {
    if (!canShoot()) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY);
    const cue = activeCue();
    if (!point || !cue) {
      return;
    }
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const distance = Math.hypot(dx, dy);
    const currentDirection = cueDirection();
    const forwardDot = dx * currentDirection.x + dy * currentDirection.y;
    state.aiming = true;
    state.pointerId = event.pointerId;
    state.pointer = point;
    state.aimAnchor.x = point.x;
    state.aimAnchor.y = point.y;
    state.aimLocked = false;
    state.aimFromStick = forwardDot < 0;
    updateAimAngleFromPoint(cue, point, state.aimFromStick, { immediate: true });
    state.power = 0;
    updatePowerUi();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture issues.
    }
  }

  function moveAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY, true);
    if (!point) {
      return;
    }
    state.pointer = point;
    const cue = activeCue();
    if (cue) {
      const dx = point.x - cue.x;
      const dy = point.y - cue.y;
      const distance = Math.hypot(dx, dy);
      if (state.aimFromStick || !state.aimLocked) {
        updateAimAngleFromPoint(cue, point, state.aimFromStick);
      }
      const direction = cueDirection();
      const dragX = state.aimAnchor.x - point.x;
      const dragY = state.aimAnchor.y - point.y;
      const pullback = dragX * direction.x + dragY * direction.y;
      const lateral = Math.abs(dragX * -direction.y + dragY * direction.x);
      const lockLateralLimit = Math.max(CUE_UI.lockLateral, pullback * 1.35);
      if (!state.aimLocked) {
        if (pullback > CUE_UI.lockPullback && lateral < lockLateralLimit) {
          state.aimLocked = true;
        } else {
          state.aimAnchor.x = point.x;
          state.aimAnchor.y = point.y;
          state.power = 0;
          updatePowerUi();
          return;
        }
      }
      const unlockLateralLimit = Math.max(CUE_UI.unlockLateral, pullback * 2.2);
      if (state.aimLocked && (pullback < CUE_UI.unlockPullback || lateral > unlockLateralLimit)) {
        state.aimLocked = false;
        updateAimAngleFromPoint(cue, point, state.aimFromStick, { immediate: true });
        state.aimAnchor.x = point.x;
        state.aimAnchor.y = point.y;
        state.power = 0;
        updatePowerUi();
        return;
      }
      const rawPower = Math.max(0, pullback - 4) / CUE_UI.powerRange;
      const easedPower = rawPower <= 1
        ? Math.pow(rawPower, 0.9)
        : 1 + Math.pow(rawPower - 1, 0.82);
      state.power = clamp(easedPower, 0, CUE_UI.maxPower);
    }
    updatePowerUi();
  }

  function finishAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY, true) || state.pointer;
    const cue = activeCue();
    const power = normalizedShotPower(state.power);
    state.aiming = false;
    state.pointerId = null;
    state.power = 0;
    state.aimLocked = false;
    state.aimFromStick = false;

    if (!cue || !point || !canShoot()) {
      updatePowerUi();
      return;
    }

    if (power < CUE_UI.minPower) {
      updatePowerUi();
      return;
    }

    const direction = cueDirection();
    if (isSoloMode()) {
      playSoloShot('white', {
        vectorX: direction.x,
        vectorY: direction.y,
        power,
      }, 'Shot fired. Orbit Bot is watching the table.');
    } else {
      const legacyVectorScale = power * 320;
      if (sendJson({
        action: 'shoot',
        vectorX: direction.x * legacyVectorScale,
        vectorY: direction.y * legacyVectorScale,
        power,
      })) {
        setStatus('Shot sent. Waiting for the table physics to resolve.');
      }
    }
    updatePowerUi();
  }

  function hydrate() {
    populateVariantSelect();
    ui.nameInput.value = (localStorage.getItem(STORAGE_KEYS.name) || '').slice(0, 18);
    ui.serverUrlInput.value = normalizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
    state.serverUrl = ui.serverUrlInput.value;
    state.roomCode = sanitizeRoomCode(ui.roomInput.value);
    state.summarySignature = snapshotSignature(null);
    state.lastFrameAt = performance.now();
    const storedSetupPref = localStorage.getItem(STORAGE_KEYS.setupCollapsed);
    const storedSidebarPref = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed);
    state.setupCollapsed = storedSetupPref === null ? false : storedSetupPref === '1';
    state.sidebarCollapsed = storedSidebarPref === null ? window.innerWidth < 1460 : storedSidebarPref === '1';
    updateLayoutChrome();
    setNetworkStatus('offline', 'Offline');
    setStatus('Host a duel, join by room code, or start a solo showdown against Orbit Bot.');
    renderUi();
  }

  ui.hostBtn.addEventListener('click', () => connect('host'));
  ui.joinBtn.addEventListener('click', () => connect('join'));
  ui.soloBtn.addEventListener('click', startSoloGame);
  ui.toggleSetupBtn.addEventListener('click', () => {
    state.setupCollapsed = !state.setupCollapsed;
    savePanelPrefs();
    updateLayoutChrome();
    renderUi();
  });
  ui.toggleSidebarBtn.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    savePanelPrefs();
    updateLayoutChrome();
    renderUi();
  });
  ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
  ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
  ui.copyBtn.addEventListener('click', () => copyToClipboard(ui.inviteInput.value, 'Invite link copied.'));
  ui.copyCodeBtn.addEventListener('click', () => copyToClipboard(state.roomCode, 'Room code copied.'));
  ui.restartBtn.addEventListener('click', () => {
    if (isSoloMode()) {
      resetSoloGame();
      return;
    }
    sendJson({ action: 'restart' });
  });
  ui.nameInput.addEventListener('change', () => {
    savePrefs();
    if (isSoloMode()) {
      state.localPlayers = buildSoloPlayers();
      refreshLocalSnapshot({ forceRender: true });
    }
  });
  ui.serverUrlInput.addEventListener('change', () => {
    ui.serverUrlInput.value = normalizeServerUrl(ui.serverUrlInput.value);
    savePrefs();
    renderUi();
  });
  ui.variantSelect.addEventListener('change', () => {
    ui.variantSelect.value = selectedVariantId();
    savePrefs();
    if (ui.variantNote) {
      ui.variantNote.textContent = describeVariant(selectedVariant());
    }
    if (isSoloMode()) {
      startSoloGame();
      return;
    }
    if (!isConnected()) {
      const variant = selectedVariant();
      setStatus(variant
        ? `${variant.label} is selected. Host a table, join a room, or start solo when you are ready.`
        : 'Pick the kind of table you want before you host or start solo play.');
    }
    renderUi();
  });
  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    state.roomCode = sanitizeRoomCode(ui.roomInput.value);
    renderUi();
  });

  canvas.addEventListener('pointerdown', beginAim);
  canvas.addEventListener('pointermove', moveAim);
  canvas.addEventListener('pointerup', finishAim);
  canvas.addEventListener('pointercancel', finishAim);
  window.addEventListener('resize', resizeCanvas);

  hydrate();
  drawFrame();

  if (state.roomCode) {
    connect('join');
  }
})();
