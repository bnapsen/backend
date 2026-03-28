(() => {
  'use strict';

  const STORAGE_KEYS = {
    name: 'miniPoolShowdown.name',
    serverUrl: 'miniPoolShowdown.serverUrl',
    variantId: 'miniPoolShowdown.variantId',
    setupCollapsed: 'miniPoolShowdown.setupCollapsed',
    sidebarCollapsed: 'miniPoolShowdown.sidebarCollapsed',
    soundEnabled: 'miniPoolShowdown.soundEnabled',
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
    soundToggleBtn: document.getElementById('soundToggleBtn'),
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
    startOverlay: document.getElementById('startOverlay'),
    startNote: document.getElementById('startNote'),
    heroSoloBtn: document.getElementById('heroSoloBtn'),
    heroHostBtn: document.getElementById('heroHostBtn'),
    heroJoinBtn: document.getElementById('heroJoinBtn'),
    heroSetupBtn: document.getElementById('heroSetupBtn'),
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
    powerTarget: 0,
    aimAngle: 0,
    aimAngleTarget: 0,
    aimAnchor: { x: 0, y: 0 },
    aimLocked: false,
    aimFromStick: false,
    stickGrabDistance: 0,
    localGame: null,
    localPlayers: [],
    soloBotDueAt: 0,
    lastFrameAt: 0,
    lastUiFrameAt: 0,
    summarySignature: '',
    setupCollapsed: false,
    sidebarCollapsed: false,
    soundEnabled: true,
    audioTelemetry: null,
    lastShotSoundAt: 0,
    pendingLocalShotCount: 0,
    frameHandle: 0,
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
    powerRange: 70,
    maxPower: 2.05,
    minPower: 0.04,
    cuePullback: 144,
    boostPullback: 134,
    cueLength: 264,
    guideLength: 640,
    guideBounceLength: 124,
    guideSecondaryLength: 96,
    guideObjectLength: 146,
    guideCueDeflectLength: 82,
    guideMarkerSpacing: 24,
    guideMarkerRadius: 2.2,
    gripRadius: 36,
    lockPullback: 10,
    unlockPullback: 4,
    lockLateral: 64,
    unlockLateral: 140,
    aimDeadZone: 26,
    aimPrecisionRange: 210,
    aimSmoothing: 0.22,
    stickAimSmoothing: 0.16,
    powerSmoothing: 0.26,
    aimLerpPerSecond: 22,
    stickAimLerpPerSecond: 14,
    powerLerpPerSecond: 18,
    scenePadding: 132,
    minCueVisualScale: 0.52,
  });
  const SOLO_BOT_NAME = 'Orbit Bot';
  const MAX_RAW_POWER = 1 + Math.pow(CUE_UI.maxPower - 1, 1 / 0.82);
  const TABLE_ART = Object.freeze({
    feltSrc: 'assets/pool/felt-green-gradient-cc0.png',
    woodSrc: 'assets/pool/synthetic-wood-polyhaven-1k.jpg',
  });

  function loadTextureAsset(src) {
    const image = new Image();
    const asset = {
      image,
      ready: false,
    };
    image.decoding = 'async';
    image.addEventListener('load', () => {
      asset.ready = true;
      queueDrawFrame();
    });
    image.addEventListener('error', () => {
      asset.ready = false;
    });
    image.src = src;
    return asset;
  }

  const textureAssets = {
    felt: loadTextureAsset(TABLE_ART.feltSrc),
    wood: loadTextureAsset(TABLE_ART.woodSrc),
  };
  const audioState = {
    ctx: null,
    master: null,
    noiseBuffer: null,
  };

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hexToRgb(hex) {
    const value = String(hex || '#000000').replace('#', '');
    const normalized = value.length === 3
      ? value.split('').map((char) => `${char}${char}`).join('')
      : value.padEnd(6, '0').slice(0, 6);
    const num = Number.parseInt(normalized, 16);
    return {
      r: (num >> 16) & 0xff,
      g: (num >> 8) & 0xff,
      b: num & 0xff,
    };
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
  }

  function roundedRectPath(x, y, width, height, radius) {
    const corner = clamp(radius, 0, Math.min(width, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + corner, y);
    ctx.arcTo(x + width, y, x + width, y + height, corner);
    ctx.arcTo(x + width, y + height, x, y + height, corner);
    ctx.arcTo(x, y + height, x, y, corner);
    ctx.arcTo(x, y, x + width, y, corner);
    ctx.closePath();
  }

  function drawTexture(asset, x, y, width, height, alpha = 1) {
    if (!asset || !asset.ready) {
      return false;
    }
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(asset.image, x, y, width, height);
    ctx.restore();
    return true;
  }

  function updateSoundToggleUi() {
    if (!ui.soundToggleBtn) {
      return;
    }
    ui.soundToggleBtn.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
    ui.soundToggleBtn.dataset.active = state.soundEnabled ? 'true' : 'false';
  }

  function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 1.6);
    }
    return buffer;
  }

  function ensureAudioContext() {
    if (!state.soundEnabled) {
      return null;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    if (!audioState.ctx) {
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
      audioState.ctx = ctx;
      audioState.master = master;
      audioState.noiseBuffer = createNoiseBuffer(ctx);
    }
    if (audioState.ctx.state === 'suspended') {
      audioState.ctx.resume().catch(() => {});
    }
    return audioState.ctx;
  }

  function primeAudio() {
    ensureAudioContext();
  }

  function playTone(options = {}) {
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.master) {
      return;
    }
    const now = ctx.currentTime + (options.delay || 0);
    const duration = Math.max(0.02, options.duration || 0.12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = options.type || 'triangle';
    const startFreq = options.startFreq || 320;
    const endFreq = options.endFreq || startFreq;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
    const peak = options.gain || 0.15;
    const attack = Math.min(duration * 0.18, options.attack || 0.012);
    const release = Math.max(0.012, options.release || duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
    osc.connect(gain);
    gain.connect(audioState.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  function playNoiseBurst(options = {}) {
    const ctx = ensureAudioContext();
    if (!ctx || !audioState.master || !audioState.noiseBuffer) {
      return;
    }
    const now = ctx.currentTime + (options.delay || 0);
    const duration = Math.max(0.02, options.duration || 0.09);
    const source = ctx.createBufferSource();
    source.buffer = audioState.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filterType || 'bandpass';
    filter.frequency.value = options.frequency || 780;
    filter.Q.value = options.q || 1.2;
    const gain = ctx.createGain();
    const peak = options.gain || 0.08;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioState.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function playToggleSound() {
    playTone({ type: 'sine', startFreq: 620, endFreq: 880, duration: 0.08, gain: 0.05 });
    playTone({ type: 'triangle', startFreq: 940, endFreq: 1220, duration: 0.06, delay: 0.015, gain: 0.035 });
  }

  function playShotSound(strength = 1) {
    const amount = clamp(strength, 0.4, 2.2);
    playNoiseBurst({ duration: 0.05, gain: 0.05 * amount, frequency: 1320, q: 0.85 });
    playTone({ type: 'triangle', startFreq: 172 - amount * 16, endFreq: 72, duration: 0.16, gain: 0.12 * amount });
    playTone({ type: 'sine', startFreq: 102, endFreq: 54, duration: 0.2, delay: 0.008, gain: 0.08 * amount });
    state.lastShotSoundAt = performance.now();
  }

  function playPocketSound(brightness = 1) {
    const amount = clamp(brightness, 0.8, 1.4);
    playTone({ type: 'sine', startFreq: 480 * amount, endFreq: 220, duration: 0.18, gain: 0.08 * amount });
    playTone({ type: 'triangle', startFreq: 280 * amount, endFreq: 148, duration: 0.22, delay: 0.018, gain: 0.075 });
    playNoiseBurst({ duration: 0.08, gain: 0.035, frequency: 540, q: 0.7 });
  }

  function playFoulSound() {
    playTone({ type: 'sawtooth', startFreq: 210, endFreq: 120, duration: 0.18, gain: 0.06 });
    playTone({ type: 'triangle', startFreq: 164, endFreq: 88, duration: 0.22, delay: 0.028, gain: 0.05 });
  }

  function playWinSound() {
    playTone({ type: 'triangle', startFreq: 520, endFreq: 520, duration: 0.18, gain: 0.06 });
    playTone({ type: 'triangle', startFreq: 660, endFreq: 660, duration: 0.2, delay: 0.08, gain: 0.06 });
    playTone({ type: 'triangle', startFreq: 880, endFreq: 880, duration: 0.24, delay: 0.16, gain: 0.07 });
  }

  function summarizeAudioSnapshot(snapshot) {
    return snapshot ? {
      shotCount: snapshot.shotCount || 0,
      moving: Boolean(snapshot.moving),
      winner: snapshot.winner || '',
      drawReason: snapshot.drawReason || '',
      latestEventId: Array.isArray(snapshot.events) && snapshot.events.length ? snapshot.events[0].id : '',
      latestEventText: Array.isArray(snapshot.events) && snapshot.events.length ? snapshot.events[0].text || '' : '',
    } : {
      shotCount: 0,
      moving: false,
      winner: '',
      drawReason: '',
      latestEventId: '',
      latestEventText: '',
    };
  }

  function updateSnapshotAudio(snapshot) {
    const next = summarizeAudioSnapshot(snapshot);
    const previous = state.audioTelemetry;
    state.audioTelemetry = next;
    if (!state.soundEnabled || !snapshot || !previous) {
      return;
    }
    const now = performance.now();
    if (next.shotCount > previous.shotCount) {
      if (state.pendingLocalShotCount && next.shotCount >= state.pendingLocalShotCount) {
        state.pendingLocalShotCount = 0;
      } else if (now - state.lastShotSoundAt > 140) {
        playShotSound(0.86);
      }
    }
    if (next.latestEventId && next.latestEventId !== previous.latestEventId) {
      const text = next.latestEventText.toLowerCase();
      if (text.includes('pockets') || text.includes('rack clear') || text.includes('crown')) {
        playPocketSound(text.includes('crown') ? 1.18 : 1);
      } else if (text.includes('jammer') || text.includes('scratch') || text.includes('penalty')) {
        playFoulSound();
      }
    }
    if (!previous.winner && next.winner) {
      playWinSound();
    }
  }

  function setSoundEnabled(enabled, options = {}) {
    state.soundEnabled = Boolean(enabled);
    localStorage.setItem(STORAGE_KEYS.soundEnabled, state.soundEnabled ? '1' : '0');
    updateSoundToggleUi();
    if (state.soundEnabled) {
      primeAudio();
      if (options.preview) {
        playToggleSound();
      }
    }
  }

  function lerp(start, end, amount) {
    return start + (end - start) * clamp(amount, 0, 1);
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
    state.powerTarget = 0;
    state.aimAngleTarget = state.aimAngle;
    state.aimAnchor.x = 0;
    state.aimAnchor.y = 0;
    state.aimLocked = false;
    state.aimFromStick = false;
    state.stickGrabDistance = 0;
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

  function normalizeVector(x, y) {
    const length = Math.hypot(x, y) || 1;
    return {
      x: x / length,
      y: y / length,
    };
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
      state.aimAngleTarget = targetAngle;
      return true;
    }
    const precisionFactor = clamp((distance - CUE_UI.aimDeadZone) / CUE_UI.aimPrecisionRange, 0, 1);
    const blendFloor = fromStick ? CUE_UI.stickAimSmoothing * 0.78 : CUE_UI.aimSmoothing * 0.68;
    const blendCeiling = fromStick ? CUE_UI.stickAimSmoothing * 1.34 : CUE_UI.aimSmoothing * 1.26;
    const blend = lerp(blendFloor, blendCeiling, precisionFactor);
    state.aimAngleTarget = lerpAngle(state.aimAngleTarget, targetAngle, blend);
    return true;
  }

  function computeCuePullState(cue, point) {
    const direction = cueDirection();
    let pullback;
    let lateral;
    if (state.aimFromStick) {
      const pointerDx = point.x - cue.x;
      const pointerDy = point.y - cue.y;
      const currentBackDistance = Math.max(0, -(pointerDx * direction.x + pointerDy * direction.y));
      pullback = currentBackDistance - state.stickGrabDistance;
      lateral = Math.abs(pointerDx * -direction.y + pointerDy * direction.x);
    } else {
      const dragX = state.aimAnchor.x - point.x;
      const dragY = state.aimAnchor.y - point.y;
      pullback = dragX * direction.x + dragY * direction.y;
      lateral = Math.abs(dragX * -direction.y + dragY * direction.x);
    }
    const viewportBounds = pointerViewportBounds();
    const availablePullback = distanceToRectEdge(state.aimAnchor, { x: -direction.x, y: -direction.y }, viewportBounds);
    const adaptiveRange = availablePullback > 0
      ? Math.min(CUE_UI.powerRange, Math.max(10, (availablePullback - 4) / MAX_RAW_POWER))
      : CUE_UI.powerRange;
    const rawPower = Math.max(0, pullback - 4) / adaptiveRange;
    const easedPower = rawPower <= 1
      ? Math.pow(rawPower, 0.9)
      : 1 + Math.pow(rawPower - 1, 0.82);
    return {
      pullback,
      lateral,
      adaptiveRange,
      availablePullback,
      power: clamp(easedPower, 0, CUE_UI.maxPower),
    };
  }

  function stepCueUi(now = performance.now()) {
    const last = state.lastUiFrameAt || now;
    const dt = clamp((now - last) / 1000, 1 / 240, 0.05);
    state.lastUiFrameAt = now;
    const aimRate = state.aimFromStick ? CUE_UI.stickAimLerpPerSecond : CUE_UI.aimLerpPerSecond;
    const aimAmount = 1 - Math.exp(-aimRate * dt);
    const powerAmount = 1 - Math.exp(-CUE_UI.powerLerpPerSecond * dt);
    state.aimAngle = lerpAngle(state.aimAngle, state.aimAngleTarget, aimAmount);
    state.power = lerp(state.power, state.powerTarget, powerAmount);
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

  function setPanelVisibility(options = {}) {
    const nextSetup = typeof options.setupCollapsed === 'boolean'
      ? options.setupCollapsed
      : state.setupCollapsed;
    const nextSidebar = typeof options.sidebarCollapsed === 'boolean'
      ? options.sidebarCollapsed
      : state.sidebarCollapsed;
    const changed = nextSetup !== state.setupCollapsed || nextSidebar !== state.sidebarCollapsed;
    state.setupCollapsed = nextSetup;
    state.sidebarCollapsed = nextSidebar;
    savePanelPrefs();
    if (changed) {
      updateLayoutChrome();
    }
  }

  function collapsePlayChrome() {
    setPanelVisibility({
      setupCollapsed: true,
      sidebarCollapsed: true,
    });
  }

  function revealSetupPanel(message, focusTarget = ui.nameInput) {
    setPanelVisibility({
      setupCollapsed: false,
      sidebarCollapsed: true,
    });
    if (message) {
      setStatus(message);
    }
    renderUi();
    requestAnimationFrame(() => {
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
        if (typeof focusTarget.select === 'function') {
          focusTarget.select();
        }
      }
    });
  }

  function isSocketConnecting() {
    return Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
  }

  function updateLayoutChrome() {
    if (!ui.layout) {
      return;
    }
    ui.layout.classList.toggle('setup-collapsed', state.setupCollapsed);
    ui.layout.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    if (ui.toggleSetupBtn) {
      ui.toggleSetupBtn.textContent = state.setupCollapsed ? 'Show setup' : 'Hide setup';
      ui.toggleSetupBtn.dataset.active = state.setupCollapsed ? 'false' : 'true';
    }
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = state.sidebarCollapsed ? 'Show feed' : 'Hide feed';
      ui.toggleSidebarBtn.dataset.active = state.sidebarCollapsed ? 'false' : 'true';
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
    updateSnapshotAudio(snapshot);
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
    collapsePlayChrome();
    resetAimState();
    state.mode = 'solo';
    state.localGame = core.createGameState({ variantId: selectedVariantId() });
    state.localPlayers = buildSoloPlayers();
    state.roomCode = 'SOLO';
    state.audioTelemetry = summarizeAudioSnapshot(null);
    state.pendingLocalShotCount = 0;
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

  function distanceToRectEdge(origin, direction, bounds) {
    let best = Number.POSITIVE_INFINITY;
    if (direction.x > 0.0001) {
      best = Math.min(best, (bounds.maxX - origin.x) / direction.x);
    } else if (direction.x < -0.0001) {
      best = Math.min(best, (bounds.minX - origin.x) / direction.x);
    }
    if (direction.y > 0.0001) {
      best = Math.min(best, (bounds.maxY - origin.y) / direction.y);
    } else if (direction.y < -0.0001) {
      best = Math.min(best, (bounds.minY - origin.y) / direction.y);
    }
    return Number.isFinite(best) && best > 0 ? best : 0;
  }

  function pointerViewportBounds() {
    const rect = canvas.getBoundingClientRect();
    return {
      minX: (0 - rect.left - state.view.offsetX) / state.view.scale,
      maxX: (window.innerWidth - rect.left - state.view.offsetX) / state.view.scale,
      minY: (0 - rect.top - state.view.offsetY) / state.view.scale,
      maxY: (window.innerHeight - rect.top - state.view.offsetY) / state.view.scale,
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

  function projectRailGuide(origin, direction, radius, bounds, maxDistance) {
    let bestHit = null;
    const candidates = [];
    if (direction.x > 0.0001) {
      candidates.push({ distance: (bounds.maxX - radius - origin.x) / direction.x, normal: { x: -1, y: 0 } });
    } else if (direction.x < -0.0001) {
      candidates.push({ distance: (bounds.minX + radius - origin.x) / direction.x, normal: { x: 1, y: 0 } });
    }
    if (direction.y > 0.0001) {
      candidates.push({ distance: (bounds.maxY - radius - origin.y) / direction.y, normal: { x: 0, y: -1 } });
    } else if (direction.y < -0.0001) {
      candidates.push({ distance: (bounds.minY + radius - origin.y) / direction.y, normal: { x: 0, y: 1 } });
    }

    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.distance) || candidate.distance <= 0.001 || candidate.distance >= maxDistance) {
        continue;
      }
      const hitX = origin.x + direction.x * candidate.distance;
      const hitY = origin.y + direction.y * candidate.distance;
      if (hitX < bounds.minX || hitX > bounds.maxX || hitY < bounds.minY || hitY > bounds.maxY) {
        continue;
      }
      bestHit = {
        type: 'rail',
        distance: candidate.distance,
        point: { x: hitX, y: hitY },
        normal: candidate.normal,
      };
      maxDistance = candidate.distance;
    }
    return bestHit;
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
    const railHit = projectRailGuide(cue, direction, cue.r, bounds, maxDistance);
    if (railHit) {
      bestHit = railHit;
    }

    if (!state.snapshot || !Array.isArray(state.snapshot.balls)) {
      if (bestHit.type === 'rail' && bestHit.normal) {
        const bounceDirection = reflectDirection(direction, bestHit.normal);
        const secondOrigin = {
          x: bestHit.point.x + bounceDirection.x * 0.8,
          y: bestHit.point.y + bounceDirection.y * 0.8,
        };
        bestHit.bounceDirection = bounceDirection;
        bestHit.bounce = projectRailGuide(secondOrigin, bounceDirection, cue.r, bounds, CUE_UI.guideSecondaryLength);
      }
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
      const objectDirection = {
        x: normalX / normalLength,
        y: normalY / normalLength,
      };
      const cueDeflectRaw = {
        x: direction.x - objectDirection.x * (direction.x * objectDirection.x + direction.y * objectDirection.y),
        y: direction.y - objectDirection.y * (direction.x * objectDirection.x + direction.y * objectDirection.y),
      };
      bestHit = {
        type: 'ball',
        distance,
        point: cueImpact,
        objectBall: ball,
        cueContactPoint: {
          x: cueImpact.x + objectDirection.x * cue.r,
          y: cueImpact.y + objectDirection.y * cue.r,
        },
        objectContactPoint: {
          x: ball.x - objectDirection.x * ball.r,
          y: ball.y - objectDirection.y * ball.r,
        },
        normal: objectDirection,
        cueDeflectDirection: Math.hypot(cueDeflectRaw.x, cueDeflectRaw.y) > 0.0001
          ? normalizeVector(cueDeflectRaw.x, cueDeflectRaw.y)
          : null,
      };
    }

    if (bestHit.type === 'rail' && bestHit.normal) {
      const bounceDirection = reflectDirection(direction, bestHit.normal);
      const secondOrigin = {
        x: bestHit.point.x + bounceDirection.x * 0.8,
        y: bestHit.point.y + bounceDirection.y * 0.8,
      };
      bestHit.bounceDirection = bounceDirection;
      bestHit.bounce = projectRailGuide(secondOrigin, bounceDirection, cue.r, bounds, CUE_UI.guideSecondaryLength);
    }
    return bestHit;
  }

  function resizeCanvas() {
    const stageRect = ui.tableStage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const rect = canvasRect.width > 0 && canvasRect.height > 0 ? canvasRect : stageRect;
    if (!rect.width || !rect.height) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const table = activeTable();
    const sceneWidth = table.width + CUE_UI.scenePadding * 2;
    const sceneHeight = table.height + CUE_UI.scenePadding * 2;
    const scale = Math.min(rect.width / sceneWidth, rect.height / sceneHeight);
    state.view = {
      width: rect.width,
      height: rect.height,
      scale,
      offsetX: (rect.width - sceneWidth * scale) / 2 + CUE_UI.scenePadding * scale,
      offsetY: (rect.height - sceneHeight * scale) / 2 + CUE_UI.scenePadding * scale,
      dpr,
    };
  }

  function boardPointFromClient(clientX, clientY, clampMode = 'table') {
    const rect = canvas.getBoundingClientRect();
    const table = activeTable();
    const x = (clientX - rect.left - state.view.offsetX) / state.view.scale;
    const y = (clientY - rect.top - state.view.offsetY) / state.view.scale;
    if (clampMode === 'none') {
      return { x, y };
    }
    const minX = clampMode === 'scene' ? -CUE_UI.scenePadding : 0;
    const maxX = clampMode === 'scene' ? table.width + CUE_UI.scenePadding : table.width;
    const minY = clampMode === 'scene' ? -CUE_UI.scenePadding : 0;
    const maxY = clampMode === 'scene' ? table.height + CUE_UI.scenePadding : table.height;
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return null;
    }
    return {
      x: clamp(x, minX, maxX),
      y: clamp(y, minY, maxY),
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

  function renderStartOverlay() {
    if (!ui.startOverlay) {
      return;
    }
    const show = !state.snapshot;
    ui.startOverlay.hidden = !show;
    ui.startOverlay.dataset.visible = show ? 'true' : 'false';
    if (!show) {
      return;
    }
    const busy = isSocketConnecting();
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    const variant = selectedVariant();
    if (ui.heroSoloBtn) {
      ui.heroSoloBtn.disabled = busy;
    }
    if (ui.heroHostBtn) {
      ui.heroHostBtn.disabled = busy;
    }
    if (ui.heroJoinBtn) {
      ui.heroJoinBtn.disabled = busy;
      ui.heroJoinBtn.textContent = roomCode ? 'Join room' : 'Join with code';
    }
    if (ui.heroSetupBtn) {
      ui.heroSetupBtn.textContent = state.setupCollapsed ? 'Open setup options' : 'Focus setup options';
    }
    if (ui.startNote) {
      if (busy) {
        ui.startNote.textContent = 'Connecting to the live table. The setup rail will tuck away as soon as the table opens.';
      } else if (state.setupCollapsed) {
        ui.startNote.textContent = `Play ${variant ? variant.label : 'solo'} instantly, or open setup to change your name, room code, and format before the break.`;
      } else {
        ui.startNote.textContent = `Play ${variant ? variant.label : 'solo'} instantly, or use setup on the left to tune your name, room code, and format before the break.`;
      }
    }
  }

  function renderUi() {
    updateSoundToggleUi();
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
    renderStartOverlay();
    updatePowerUi();
  }

  function setDrawTransform() {
    const { dpr, scale, offsetX, offsetY } = state.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.view.width, state.view.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr, offsetY * dpr);
  }

  function drawRailSight(x, y, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const diamondGradient = ctx.createLinearGradient(-8, 0, 8, 0);
    diamondGradient.addColorStop(0, '#f8ecd3');
    diamondGradient.addColorStop(1, '#b99558');
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(7.5, 0);
    ctx.lineTo(0, 6.5);
    ctx.lineTo(-7.5, 0);
    ctx.closePath();
    ctx.fillStyle = diamondGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(65, 38, 16, 0.56)';
    ctx.lineWidth = 1.35;
    ctx.stroke();
    ctx.restore();
  }

  function drawTable() {
    const table = activeTable();
    const feltX = table.rail;
    const feltY = table.rail;
    const feltW = table.width - table.rail * 2;
    const feltH = table.height - table.rail * 2;
    const breakX = feltX + feltW * 0.27;
    const outerInset = 10;
    const outerW = table.width - outerInset * 2;
    const outerH = table.height - outerInset * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 18;
    roundedRectPath(outerInset, outerInset, outerW, outerH, 28);
    ctx.fillStyle = '#1f130c';
    ctx.fill();
    ctx.restore();

    roundedRectPath(outerInset, outerInset, outerW, outerH, 28);
    ctx.fillStyle = '#4a2b16';
    ctx.fill();
    ctx.save();
    roundedRectPath(outerInset, outerInset, outerW, outerH, 28);
    ctx.clip();
    drawTexture(textureAssets.wood, outerInset, outerInset, outerW, outerH, 0.8);
    const woodTint = ctx.createLinearGradient(0, 0, table.width, table.height);
    woodTint.addColorStop(0, 'rgba(122, 77, 39, 0.56)');
    woodTint.addColorStop(0.55, 'rgba(42, 23, 12, 0.46)');
    woodTint.addColorStop(1, 'rgba(152, 103, 57, 0.34)');
    ctx.fillStyle = woodTint;
    ctx.fillRect(outerInset, outerInset, outerW, outerH);
    ctx.restore();

    const railGlow = ctx.createLinearGradient(feltX - 18, feltY - 18, feltX + feltW + 18, feltY + feltH + 18);
    railGlow.addColorStop(0, 'rgba(247, 231, 205, 0.18)');
    railGlow.addColorStop(0.5, 'rgba(108, 68, 32, 0)');
    railGlow.addColorStop(1, 'rgba(247, 231, 205, 0.22)');
    ctx.strokeStyle = railGlow;
    ctx.lineWidth = 24;
    ctx.strokeRect(feltX - 12, feltY - 12, feltW + 24, feltH + 24);

    ctx.fillStyle = '#0b4727';
    ctx.fillRect(feltX, feltY, feltW, feltH);
    drawTexture(textureAssets.felt, feltX, feltY, feltW, feltH, 0.44);

    const feltGradient = ctx.createLinearGradient(feltX, feltY, feltX + feltW, feltY + feltH);
    feltGradient.addColorStop(0, 'rgba(16, 102, 58, 0.7)');
    feltGradient.addColorStop(0.52, 'rgba(8, 74, 44, 0.32)');
    feltGradient.addColorStop(1, 'rgba(11, 92, 61, 0.62)');
    ctx.fillStyle = feltGradient;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    const sheen = ctx.createRadialGradient(table.width * 0.46, table.height * 0.26, 18, table.width * 0.46, table.height * 0.26, table.width * 0.46);
    sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
    sheen.addColorStop(0.34, 'rgba(255,255,255,0.08)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(feltX, feltY, feltW, feltH);

    ctx.strokeStyle = 'rgba(245, 248, 251, 0.12)';
    ctx.lineWidth = 2.8;
    ctx.strokeRect(feltX + 1.5, feltY + 1.5, feltW - 3, feltH - 3);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 6;
    ctx.strokeRect(feltX - 1.5, feltY - 1.5, feltW + 3, feltH + 3);

    ctx.strokeStyle = 'rgba(244, 246, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(breakX, feltY + 14);
    ctx.lineTo(breakX, feltY + feltH - 14);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(breakX, table.height / 2, 62, Math.PI / 2, -Math.PI / 2, true);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(breakX, table.height / 2, 3.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 252, 255, 0.66)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(feltX + feltW * 0.75, table.height / 2, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 252, 255, 0.44)';
    ctx.fill();

    const topBottomSights = [0.18, 0.5, 0.82];
    for (const factor of topBottomSights) {
      const x = feltX + feltW * factor;
      drawRailSight(x, feltY - table.rail * 0.45);
      drawRailSight(x, feltY + feltH + table.rail * 0.45);
    }
    const sideSights = [0.22, 0.5, 0.78];
    for (const factor of sideSights) {
      const y = feltY + feltH * factor;
      drawRailSight(feltX - table.rail * 0.45, y, Math.PI / 2);
      drawRailSight(feltX + feltW + table.rail * 0.45, y, Math.PI / 2);
    }

    for (const pocket of pocketCoords(table)) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR + 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(61, 33, 17, 0.95)';
      ctx.fill();
      ctx.restore();

      const leatherGradient = ctx.createRadialGradient(
        pocket.x - 5,
        pocket.y - 6,
        1,
        pocket.x,
        pocket.y,
        table.pocketR + 8
      );
      leatherGradient.addColorStop(0, '#8e5a2a');
      leatherGradient.addColorStop(0.55, '#523016');
      leatherGradient.addColorStop(1, '#1a100a');
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR + 8, 0, Math.PI * 2);
      ctx.fillStyle = leatherGradient;
      ctx.fill();

      const pocketGradient = ctx.createRadialGradient(
        pocket.x - 4,
        pocket.y - 4,
        1,
        pocket.x,
        pocket.y,
        table.pocketR
      );
      pocketGradient.addColorStop(0, '#454545');
      pocketGradient.addColorStop(0.4, '#171717');
      pocketGradient.addColorStop(1, '#020202');
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR - 1.5, 0, Math.PI * 2);
      ctx.fillStyle = pocketGradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, table.pocketR + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 235, 214, 0.18)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
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
    ctx.save();

    const shadowGradient = ctx.createRadialGradient(
      ball.x + ball.r * 0.16,
      ball.y + ball.r * 0.72,
      1,
      ball.x + ball.r * 0.16,
      ball.y + ball.r * 0.72,
      ball.r * 1.45
    );
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.24)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.ellipse(ball.x + ball.r * 0.14, ball.y + ball.r * 0.7, ball.r * 0.98, ball.r * 0.58, -0.08, 0, Math.PI * 2);
    ctx.fillStyle = shadowGradient;
    ctx.fill();

    const baseLight = ball.kind === 'cue' ? '#ffffff' : ball.kind === 'crown' ? '#fff6c7' : shade(ball.color, 32);
    const baseMid = ball.kind === 'cue' ? '#f5f6f7' : ball.kind === 'crown' ? '#f4ca53' : ball.color;
    const baseDark = ball.kind === 'cue' ? '#d2d7db' : ball.kind === 'crown' ? '#6b4814' : shade(ball.color, -34);
    const shellGradient = ctx.createRadialGradient(
      ball.x - ball.r * 0.4,
      ball.y - ball.r * 0.46,
      1,
      ball.x,
      ball.y,
      ball.r * 1.25
    );
    shellGradient.addColorStop(0, baseLight);
    shellGradient.addColorStop(0.28, baseMid);
    shellGradient.addColorStop(1, baseDark);

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = shellGradient;
    ctx.fill();

    if (ball.kind === 'target') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.clip();
      const stripeGradient = ctx.createLinearGradient(ball.x - ball.r, ball.y, ball.x + ball.r, ball.y);
      stripeGradient.addColorStop(0, 'rgba(255,255,255,0.96)');
      stripeGradient.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      stripeGradient.addColorStop(1, 'rgba(227,233,237,0.96)');
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + ball.r * 0.03, ball.r * 0.98, ball.r * 0.56, 0, 0, Math.PI * 2);
      ctx.fillStyle = stripeGradient;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + ball.r * 0.03, ball.r * 0.98, ball.r * 0.56, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ball.color, 0.38);
      ctx.lineWidth = 1.15;
      ctx.stroke();
      ctx.restore();
    }

    if (ball.kind === 'blocker') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(-Math.PI / 5);
      for (let offset = -ball.r * 2; offset <= ball.r * 2; offset += ball.r * 0.52) {
        ctx.fillStyle = offset / (ball.r * 0.52) % 2 === 0 ? 'rgba(255, 175, 64, 0.92)' : 'rgba(31, 35, 43, 0.9)';
        ctx.fillRect(offset, -ball.r * 1.4, ball.r * 0.34, ball.r * 2.8);
      }
      ctx.restore();
    }

    const plateRadius = ball.kind === 'cue' ? ball.r * 0.28 : ball.kind === 'crown' ? ball.r * 0.48 : ball.r * 0.4;
    if (ball.kind !== 'cue') {
      const plateGradient = ctx.createRadialGradient(
        ball.x - plateRadius * 0.25,
        ball.y - plateRadius * 0.28,
        1,
        ball.x,
        ball.y,
        plateRadius * 1.35
      );
      plateGradient.addColorStop(0, ball.kind === 'crown' ? '#2e1d0b' : '#fcfeff');
      plateGradient.addColorStop(1, ball.kind === 'crown' ? '#120a05' : '#d8e0e7');
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, plateRadius, 0, Math.PI * 2);
      ctx.fillStyle = plateGradient;
      ctx.fill();
      ctx.strokeStyle = ball.kind === 'crown' ? 'rgba(255, 216, 120, 0.45)' : 'rgba(71, 84, 98, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ball.x + ball.r * 0.06, ball.y + ball.r * 0.04, plateRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(216, 224, 232, 0.92)';
      ctx.fill();
    }

    if (ball.kind === 'blocker') {
      ctx.strokeStyle = 'rgba(255, 106, 106, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ball.x - ball.r * 0.52, ball.y - ball.r * 0.52);
      ctx.lineTo(ball.x + ball.r * 0.52, ball.y + ball.r * 0.52);
      ctx.moveTo(ball.x + ball.r * 0.52, ball.y - ball.r * 0.52);
      ctx.lineTo(ball.x - ball.r * 0.52, ball.y + ball.r * 0.52);
      ctx.stroke();
    }

    if (ball.label) {
      ctx.fillStyle = ball.kind === 'crown' ? '#ffe18c' : '#0e1720';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(10, Math.round(ball.r * 0.92))}px "Space Grotesk", system-ui, sans-serif`;
      ctx.fillText(ball.label, ball.x, ball.y + 0.4);
    }

    const edgeHighlight = ctx.createLinearGradient(ball.x - ball.r, ball.y - ball.r, ball.x + ball.r, ball.y + ball.r);
    edgeHighlight.addColorStop(0, 'rgba(255,255,255,0.26)');
    edgeHighlight.addColorStop(0.55, 'rgba(255,255,255,0)');
    edgeHighlight.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r - 0.3, 0, Math.PI * 2);
    ctx.strokeStyle = edgeHighlight;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(ball.x - ball.r * 0.36, ball.y - ball.r * 0.42, ball.r * 0.33, ball.r * 0.22, -0.65, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
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

  function drawGuideMarkers(start, direction, distance, color, options = {}) {
    if (distance <= 18) {
      return;
    }
    const spacing = options.spacing || CUE_UI.guideMarkerSpacing;
    const radius = options.radius || CUE_UI.guideMarkerRadius;
    const startOffset = options.startOffset || spacing;
    const fade = options.fade || 0.82;
    const rgb = hexToRgb(color);
    for (let step = startOffset; step < distance; step += spacing) {
      const alpha = clamp((1 - step / Math.max(distance, spacing)) * fade, 0.12, fade);
      ctx.beginPath();
      ctx.arc(
        start.x + direction.x * step,
        start.y + direction.y * step,
        radius,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
      ctx.fill();
    }
  }

  function drawCueAndGuide() {
    const cue = activeCue();
    if (!cue || !canShoot()) {
      return;
    }

    const sceneBounds = {
      minX: -CUE_UI.scenePadding,
      maxX: activeTable().width + CUE_UI.scenePadding,
      minY: -CUE_UI.scenePadding,
      maxY: activeTable().height + CUE_UI.scenePadding,
    };
    const direction = cueDirection();
    const guide = projectAimGuide(cue, direction);
    const power = state.aiming ? normalizedShotPower(state.power) : 0;
    const basePull = Math.min(power, 1) * CUE_UI.cuePullback;
    const boostPull = Math.max(0, power - 1) * CUE_UI.boostPullback;
    const cueTipDistance = cue.r + 6 + basePull + boostPull;
    const totalBackDistance = cueTipDistance + CUE_UI.cueLength;
    const maxBackDistance = distanceToRectEdge(cue, { x: -direction.x, y: -direction.y }, sceneBounds);
    const cueScale = totalBackDistance > 0
      ? clamp(maxBackDistance / totalBackDistance, CUE_UI.minCueVisualScale, 1)
      : 1;
    const visualCueTipDistance = cueTipDistance * cueScale;
    const visualCueLength = CUE_UI.cueLength * cueScale;
    const cueTip = {
      x: cue.x - direction.x * visualCueTipDistance,
      y: cue.y - direction.y * visualCueTipDistance,
    };
    const cueButt = {
      x: cueTip.x - direction.x * visualCueLength,
      y: cueTip.y - direction.y * visualCueLength,
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
    ctx.strokeStyle = power > 1 ? 'rgba(255, 224, 168, 0.22)' : state.aiming ? 'rgba(113, 241, 209, 0.18)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = power > 1 ? 8 : 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(guide.point.x, guide.point.y);
    ctx.strokeStyle = power > 1 ? 'rgba(255, 245, 214, 0.96)' : state.aiming ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.58)';
    ctx.lineWidth = power > 1 ? 3 : state.aiming ? 2.5 : 1.8;
    ctx.setLineDash(state.aiming ? [12, 8] : [8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawGuideMarkers(
      cue,
      direction,
      Math.min(guide.distance, CUE_UI.guideLength),
      power > 1 ? '#ffe08a' : state.aiming ? '#9af5df' : '#e9f1ff',
      { radius: power > 1 ? 2.4 : 2.1, fade: state.aiming ? 0.88 : 0.58 }
    );

    if (guide.type === 'ball' && guide.objectBall) {
      if (guide.cueContactPoint) {
        ctx.beginPath();
        ctx.arc(guide.cueContactPoint.x, guide.cueContactPoint.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fill();
      }
      if (guide.objectContactPoint) {
        ctx.beginPath();
        ctx.arc(guide.objectContactPoint.x, guide.objectContactPoint.y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 213, 124, 0.92)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(guide.objectContactPoint.x, guide.objectContactPoint.y, 8.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 213, 124, 0.44)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cueGhost.x, cueGhost.y, cue.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cueGhost.x, cueGhost.y, cue.r - 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(guide.objectBall.x, guide.objectBall.y);
      ctx.lineTo(
        guide.objectBall.x + guide.normal.x * CUE_UI.guideObjectLength,
        guide.objectBall.y + guide.normal.y * CUE_UI.guideObjectLength
      );
      ctx.strokeStyle = 'rgba(255, 213, 124, 0.78)';
      ctx.lineWidth = 2.1;
      ctx.setLineDash([9, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawGuideMarkers(
        guide.objectBall,
        guide.normal,
        CUE_UI.guideObjectLength,
        '#ffd57c',
        { startOffset: 18, radius: 2.1, fade: 0.72 }
      );
      if (guide.cueDeflectDirection) {
        ctx.beginPath();
        ctx.moveTo(cueGhost.x, cueGhost.y);
        ctx.lineTo(
          cueGhost.x + guide.cueDeflectDirection.x * CUE_UI.guideCueDeflectLength,
          cueGhost.y + guide.cueDeflectDirection.y * CUE_UI.guideCueDeflectLength
        );
        ctx.strokeStyle = 'rgba(165, 222, 255, 0.72)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        drawGuideMarkers(
          cueGhost,
          guide.cueDeflectDirection,
          CUE_UI.guideCueDeflectLength,
          '#a5deff',
          { startOffset: 14, radius: 1.8, fade: 0.5 }
        );
      }
    } else if (guide.type === 'rail' && guide.normal) {
      const bounce = guide.bounceDirection || reflectDirection(direction, guide.normal);
      const bounceEnd = guide.bounce && guide.bounce.point
        ? guide.bounce.point
        : {
            x: guide.point.x + bounce.x * CUE_UI.guideBounceLength,
            y: guide.point.y + bounce.y * CUE_UI.guideBounceLength,
          };
      ctx.beginPath();
      ctx.moveTo(guide.point.x, guide.point.y);
      ctx.lineTo(bounceEnd.x, bounceEnd.y);
      ctx.strokeStyle = 'rgba(113, 241, 209, 0.6)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawGuideMarkers(
        guide.point,
        bounce,
        guide.bounce ? Math.min(guide.bounce.distance, CUE_UI.guideSecondaryLength) : CUE_UI.guideBounceLength,
        '#7df1d1',
        { startOffset: 14, radius: 1.9, fade: 0.52 }
      );
      ctx.beginPath();
      ctx.arc(guide.point.x, guide.point.y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(113, 241, 209, 0.82)';
      ctx.fill();
      if (guide.bounce && guide.bounce.point) {
        ctx.beginPath();
        ctx.moveTo(guide.point.x, guide.point.y);
        ctx.lineTo(guide.bounce.point.x, guide.bounce.point.y);
        ctx.strokeStyle = 'rgba(113, 241, 209, 0.34)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
    if (!snapshot) {
      return;
    }
    const table = activeTable();
    let title = '';
    let subtitle = '';

    if (snapshot.winner) {
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

  function queueDrawFrame() {
    if (state.frameHandle) {
      return;
    }
    state.frameHandle = requestAnimationFrame(drawFrame);
  }

  function drawFrame(now = performance.now()) {
    state.frameHandle = 0;
    stepSoloMode(now);
    stepCueUi(now);
    resizeCanvas();
    setDrawTransform();
    drawTable();
    drawBalls();
    drawCueAndGuide();
    drawOverlay();
    queueDrawFrame();
  }

  function handleSnapshot(payload) {
    state.mode = 'online';
    state.localGame = null;
    state.localPlayers = [];
    state.soloBotDueAt = 0;
    state.snapshot = payload.snapshot || null;
    updateSnapshotAudio(state.snapshot);
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
      revealSetupPanel('Enter a room code before joining.', ui.roomInput);
      return;
    }

    savePrefs();
    collapsePlayChrome();
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
    state.audioTelemetry = summarizeAudioSnapshot(null);
    state.pendingLocalShotCount = 0;
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
    primeAudio();
    const point = boardPointFromClient(event.clientX, event.clientY, 'scene');
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
    state.aimFromStick = forwardDot < 0;
    updateAimAngleFromPoint(cue, point, state.aimFromStick, { immediate: true });
    if (state.aimFromStick) {
      const direction = cueDirection();
      const stickDx = point.x - cue.x;
      const stickDy = point.y - cue.y;
      state.stickGrabDistance = Math.max(0, -(stickDx * direction.x + stickDy * direction.y));
      state.aimLocked = true;
    } else {
      state.stickGrabDistance = 0;
      state.aimLocked = false;
    }
    state.power = 0;
    state.powerTarget = 0;
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
    const point = boardPointFromClient(event.clientX, event.clientY, 'scene');
    const rawPoint = boardPointFromClient(event.clientX, event.clientY, 'none');
    if (!point || !rawPoint) {
      return;
    }
    state.pointer = point;
    const cue = activeCue();
    if (cue) {
      if (state.aimFromStick) {
        updateAimAngleFromPoint(cue, point, state.aimFromStick);
        const pullState = computeCuePullState(cue, rawPoint);
        state.powerTarget = pullState.power;
        updatePowerUi();
        return;
      }
      if (!state.aimLocked) {
        updateAimAngleFromPoint(cue, point, state.aimFromStick);
      }
      const pullState = computeCuePullState(cue, rawPoint);
      const pullback = pullState.pullback;
      const lateral = pullState.lateral;
      const lockLateralLimit = Math.max(CUE_UI.lockLateral, pullback * 1.35);
      if (!state.aimLocked) {
        if (pullback > CUE_UI.lockPullback && lateral < lockLateralLimit) {
          state.aimLocked = true;
        } else {
          state.aimAnchor.x = point.x;
          state.aimAnchor.y = point.y;
          state.powerTarget = 0;
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
        state.powerTarget = 0;
        state.power = 0;
        updatePowerUi();
        return;
      }
      state.powerTarget = pullState.power;
    }
    updatePowerUi();
  }

  function finishAim(event) {
    if (!state.aiming || event.pointerId !== state.pointerId) {
      return;
    }
    const point = boardPointFromClient(event.clientX, event.clientY, 'scene') || state.pointer;
    const rawPoint = boardPointFromClient(event.clientX, event.clientY, 'none') || point;
    const cue = activeCue();
    const power = cue && point && canShoot()
      ? normalizedShotPower(computeCuePullState(cue, rawPoint).power)
      : 0;
    const direction = cue ? cueDirection() : null;
    state.aiming = false;
    state.pointerId = null;
    state.power = 0;
    state.powerTarget = 0;
    state.aimLocked = false;
    state.aimFromStick = false;
    state.stickGrabDistance = 0;

    if (!cue || !point || !canShoot()) {
      updatePowerUi();
      return;
    }

    if (power < CUE_UI.minPower) {
      updatePowerUi();
      return;
    }

    state.pendingLocalShotCount = (state.snapshot && state.snapshot.shotCount ? state.snapshot.shotCount : 0) + 1;
    if (isSoloMode()) {
      if (playSoloShot('white', {
        vectorX: direction.x,
        vectorY: direction.y,
        power,
      }, 'Shot fired. Orbit Bot is watching the table.')) {
        playShotSound(power);
      } else {
        state.pendingLocalShotCount = 0;
      }
    } else {
      const legacyVectorScale = power * 320;
      if (sendJson({
        action: 'shoot',
        vectorX: direction.x * legacyVectorScale,
        vectorY: direction.y * legacyVectorScale,
        power,
      })) {
        playShotSound(power);
        setStatus('Shot sent. Waiting for the table physics to resolve.');
      } else {
        state.pendingLocalShotCount = 0;
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
    const storedSoundPref = localStorage.getItem(STORAGE_KEYS.soundEnabled);
    state.setupCollapsed = storedSetupPref === null ? false : storedSetupPref === '1';
    state.sidebarCollapsed = storedSidebarPref === null ? true : storedSidebarPref === '1';
    state.soundEnabled = storedSoundPref === null ? true : storedSoundPref === '1';
    state.audioTelemetry = summarizeAudioSnapshot(null);
    updateLayoutChrome();
    updateSoundToggleUi();
    setNetworkStatus('offline', 'Offline');
    setStatus('Host a duel, join by room code, or start a solo showdown against Orbit Bot.');
    renderUi();
  }

  ui.hostBtn.addEventListener('click', () => connect('host'));
  ui.joinBtn.addEventListener('click', () => connect('join'));
  ui.soloBtn.addEventListener('click', startSoloGame);
  if (ui.heroSoloBtn) {
    ui.heroSoloBtn.addEventListener('click', startSoloGame);
  }
  if (ui.heroHostBtn) {
    ui.heroHostBtn.addEventListener('click', () => connect('host'));
  }
  if (ui.heroJoinBtn) {
    ui.heroJoinBtn.addEventListener('click', () => {
      if (!sanitizeRoomCode(ui.roomInput.value)) {
        revealSetupPanel('Enter a room code, then join the live table.', ui.roomInput);
        return;
      }
      connect('join');
    });
  }
  if (ui.heroSetupBtn) {
    ui.heroSetupBtn.addEventListener('click', () => {
      revealSetupPanel('Tune your name, room code, or format here before the break.', ui.nameInput);
    });
  }
  ui.soundToggleBtn.addEventListener('click', () => {
    setSoundEnabled(!state.soundEnabled, { preview: !state.soundEnabled });
  });
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
  queueDrawFrame();

  if (state.roomCode) {
    connect('join');
  }
})();
