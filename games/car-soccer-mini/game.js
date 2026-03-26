(() => {
  'use strict';

  const Core = window.CarSoccerTurboCore;
  const STORAGE_KEYS = {
    name: 'turboArenaLive.name',
    serverUrl: 'turboArenaLive.serverUrl',
    setupHidden: 'turboArenaLive.setupHidden',
    infoHidden: 'turboArenaLive.infoHidden',
    highGraphics: 'turboArenaLive.highGraphics',
    soundOn: 'turboArenaLive.soundOn',
    volume: 'turboArenaLive.volume',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const INPUT_SEND_MS = 50;
  const query = new URLSearchParams(window.location.search);
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

  const ui = {
    canvas: document.getElementById('gameCanvas'),
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    restartBtn: document.getElementById('restartBtn'),
    copyInviteBtn: document.getElementById('copyInviteBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    inviteInput: document.getElementById('inviteInput'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    graphicsToggle: document.getElementById('graphicsToggle'),
    soundToggle: document.getElementById('soundToggle'),
    volumeSlider: document.getElementById('volumeSlider'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleInfoBtn: document.getElementById('toggleInfoBtn'),
    setupPanel: document.getElementById('setupPanel'),
    infoPanel: document.getElementById('infoPanel'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    leftTeamLabel: document.getElementById('leftTeamLabel'),
    rightTeamLabel: document.getElementById('rightTeamLabel'),
    score: document.getElementById('score'),
    time: document.getElementById('time'),
    boost: document.getElementById('boost'),
    phaseLabel: document.getElementById('phaseLabel'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    statusText: document.getElementById('statusText'),
    conditionLabel: document.getElementById('conditionLabel'),
    presenceText: document.getElementById('presenceText'),
    playerCards: document.getElementById('playerCards'),
    eventList: document.getElementById('eventList'),
    touchControls: document.getElementById('touchControls'),
    toast: document.getElementById('toast'),
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
    highGraphics: true,
    soundOn: true,
    volume: 0.3,
    panels: {
      setupHidden: false,
      infoHidden: false,
    },
    keys: {
      up: false,
      down: false,
      left: false,
      right: false,
      boost: false,
      handbrake: false,
    },
    particles: [],
    cameraShake: 0,
    toastTimer: 0,
    lastInputSentAt: 0,
    lastFrameAt: performance.now(),
    nextPanelRefreshAt: 0,
    lastEventId: 0,
    renderCache: {
      players: new Map(),
      ball: null,
    },
    audio: {
      ctx: null,
      unlocked: false,
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function lerpAngle(start, end, amount) {
    const delta = ((((end - start) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return start + delta * amount;
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) {
      angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
      angle += Math.PI * 2;
    }
    return angle;
  }

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function defaultServerUrl() {
    const explicit = query.get('server');
    if (explicit) {
      return sanitizeServerUrl(explicit);
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'ws://127.0.0.1:8081';
    }
    return PROD_SERVER_URL;
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return defaultServerUrl();
    }
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'Driver';
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(total / 60).toString().padStart(2, '0');
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function setNetworkStatus(text, tone) {
    ui.networkStatus.textContent = text;
    ui.networkStatus.dataset.tone = tone;
  }

  function setModePill(text) {
    ui.modePill.textContent = text;
  }

  function showToast(message) {
    if (!message) {
      return;
    }
    window.clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove('visible');
    }, 2200);
  }

  function ensureAudio() {
    if (!state.soundOn) {
      return null;
    }
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

  function scheduleTone(from, to, duration, gainValue, type, delay) {
    const audioContext = ensureAudio();
    if (!audioContext) {
      return;
    }
    const now = audioContext.currentTime + (delay || 0);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type || 'triangle';
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime((gainValue || 0.05) * state.volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function noiseBurst(duration, gainValue) {
    const audioContext = ensureAudio();
    if (!audioContext) {
      return;
    }
    const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
    }
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = 'highpass';
    filter.frequency.value = 220;
    gain.gain.setValueAtTime((gainValue || 0.035) * state.volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start();
    source.stop(audioContext.currentTime + duration + 0.02);
  }

  function playKickoffSound() {
    scheduleTone(340, 510, 0.12, 0.05, 'triangle');
    scheduleTone(510, 760, 0.14, 0.035, 'sine', 0.05);
  }

  function playGoalSound(team) {
    if (team === 'blue') {
      scheduleTone(420, 780, 0.24, 0.06, 'sawtooth');
    } else {
      scheduleTone(220, 480, 0.24, 0.06, 'sawtooth');
    }
    scheduleTone(520, 920, 0.22, 0.04, 'triangle', 0.04);
  }

  function playBoostSound() {
    scheduleTone(520, 820, 0.11, 0.04, 'triangle');
  }

  function playDemoSound() {
    noiseBurst(0.16, 0.06);
    scheduleTone(160, 80, 0.24, 0.045, 'sawtooth');
  }

  function playWinSound() {
    scheduleTone(360, 720, 0.22, 0.05, 'triangle');
    scheduleTone(480, 960, 0.26, 0.04, 'sine', 0.04);
  }

  function setPanelHidden(key, hidden) {
    state.panels[key] = hidden;
    ui[`${key === 'setupHidden' ? 'setupPanel' : 'infoPanel'}`].classList.toggle('panel-hidden', hidden);
    localStorage.setItem(STORAGE_KEYS[key], hidden ? '1' : '0');
    renderPanels();
  }

  function persistPreferences() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.highGraphics, state.highGraphics ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.soundOn, state.soundOn ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.volume, String(state.volume));
  }

  function currentGame() {
    return state.mode === 'solo' ? state.localGame : state.snapshot;
  }

  function localPlayer(game) {
    if (!game || !state.yourPlayerId) {
      return null;
    }
    return game.players.find((player) => player.id === state.yourPlayerId) || null;
  }

  function rosterPlayers(game) {
    return Array.isArray(game?.players) ? [...game.players].sort((left, right) => left.seat - right.seat) : [];
  }

  function defaultStatusText() {
    const game = currentGame();
    if (state.statusMessage) {
      return state.statusMessage;
    }
    if (game?.status) {
      return game.status;
    }
    if (state.mode === 'connecting') {
      return 'Connecting to Turbo Arena...';
    }
    return 'Host a room, invite another driver, or launch solo against Turbo Bot.';
  }

  function phaseText(game) {
    if (!game) {
      return 'Stand by';
    }
    if (game.phase === 'finished') {
      return 'Final';
    }
    if (game.overtime && game.phase === 'live') {
      return 'Overtime';
    }
    if (game.phase === 'countdown') {
      return game.overtime ? 'OT kickoff' : 'Kickoff';
    }
    if (game.phase === 'waiting') {
      return 'Waiting';
    }
    return 'Live';
  }

  function conditionText(game) {
    if (!game) {
      return 'Stand by';
    }
    if (game.phase === 'finished') {
      return game.winnerName ? `${game.winnerName} wins` : 'Match complete';
    }
    if (game.overtime) {
      return 'Next goal wins';
    }
    if (game.phase === 'countdown') {
      return `Kickoff in ${Math.max(1, Math.ceil(game.kickoffTimer || 0))}`;
    }
    if (game.phase === 'waiting') {
      return 'Waiting for opponent';
    }
    return 'Arena live';
  }

  function eventTitle(event) {
    switch (event.type) {
      case 'goal':
        return 'Goal';
      case 'demo':
        return 'Demolition';
      case 'boost':
        return 'Boost pad';
      case 'overtime':
        return 'Overtime';
      case 'finish':
        return 'Match point';
      case 'kickoff':
        return 'Kickoff';
      case 'respawn':
        return 'Respawn';
      default:
        return 'Arena';
    }
  }

  function eventBody(event) {
    if (event.message) {
      return event.message;
    }
    switch (event.type) {
      case 'goal':
        return `${event.scorerName || 'A driver'} scored.`;
      case 'demo':
        return `${event.playerName || 'A driver'} was demolished.`;
      case 'boost':
        return `${event.playerName || 'A driver'} refilled boost.`;
      case 'respawn':
        return `${event.playerName || 'A driver'} is back on the pitch.`;
      default:
        return 'Arena update.';
    }
  }

  function renderPlayerCards(game) {
    const players = rosterPlayers(game);
    if (!players.length) {
      ui.playerCards.innerHTML = `
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">Open arena</div>
              <div class="player-role">Blue slot</div>
            </div>
            <span class="inline-chip">Empty</span>
          </div>
        </div>
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">Open arena</div>
              <div class="player-role">Orange slot</div>
            </div>
            <span class="inline-chip">Empty</span>
          </div>
        </div>
      `;
      return;
    }

    const ordered = [];
    players.forEach((player) => {
      ordered[player.seat] = player;
    });

    ui.playerCards.innerHTML = [0, 1].map((seat) => {
      const player = ordered[seat];
      if (!player) {
        return `
          <div class="player-card">
            <div class="player-head">
              <div>
                <div class="player-name">Open seat</div>
                <div class="player-role">${seat === 0 ? 'Blue slot' : 'Orange slot'}</div>
              </div>
              <span class="inline-chip">Waiting</span>
            </div>
          </div>
        `;
      }
      const tag = player.id === state.yourPlayerId
        ? 'You'
        : state.mode === 'solo'
          ? 'Turbo Bot'
          : player.team === 'blue'
            ? 'Blue'
            : 'Orange';
      const boostPct = clamp(player.boost, 0, 100);
      return `
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">${player.name}</div>
              <div class="player-role">${player.team === 'blue' ? 'Blue striker' : 'Orange striker'}</div>
            </div>
            <span class="inline-chip">${tag}</span>
          </div>
          <div class="player-stats">
            <div class="stat-row"><span>Score</span><strong>${player.score}</strong></div>
            <div class="stat-row"><span>Touches</span><strong>${player.touches}</strong></div>
            <div class="stat-row"><span>Boost pads</span><strong>${player.boostPickups || 0}</strong></div>
            <div class="stat-row"><span>${player.demolished ? 'Respawn' : 'Boost'}</span><strong>${player.demolished ? `${player.respawnTimer.toFixed(1)}s` : `${Math.round(boostPct)}%`}</strong></div>
            <div class="meter"><span class="meter-fill ${player.team === 'orange' ? 'orange' : ''} boost" style="width:${player.demolished ? 100 : boostPct}%"></span></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderEventFeed(game) {
    const events = Array.isArray(game?.events) ? [...game.events].slice(-6).reverse() : [];
    if (!events.length) {
      ui.eventList.innerHTML = '<div class="event-card"><div class="event-title">No arena moments yet</div><p>Goals, demos, boost grabs, and overtime calls will show up here.</p></div>';
      return;
    }
    ui.eventList.innerHTML = events.map((event) => `
      <div class="event-card">
        <div class="event-head">
          <div class="event-title">${eventTitle(event)}</div>
          <div class="event-time">${formatTime(event.createdAt || 0)}</div>
        </div>
        <p>${eventBody(event)}</p>
      </div>
    `).join('');
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
    const link = inviteUrl();
    ui.inviteInput.value = link;
    ui.copyInviteBtn.disabled = !link;
    ui.copyCodeBtn.disabled = !(state.mode === 'online' && state.roomCode);
    ui.shareLoungeBtn.disabled = !(state.mode === 'online' && state.roomCode);
  }

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      showToast('Arcade Lounge bridge is not available.');
      return;
    }
    if (autoShare && !(state.mode === 'online' && state.roomCode)) {
      showToast('Host or join a live arena before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: getPlayerName(),
      serverUrl: sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl || PROD_SERVER_URL),
      gameType: 'car-soccer',
      roomCode: state.mode === 'online' ? state.roomCode : '',
      inviteUrl: state.mode === 'online' ? inviteUrl() : '',
      note: state.mode === 'online' && state.roomCode
        ? `Join my Car Soccer Mini arena in room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    showToast(autoShare ? 'Opening Arcade Lounge with your arena ready to share.' : 'Opening Arcade Lounge in a new tab.');
  }

  function copyText(value, successText) {
    if (!value) {
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      showToast(successText);
    }).catch(() => {
      showToast('Copy failed. You can still copy it manually.');
    });
  }

  function renderPanels() {
    const game = currentGame();
    const player = localPlayer(game);
    const scoreBlue = game?.score?.blue || 0;
    const scoreOrange = game?.score?.orange || 0;

    ui.leftTeamLabel.textContent = 'Blue';
    ui.rightTeamLabel.textContent = 'Orange';
    ui.score.textContent = `${scoreBlue} - ${scoreOrange}`;
    ui.time.textContent = formatTime(game?.timeRemaining || Core.MATCH_SECONDS);
    ui.boost.textContent = `${Math.round(player?.boost ?? 100)}%`;
    ui.phaseLabel.textContent = phaseText(game);
    ui.roomCodeLabel.textContent = state.roomCode || '-';
    ui.statusText.textContent = defaultStatusText();
    ui.conditionLabel.textContent = conditionText(game);
    ui.presenceText.textContent = state.mode === 'online'
      ? (rosterPlayers(game).length >= 2 ? 'Two drivers synced online.' : 'Arena live. Waiting for the second driver.')
      : state.mode === 'solo'
        ? 'Turbo Bot is active.'
        : 'Waiting for a launch.';

    if (state.mode === 'online' && state.socket?.readyState === WebSocket.OPEN) {
      setNetworkStatus('Online', 'online');
      setModePill(state.roomCode ? `Arena ${state.roomCode}` : 'Live arena');
    } else if (state.mode === 'connecting') {
      setNetworkStatus('Connecting', 'busy');
      setModePill('Connecting');
    } else if (state.mode === 'solo') {
      setNetworkStatus('Local', 'busy');
      setModePill('Solo vs Turbo Bot');
    } else {
      setNetworkStatus('Offline', 'offline');
      setModePill('No arena live');
    }

    const busy = state.mode === 'connecting';
    const canJoin = Boolean(sanitizeRoomCode(ui.roomInput.value));
    ui.hostBtn.disabled = busy;
    ui.joinBtn.disabled = busy || !canJoin;
    ui.soloBtn.disabled = busy;
    ui.restartBtn.disabled = !(game || state.mode === 'online');
    ui.graphicsToggle.textContent = state.highGraphics ? 'High' : 'Low';
    ui.soundToggle.textContent = state.soundOn ? 'On' : 'Off';
    ui.volumeSlider.value = String(state.volume);
    ui.toggleSetupBtn.textContent = state.panels.setupHidden ? 'Show setup' : 'Hide setup';
    ui.toggleInfoBtn.textContent = state.panels.infoHidden ? 'Show info' : 'Hide info';

    updateInviteUi();
    renderPlayerCards(game);
    renderEventFeed(game);
  }

  function resetRenderCache() {
    state.renderCache.players.clear();
    state.renderCache.ball = null;
    state.lastEventId = 0;
    state.particles.length = 0;
    state.cameraShake = 0;
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

  function startSolo() {
    disconnectSocket();
    resetRenderCache();
    const game = Core.createGameState();
    Core.addPlayer(game, { id: 'solo-human', name: getPlayerName() });
    Core.addPlayer(game, { id: 'solo-bot', name: 'Turbo Bot' });
    game.status = 'Solo arena live. Turbo Bot is looking for demos and boost pads.';
    state.mode = 'solo';
    state.localGame = game;
    state.snapshot = null;
    state.yourPlayerId = 'solo-human';
    state.roomCode = 'SOLO';
    state.statusMessage = '';
    state.lastInputSentAt = 0;
    renderPanels();
    showToast('Solo arena launched.');
  }

  function handleDisconnectMessage() {
    const wasOnline = state.mode === 'online' || state.mode === 'connecting';
    state.socket = null;
    if (!wasOnline) {
      return;
    }
    state.mode = 'idle';
    state.snapshot = null;
    state.localGame = null;
    state.yourPlayerId = '';
    state.statusMessage = 'Arena connection closed. You can host, join, or launch solo again.';
    renderPanels();
    showToast('Arena connection closed.');
  }

  function connectOnline(mode) {
    const joinMode = mode === 'join' ? 'join' : 'host';
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (joinMode === 'join' && !roomCode) {
      showToast('Enter the room code from the host first.');
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
    state.statusMessage = '';
    persistPreferences();
    renderPanels();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        action: 'join',
        mode: joinMode,
        roomCode,
        name: getPlayerName(),
        game: 'car-soccer',
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
        showToast(payload.title || 'Turbo Arena connected.');
        renderPanels();
        return;
      }

      if (payload.type === 'state') {
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        processGameEvents(state.snapshot);
        renderPanels();
        return;
      }

      if (payload.type === 'error') {
        showToast(payload.message || 'Arena connection error.');
        disconnectSocket();
        state.mode = 'idle';
        state.snapshot = null;
        state.yourPlayerId = '';
        state.statusMessage = payload.message || 'Arena connection error.';
        renderPanels();
      }
    });

    socket.addEventListener('close', handleDisconnectMessage);
    socket.addEventListener('error', () => {
      showToast('Arena network error.');
    });
  }

  function restartMatch() {
    if (state.mode === 'online' && state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ action: 'restart' }));
      return;
    }
    if (state.mode === 'solo' && state.localGame) {
      Core.resetMatch(state.localGame);
      state.lastEventId = 0;
      renderPanels();
      showToast('Fresh solo kickoff ready.');
      return;
    }
    startSolo();
  }

  function composeInput() {
    return {
      throttle: (state.keys.up ? 1 : 0) - (state.keys.down ? 1 : 0),
      steer: (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0),
      boost: state.keys.boost,
      handbrake: state.keys.handbrake,
    };
  }

  function angleDiff(current, target) {
    return wrapAngle(target - current);
  }

  function updateBotDriver(game) {
    const bot = game.players.find((player) => player.id === 'solo-bot');
    const human = localPlayer(game);
    if (!bot || !human) {
      return;
    }

    const ball = game.ball;
    const attackGoalX = bot.team === 'blue' ? game.arena.width + 80 : -80;
    const ownGoalX = bot.team === 'blue' ? 80 : game.arena.width - 80;
    const attackAngle = Math.atan2(game.arena.height * 0.5 - ball.y, attackGoalX - ball.x);
    let targetX = ball.x - Math.cos(attackAngle) * 90;
    let targetY = ball.y - Math.sin(attackAngle) * 90;

    const defending = (bot.team === 'blue' && ball.x < game.arena.width * 0.43)
      || (bot.team === 'orange' && ball.x > game.arena.width * 0.57);

    if (defending) {
      targetX = clamp((ball.x + ownGoalX) * 0.5, 110, game.arena.width - 110);
      targetY = clamp(ball.y + Math.sin(game.elapsed * 2.3) * 40, 120, game.arena.height - 120);
    }

    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const distance = Math.hypot(dx, dy) || 1;
    const desiredAngle = Math.atan2(dy, dx);
    const turn = clamp(angleDiff(bot.angle, desiredAngle) * 2.6, -1, 1);

    Core.setPlayerInput(game, bot.id, {
      throttle: distance > 90 ? 1 : 0.35,
      steer: turn,
      boost: distance > 280 && Math.abs(turn) < 0.34,
      handbrake: Math.abs(turn) > 0.95 && distance > 170,
    });
  }

  function sendInputIfNeeded(now) {
    if (state.mode !== 'online' || !state.socket || state.socket.readyState !== WebSocket.OPEN || !state.yourPlayerId) {
      return;
    }
    if (now - state.lastInputSentAt < INPUT_SEND_MS) {
      return;
    }
    state.lastInputSentAt = now;
    state.socket.send(JSON.stringify({
      action: 'input',
      input: composeInput(),
    }));
  }

  function spawnParticles(x, y, count, color, speed) {
    if (!state.highGraphics) {
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const magnitude = (speed || 220) * (0.5 + Math.random());
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * magnitude,
        vy: Math.sin(angle) * magnitude,
        life: 0.32 + Math.random() * 0.46,
        maxLife: 0.32 + Math.random() * 0.46,
        color,
      });
    }
  }

  function processGameEvents(game) {
    if (!game?.events?.length) {
      return;
    }
    for (const event of game.events) {
      if (event.id <= state.lastEventId) {
        continue;
      }
      state.lastEventId = event.id;
      if (event.type === 'goal') {
        showToast(event.message || `${event.scorerName || 'A driver'} scored.`);
        spawnParticles(event.x || game.ball.x, event.y || game.ball.y, 44, event.team === 'blue' ? '#4ec9ff' : '#ff8c77', 440);
        state.cameraShake = 14;
        playGoalSound(event.team);
      } else if (event.type === 'demo') {
        showToast(event.message || `${event.playerName || 'A driver'} was demolished.`);
        spawnParticles(event.x || game.ball.x, event.y || game.ball.y, 64, '#ffb366', 520);
        state.cameraShake = 20;
        playDemoSound();
      } else if (event.type === 'boost') {
        spawnParticles(event.x || 0, event.y || 0, 20, '#ffe37f', 180);
        playBoostSound();
      } else if (event.type === 'kickoff' || event.type === 'live') {
        playKickoffSound();
      } else if (event.type === 'overtime') {
        showToast(event.message || 'Overtime. Next goal wins.');
        playKickoffSound();
      } else if (event.type === 'finish') {
        showToast(event.message || 'Match complete.');
        playWinSound();
      }
    }
  }

  function updateParticles(dt) {
    for (let index = state.particles.length - 1; index >= 0; index -= 1) {
      const particle = state.particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        state.particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.95;
      particle.vy *= 0.95;
    }
    state.cameraShake = Math.max(0, state.cameraShake - dt * 18);
  }

  function resizeCanvas() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    ui.canvas.width = Math.floor(window.innerWidth * dpr);
    ui.canvas.height = Math.floor(window.innerHeight * dpr);
    ui.canvas.style.width = `${window.innerWidth}px`;
    ui.canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen() {
    const sx = window.innerWidth / Core.ARENA.width;
    const sy = window.innerHeight / Core.ARENA.height;
    const scale = Math.min(sx, sy);
    const offsetX = (window.innerWidth - Core.ARENA.width * scale) * 0.5;
    const offsetY = (window.innerHeight - Core.ARENA.height * scale) * 0.5;
    return { scale, offsetX, offsetY };
  }

  function createProjection(transform) {
    const { scale, offsetX, offsetY } = transform;
    const centerX = offsetX + Core.ARENA.width * 0.5 * scale;
    const horizonY = offsetY - Core.ARENA.height * scale * 0.04;
    const nearY = offsetY + Core.ARENA.height * scale * 1.02;

    function project(x, y) {
      const depth = clamp(y / Core.ARENA.height, 0, 1);
      const laneScale = 0.7 + depth * 0.3;
      return {
        x: centerX + (x - Core.ARENA.width * 0.5) * scale * laneScale,
        y: horizonY + depth * (nearY - horizonY),
        depth,
        laneScale,
      };
    }

    return {
      project,
      centerX,
      horizonY,
      nearY,
    };
  }

  function smoothedGame(game) {
    if (!game) {
      return null;
    }
    const smoothing = state.mode === 'online' ? 0.3 : 1;
    const nextPlayers = [];
    const activeIds = new Set();

    game.players.forEach((player) => {
      activeIds.add(player.id);
      const cached = state.renderCache.players.get(player.id) || { ...player };
      if (smoothing < 1) {
        cached.x = lerp(cached.x ?? player.x, player.x, smoothing);
        cached.y = lerp(cached.y ?? player.y, player.y, smoothing);
        cached.angle = lerpAngle(cached.angle ?? player.angle, player.angle, smoothing);
        cached.boost = lerp(cached.boost ?? player.boost, player.boost, 0.35);
      } else {
        cached.x = player.x;
        cached.y = player.y;
        cached.angle = player.angle;
        cached.boost = player.boost;
      }
      cached.vx = player.vx;
      cached.vy = player.vy;
      cached.score = player.score;
      cached.touches = player.touches;
      cached.team = player.team;
      cached.name = player.name;
      cached.seat = player.seat;
      cached.color = player.color;
      cached.w = player.w;
      cached.h = player.h;
      cached.demolished = player.demolished;
      cached.respawnTimer = player.respawnTimer;
      cached.boostPickups = player.boostPickups;
      state.renderCache.players.set(player.id, cached);
      nextPlayers.push({ ...player, ...cached });
    });

    for (const id of Array.from(state.renderCache.players.keys())) {
      if (!activeIds.has(id)) {
        state.renderCache.players.delete(id);
      }
    }

    const cachedBall = state.renderCache.ball || { ...game.ball };
    if (smoothing < 1) {
      cachedBall.x = lerp(cachedBall.x ?? game.ball.x, game.ball.x, 0.38);
      cachedBall.y = lerp(cachedBall.y ?? game.ball.y, game.ball.y, 0.38);
    } else {
      cachedBall.x = game.ball.x;
      cachedBall.y = game.ball.y;
    }
    cachedBall.vx = game.ball.vx;
    cachedBall.vy = game.ball.vy;
    cachedBall.radius = game.ball.radius;
    state.renderCache.ball = cachedBall;

    return {
      ...game,
      players: nextPlayers,
      ball: { ...game.ball, ...cachedBall },
    };
  }

  function drawField(transform, projection, game) {
    const { scale } = transform;
    const { project, centerX, horizonY, nearY } = projection;

    ctx.save();
    if (state.cameraShake > 0 && state.highGraphics) {
      ctx.translate((Math.random() - 0.5) * state.cameraShake, (Math.random() - 0.5) * state.cameraShake);
    }

    ctx.fillStyle = '#081222';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const corners = [
      project(0, 0),
      project(Core.ARENA.width, 0),
      project(Core.ARENA.width, Core.ARENA.height),
      project(0, Core.ARENA.height),
    ];

    const skyGradient = ctx.createLinearGradient(0, 0, 0, nearY);
    skyGradient.addColorStop(0, '#071018');
    skyGradient.addColorStop(1, '#081a2b');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, window.innerWidth, nearY + 200);

    if (state.highGraphics) {
      for (let index = 0; index < 12; index += 1) {
        const y = horizonY + (index / 11) * (nearY - horizonY);
        const alpha = 0.08 - index * 0.005;
        ctx.strokeStyle = `rgba(135,180,255,${Math.max(0, alpha)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(window.innerWidth, y);
        ctx.stroke();
      }
    }

    const turfGradient = ctx.createLinearGradient(0, horizonY, 0, nearY);
    turfGradient.addColorStop(0, '#0f3222');
    turfGradient.addColorStop(0.55, '#175536');
    turfGradient.addColorStop(1, '#1e7248');
    ctx.fillStyle = turfGradient;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < 9; index += 1) {
      const y0 = (index / 9) * Core.ARENA.height;
      const y1 = ((index + 1) / 9) * Core.ARENA.height;
      const a = project(0, y0);
      const b = project(Core.ARENA.width, y0);
      const c = project(Core.ARENA.width, y1);
      const d = project(0, y1);
      ctx.fillStyle = index % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }

    const drawLine = (x1, y1, x2, y2, width) => {
      const p1 = project(x1, y1);
      const p2 = project(x2, y2);
      ctx.strokeStyle = 'rgba(236, 247, 255, 0.82)';
      ctx.lineWidth = width * (0.72 + (p1.depth + p2.depth) * 0.35) * scale;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    };

    drawLine(0, 0, Core.ARENA.width, 0, 6);
    drawLine(Core.ARENA.width, 0, Core.ARENA.width, Core.ARENA.height, 6);
    drawLine(Core.ARENA.width, Core.ARENA.height, 0, Core.ARENA.height, 6);
    drawLine(0, Core.ARENA.height, 0, 0, 6);
    drawLine(Core.ARENA.width * 0.5, 0, Core.ARENA.width * 0.5, Core.ARENA.height, 5);

    ctx.strokeStyle = 'rgba(236, 247, 255, 0.74)';
    for (let index = 0; index <= 48; index += 1) {
      const angle = (index / 48) * Math.PI * 2;
      const px = Core.ARENA.width * 0.5 + Math.cos(angle) * 110;
      const py = Core.ARENA.height * 0.5 + Math.sin(angle) * 110;
      const point = project(px, py);
      if (index === 0) {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.lineWidth = 4.5 * scale;
    ctx.stroke();

    const goalY = Core.ARENA.height * 0.5 - Core.ARENA.goalWidth * 0.5;
    function drawGoal(left, color) {
      const x0 = left ? -Core.ARENA.goalDepth : Core.ARENA.width;
      const x1 = left ? 0 : Core.ARENA.width + Core.ARENA.goalDepth;
      const a = project(x0, goalY);
      const b = project(x1, goalY);
      const c = project(x1, goalY + Core.ARENA.goalWidth);
      const d = project(x0, goalY + Core.ARENA.goalWidth);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    }

    drawGoal(true, 'rgba(78, 201, 255, 0.24)');
    drawGoal(false, 'rgba(255, 140, 119, 0.24)');

    if (state.highGraphics) {
      const crowdGradient = ctx.createLinearGradient(0, 0, 0, horizonY + 80);
      crowdGradient.addColorStop(0, 'rgba(26,50,74,0)');
      crowdGradient.addColorStop(1, 'rgba(26,50,74,0.55)');
      ctx.fillStyle = crowdGradient;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(centerX + Core.ARENA.width * scale * 0.55, horizonY - 55);
      ctx.lineTo(centerX - Core.ARENA.width * scale * 0.55, horizonY - 55);
      ctx.closePath();
      ctx.fill();
    }

    if (game?.boostPads?.length) {
      game.boostPads.forEach((pad) => {
        const projected = project(pad.x, pad.y);
        const radius = pad.radius * scale * (0.58 + projected.depth * 0.36);
        ctx.fillStyle = pad.active ? 'rgba(255, 224, 114, 0.2)' : 'rgba(255,255,255,0.05)';
        ctx.strokeStyle = pad.active ? 'rgba(255, 232, 152, 0.82)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    ctx.restore();
  }

  function drawParticles(transform, projection) {
    const { scale } = transform;
    for (const particle of state.particles) {
      const alpha = particle.life / particle.maxLife;
      const projected = projection.project(particle.x, particle.y);
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, Math.max(1.2, 3 * scale * alpha * (0.7 + projected.depth * 0.6)), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawCar(player, transform, projection) {
    const { scale } = transform;
    const projected = projection.project(player.x, player.y);
    const carScale = scale * (0.76 + projected.depth * 0.5);
    const bodyWidth = player.w * carScale;
    const bodyHeight = player.h * carScale;
    const noseX = bodyWidth * 0.5;
    const tailX = -bodyWidth * 0.5;

    function roundedRectPath(x, y, width, height, radius) {
      const r = Math.min(radius, width * 0.5, height * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      ctx.lineTo(x + width, y + height - r);
      ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      ctx.lineTo(x + r, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.rotate(player.angle);

    if (player.demolished) {
      ctx.strokeStyle = player.team === 'blue' ? 'rgba(78, 201, 255, 0.72)' : 'rgba(255, 140, 119, 0.72)';
      ctx.lineWidth = Math.max(2, 3 * carScale);
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, bodyWidth * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundedRectPath(tailX + 5, -bodyHeight * 0.5 + 6, bodyWidth, bodyHeight, bodyHeight * 0.24);
    ctx.fill();

    ctx.fillStyle = '#15181f';
    const wheelWidth = bodyWidth * 0.14;
    const wheelHeight = bodyHeight * 0.28;
    const wheelX = bodyWidth * 0.2;
    const wheelY = bodyHeight * 0.38;
    roundedRectPath(-wheelX - wheelWidth, -wheelY - wheelHeight, wheelWidth, wheelHeight, wheelWidth * 0.35);
    ctx.fill();
    roundedRectPath(wheelX, -wheelY - wheelHeight, wheelWidth, wheelHeight, wheelWidth * 0.35);
    ctx.fill();
    roundedRectPath(-wheelX - wheelWidth, wheelY, wheelWidth, wheelHeight, wheelWidth * 0.35);
    ctx.fill();
    roundedRectPath(wheelX, wheelY, wheelWidth, wheelHeight, wheelWidth * 0.35);
    ctx.fill();

    const paint = ctx.createLinearGradient(tailX, -bodyHeight * 0.5, noseX, bodyHeight * 0.5);
    if (player.team === 'blue') {
      paint.addColorStop(0, '#0f2c72');
      paint.addColorStop(0.35, '#136fd4');
      paint.addColorStop(0.7, '#1b6af9');
      paint.addColorStop(1, '#4db8ff');
    } else {
      paint.addColorStop(0, '#5f1620');
      paint.addColorStop(0.35, '#a22d38');
      paint.addColorStop(0.7, '#df5763');
      paint.addColorStop(1, '#ff8c77');
    }
    ctx.fillStyle = paint;
    roundedRectPath(tailX, -bodyHeight * 0.5, bodyWidth, bodyHeight, bodyHeight * 0.26);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(1.5, 2 * carScale);
    roundedRectPath(tailX + bodyWidth * 0.06, -bodyHeight * 0.5 + bodyHeight * 0.07, bodyWidth * 0.88, bodyHeight * 0.86, bodyHeight * 0.22);
    ctx.stroke();

    ctx.fillStyle = '#0f131a';
    roundedRectPath(-bodyWidth * 0.08, -bodyHeight * 0.27, bodyWidth * 0.33, bodyHeight * 0.54, bodyHeight * 0.16);
    ctx.fill();

    const windshield = ctx.createLinearGradient(-bodyWidth * 0.02, -bodyHeight * 0.26, bodyWidth * 0.2, bodyHeight * 0.26);
    windshield.addColorStop(0, 'rgba(120,170,220,0.72)');
    windshield.addColorStop(1, 'rgba(20,40,65,0.86)');
    ctx.fillStyle = windshield;
    roundedRectPath(-bodyWidth * 0.03, -bodyHeight * 0.21, bodyWidth * 0.24, bodyHeight * 0.42, bodyHeight * 0.12);
    ctx.fill();

    ctx.fillStyle = '#d7ecff';
    roundedRectPath(noseX - bodyWidth * 0.03, -bodyHeight * 0.35, bodyWidth * 0.05, bodyHeight * 0.14, bodyHeight * 0.03);
    ctx.fill();
    roundedRectPath(noseX - bodyWidth * 0.03, bodyHeight * 0.21, bodyWidth * 0.05, bodyHeight * 0.14, bodyHeight * 0.03);
    ctx.fill();

    ctx.restore();
  }

  function drawBall(transform, projection, ball) {
    const { scale } = transform;
    const projected = projection.project(ball.x, ball.y);
    const ballScale = scale * (0.78 + projected.depth * 0.42);
    ctx.save();
    ctx.translate(projected.x, projected.y);
    const radius = ball.radius * ballScale;
    const gradient = ctx.createRadialGradient(-radius * 0.35, -radius * 0.35, 2, 0, 0, radius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#d0deea');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawOverlay(game) {
    if (!game) {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 8, 15, 0.56)';
      ctx.fillRect(0, 0, Core.ARENA.width, Core.ARENA.height);
      ctx.fillStyle = '#f3fbff';
      ctx.textAlign = 'center';
      ctx.font = '700 58px "Space Grotesk", sans-serif';
      ctx.fillText('TURBO ARENA', Core.ARENA.width / 2, Core.ARENA.height / 2 - 20);
      ctx.font = '500 24px Inter, sans-serif';
      ctx.fillStyle = 'rgba(232, 243, 255, 0.82)';
      ctx.fillText('Host a room, join by code, or launch solo against Turbo Bot.', Core.ARENA.width / 2, Core.ARENA.height / 2 + 26);
      ctx.restore();
      return;
    }

    if (game.phase === 'countdown') {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.textAlign = 'center';
      ctx.font = '700 108px "Space Grotesk", sans-serif';
      ctx.fillText(String(Math.max(1, Math.ceil(game.kickoffTimer || 0))), Core.ARENA.width / 2, Core.ARENA.height * 0.37);
      ctx.font = '500 28px Inter, sans-serif';
      ctx.fillText(game.overtime ? 'Overtime kickoff' : 'Kickoff reset', Core.ARENA.width / 2, Core.ARENA.height * 0.37 + 42);
      ctx.restore();
    }

    if (game.phase === 'finished') {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 8, 15, 0.66)';
      ctx.fillRect(0, 0, Core.ARENA.width, Core.ARENA.height);
      ctx.fillStyle = '#fff4f7';
      ctx.textAlign = 'center';
      ctx.font = '700 62px "Space Grotesk", sans-serif';
      ctx.fillText(game.winnerName ? `${game.winnerName} wins` : 'Match complete', Core.ARENA.width / 2, Core.ARENA.height / 2 - 18);
      ctx.font = '500 26px Inter, sans-serif';
      ctx.fillStyle = 'rgba(232, 243, 255, 0.86)';
      ctx.fillText(`Final score ${game.score.blue}-${game.score.orange}`, Core.ARENA.width / 2, Core.ARENA.height / 2 + 28);
      ctx.fillText('Press Restart match for another kickoff.', Core.ARENA.width / 2, Core.ARENA.height / 2 + 64);
      ctx.restore();
    }
  }

  function renderCanvas() {
    resizeCanvas();
    const game = smoothedGame(currentGame());
    const transform = worldToScreen();
    const projection = createProjection(transform);

    drawField(transform, projection, game);
    if (state.highGraphics) {
      drawParticles(transform, projection);
    }
    if (game) {
      drawBall(transform, projection, game.ball);
      game.players.forEach((player) => drawCar(player, transform, projection));
    }
    drawOverlay(game);
  }

  function setKeyState(code, pressed) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        state.keys.up = pressed;
        return true;
      case 'KeyS':
      case 'ArrowDown':
        state.keys.down = pressed;
        return true;
      case 'KeyA':
      case 'ArrowLeft':
        state.keys.left = pressed;
        return true;
      case 'KeyD':
      case 'ArrowRight':
        state.keys.right = pressed;
        return true;
      case 'ShiftLeft':
      case 'ShiftRight':
        state.keys.boost = pressed;
        return true;
      case 'Space':
        state.keys.handbrake = pressed;
        return true;
      default:
        return false;
    }
  }

  function bindTouchButtons() {
    if (!isCoarsePointer) {
      return;
    }
    ui.touchControls.classList.remove('hidden');
    const mapping = { shift: 'boost', space: 'handbrake', w: 'up', a: 'left', s: 'down', d: 'right' };
    ui.touchControls.querySelectorAll('button').forEach((button) => {
      const key = mapping[button.dataset.key];
      if (!key) {
        return;
      }
      const press = (down) => {
        state.keys[key] = down;
      };
      button.addEventListener('touchstart', (event) => {
        event.preventDefault();
        ensureAudio();
        press(true);
      }, { passive: false });
      button.addEventListener('touchend', (event) => {
        event.preventDefault();
        press(false);
      }, { passive: false });
      button.addEventListener('touchcancel', (event) => {
        event.preventDefault();
        press(false);
      }, { passive: false });
    });
  }

  function bindEvents() {
    ui.nameInput.addEventListener('input', () => {
      persistPreferences();
      renderPanels();
    });

    ui.roomInput.addEventListener('input', () => {
      ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
      renderPanels();
    });

    ui.serverUrlInput.addEventListener('change', () => {
      state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
      ui.serverUrlInput.value = state.serverUrl;
      persistPreferences();
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
    });

    ui.restartBtn.addEventListener('click', () => {
      ensureAudio();
      restartMatch();
    });

    ui.copyInviteBtn.addEventListener('click', () => {
      copyText(ui.inviteInput.value, 'Invite link copied.');
    });

    ui.copyCodeBtn.addEventListener('click', () => {
      copyText(state.roomCode, 'Room code copied.');
    });

    ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
    ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));

    ui.graphicsToggle.addEventListener('click', () => {
      state.highGraphics = !state.highGraphics;
      persistPreferences();
      renderPanels();
    });

    ui.soundToggle.addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      persistPreferences();
      renderPanels();
      if (state.soundOn) {
        ensureAudio();
        playKickoffSound();
      }
    });

    ui.volumeSlider.addEventListener('input', () => {
      state.volume = clamp(parseFloat(ui.volumeSlider.value) || 0, 0, 1);
      persistPreferences();
    });

    ui.toggleSetupBtn.addEventListener('click', () => {
      setPanelHidden('setupHidden', !state.panels.setupHidden);
    });

    ui.toggleInfoBtn.addEventListener('click', () => {
      setPanelHidden('infoHidden', !state.panels.infoHidden);
    });

    window.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      ensureAudio();
      if (event.code === 'KeyR') {
        event.preventDefault();
        restartMatch();
        return;
      }
      const handled = setKeyState(event.code, true);
      if (handled) {
        event.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      const handled = setKeyState(event.code, false);
      if (handled) {
        event.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('beforeunload', () => {
      disconnectSocket();
    });

    bindTouchButtons();
  }

  function tick(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameAt) / 1000));
    state.lastFrameAt = now;
    updateParticles(dt);

    if (state.mode === 'solo' && state.localGame) {
      Core.setPlayerInput(state.localGame, state.yourPlayerId, composeInput());
      updateBotDriver(state.localGame);
      Core.step(state.localGame, dt);
      processGameEvents(state.localGame);
    }

    sendInputIfNeeded(now);
    renderCanvas();

    if (now >= state.nextPanelRefreshAt) {
      renderPanels();
      state.nextPanelRefreshAt = now + 120;
    }

    window.requestAnimationFrame(tick);
  }

  function loadPreferences() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    ui.serverUrlInput.value = state.serverUrl;
    state.panels.setupHidden = localStorage.getItem(STORAGE_KEYS.setupHidden) === '1';
    state.panels.infoHidden = localStorage.getItem(STORAGE_KEYS.infoHidden) === '1';
    state.highGraphics = localStorage.getItem(STORAGE_KEYS.highGraphics) !== '0';
    state.soundOn = localStorage.getItem(STORAGE_KEYS.soundOn) !== '0';
    state.volume = clamp(parseFloat(localStorage.getItem(STORAGE_KEYS.volume) || '0.3') || 0.3, 0, 1);
    ui.volumeSlider.value = String(state.volume);
    ui.setupPanel.classList.toggle('panel-hidden', state.panels.setupHidden);
    ui.infoPanel.classList.toggle('panel-hidden', state.panels.infoHidden);

    const room = sanitizeRoomCode(query.get('room'));
    if (room) {
      ui.roomInput.value = room;
      state.statusMessage = `Invite loaded for room ${room}. Press Join arena when you are ready.`;
    }
  }

  loadPreferences();
  renderPanels();
  bindEvents();
  resizeCanvas();
  window.requestAnimationFrame(tick);
})();
