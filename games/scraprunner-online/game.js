(() => {
  'use strict';

  const Core = window.ScrapRunnerCore;
  if (!Core) {
    console.error('ScrapRunner core is missing.');
    return;
  }

  const PROD_WS_URL = 'wss://nova-arcade-backend-1000121513328.us-central1.run.app';
  const PROD_API_BASE = 'https://nova-arcade-backend-2rpkpv7fpq-uc.a.run.app';
  const STORAGE = {
    name: 'scraprunner.name',
    serverUrl: 'scraprunner.serverUrl',
    sound: 'scraprunner.sound',
    shake: 'scraprunner.shake',
    devUid: 'scraprunner.devUid',
  };
  const INPUT_SEND_MS = 50;

  const $ = (id) => document.getElementById(id);
  const ui = {
    nameInput: $('nameInput'),
    roomInput: $('roomInput'),
    serverUrlInput: $('serverUrlInput'),
    inviteInput: $('inviteInput'),
    hostBtn: $('hostBtn'),
    joinBtn: $('joinBtn'),
    overlayHostBtn: $('overlayHostBtn'),
    extractBtn: $('extractBtn'),
    restartBtn: $('restartBtn'),
    copyBtn: $('copyBtn'),
    soundBtn: $('soundBtn'),
    shakeBtn: $('shakeBtn'),
    networkStatus: $('networkStatus'),
    modePill: $('modePill'),
    accountStatus: $('accountStatus'),
    statusText: $('statusText'),
    roomCodeLabel: $('roomCodeLabel'),
    zoneLabel: $('zoneLabel'),
    timerLabel: $('timerLabel'),
    scoreLabel: $('scoreLabel'),
    cargoText: $('cargoText'),
    conditionText: $('conditionText'),
    missionText: $('missionText'),
    objectiveText: $('objectiveText'),
    presenceText: $('presenceText'),
    playerCards: $('playerCards'),
    feedList: $('feedList'),
    zoneStrip: $('zoneStrip'),
    overlay: $('overlay'),
    overlayTitle: $('overlayTitle'),
    overlayCopy: $('overlayCopy'),
    canvas: $('gameCanvas'),
    arenaStage: $('arenaStage'),
    toast: $('toast'),
    devPanel: $('devPanel'),
    debugText: $('debugText'),
    tabs: Array.from(document.querySelectorAll('.tab')),
    panels: {
      shop: $('tab-shop'),
      missions: $('tab-missions'),
      achievements: $('tab-achievements'),
      leaderboard: $('tab-leaderboard'),
      profile: $('tab-profile'),
    },
  };
  const ctx = ui.canvas.getContext('2d');

  const state = {
    socket: null,
    snapshot: null,
    profile: null,
    wallet: null,
    leaderboard: [],
    selectedZoneId: 'rust-yard',
    yourPlayerId: '',
    roomCode: '',
    serverUrl: '',
    lastInputSentAt: 0,
    lastFrameAt: performance.now(),
    lastEventId: 0,
    renderCache: {
      scraps: new Map(),
      enemies: new Map(),
      bullets: new Map(),
      players: new Map(),
    },
    pointer: {
      worldX: Core.ARENA.width / 2,
      worldY: Core.ARENA.height / 2,
      inside: false,
    },
    keys: {
      up: false,
      down: false,
      left: false,
      right: false,
      fire: false,
      boost: false,
    },
    touch: {
      up: false,
      down: false,
      left: false,
      right: false,
      fire: false,
      boost: false,
    },
    input: {
      moveX: 0,
      moveY: 0,
      aimX: Core.ARENA.width / 2,
      aimY: Core.ARENA.height / 2,
      fire: false,
      boost: false,
    },
    sound: localStorage.getItem(STORAGE.sound) !== 'off',
    shake: localStorage.getItem(STORAGE.shake) === 'on',
    shakeAmount: 0,
    audio: {
      context: null,
      unlocked: false,
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSim(cents) {
    return `${(Math.max(0, Math.round(Number(cents) || 0)) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} SIM`;
  }

  function formatTimer(seconds) {
    const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(safe / 60);
    return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
  }

  function localApiBase() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:8081';
    }
    if (host.endsWith('.run.app')) {
      return `${window.location.protocol}//${window.location.host}`;
    }
    return PROD_API_BASE;
  }

  function apiUrl(path) {
    return `${localApiBase()}${path}`;
  }

  function isLocalHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  function defaultWsUrl() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:8081';
    }
    return PROD_WS_URL;
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return defaultWsUrl();
    }
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'AP Runner';
  }

  function localDevUid() {
    let uid = localStorage.getItem(STORAGE.devUid);
    if (!uid) {
      uid = `local-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE.devUid, uid);
    }
    return uid;
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => ui.toast.classList.remove('show'), 2600);
  }

  function setNetwork(tone, label) {
    ui.networkStatus.dataset.tone = tone;
    ui.networkStatus.textContent = label;
  }

  function setStatus(message) {
    ui.statusText.textContent = message || '';
  }

  function ensureAudio() {
    if (!state.sound) return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!state.audio.context) {
      state.audio.context = new AudioCtor();
    }
    if (state.audio.context.state === 'suspended') {
      state.audio.context.resume().catch(() => {});
    }
    state.audio.unlocked = true;
    return state.audio.context;
  }

  function playTone(from, to, duration = 0.12, gainValue = 0.05, type = 'triangle') {
    const audio = ensureAudio();
    if (!audio) return;
    const start = audio.currentTime + 0.01;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function authReady() {
    return new Promise((resolve) => {
      const tick = () => {
        if (window.NovaAuth && typeof window.NovaAuth.init === 'function') {
          window.NovaAuth.init({ apiBaseUrl: localApiBase(), onChange: syncAuthUi }).then(resolve).catch(resolve);
        } else {
          window.setTimeout(tick, 50);
        }
      };
      tick();
    });
  }

  function canUseLocalDevAccount(profile = authProfile()) {
    return isLocalHost() && profile.ready && profile.enabled === false && profile.required === false;
  }

  function hasPlayableAccount(profile = authProfile()) {
    return Boolean(profile.signedIn || canUseLocalDevAccount(profile));
  }

  async function authHeaders(extra = {}) {
    await authReady();
    const profile = authProfile();
    if (canUseLocalDevAccount(profile)) {
      return {
        ...extra,
        'X-ScrapRunner-Dev-User': localDevUid(),
        'X-ScrapRunner-Dev-Name': getPlayerName(),
      };
    }
    if (!window.NovaAuth || typeof window.NovaAuth.appendAuthHeaders !== 'function') {
      throw new Error('AP account system is not ready.');
    }
    return window.NovaAuth.appendAuthHeaders(extra);
  }

  function authProfile() {
    return window.NovaAuth && typeof window.NovaAuth.profile === 'function'
      ? window.NovaAuth.profile()
      : { ready: false, signedIn: false, simWallet: {} };
  }

  function syncAuthUi() {
    const profile = authProfile();
    state.wallet = profile.simWallet && profile.simWallet.ready ? profile.simWallet : state.wallet;
    const localDev = canUseLocalDevAccount(profile);
    document.body.classList.toggle('scraprunner-local-dev', localDev);
    document.querySelectorAll('[data-auth-widget]').forEach((widget) => {
      widget.hidden = localDev;
    });
    if (!profile.ready) {
      ui.accountStatus.textContent = 'Loading account system...';
    } else if (localDev) {
      ui.accountStatus.textContent = `Local dev SIM account - ${formatSim(state.wallet?.balanceCents || 0)}`;
    } else if (!profile.signedIn) {
      ui.accountStatus.textContent = 'Sign in to save upgrades and bank extraction SIM.';
    } else {
      ui.accountStatus.textContent = `${profile.displayName} - ${window.NovaAuth.formatSimWallet(profile.simWallet)}`;
      ui.nameInput.value = ui.nameInput.value || profile.displayName || 'AP Runner';
    }
    renderAllPanels();
  }

  async function requestJson(path, options = {}) {
    const headers = await authHeaders(options.headers || {});
    const response = await fetch(apiUrl(path), {
      ...options,
      headers,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Request failed.');
    }
    return payload;
  }

  async function loadProfile() {
    const profile = authProfile();
    if (!hasPlayableAccount(profile)) {
      state.profile = null;
      renderAllPanels();
      return;
    }
    try {
      const payload = await requestJson('/api/scraprunner/profile');
      state.profile = payload.profile;
      state.wallet = payload.wallet || state.wallet;
      const firstUnlocked = state.profile.unlockedZones.includes(state.selectedZoneId)
        ? state.selectedZoneId
        : state.profile.unlockedZones[0] || 'rust-yard';
      state.selectedZoneId = firstUnlocked;
      syncAuthUi();
    } catch (error) {
      setStatus(error.message || 'Unable to load ScrapRunner profile.');
    }
  }

  async function refreshLeaderboard() {
    try {
      const response = await fetch(apiUrl('/api/scraprunner/leaderboard?limit=20'), { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        state.leaderboard = payload.runs || [];
        renderLeaderboard();
      }
    } catch {
      // Leaderboard is optional while the backend is waking up.
    }
  }

  async function buyUpgrade(upgradeId) {
    try {
      const payload = await requestJson('/api/scraprunner/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upgradeId }),
      });
      state.profile = payload.profile;
      state.wallet = payload.wallet;
      window.NovaAuth?.refreshWallet?.();
      showToast(`Upgrade installed for ${formatSim(payload.purchase.costCents)}.`);
      syncAuthUi();
    } catch (error) {
      showToast(error.message || 'Upgrade failed.');
    }
  }

  async function unlockZone(zoneId) {
    try {
      const payload = await requestJson('/api/scraprunner/unlock-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoneId }),
      });
      state.profile = payload.profile;
      state.wallet = payload.wallet;
      state.selectedZoneId = zoneId;
      window.NovaAuth?.refreshWallet?.();
      showToast(`Zone unlocked for ${formatSim(payload.unlock.costCents)}.`);
      syncAuthUi();
    } catch (error) {
      showToast(error.message || 'Zone unlock failed.');
    }
  }

  async function claimDaily() {
    try {
      const payload = await requestJson('/api/scraprunner/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      state.profile = payload.profile;
      state.wallet = payload.wallet;
      window.NovaAuth?.refreshWallet?.();
      showToast(`Daily reward banked: ${formatSim(payload.rewardCents)}.`);
      syncAuthUi();
    } catch (error) {
      showToast(error.message || 'Daily reward unavailable.');
    }
  }

  async function claimMission(missionId) {
    try {
      const payload = await requestJson('/api/scraprunner/mission-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      });
      state.profile = payload.profile;
      state.wallet = payload.wallet;
      window.NovaAuth?.refreshWallet?.();
      showToast(`Mission reward banked: ${formatSim(payload.rewardCents)}.`);
      syncAuthUi();
    } catch (error) {
      showToast(error.message || 'Mission reward unavailable.');
    }
  }

  function renderZones() {
    const zones = state.profile?.zones || Core.ZONES.map((zone) => ({ ...zone, unlocked: zone.id === 'rust-yard' }));
    ui.zoneStrip.innerHTML = zones.map((zone) => {
      const locked = !zone.unlocked;
      const active = state.selectedZoneId === zone.id;
      return `
        <button class="zone-button ${active ? 'active' : ''} ${locked ? 'locked' : ''}" type="button" data-zone="${zone.id}" data-locked="${locked ? '1' : '0'}">
          <strong>${escapeHtml(zone.name)}</strong>
          <span>${locked ? `Unlock ${formatSim(zone.unlockCostCents)}` : `${zone.difficulty}x risk - max ${formatSim(zone.maxRewardCents)}`}</span>
        </button>
      `;
    }).join('');
    ui.zoneStrip.querySelectorAll('.zone-button').forEach((button) => {
      button.addEventListener('click', () => {
        const zoneId = button.dataset.zone;
        if (button.dataset.locked === '1') {
          unlockZone(zoneId);
        } else {
          state.selectedZoneId = zoneId;
          renderZones();
        }
      });
    });
  }

  function renderShop() {
    if (!state.profile) {
      ui.panels.shop.innerHTML = '<p class="shop-copy">Sign in to load upgrades.</p>';
      return;
    }
    ui.panels.shop.innerHTML = `
      <div class="shop-grid">
        ${state.profile.upgradesList.map((upgrade) => `
          <article class="shop-card">
            <div>
              <strong>${escapeHtml(upgrade.name)}</strong>
              <div class="progress" aria-hidden="true"><span style="--pct:${(upgrade.level / upgrade.maxLevel) * 100}%"></span></div>
              <small>Level ${upgrade.level} / ${upgrade.maxLevel}</small>
            </div>
            <button type="button" data-upgrade="${upgrade.id}" ${upgrade.level >= upgrade.maxLevel ? 'disabled' : ''}>
              ${upgrade.level >= upgrade.maxLevel ? 'Max' : formatSim(upgrade.nextCostCents)}
            </button>
          </article>
        `).join('')}
      </div>
    `;
    ui.panels.shop.querySelectorAll('[data-upgrade]').forEach((button) => {
      button.addEventListener('click', () => buyUpgrade(button.dataset.upgrade));
    });
  }

  function renderMissions() {
    if (!state.profile) {
      ui.panels.missions.innerHTML = '<p class="shop-copy">Sign in to load daily missions.</p>';
      return;
    }
    const daily = state.profile.daily || {};
    const missions = state.profile.missions?.items || [];
    ui.panels.missions.innerHTML = `
      <div class="mission-grid">
        <article class="mission-card">
          <strong>Daily streak: ${daily.streak || 0}</strong>
          <p class="shop-copy">Best streak ${daily.bestStreak || 0}. Daily claims pay more as the streak grows.</p>
          <button type="button" id="dailyClaimBtn">Claim daily</button>
        </article>
        ${missions.map((mission) => {
          const complete = mission.progress >= mission.target;
          return `
            <article class="mission-card">
              <strong>${escapeHtml(mission.label)}</strong>
              <div class="progress" aria-hidden="true"><span style="--pct:${Math.min(100, (mission.progress / mission.target) * 100)}%"></span></div>
              <small>${mission.progress} / ${mission.target} - ${formatSim(mission.rewardCents)}</small>
              <button type="button" data-mission="${mission.id}" ${!complete || mission.claimed ? 'disabled' : ''}>${mission.claimed ? 'Claimed' : 'Claim'}</button>
            </article>
          `;
        }).join('')}
      </div>
    `;
    $('dailyClaimBtn')?.addEventListener('click', claimDaily);
    ui.panels.missions.querySelectorAll('[data-mission]').forEach((button) => {
      button.addEventListener('click', () => claimMission(button.dataset.mission));
    });
  }

  function renderAchievements() {
    if (!state.profile) {
      ui.panels.achievements.innerHTML = '<p class="shop-copy">Sign in to load achievements.</p>';
      return;
    }
    ui.panels.achievements.innerHTML = `
      <div class="achievement-grid">
        ${state.profile.achievementsList.map((achievement) => `
          <article class="achievement-card">
            <strong>${achievement.unlocked ? 'Unlocked' : 'Locked'} - ${escapeHtml(achievement.name)}</strong>
            <p class="shop-copy">${escapeHtml(achievement.description)}</p>
          </article>
        `).join('')}
      </div>
    `;
  }

  function renderLeaderboard() {
    const rows = state.leaderboard || [];
    ui.panels.leaderboard.innerHTML = rows.length
      ? `<div class="leaderboard-list">${rows.map((run, index) => `
          <article class="leaderboard-row">
            <div>
              <strong>#${index + 1} ${escapeHtml(run.displayName)}</strong>
              <small>${escapeHtml(run.zoneName)} - ${run.scrap} scrap - ${run.kills} drones</small>
            </div>
            <strong>${formatSim(run.rewardCents)}</strong>
          </article>
        `).join('')}</div>`
      : '<p class="shop-copy">No extracted runs yet.</p>';
  }

  function renderProfile() {
    if (!state.profile) {
      ui.panels.profile.innerHTML = '<p class="shop-copy">Sign in to load profile stats.</p>';
      return;
    }
    const stats = state.profile.stats || {};
    ui.panels.profile.innerHTML = `
      <div class="profile-grid">
        <article class="profile-card"><span>SIM wallet</span><strong>${window.NovaAuth?.formatSimWallet?.(authProfile().simWallet) || formatSim(state.wallet?.balanceCents || 0)}</strong></article>
        <article class="profile-card"><span>ScrapRunner earned</span><strong>${formatSim(stats.earnedCents || 0)}</strong></article>
        <article class="profile-card"><span>Runs / extracts</span><strong>${stats.runs || 0} / ${stats.extractions || 0}</strong></article>
        <article class="profile-card"><span>Scrap / drones</span><strong>${stats.scrap || 0} / ${stats.kills || 0}</strong></article>
        <article class="profile-card"><span>Best haul</span><strong>${formatSim(stats.bestRewardCents || 0)}</strong></article>
      </div>
    `;
  }

  function renderAllPanels() {
    renderZones();
    renderShop();
    renderMissions();
    renderAchievements();
    renderLeaderboard();
    renderProfile();
  }

  function updateInvite() {
    if (!state.roomCode) {
      ui.inviteInput.value = '';
      return;
    }
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/[^/]*$/, 'scraprunner-online.html');
    url.searchParams.set('room', state.roomCode);
    url.searchParams.set('zone', state.snapshot?.zone?.id || state.selectedZoneId);
    ui.inviteInput.value = url.toString();
  }

  async function connect(mode) {
    await authReady();
    const profile = authProfile();
    const localDev = canUseLocalDevAccount(profile);
    if (!hasPlayableAccount(profile)) {
      window.NovaAuth?.requireSignedIn?.('play ScrapRunner');
      return;
    }
    const token = localDev ? '' : await window.NovaAuth.getIdToken();
    if (!localDev && !token) {
      showToast('Sign in before joining a SIM salvage room.');
      return;
    }
    ensureAudio();
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl);
    localStorage.setItem(STORAGE.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE.serverUrl, state.serverUrl);

    if (state.socket && state.socket.readyState < WebSocket.CLOSING) {
      state.socket.close();
    }

    setNetwork('busy', 'Connecting');
    setStatus(mode === 'host' ? 'Creating salvage room...' : 'Joining salvage room...');
    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        action: 'join',
        mode,
        game: 'scraprunner',
        name: getPlayerName(),
        roomCode: mode === 'join' ? sanitizeRoomCode(ui.roomInput.value) : sanitizeRoomCode(ui.roomInput.value),
        zoneId: state.selectedZoneId,
        authToken: token,
        devUser: localDev ? localDevUid() : '',
        devName: localDev ? getPlayerName() : '',
      }));
    });

    socket.addEventListener('message', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      handleSocketPayload(payload);
    });

    socket.addEventListener('close', () => {
      if (state.socket === socket) {
        setNetwork('offline', 'Offline');
        ui.modePill.textContent = 'Room closed';
      }
    });

    socket.addEventListener('error', () => {
      setNetwork('offline', 'Error');
      showToast('WebSocket connection failed.');
    });
  }

  function handleSocketPayload(payload) {
    if (payload.type === 'error') {
      setStatus(payload.message || 'Server error.');
      showToast(payload.message || 'Server error.');
      return;
    }
    if (payload.type === 'welcome') {
      state.yourPlayerId = payload.playerId;
      state.roomCode = payload.roomCode;
      ui.roomInput.value = payload.roomCode;
      setNetwork('online', 'Online');
      ui.modePill.textContent = `Room ${payload.roomCode}`;
      setStatus('Salvage room connected.');
      updateInvite();
      playTone(420, 720, 0.14, 0.04);
      return;
    }
    if (payload.type === 'state') {
      state.snapshot = payload.snapshot;
      state.roomCode = payload.snapshot?.roomCode || state.roomCode;
      updateInvite();
      ui.overlay.classList.toggle('hidden', Boolean(state.snapshot && state.snapshot.phase === 'running'));
      consumeEvents(state.snapshot);
      renderHud();
      return;
    }
    if (payload.type === 'scraprunner-reward') {
      state.profile = payload.profile || state.profile;
      state.wallet = payload.wallet || state.wallet;
      window.NovaAuth?.refreshWallet?.();
      refreshLeaderboard();
      syncAuthUi();
      showToast(`Extraction banked: ${formatSim(payload.run?.rewardCents || 0)}.`);
      playTone(520, 1180, 0.22, 0.07);
    }
  }

  function currentPlayer() {
    const game = state.snapshot;
    if (!game || !state.yourPlayerId) return null;
    return (game.players || []).find((player) => player.id === state.yourPlayerId) || null;
  }

  function sendInput() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.snapshot) return;
    const now = performance.now();
    if (now - state.lastInputSentAt < INPUT_SEND_MS) return;
    state.lastInputSentAt = now;
    state.socket.send(JSON.stringify({
      action: 'input',
      input: { ...state.input },
    }));
  }

  function extract() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      showToast('Join a room before extracting.');
      return;
    }
    state.socket.send(JSON.stringify({ action: 'extract' }));
  }

  function restart() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      showToast('Join a room before restarting.');
      return;
    }
    state.socket.send(JSON.stringify({ action: 'restart' }));
  }

  function renderHud() {
    const game = state.snapshot;
    if (!game) {
      ui.roomCodeLabel.textContent = '-';
      return;
    }
    const player = currentPlayer();
    ui.roomCodeLabel.textContent = game.roomCode || '-';
    ui.zoneLabel.textContent = game.zone?.shortName || game.zone?.name || 'Rust';
    ui.timerLabel.textContent = formatTimer(game.timeLeft);
    ui.scoreLabel.textContent = String(Math.round(game.score || 0)).toLocaleString();
    ui.missionText.textContent = game.status || 'Run live.';
    ui.objectiveText.textContent = game.objective || '';
    ui.cargoText.textContent = player ? `${Math.round(player.scrap)} / ${Math.round(player.cargo)}` : '0 / 0';
    ui.conditionText.textContent = player
      ? player.extracted
        ? `Extracted - ${formatSim(player.rewardCents)}`
        : player.alive
          ? `${Math.ceil(player.hp)} HP - ${player.kills} drones`
          : 'Rig down'
      : 'Spectating';
    const roster = game.roster || [];
    ui.presenceText.textContent = roster.length ? `${roster.length} runner${roster.length === 1 ? '' : 's'} connected` : 'No runners connected.';
    renderPlayerCards(game);
    renderFeed(game);
    renderDebug();
  }

  function renderPlayerCards(game) {
    const players = game.players || [];
    ui.playerCards.innerHTML = players.map((player) => `
      <article class="player-card">
        <header>
          <strong style="color:${player.color}">${escapeHtml(player.name)}</strong>
          <span>${player.extracted ? 'Extracted' : player.alive ? 'Running' : 'Down'}</span>
        </header>
        <div class="meter-row">
          <span>Health ${Math.ceil(player.hp)} / ${player.maxHp}</span>
          <div class="progress"><span style="--pct:${Math.max(0, (player.hp / player.maxHp) * 100)}%"></span></div>
          <span>Cargo ${Math.round(player.scrap)} / ${Math.round(player.cargo)} - ${player.kills} drones</span>
        </div>
      </article>
    `).join('') || '<p class="shop-copy">Waiting for runners.</p>';
  }

  function eventLabel(event) {
    if (event.type === 'scrap') return `${event.name} collected ${event.amount} scrap.`;
    if (event.type === 'drone-down') return `${event.name} dropped a drone.`;
    if (event.type === 'extract') return `${event.name} extracted ${event.scrap} scrap for ${formatSim(event.rewardCents)}.`;
    if (event.type === 'runner-downed') return `${event.name} went down.`;
    if (event.type === 'timer-expired') return 'Timer expired.';
    if (event.type === 'run-complete') return `Run complete with ${event.extractedCount} extraction${event.extractedCount === 1 ? '' : 's'}.`;
    return event.name ? `${event.name}: ${event.type}` : event.type;
  }

  function renderFeed(game) {
    const events = (game.events || []).slice(-8).reverse();
    ui.feedList.innerHTML = events.map((event) => `
      <article class="feed-item">
        ${escapeHtml(eventLabel(event))}
        <small>${Number(event.at || 0).toFixed(1)}s</small>
      </article>
    `).join('') || '<p class="shop-copy">Run events will appear here.</p>';
  }

  function consumeEvents(game) {
    if (!game || !Array.isArray(game.events)) return;
    for (const event of game.events) {
      if (event.id <= state.lastEventId) continue;
      state.lastEventId = event.id;
      if (event.type === 'scrap') playTone(780, 980, 0.08, 0.025);
      if (event.type === 'drone-down') {
        playTone(160, 70, 0.14, 0.045, 'sawtooth');
        state.shakeAmount = Math.max(state.shakeAmount, 5);
      }
      if (event.type === 'runner-downed') {
        playTone(220, 90, 0.24, 0.055, 'square');
        state.shakeAmount = Math.max(state.shakeAmount, 8);
      }
    }
  }

  function updateInput() {
    const moveX = (state.keys.right || state.touch.right ? 1 : 0) - (state.keys.left || state.touch.left ? 1 : 0);
    const moveY = (state.keys.down || state.touch.down ? 1 : 0) - (state.keys.up || state.touch.up ? 1 : 0);
    const length = Math.hypot(moveX, moveY) || 1;
    state.input.moveX = moveX / length;
    state.input.moveY = moveY / length;
    state.input.aimX = state.pointer.worldX;
    state.input.aimY = state.pointer.worldY;
    state.input.fire = state.keys.fire || state.touch.fire;
    state.input.boost = state.keys.boost || state.touch.boost;
    sendInput();
  }

  function worldFromCanvas(clientX, clientY) {
    const rect = ui.canvas.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1) * Core.ARENA.width;
    const y = clamp((clientY - rect.top) / rect.height, 0, 1) * Core.ARENA.height;
    return { x, y };
  }

  function trackPointer(event) {
    const point = worldFromCanvas(event.clientX, event.clientY);
    state.pointer.worldX = point.x;
    state.pointer.worldY = point.y;
  }

  function drawGrid(game) {
    const zone = game?.zone || Core.ZONES[0];
    const gradient = ctx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
    gradient.addColorStop(0, zone.bg || '#07100d');
    gradient.addColorStop(1, '#050807');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

    const scaleX = ui.canvas.width / Core.ARENA.width;
    const scaleY = ui.canvas.height / Core.ARENA.height;
    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.strokeStyle = 'rgba(237,247,238,0.055)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= Core.ARENA.width; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, Core.ARENA.height);
      ctx.stroke();
    }
    for (let y = 0; y <= Core.ARENA.height; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(Core.ARENA.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function withWorld(callback) {
    const scaleX = ui.canvas.width / Core.ARENA.width;
    const scaleY = ui.canvas.height / Core.ARENA.height;
    ctx.save();
    if (state.shake && state.shakeAmount > 0) {
      ctx.translate((Math.random() - 0.5) * state.shakeAmount, (Math.random() - 0.5) * state.shakeAmount);
    }
    ctx.scale(scaleX, scaleY);
    callback();
    ctx.restore();
  }

  function drawExtraction(extraction) {
    if (!extraction) return;
    const pulse = Math.sin((extraction.pulse || 0) * 2) * 0.12 + 1;
    ctx.save();
    ctx.translate(extraction.x, extraction.y);
    ctx.strokeStyle = 'rgba(134,239,172,0.78)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, extraction.radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(134,239,172,0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, extraction.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9ffe2';
    ctx.font = '800 22px Oxanium, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXTRACT', 0, 8);
    ctx.restore();
  }

  function drawHazard(hazard) {
    const pulse = Math.sin(performance.now() / 300 + hazard.phase) * 0.12 + 1;
    ctx.fillStyle = 'rgba(251,113,133,0.12)';
    ctx.strokeStyle = 'rgba(251,113,133,0.48)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(hazard.x, hazard.y, hazard.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawScrap(scrap) {
    const cache = state.renderCache.scraps.get(scrap.id) || { x: scrap.x, y: scrap.y };
    cache.x = lerp(cache.x, scrap.x, 0.36);
    cache.y = lerp(cache.y, scrap.y, 0.36);
    state.renderCache.scraps.set(scrap.id, cache);
    ctx.save();
    ctx.translate(cache.x, cache.y + Math.sin(performance.now() / 140 + scrap.phase) * 3);
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-scrap.r, -scrap.r * 0.4);
    ctx.lineTo(scrap.r * 0.8, -scrap.r);
    ctx.lineTo(scrap.r, scrap.r * 0.5);
    ctx.lineTo(-scrap.r * 0.7, scrap.r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemy(enemy) {
    const cache = state.renderCache.enemies.get(enemy.id) || { x: enemy.x, y: enemy.y };
    cache.x = lerp(cache.x, enemy.x, 0.34);
    cache.y = lerp(cache.y, enemy.y, 0.34);
    state.renderCache.enemies.set(enemy.id, cache);
    ctx.save();
    ctx.translate(cache.x, cache.y);
    ctx.fillStyle = enemy.flash > 0 ? '#ffffff' : enemy.type === 'hauler-drone' ? '#f0abfc' : '#fb7185';
    ctx.strokeStyle = '#10140f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111827';
    ctx.fillRect(-enemy.r * 0.52, -4, enemy.r * 1.04, 8);
    ctx.fillStyle = '#86efac';
    ctx.fillRect(-enemy.r * 0.52, -4, enemy.r * 1.04 * Math.max(0, enemy.hp / enemy.maxHp), 8);
    ctx.restore();
  }

  function drawBullet(bullet) {
    ctx.fillStyle = bullet.color || '#67e8f9';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayer(player) {
    const cache = state.renderCache.players.get(player.id) || { x: player.x, y: player.y, angle: player.angle };
    cache.x = lerp(cache.x, player.x, 0.38);
    cache.y = lerp(cache.y, player.y, 0.38);
    cache.angle = lerp(cache.angle, player.angle, 0.25);
    state.renderCache.players.set(player.id, cache);
    ctx.save();
    ctx.translate(cache.x, cache.y);
    ctx.rotate(cache.angle);
    ctx.globalAlpha = player.alive || player.extracted ? 1 : 0.44;
    ctx.fillStyle = player.extracted ? '#86efac' : player.flash > 0 ? '#ffffff' : player.color;
    ctx.strokeStyle = '#07100d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(player.r + 14, 0);
    ctx.lineTo(-player.r, -player.r * 0.8);
    ctx.lineTo(-player.r * 0.55, 0);
    ctx.lineTo(-player.r, player.r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (player.boostTimer > 0) {
      ctx.fillStyle = 'rgba(255,209,102,0.82)';
      ctx.beginPath();
      ctx.moveTo(-player.r - 4, -8);
      ctx.lineTo(-player.r - 28, 0);
      ctx.lineTo(-player.r - 4, 8);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#edf7ee';
    ctx.font = '700 18px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, cache.x, cache.y - player.r - 18);
    ctx.restore();
  }

  function drawGame() {
    const game = state.snapshot;
    drawGrid(game);
    if (!game) return;
    withWorld(() => {
      (game.hazards || []).forEach(drawHazard);
      drawExtraction(game.extraction);
      (game.scraps || []).forEach(drawScrap);
      (game.bullets || []).forEach(drawBullet);
      (game.enemies || []).forEach(drawEnemy);
      (game.players || []).forEach(drawPlayer);
    });
  }

  function frame(now) {
    const delta = Math.min(0.05, (now - state.lastFrameAt) / 1000);
    state.lastFrameAt = now;
    state.shakeAmount = Math.max(0, state.shakeAmount - delta * 18);
    updateInput();
    drawGame();
    window.requestAnimationFrame(frame);
  }

  function renderDebug() {
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    ui.devPanel.classList.toggle('hidden', !local);
    if (local) {
      ui.debugText.textContent = JSON.stringify({
        room: state.roomCode,
        selectedZone: state.selectedZoneId,
        playerId: state.yourPlayerId,
        profileLoaded: Boolean(state.profile),
        socket: state.socket ? state.socket.readyState : 'none',
      }, null, 2);
    }
  }

  function installEvents() {
    ui.hostBtn.addEventListener('click', () => connect('host'));
    ui.overlayHostBtn.addEventListener('click', () => connect('host'));
    ui.joinBtn.addEventListener('click', () => connect('join'));
    ui.extractBtn.addEventListener('click', extract);
    ui.restartBtn.addEventListener('click', restart);
    ui.copyBtn.addEventListener('click', async () => {
      if (!ui.inviteInput.value) return;
      await navigator.clipboard?.writeText(ui.inviteInput.value).catch(() => {});
      showToast('Invite copied.');
    });
    ui.soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      localStorage.setItem(STORAGE.sound, state.sound ? 'on' : 'off');
      ui.soundBtn.textContent = state.sound ? 'Sound on' : 'Sound off';
      ui.soundBtn.setAttribute('aria-pressed', String(state.sound));
      if (state.sound) ensureAudio();
    });
    ui.shakeBtn.addEventListener('click', () => {
      state.shake = !state.shake;
      localStorage.setItem(STORAGE.shake, state.shake ? 'on' : 'off');
      ui.shakeBtn.textContent = state.shake ? 'Shake on' : 'Shake off';
      ui.shakeBtn.setAttribute('aria-pressed', String(state.shake));
    });

    ui.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        ui.tabs.forEach((item) => item.classList.toggle('active', item === tab));
        Object.entries(ui.panels).forEach(([key, panel]) => {
          panel.classList.toggle('active', key === tab.dataset.tab);
        });
        if (tab.dataset.tab === 'leaderboard') refreshLeaderboard();
      });
    });

    window.addEventListener('keydown', (event) => {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      if (event.key === 'w' || event.key === 'W' || event.key === 'ArrowUp') state.keys.up = true;
      if (event.key === 's' || event.key === 'S' || event.key === 'ArrowDown') state.keys.down = true;
      if (event.key === 'a' || event.key === 'A' || event.key === 'ArrowLeft') state.keys.left = true;
      if (event.key === 'd' || event.key === 'D' || event.key === 'ArrowRight') state.keys.right = true;
      if (event.key === ' ' || event.key === 'Enter') state.keys.fire = true;
      if (event.key === 'Shift') state.keys.boost = true;
      if (event.key === 'e' || event.key === 'E') extract();
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === 'w' || event.key === 'W' || event.key === 'ArrowUp') state.keys.up = false;
      if (event.key === 's' || event.key === 'S' || event.key === 'ArrowDown') state.keys.down = false;
      if (event.key === 'a' || event.key === 'A' || event.key === 'ArrowLeft') state.keys.left = false;
      if (event.key === 'd' || event.key === 'D' || event.key === 'ArrowRight') state.keys.right = false;
      if (event.key === ' ' || event.key === 'Enter') state.keys.fire = false;
      if (event.key === 'Shift') state.keys.boost = false;
    });

    ui.canvas.addEventListener('pointermove', trackPointer);
    ui.canvas.addEventListener('pointerdown', (event) => {
      ensureAudio();
      trackPointer(event);
      state.keys.fire = true;
      ui.canvas.setPointerCapture?.(event.pointerId);
    });
    ui.canvas.addEventListener('pointerup', () => {
      state.keys.fire = false;
    });
    ui.canvas.addEventListener('pointerleave', () => {
      state.keys.fire = false;
    });

    document.querySelectorAll('[data-touch]').forEach((button) => {
      const key = button.dataset.touch;
      const down = (event) => {
        event.preventDefault();
        ensureAudio();
        if (key === 'extract') {
          extract();
          return;
        }
        state.touch[key] = true;
      };
      const up = () => {
        if (key !== 'extract') state.touch[key] = false;
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
    });
  }

  function restoreSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE.name) || '';
    state.serverUrl = localStorage.getItem(STORAGE.serverUrl) || defaultWsUrl();
    ui.serverUrlInput.value = state.serverUrl;
    ui.soundBtn.textContent = state.sound ? 'Sound on' : 'Sound off';
    ui.soundBtn.setAttribute('aria-pressed', String(state.sound));
    ui.shakeBtn.textContent = state.shake ? 'Shake on' : 'Shake off';
    ui.shakeBtn.setAttribute('aria-pressed', String(state.shake));
    const query = new URLSearchParams(window.location.search);
    const room = sanitizeRoomCode(query.get('room'));
    if (room) {
      ui.roomInput.value = room;
      setStatus(`Invite loaded for room ${room}.`);
    }
    const zone = Core.normalizeZoneId(query.get('zone'));
    if (zone) state.selectedZoneId = zone;
  }

  async function init() {
    restoreSettings();
    installEvents();
    renderAllPanels();
    refreshLeaderboard();
    window.requestAnimationFrame(frame);
    await authReady();
    syncAuthUi();
    await loadProfile();
    window.NovaAuth?.onChange?.(() => {
      syncAuthUi();
      loadProfile().catch(() => {});
    });
  }

  init().catch((error) => {
    setStatus(error.message || 'ScrapRunner failed to start.');
  });
})();
