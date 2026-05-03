(() => {
  'use strict';

  const PROD_SERVER_URL = 'wss://nova-arcade-backend-1000121513328.us-central1.run.app';
  const DRAG_THRESHOLD_PX = 6;
  const DRAG_COLLISION_GAP_PX = 8;
  const STORAGE_KEYS = {
    name: 'royalBlackjackLive.name',
    serverUrl: 'royalBlackjackLive.serverUrl',
    setupHidden: 'royalBlackjackLive.setupHidden',
    infoHidden: 'royalBlackjackLive.infoHidden',
    tableLayout: 'royalBlackjackLive.tableLayout',
  };
  const query = new URLSearchParams(window.location.search);

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    authProfile: null,
    playerId: '',
    roomCode: '',
    serverUrl: '',
    statusMessage: '',
    toastTimer: 0,
    walletRefreshTimer: 0,
    audio: {
      context: null,
      unlocked: false,
      lastDealCueAt: 0,
      lastShuffleCueAt: 0,
    },
    panels: {
      setupHidden: false,
      infoHidden: false,
    },
    renderMemo: {
      dealerSignature: '',
      seatSignatures: new Map(),
      visibleCardCount: 0,
      outcomeKey: '',
      shoeRemaining: null,
      discardCount: null,
      chipSignature: '',
    },
    tableDrag: {
      positions: {},
      active: null,
      suppressClickUntil: 0,
    },
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    walletStatus: document.getElementById('walletStatus'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    phaseLabel: document.getElementById('phaseLabel'),
    tableBetLabel: document.getElementById('tableBetLabel'),
    shoeLabel: document.getElementById('shoeLabel'),
    tableHeadline: document.getElementById('tableHeadline'),
    tableSubline: document.getElementById('tableSubline'),
    dealerCards: document.getElementById('dealerCards'),
    dealerScoreLabel: document.getElementById('dealerScoreLabel'),
    shoeMeter: document.getElementById('shoeMeter'),
    discardMeter: document.getElementById('discardMeter'),
    countMeter: document.getElementById('countMeter'),
    runningCountLabel: document.getElementById('runningCountLabel'),
    trueCountLabel: document.getElementById('trueCountLabel'),
    handLabel: document.getElementById('handLabel'),
    tableBetAmount: document.getElementById('tableBetAmount'),
    turnLabel: document.getElementById('turnLabel'),
    seatLayer: document.getElementById('seatLayer'),
    chipRow: document.getElementById('chipRow'),
    actionPrompt: document.getElementById('actionPrompt'),
    logList: document.getElementById('logList'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleInfoBtn: document.getElementById('toggleInfoBtn'),
    dealBtn: document.getElementById('dealBtn'),
    hitBtn: document.getElementById('hitBtn'),
    standBtn: document.getElementById('standBtn'),
    doubleBtn: document.getElementById('doubleBtn'),
    splitBtn: document.getElementById('splitBtn'),
    resetTableBtn: document.getElementById('resetTableBtn'),
    toast: document.getElementById('toast'),
    layoutShell: document.getElementById('layoutShell'),
  };

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function defaultServerUrl() {
    const explicit = query.get('server');
    if (explicit) {
      return sanitizeServerUrl(explicit);
    }
    return canonicalServerUrl();
  }

  function isLocalPageHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  function canonicalServerUrl() {
    return isLocalPageHost() ? 'ws://127.0.0.1:8081' : PROD_SERVER_URL;
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return defaultServerUrl();
    }
    if (/^wss?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/^http/i, 'ws');
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function productionSafeServerUrl(value) {
    const requested = sanitizeServerUrl(value || canonicalServerUrl());
    if (query.get('server') || isLocalPageHost()) {
      return requested;
    }
    return canonicalServerUrl();
  }

  function getPlayerName() {
    const typedName = ui.nameInput.value.trim().slice(0, 18);
    if (typedName) {
      return typedName;
    }
    return state.authProfile?.displayName?.slice(0, 18) || 'Player';
  }

  function formatChips(value) {
    const cents = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    const sim = cents / 100;
    return `${sim.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(sim) ? 0 : 2,
      maximumFractionDigits: 2,
    })} SIM`;
  }

  function getAudioContext() {
    if (state.audio.context) {
      return state.audio.context;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    state.audio.context = new AudioCtor();
    return state.audio.context;
  }

  function unlockAudio() {
    const context = getAudioContext();
    if (!context) {
      return null;
    }
    state.audio.unlocked = true;
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }
    return context;
  }

  function playTone(context, frequency, startAt, duration, options = {}) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, startAt + duration);
    }
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.045, startAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.025);
  }

  function playNoise(context, startAt, duration, options = {}) {
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = options.filterType || 'bandpass';
    filter.frequency.setValueAtTime(options.frequency || 1200, startAt);
    filter.Q.setValueAtTime(options.q || 0.85, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.05, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(startAt);
    source.stop(startAt + duration + 0.02);
  }

  function playSound(name) {
    const context = unlockAudio();
    if (!context) {
      return;
    }
    const now = context.currentTime;
    if (name === 'chip') {
      playTone(context, 360, now, 0.055, { type: 'triangle', volume: 0.04, endFrequency: 260 });
      playTone(context, 760, now + 0.035, 0.045, { type: 'square', volume: 0.018, endFrequency: 540 });
      return;
    }
    if (name === 'deal') {
      playNoise(context, now, 0.075, { frequency: 1900, q: 1.1, volume: 0.032 });
      playTone(context, 520, now + 0.025, 0.04, { type: 'triangle', volume: 0.022, endFrequency: 410 });
      return;
    }
    if (name === 'throw') {
      playNoise(context, now, 0.12, { frequency: 2400, q: 1.6, volume: 0.034 });
      playTone(context, 180, now + 0.15, 0.055, { type: 'triangle', volume: 0.028, endFrequency: 105 });
      playTone(context, 420, now + 0.205, 0.045, { type: 'sine', volume: 0.018, endFrequency: 320 });
      return;
    }
    if (name === 'shuffle') {
      for (let index = 0; index < 6; index += 1) {
        playNoise(context, now + index * 0.045, 0.08, {
          frequency: 520 + index * 190,
          q: 0.7,
          volume: 0.038,
        });
      }
      playTone(context, 150, now + 0.22, 0.12, { type: 'sawtooth', volume: 0.018, endFrequency: 95 });
      return;
    }
    if (name === 'win') {
      playTone(context, 523.25, now, 0.08, { type: 'triangle', volume: 0.04, endFrequency: 659.25 });
      playTone(context, 783.99, now + 0.09, 0.11, { type: 'triangle', volume: 0.045, endFrequency: 1046.5 });
      playNoise(context, now + 0.04, 0.13, { frequency: 3200, q: 1.4, volume: 0.022 });
      return;
    }
    if (name === 'lose') {
      playTone(context, 220, now, 0.14, { type: 'sawtooth', volume: 0.032, endFrequency: 110 });
      playNoise(context, now + 0.035, 0.16, { frequency: 360, q: 0.55, volume: 0.03 });
      return;
    }
    if (name === 'push') {
      playTone(context, 420, now, 0.07, { type: 'sine', volume: 0.024, endFrequency: 420 });
      playTone(context, 420, now + 0.09, 0.06, { type: 'sine', volume: 0.02, endFrequency: 360 });
      return;
    }
    playTone(context, 620, now, 0.045, { type: 'triangle', volume: 0.032, endFrequency: 460 });
  }

  function authProfile() {
    if (window.NovaAuth && typeof window.NovaAuth.profile === 'function') {
      state.authProfile = window.NovaAuth.profile();
    }
    return state.authProfile || {
      ready: false,
      signedIn: false,
      displayName: '',
      simWallet: { balanceCents: null, currency: 'SIM' },
    };
  }

  function signedInForSim(actionLabel) {
    if (!window.NovaAuth) {
      showToast('SIM wallet is still loading. Try again in a moment.');
      return false;
    }
    const profile = authProfile();
    if (profile.signedIn) {
      return true;
    }
    window.NovaAuth.requireSignedIn(actionLabel);
    showToast(`Sign in to ${actionLabel}.`);
    render();
    return false;
  }

  async function authPayloadForTable() {
    if (!window.NovaAuth) {
      throw new Error('SIM wallet is not available yet.');
    }
    await window.NovaAuth.init();
    const token = await window.NovaAuth.getIdToken(true);
    if (!token) {
      throw new Error('Sign in to use your SIM wallet.');
    }
    state.authProfile = window.NovaAuth.profile();
    return { authToken: token };
  }

  function refreshWalletSoon() {
    if (!window.NovaAuth || typeof window.NovaAuth.refreshWallet !== 'function') {
      return;
    }
    window.clearTimeout(state.walletRefreshTimer);
    state.walletRefreshTimer = window.setTimeout(() => {
      window.NovaAuth.refreshWallet()
        .then(() => {
          state.authProfile = window.NovaAuth.profile();
          renderPills();
        })
        .catch(() => {});
    }, 220);
  }

  function suitEntity(suit) {
    switch (suit) {
      case 'S':
        return '&spades;';
      case 'H':
        return '&hearts;';
      case 'D':
        return '&diams;';
      case 'C':
        return '&clubs;';
      default:
        return '';
    }
  }

  function suitTone(suit) {
    return suit === 'H' || suit === 'D' ? 'red' : 'black';
  }

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value || '').replace(/["\\]/g, '\\$&');
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
    state.statusMessage = message || '';
    renderStatus();
  }

  function renderStatus() {
    const base = state.snapshot?.status || '';
    ui.statusText.textContent = state.statusMessage || base || 'Host a table to create an invite link, or join with a room code to take the player spot.';
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.setupHidden, state.panels.setupHidden ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.infoHidden, state.panels.infoHidden ? '1' : '0');
  }

  function persistTableLayout() {
    try {
      localStorage.setItem(STORAGE_KEYS.tableLayout, JSON.stringify(state.tableDrag.positions || {}));
    } catch (error) {
      // Ignore layout persistence failures.
    }
  }

  function readTableLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.tableLayout) || '{}');
      state.tableDrag.positions = saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      state.tableDrag.positions = {};
    }
  }

  function setPanelHidden(key, hidden, persist) {
    state.panels[key] = Boolean(hidden);
    if (persist !== false) {
      persistSettings();
    }
    renderChrome();
  }

  function renderChrome() {
    ui.layoutShell.classList.toggle('setup-hidden', state.panels.setupHidden);
    ui.layoutShell.classList.toggle('info-hidden', state.panels.infoHidden);
    ui.toggleSetupBtn.textContent = state.panels.setupHidden ? 'Show setup' : 'Hide setup';
    ui.toggleInfoBtn.textContent = state.panels.infoHidden ? 'Show feed' : 'Hide feed';
    ui.toggleSetupBtn.setAttribute('aria-pressed', state.panels.setupHidden ? 'true' : 'false');
    ui.toggleInfoBtn.setAttribute('aria-pressed', state.panels.infoHidden ? 'true' : 'false');
  }

  function canSend() {
    return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
  }

  function sendMessage(payload) {
    if (!canSend()) {
      showToast('Reconnect to the table before sending an action.');
      return false;
    }
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function disconnectSocket() {
    if (!state.socket) {
      return;
    }
    const socket = state.socket;
    state.socket = null;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch (error) {
      // Ignore close failures.
    }
  }

  function inviteUrl() {
    if (state.mode !== 'online' || !state.roomCode) {
      return '';
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    if (state.serverUrl && state.serverUrl !== PROD_SERVER_URL && state.serverUrl !== defaultServerUrl()) {
      url.searchParams.set('server', state.serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    return url.toString();
  }

  function updateInviteUi() {
    const link = inviteUrl();
    ui.inviteInput.value = link;
    ui.copyBtn.disabled = !link;
    ui.copyCodeBtn.disabled = !(state.mode === 'online' && state.roomCode);
  }

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      showToast('AP Lounge bridge is not available.');
      return;
    }
    if (autoShare && !(state.mode === 'online' && state.roomCode)) {
      showToast('Host or join an online table before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: getPlayerName(),
      serverUrl: sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl || defaultServerUrl()),
      gameType: 'blackjack',
      roomCode: state.mode === 'online' ? state.roomCode : '',
      inviteUrl: state.mode === 'online' ? inviteUrl() : '',
      note: state.mode === 'online' && state.roomCode
        ? `Join my AP Blackjack SIM table in room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    showToast(autoShare ? 'Opening AP Lounge with your blackjack table ready to share.' : 'Opening AP Lounge in a new tab.');
  }

  function currentControls() {
    return state.snapshot?.controls || {
      canStartRound: false,
      canResetTable: false,
      canAdjustBet: false,
      canClearBet: false,
      canAct: false,
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      betPresets: [100, 500, 2500, 10000, -500],
    };
  }

  function getPlayerBySeat(seat) {
    if (!state.snapshot || !Array.isArray(state.snapshot.players)) {
      return null;
    }
    return state.snapshot.players.find((player) => player.seat === seat) || null;
  }

  function getViewerSeat() {
    if (!state.snapshot) {
      return null;
    }
    return Number.isInteger(state.snapshot.viewerSeat) ? state.snapshot.viewerSeat : null;
  }

  function getViewer() {
    const seat = getViewerSeat();
    return Number.isInteger(seat) ? getPlayerBySeat(seat) : null;
  }

  function getDisplayPlayer() {
    const viewer = getViewer();
    if (viewer) {
      return viewer;
    }
    const players = state.snapshot?.players || [];
    return players.find((player) => player.id === state.playerId) || players[0] || null;
  }

  function getActionPlayer() {
    if (!state.snapshot || !Number.isInteger(state.snapshot.actionSeat)) {
      return null;
    }
    return getPlayerBySeat(state.snapshot.actionSeat);
  }

  function canQuickSeatJoin() {
    return getViewerSeat() === null;
  }

  function phaseText(phase) {
    switch (phase) {
      case 'betting':
        return 'Betting';
      case 'player-turns':
        return 'Player turns';
      case 'dealer-turn':
        return 'Dealer turn';
      case 'settled':
        return 'Settled';
      default:
        return 'Waiting';
    }
  }

  function copyText(value, successMessage) {
    if (!value) {
      return;
    }
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showToast('Copy is not available in this browser.');
      return;
    }
    navigator.clipboard.writeText(value).then(() => {
      showToast(successMessage);
    }).catch(() => {
      showToast('Copy failed on this browser.');
    });
  }

  function cardMarkup(card, options) {
    const settings = options || {};
    const extraClass = settings.extraClass ? ` ${settings.extraClass}` : '';
    const animateClass = settings.animate ? ' animate-in' : '';
    const styleAttr = settings.style ? ` style="${settings.style}"` : '';
    const dragAttr = settings.dragId ? ` data-drag-id="${escapeAttr(settings.dragId)}"` : '';
    if (!card) {
      const hiddenClass = settings.dim ? ' hidden' : '';
      return `
        <div class="card back${hiddenClass}${extraClass}${animateClass}"${styleAttr}${dragAttr}>
          <div class="card-inner">
            <div class="card-back-face" aria-hidden="true">
              <span class="card-back-monogram">AP</span>
            </div>
          </div>
        </div>
      `;
    }
    const tone = suitTone(card.suit);
    const suit = suitEntity(card.suit);
    const pipMarks = Array.from({ length: 6 }, () => `<span>${suit}</span>`).join('');
    return `
      <div class="card ${tone}${extraClass}${animateClass}"${styleAttr}${dragAttr}>
        <div class="card-inner">
          <div class="card-back-face" aria-hidden="true">
            <span class="card-back-monogram">AP</span>
          </div>
          <div class="card-face">
            <div class="card-corner top">
              <span class="card-rank">${card.rank}</span>
              <span class="card-suit">${suit}</span>
            </div>
            <div class="card-center">
              <span class="card-center-rank">${card.rank}</span>
              <span class="card-center-suit">${suit}</span>
            </div>
            <div class="card-pip-cloud" aria-hidden="true">${pipMarks}</div>
            <div class="card-corner bottom">
              <span class="card-rank">${card.rank}</span>
              <span class="card-suit">${suit}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function seatCardStyle(index, total) {
    const centerOffset = (Math.max(total, 1) - 1) / 2;
    const relative = index - centerOffset;
    return `--fan-shift:${index === 0 ? 0 : -18}px;--card-tilt:${(relative * 5).toFixed(2)}deg;--card-lift:${Math.abs(relative * 3).toFixed(2)}px;`;
  }

  function dealerSignature() {
    if (!state.snapshot) {
      return 'empty';
    }
    return (state.snapshot.dealer?.cards || [])
      .map((card) => (card ? `${card.rank}${card.suit}` : 'XX'))
      .join('|');
  }

  function countVisibleCards(snapshot) {
    if (!snapshot) {
      return 0;
    }
    let count = (snapshot.dealer?.cards || []).filter(Boolean).length;
    for (const player of snapshot.players || []) {
      const hands = Array.isArray(player.hands) && player.hands.length
        ? player.hands
        : [{ cards: player.cards || [] }];
      for (const hand of hands) {
        count += (hand.cards || []).filter(Boolean).length;
      }
    }
    return count;
  }

  function animateShuffleCue() {
    const elements = [
      ui.shoeMeter,
      ui.discardMeter,
      document.querySelector('.table-felt'),
    ].filter(Boolean);
    for (const element of elements) {
      element.classList.remove('shuffling');
      window.requestAnimationFrame(() => {
        element.classList.add('shuffling');
        window.setTimeout(() => element.classList.remove('shuffling'), 760);
      });
    }
  }

  function cueShuffle() {
    const now = Date.now();
    if (now - state.audio.lastShuffleCueAt < 420) {
      return;
    }
    state.audio.lastShuffleCueAt = now;
    animateShuffleCue();
    if (state.audio.unlocked) {
      playSound('shuffle');
    }
  }

  function cueDealCards(count) {
    const cardCount = Math.max(0, Math.min(8, Math.round(Number(count) || 0)));
    if (!cardCount || !state.audio.unlocked) {
      return;
    }
    const now = Date.now();
    if (now - state.audio.lastDealCueAt < 70) {
      return;
    }
    state.audio.lastDealCueAt = now;
    for (let index = 0; index < cardCount; index += 1) {
      window.setTimeout(() => playSound('deal'), index * 76);
    }
  }

  function snapshotViewer(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) {
      return null;
    }
    return snapshot.players.find((player) => player.id === state.playerId) || snapshot.players[0] || null;
  }

  function playerOutcome(player) {
    if (!player) {
      return '';
    }
    const direct = String(player.lastOutcome || '').toLowerCase();
    if (direct === 'blackjack' || direct === 'win') {
      return 'win';
    }
    if (direct === 'push') {
      return 'push';
    }
    if (direct === 'lose') {
      return 'lose';
    }
    const resultText = [
      player.result,
      ...(Array.isArray(player.hands) ? player.hands.map((hand) => hand.result) : []),
    ].join(' ').toLowerCase();
    if (/blackjack|you beat|dealer busts|you win/.test(resultText)) {
      return 'win';
    }
    if (/push/.test(resultText)) {
      return 'push';
    }
    if (/dealer wins|bust|lose|dealer blackjack/.test(resultText)) {
      return 'lose';
    }
    return '';
  }

  function triggerOutcomeAnimation(outcome) {
    const tone = ['win', 'lose', 'push'].includes(outcome) ? outcome : '';
    if (!tone) {
      return;
    }
    const targets = [
      document.querySelector('.table-felt'),
      document.querySelector('.seat-card:not(.empty)'),
    ].filter(Boolean);
    for (const element of targets) {
      element.classList.remove('result-win', 'result-lose', 'result-push');
      window.requestAnimationFrame(() => {
        element.classList.add(`result-${tone}`);
        window.setTimeout(() => element.classList.remove(`result-${tone}`), 1500);
      });
    }
  }

  function cueOutcome(previousSnapshot, nextSnapshot) {
    if (!nextSnapshot || nextSnapshot.phase !== 'settled') {
      return;
    }
    const player = snapshotViewer(nextSnapshot);
    const outcome = playerOutcome(player);
    if (!outcome) {
      return;
    }
    const outcomeKey = `${nextSnapshot.roomCode || state.roomCode}|${nextSnapshot.handNumber || 0}|${player.id || 'table'}|${outcome}`;
    if (state.renderMemo.outcomeKey === outcomeKey && previousSnapshot?.phase === 'settled') {
      return;
    }
    state.renderMemo.outcomeKey = outcomeKey;
    window.setTimeout(() => {
      triggerOutcomeAnimation(outcome);
      if (state.audio.unlocked) {
        playSound(outcome);
      }
    }, 120);
  }

  function cueSnapshotSounds(previousSnapshot, nextSnapshot, message) {
    if (!previousSnapshot || !nextSnapshot) {
      state.renderMemo.visibleCardCount = countVisibleCards(nextSnapshot);
      return;
    }
    const previousCards = countVisibleCards(previousSnapshot);
    const nextCards = countVisibleCards(nextSnapshot);
    const previousShoe = Number(previousSnapshot.shoeRemaining);
    const nextShoe = Number(nextSnapshot.shoeRemaining);
    const tableMessage = `${message || ''} ${nextSnapshot.status || ''}`;
    const looksShuffled = /reshuff|shuffle|fresh shoe|reset/i.test(tableMessage) ||
      (Number.isFinite(previousShoe) && Number.isFinite(nextShoe) && nextShoe > previousShoe + 20);

    if (looksShuffled) {
      cueShuffle();
    }
    if (nextCards > previousCards) {
      cueDealCards(nextCards - previousCards);
    }
    cueOutcome(previousSnapshot, nextSnapshot);
    state.renderMemo.visibleCardCount = nextCards;
  }

  function renderDealer() {
    const signature = dealerSignature();
    const animate = signature !== state.renderMemo.dealerSignature;
    const cards = state.snapshot?.dealer?.cards || [];
    const rows = cards.length ? cards : [null, null];
    ui.dealerCards.innerHTML = rows.map((card, index) => cardMarkup(card, {
      animate: animate && Boolean(card),
      dragId: card ? `dealer:card:${index}` : '',
      style: `--deal-delay:${100 + index * 70}ms;`,
    })).join('');
    state.renderMemo.dealerSignature = signature;
  }

  function seatSignature(player) {
    if (!player) {
      return 'empty';
    }
    const hands = Array.isArray(player.hands) && player.hands.length
      ? player.hands.map((hand) => (
          `${hand.bet}:${hand.done ? 'done' : 'live'}:${(hand.cards || []).map((card) => (card ? `${card.rank}${card.suit}` : 'XX')).join(',')}`
        )).join('|')
      : (player.cards || []).map((card) => (card ? `${card.rank}${card.suit}` : 'XX')).join('|');
    return `${player.id}|${hands}|${player.stack}|${player.bet}|${player.activeBet}|${player.activeHandIndex}|${player.statusText}|${player.result}`;
  }

  function seatBadges(player, seat) {
    const badges = [];
    if (player.id === state.playerId) {
      badges.push('<span class="badge">You</span>');
    }
    if (state.snapshot?.actionSeat === seat && state.snapshot?.phase === 'player-turns') {
      badges.push('<span class="badge turn">Acting</span>');
    }
    if (player.blackjack) {
      badges.push('<span class="badge blackjack">Blackjack</span>');
    }
    if (player.busted) {
      badges.push('<span class="badge bust">Bust</span>');
    }
    if (player.leaving) {
      badges.push('<span class="badge">Leaving</span>');
    }
    return badges.join('');
  }

  function emptySeatMarkup() {
    const roomCode = sanitizeRoomCode(state.roomCode || ui.roomInput.value);
    const quickAction = canQuickSeatJoin() ? (roomCode ? 'join' : 'host') : '';
    const actionButton = quickAction
      ? `<button class="seat-join-button" type="button" data-seat-action="${quickAction}" data-drag-id="button:sit">Sit down</button>`
      : '';
    return `
      <div class="seat-card empty${quickAction ? ' joinable' : ''}">
        <div class="seat-play-area">
          <div class="seat-bet-circle empty-circle">
            <span></span>
          </div>
          <div class="hole-row">
            ${cardMarkup(null, { dim: true, extraClass: 'hole-card', style: seatCardStyle(0, 2) })}
            ${cardMarkup(null, { dim: true, extraClass: 'hole-card', style: seatCardStyle(1, 2) })}
          </div>
        </div>
        <div class="seat-footer">
          ${actionButton}
        </div>
      </div>
    `;
  }

  function renderHandCardRow(cards, animate, delayBase = 120, dragPrefix = '') {
    const seatCards = Array.isArray(cards) && cards.length ? cards : [null, null];
    return seatCards.map((card, index) => cardMarkup(card, {
      dim: !card,
      animate: animate && Boolean(card),
      extraClass: 'hole-card',
      dragId: card && dragPrefix ? `${dragPrefix}:card:${index}` : '',
      style: `${seatCardStyle(index, seatCards.length)}--deal-delay:${delayBase + index * 60}ms;`,
    })).join('');
  }

  function renderSeat(player) {
    if (!player) {
      return emptySeatMarkup();
    }

    const seat = Number.isInteger(player.seat) ? player.seat : 0;
    const classes = ['seat-card'];
    if (player.id === state.playerId) {
      classes.push('you');
    }
    if (state.snapshot?.actionSeat === seat && state.snapshot?.phase === 'player-turns') {
      classes.push('active');
    }

    const animate = state.renderMemo.seatSignatures.get(seat) !== seatSignature(player);
    const hands = Array.isArray(player.hands) && player.hands.length
      ? player.hands
      : [{
          cards: Array.isArray(player.cards) ? player.cards : [],
          bet: player.activeBet,
          scoreLabel: player.scoreLabel,
          done: player.done,
          busted: player.busted,
          blackjack: player.blackjack,
        }];
    const activeHandIndex = Number.isInteger(player.activeHandIndex) ? player.activeHandIndex : 0;
    const splitMode = hands.length > 1;
    const activeHand = hands[Math.max(0, Math.min(hands.length - 1, activeHandIndex))] || hands[0];
    const playerCards = Array.isArray(activeHand?.cards) ? activeHand.cards : [];
    const handRows = splitMode
      ? `<div class="split-hands">
          ${hands.map((hand, index) => {
            const splitClasses = ['split-hand'];
            if (index === activeHandIndex && state.snapshot?.actionSeat === seat && state.snapshot?.phase === 'player-turns') {
              splitClasses.push('active');
            }
            if (hand.done) {
              splitClasses.push('done');
            }
            if (hand.busted) {
              splitClasses.push('bust');
            }
            return `
              <div class="${splitClasses.join(' ')}">
                <div class="hole-row split-hole-row">
                  ${renderHandCardRow(hand.cards, animate, 110 + index * 90, `player:${seat}:hand:${index}`)}
                </div>
                <div class="split-hand-meta">
                  <span>H${index + 1} ${hand.scoreLabel || '-'}</span>
                  <strong>${formatChips(hand.bet || 0)}</strong>
                </div>
              </div>
            `;
          }).join('')}
        </div>`
      : `<div class="hole-row">${renderHandCardRow(playerCards, animate, 120, `player:${seat}:hand:${activeHandIndex}`)}</div>`;

    const betLine = player.activeBet > 0
      ? `${splitMode ? 'Total' : 'Live'} ${formatChips(player.activeBet)}`
      : `Next ${formatChips(player.bet)}`;
    const scoreLine = playerCards.length
      ? splitMode
        ? `Hand ${activeHandIndex + 1} ${activeHand?.scoreLabel || '-'}`
        : `Hand ${player.scoreLabel}`
      : 'Waiting';

    return `
      <div class="${classes.join(' ')}">
        <div class="seat-play-area">
          <div class="seat-bet-circle">
            <span></span>
          </div>
          ${handRows}
        </div>
        <div class="seat-footer">
          <div class="seat-totals">
            <div class="seat-score">${scoreLine}</div>
            <div class="seat-stack">${betLine}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSeats() {
    const nextSignatures = new Map();
    const player = getDisplayPlayer();
    if (player) {
      nextSignatures.set(Number.isInteger(player.seat) ? player.seat : 0, seatSignature(player));
    }
    ui.seatLayer.innerHTML = renderSeat(player);
    state.renderMemo.seatSignatures = nextSignatures;
  }

  function renderLog() {
    const entries = state.snapshot?.log || [];
    if (!entries.length) {
      ui.logList.innerHTML = '<div class="log-item"><span class="log-tag">Dealer</span><p>Sit down, set a SIM wager, and deal when ready.</p></div>';
      return;
    }
    ui.logList.innerHTML = [...entries].reverse().map((entry) => {
      const tone = ['good', 'warn', 'bad'].includes(entry.tone) ? entry.tone : 'info';
      const tag = tone === 'good' ? 'Win' : tone === 'warn' ? 'Table' : tone === 'bad' ? 'Alert' : 'Dealer';
      return `
        <div class="log-item ${tone}">
          <span class="log-tag">${tag}</span>
          <p>${entry.text}</p>
        </div>
      `;
    }).join('');
  }

  function pulseMeter(element) {
    if (!element) {
      return;
    }
    element.classList.remove('dealing');
    window.requestAnimationFrame(() => {
      element.classList.add('dealing');
      window.setTimeout(() => element.classList.remove('dealing'), 420);
    });
  }

  function formatMeterPercent(ratio) {
    const bounded = Math.max(0, Math.min(1, Number.isFinite(Number(ratio)) ? Number(ratio) : 0));
    return `${Math.round(bounded * 100)}%`;
  }

  function renderShoeMeters(snapshot) {
    const total = Math.max(1, Number(snapshot?.shoeCardCount) || 312);
    const remainingRaw = Number(snapshot?.shoeRemaining);
    const discardRaw = Number(snapshot?.discardCount);
    const remaining = Math.max(0, Math.min(total, Number.isFinite(remainingRaw) ? remainingRaw : total));
    const discard = Math.max(0, Math.min(total, Number.isFinite(discardRaw) ? discardRaw : 0));
    const shoeFill = remaining / total;
    const discardFill = discard / total;
    const shoePercent = formatMeterPercent(shoeFill);
    const discardPercent = formatMeterPercent(discardFill);

    if (ui.shoeMeter) {
      ui.shoeMeter.style.setProperty('--fill', shoeFill.toFixed(4));
      ui.shoeMeter.style.setProperty('--cards-left', String(remaining));
      ui.shoeMeter.dataset.percent = shoePercent;
      ui.shoeMeter.title = `Shoe: ${remaining} of ${total} cards remain`;
      ui.shoeMeter.setAttribute('aria-label', ui.shoeMeter.title);
      const label = ui.shoeMeter.querySelector('span');
      if (label) {
        label.innerHTML = `<strong>${shoePercent}</strong><small>Shoe left</small>`;
      }
      if (state.renderMemo.shoeRemaining !== null && state.renderMemo.shoeRemaining !== remaining) {
        pulseMeter(ui.shoeMeter);
      }
    }

    if (ui.discardMeter) {
      ui.discardMeter.style.setProperty('--fill', discardFill.toFixed(4));
      ui.discardMeter.style.setProperty('--cards-used', String(discard));
      ui.discardMeter.dataset.percent = discardPercent;
      ui.discardMeter.title = `Discard: ${discard} of ${total} cards`;
      ui.discardMeter.setAttribute('aria-label', ui.discardMeter.title);
      const label = ui.discardMeter.querySelector('span');
      if (label) {
        label.innerHTML = `<strong>${discardPercent}</strong><small>Discard</small>`;
      }
      if (state.renderMemo.discardCount !== null && state.renderMemo.discardCount !== discard) {
        pulseMeter(ui.discardMeter);
      }
    }

    state.renderMemo.shoeRemaining = remaining;
    state.renderMemo.discardCount = discard;
  }

  function renderCountMeter(snapshot) {
    if (!ui.countMeter) {
      return;
    }
    const info = snapshot?.countInfo || {};
    const runningCount = Math.round(Number(info.runningCount) || 0);
    const trueCount = Number.isFinite(Number(info.trueCount)) ? Number(info.trueCount) : 0;
    ui.runningCountLabel.textContent = runningCount > 0 ? `+${runningCount}` : String(runningCount);
    ui.trueCountLabel.textContent = trueCount > 0 ? `+${trueCount.toFixed(1)}` : trueCount.toFixed(1);
    ui.countMeter.dataset.tone = runningCount > 0 ? 'positive' : runningCount < 0 ? 'negative' : 'neutral';
    ui.countMeter.title = 'Hi-Lo running count since shuffle and true count adjusted by current shoe depth.';
  }

  function renderSummary() {
    const snapshot = state.snapshot;
    const actor = getActionPlayer();
    const viewer = getViewer();
    renderShoeMeters(snapshot);
    renderCountMeter(snapshot);

    if (!snapshot) {
      ui.roomCodeLabel.textContent = state.roomCode || '-';
      ui.phaseLabel.textContent = 'Waiting';
      ui.tableBetLabel.textContent = formatChips(0);
      ui.shoeLabel.textContent = '6 decks / 25% cut';
      ui.tableHeadline.textContent = 'AP Blackjack Live';
      ui.tableSubline.textContent = 'Sit down, set a SIM wager, and deal when ready.';
      ui.dealerScoreLabel.textContent = '?';
      ui.handLabel.textContent = '0';
      ui.tableBetAmount.textContent = formatChips(0);
      ui.turnLabel.textContent = 'Sit down';
      return;
    }

    ui.roomCodeLabel.textContent = state.roomCode || snapshot.roomCode || '-';
    ui.phaseLabel.textContent = phaseText(snapshot.phase);
    ui.tableBetLabel.textContent = formatChips(snapshot.tableBetTotal || 0);
    const shoeTotal = Math.max(1, Number(snapshot.shoeCardCount) || 312);
    const shoeLeft = Math.max(0, Math.min(shoeTotal, Number(snapshot.shoeRemaining) || 0));
    ui.shoeLabel.textContent = `${formatMeterPercent(shoeLeft / shoeTotal)} shoe${snapshot.shufflePending ? ' - shuffle next' : ''}`;
    ui.tableHeadline.textContent = snapshot.handNumber
      ? `Hand ${snapshot.handNumber} live`
      : 'AP Blackjack Live';
    ui.tableSubline.textContent = snapshot.status || 'Sit down and deal.';
    ui.dealerScoreLabel.textContent = snapshot.dealer?.scoreLabel || '?';
    ui.handLabel.textContent = String(snapshot.handNumber || 0);
    ui.tableBetAmount.textContent = formatChips(snapshot.tableBetTotal || 0);
    ui.turnLabel.textContent = actor
      ? `${actor.name} to act`
      : snapshot.phase === 'settled'
        ? 'Payouts settled'
        : snapshot.phase === 'dealer-turn'
          ? 'Dealer playing'
          : getDisplayPlayer()
            ? 'Player seated'
            : 'Sit down';
  }

  function renderPills() {
    if (state.mode === 'online' && state.socket && state.socket.readyState === WebSocket.OPEN) {
      ui.networkStatus.dataset.tone = 'online';
      ui.networkStatus.textContent = 'Online';
    } else if (state.mode === 'online' && state.socket && state.socket.readyState === WebSocket.CONNECTING) {
      ui.networkStatus.dataset.tone = 'busy';
      ui.networkStatus.textContent = 'Connecting';
    } else if (state.mode === 'online') {
      ui.networkStatus.dataset.tone = 'offline';
      ui.networkStatus.textContent = 'Disconnected';
    } else {
      ui.networkStatus.dataset.tone = 'offline';
      ui.networkStatus.textContent = 'Offline';
    }

    if (state.mode === 'online') {
      ui.modePill.textContent = state.roomCode ? `Live table ${state.roomCode}` : 'Online setup';
    } else {
      ui.modePill.textContent = 'No table connected';
    }

    const profile = authProfile();
    const wallet = profile.simWallet || {};
    if (!ui.walletStatus) {
      return;
    }
    if (!profile.ready) {
      ui.walletStatus.dataset.tone = 'busy';
      ui.walletStatus.textContent = 'SIM wallet loading';
    } else if (!profile.signedIn) {
      ui.walletStatus.dataset.tone = 'offline';
      ui.walletStatus.textContent = 'Sign in for SIM';
    } else if (wallet.error) {
      ui.walletStatus.dataset.tone = 'offline';
      ui.walletStatus.textContent = 'SIM wallet unavailable';
    } else {
      ui.walletStatus.dataset.tone = 'online';
      ui.walletStatus.textContent = `Wallet ${formatChips(wallet.balanceCents ?? 0)}`;
    }
  }

  function renderActionPrompt() {
    ui.actionPrompt.textContent = '';
  }

  function renderChips() {
    const controls = currentControls();
    const presets = controls.betPresets || [100, 500, 2500, 10000, -500];
    const signature = presets.join('|');
    if (signature === state.renderMemo.chipSignature && ui.chipRow.children.length) {
      return;
    }
    state.renderMemo.chipSignature = signature;
    ui.chipRow.innerHTML = presets.map((amount) => {
      const sign = amount > 0 ? '+' : '';
      const className = amount < 0 ? 'chip-btn minus' : 'chip-btn';
      return `<button class="${className}" type="button" data-chip-amount="${amount}" data-drag-id="chip:${amount}">${sign}${formatChips(Math.abs(amount))}</button>`;
    }).join('');
  }

  function setTableButtonAvailable(button, available) {
    if (!button) {
      return;
    }
    button.disabled = false;
    button.setAttribute('aria-disabled', available ? 'false' : 'true');
    button.classList.toggle('control-disabled', !available);
  }

  function renderControls() {
    const controls = currentControls();
    const pendingConnection = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    const connected = canSend();
    const canJoin = Boolean(sanitizeRoomCode(ui.roomInput.value));

    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !canJoin;
    ui.shareLoungeBtn.disabled = !(connected && state.mode === 'online' && state.roomCode);
    setTableButtonAvailable(ui.dealBtn, connected && controls.canStartRound);
    setTableButtonAvailable(ui.hitBtn, connected && controls.canHit);
    setTableButtonAvailable(ui.standBtn, connected && controls.canStand);
    setTableButtonAvailable(ui.doubleBtn, connected && controls.canDouble);
    setTableButtonAvailable(ui.splitBtn, connected && controls.canSplit);
    setTableButtonAvailable(ui.resetTableBtn, connected && controls.canResetTable);

    renderActionPrompt();
    renderChips();
  }

  function dragPieces() {
    return Array.from(document.querySelectorAll('.table-felt [data-drag-id]'));
  }

  function applyDragPosition(element, position) {
    const x = Math.round(Number(position?.x) || 0);
    const y = Math.round(Number(position?.y) || 0);
    element.style.setProperty('--drag-x', `${x}px`);
    element.style.setProperty('--drag-y', `${y}px`);
    element.classList.toggle('is-moved', Boolean(x || y));
  }

  function createCardDragGhost(element) {
    const rect = element.getBoundingClientRect();
    const ghost = element.cloneNode(true);
    ghost.classList.add('card-drag-ghost');
    ghost.classList.remove('dragging');
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    element.classList.add('drag-source-anchored');
    return { ghost, rect };
  }

  function clampGhostDelta(startRect, dx, dy) {
    const table = document.querySelector('.table-felt');
    if (!table || !startRect) {
      return { dx, dy };
    }
    const pad = 8;
    const tableRect = table.getBoundingClientRect();
    let nextDx = dx;
    let nextDy = dy;
    if (startRect.left + nextDx < tableRect.left + pad) {
      nextDx += tableRect.left + pad - (startRect.left + nextDx);
    }
    if (startRect.right + nextDx > tableRect.right - pad) {
      nextDx -= (startRect.right + nextDx) - (tableRect.right - pad);
    }
    if (startRect.top + nextDy < tableRect.top + pad) {
      nextDy += tableRect.top + pad - (startRect.top + nextDy);
    }
    if (startRect.bottom + nextDy > tableRect.bottom - pad) {
      nextDy -= (startRect.bottom + nextDy) - (tableRect.bottom - pad);
    }
    return { dx: nextDx, dy: nextDy };
  }

  function updateDragVelocity(drag, event) {
    const now = performance.now();
    const elapsed = Math.max(16, now - (drag.lastTime || now));
    drag.velocityX = ((event.clientX - drag.lastX) / elapsed) * 1000;
    drag.velocityY = ((event.clientY - drag.lastY) / elapsed) * 1000;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
  }

  function shouldChuckCard(drag) {
    if (!drag?.isCard || !drag.moved || !drag.ghost) {
      return false;
    }
    const position = state.tableDrag.positions[drag.id] || { x: drag.baseX, y: drag.baseY };
    const dx = Math.round(Number(position.x) || 0) - drag.baseX;
    const dy = Math.round(Number(position.y) || 0) - drag.baseY;
    const speed = Math.hypot(drag.velocityX || 0, drag.velocityY || 0);
    return speed > 760 && (drag.velocityY < -220 || dy < -58 || Math.hypot(dx, dy) > 150);
  }

  function animateCardChuck(drag) {
    const ghost = drag?.ghost;
    if (!ghost) {
      return;
    }
    const currentRect = ghost.getBoundingClientRect();
    const dealerTarget = document.querySelector('.dealer-row') ||
      document.querySelector('.dealer-zone') ||
      document.querySelector('.table-felt');
    const dealerRect = dealerTarget?.getBoundingClientRect();
    const startCenterX = currentRect.left + currentRect.width / 2;
    const startCenterY = currentRect.top + currentRect.height / 2;
    const targetCenterX = dealerRect
      ? dealerRect.left + dealerRect.width / 2 + Math.max(-26, Math.min(26, (drag.velocityX || 0) * 0.018))
      : startCenterX;
    const targetCenterY = dealerRect
      ? dealerRect.top + Math.min(dealerRect.height * 0.58, currentRect.height * 0.7)
      : startCenterY - 160;
    const targetX = targetCenterX - startCenterX;
    const targetY = targetCenterY - startCenterY;
    const spin = Math.max(-42, Math.min(42, (drag.velocityX || 0) * 0.04));
    const arcY = targetY - Math.min(150, Math.max(72, Math.abs(targetY) * 0.45));
    const bounceX = Math.max(-18, Math.min(18, (drag.velocityX || 0) * 0.012));

    ghost.classList.add('card-chuck-ghost');
    ghost.style.left = `${currentRect.left}px`;
    ghost.style.top = `${currentRect.top}px`;
    ghost.style.width = `${currentRect.width}px`;
    ghost.style.height = `${currentRect.height}px`;
    ghost.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1.045)';

    const dealerZone = document.querySelector('.dealer-zone');
    dealerZone?.classList.add('card-impact');
    window.setTimeout(() => dealerZone?.classList.remove('card-impact'), 820);

    if (typeof ghost.animate === 'function') {
      const animation = ghost.animate([
        { transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1.045)', offset: 0 },
        { transform: `translate3d(${targetX * 0.52}px, ${arcY}px, 0) rotate(${spin * 0.7}deg) scale(1.08)`, offset: 0.52 },
        { transform: `translate3d(${targetX}px, ${targetY}px, 0) rotate(${spin + 12}deg) scale(0.96)`, offset: 0.78 },
        { transform: `translate3d(${targetX + bounceX}px, ${targetY - 20}px, 0) rotate(${spin - 8}deg) scale(0.99)`, offset: 0.9 },
        { transform: `translate3d(${targetX + bounceX * 0.25}px, ${targetY + 2}px, 0) rotate(${spin}deg) scale(0.94)`, offset: 1 },
      ], {
        duration: 780,
        easing: 'cubic-bezier(0.16, 0.86, 0.2, 1)',
        fill: 'forwards',
      });
      animation.onfinish = () => ghost.remove();
    } else {
      ghost.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) rotate(${spin}deg) scale(0.94)`;
      window.setTimeout(() => ghost.remove(), 820);
    }
    playSound('throw');
  }

  function clampDragPosition(element, position) {
    const table = document.querySelector('.table-felt');
    if (!table || !element) {
      return position;
    }
    const next = {
      x: Math.round(Number(position?.x) || 0),
      y: Math.round(Number(position?.y) || 0),
    };
    applyDragPosition(element, next);
    const pad = 8;
    const tableRect = table.getBoundingClientRect();
    let rect = element.getBoundingClientRect();
    if (rect.left < tableRect.left + pad) {
      next.x += tableRect.left + pad - rect.left;
    }
    if (rect.right > tableRect.right - pad) {
      next.x -= rect.right - (tableRect.right - pad);
    }
    if (rect.top < tableRect.top + pad) {
      next.y += tableRect.top + pad - rect.top;
    }
    if (rect.bottom > tableRect.bottom - pad) {
      next.y -= rect.bottom - (tableRect.bottom - pad);
    }
    applyDragPosition(element, next);
    return next;
  }

  function rectsOverlap(left, right, gap = 0) {
    return !(
      left.right + gap <= right.left ||
      left.left >= right.right + gap ||
      left.bottom + gap <= right.top ||
      left.top >= right.bottom + gap
    );
  }

  function hasDragCollision(element) {
    const rect = element.getBoundingClientRect();
    return dragPieces().some((piece) => (
      piece !== element &&
      piece.offsetParent !== null &&
      rectsOverlap(rect, piece.getBoundingClientRect(), DRAG_COLLISION_GAP_PX)
    ));
  }

  function findNearbyOpenDragPosition(element, position) {
    const origin = {
      x: Math.round(Number(position?.x) || 0),
      y: Math.round(Number(position?.y) || 0),
    };
    for (let radius = 18; radius <= 280; radius += 18) {
      for (let angle = 0; angle < 360; angle += 30) {
        const radians = angle * Math.PI / 180;
        const candidate = clampDragPosition(element, {
          x: origin.x + Math.cos(radians) * radius,
          y: origin.y + Math.sin(radians) * radius,
        });
        if (!hasDragCollision(element)) {
          return candidate;
        }
      }
    }
    return clampDragPosition(element, origin);
  }

  function resolveDragOverlaps(element, position) {
    let next = clampDragPosition(element, position);
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const rect = element.getBoundingClientRect();
      const other = dragPieces().find((piece) => (
        piece !== element &&
        piece.offsetParent !== null &&
        rectsOverlap(rect, piece.getBoundingClientRect(), DRAG_COLLISION_GAP_PX)
      ));
      if (!other) {
        break;
      }
      const otherRect = other.getBoundingClientRect();
      const overlapX = Math.min(rect.right, otherRect.right) - Math.max(rect.left, otherRect.left);
      const overlapY = Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top);
      const pushRight = rect.left + rect.width / 2 >= otherRect.left + otherRect.width / 2;
      const pushDown = rect.top + rect.height / 2 >= otherRect.top + otherRect.height / 2;
      if (overlapX <= overlapY) {
        next.x += (pushRight ? 1 : -1) * (overlapX + DRAG_COLLISION_GAP_PX);
      } else {
        next.y += (pushDown ? 1 : -1) * (overlapY + DRAG_COLLISION_GAP_PX);
      }
      next = clampDragPosition(element, next);
    }
    if (hasDragCollision(element)) {
      next = findNearbyOpenDragPosition(element, next);
    }
    return next;
  }

  function applyTableDragPositions() {
    for (const element of dragPieces()) {
      const id = element.dataset.dragId;
      if (!id) {
        continue;
      }
      element.classList.add('drag-piece');
      applyDragPosition(element, state.tableDrag.positions[id] || { x: 0, y: 0 });
    }
  }

  function beginTableDrag(event) {
    const element = event.target.closest('.table-felt [data-drag-id]');
    if (!element || event.button !== 0) {
      return false;
    }
    const id = element.dataset.dragId;
    const saved = state.tableDrag.positions[id] || { x: 0, y: 0 };
    state.tableDrag.active = {
      id,
      element,
      surface: element.closest('.table-props, .dealer-zone, .seat-layer, .felt-actions'),
      isCard: element.classList.contains('card'),
      ghost: null,
      ghostStartRect: null,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
      baseX: Math.round(Number(saved.x) || 0),
      baseY: Math.round(Number(saved.y) || 0),
      moved: false,
    };
    state.tableDrag.active.surface?.classList.add('drag-surface-active');
    element.setPointerCapture?.(event.pointerId);
    return true;
  }

  function moveTableDrag(event) {
    const drag = state.tableDrag.active;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    updateDragVelocity(drag, event);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      if (drag.isCard) {
        const cardGhost = createCardDragGhost(drag.element);
        drag.ghost = cardGhost.ghost;
        drag.ghostStartRect = cardGhost.rect;
      } else {
        drag.element.classList.add('dragging');
      }
      drag.ghost?.classList.add('dragging');
      document.body.classList.add('dragging-table-piece');
      unlockAudio();
    }
    event.preventDefault();
    if (drag.ghost) {
      const clamped = clampGhostDelta(drag.ghostStartRect, dx, dy);
      drag.ghost.style.transform = `translate3d(${clamped.dx}px, ${clamped.dy}px, 0) scale(1.045)`;
      state.tableDrag.positions[drag.id] = {
        x: drag.baseX + clamped.dx,
        y: drag.baseY + clamped.dy,
      };
      return;
    }
    const next = clampDragPosition(drag.element, {
      x: drag.baseX + dx,
      y: drag.baseY + dy,
    });
    state.tableDrag.positions[drag.id] = next;
  }

  function endTableDrag(event) {
    const drag = state.tableDrag.active;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.element.releasePointerCapture?.(event.pointerId);
    const target = document.querySelector(`.table-felt [data-drag-id="${cssEscape(drag.id)}"]`) || drag.element;
    if (drag.moved) {
      if (shouldChuckCard(drag)) {
        const originalPosition = { x: drag.baseX, y: drag.baseY };
        state.tableDrag.positions[drag.id] = originalPosition;
        applyDragPosition(target, originalPosition);
        animateCardChuck(drag);
        drag.ghost = null;
      } else {
        const finalPosition = resolveDragOverlaps(
          target,
          state.tableDrag.positions[drag.id] || { x: drag.baseX, y: drag.baseY }
        );
        state.tableDrag.positions[drag.id] = finalPosition;
        applyDragPosition(target, finalPosition);
        playSound('click');
      }
      persistTableLayout();
      state.tableDrag.suppressClickUntil = Date.now() + 450;
    }
    drag.element.classList.remove('dragging');
    drag.element.classList.remove('drag-source-anchored');
    target.classList.remove('dragging', 'drag-source-anchored');
    drag.ghost?.remove();
    drag.surface?.classList.remove('drag-surface-active');
    document.body.classList.remove('dragging-table-piece');
    state.tableDrag.active = null;
  }

  function render() {
    renderChrome();
    renderPills();
    renderStatus();
    updateInviteUi();
    renderSummary();
    renderDealer();
    renderSeats();
    renderLog();
    renderControls();
    applyTableDragPositions();
  }

  async function connectOnline(mode, options = {}) {
    if (!signedInForSim(mode === 'host' ? 'host SIM blackjack' : 'join SIM blackjack')) {
      return;
    }
    const name = getPlayerName();
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (mode === 'join' && !roomCode) {
      showToast('Enter the room code from the host first.');
      return;
    }

    let authPayload;
    try {
      authPayload = await authPayloadForTable();
    } catch (error) {
      const message = error.message || 'Sign in to use your SIM wallet.';
      setStatusMessage(message);
      showToast(message);
      render();
      return;
    }

    disconnectSocket();
    state.mode = 'online';
    state.snapshot = null;
    state.playerId = '';
    state.roomCode = roomCode;
    state.serverUrl = productionSafeServerUrl(ui.serverUrlInput.value);
    ui.serverUrlInput.value = state.serverUrl;
    if (!state.panels.setupHidden) {
      state.panels.setupHidden = true;
    }
    if (!state.panels.infoHidden) {
      state.panels.infoHidden = true;
    }
    if (!ui.nameInput.value.trim() && state.authProfile?.displayName) {
      ui.nameInput.value = state.authProfile.displayName.slice(0, 18);
    }
    persistSettings();
    setStatusMessage(mode === 'host'
      ? 'Opening your SIM blackjack table and creating an invite link...'
      : 'Joining the SIM blackjack table and syncing the felt...');
    render();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        action: 'join',
        game: 'blackjack',
        mode,
        name,
        roomCode,
        ...authPayload,
      }));
      render();
    };

    socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (payload.type === 'welcome') {
        state.playerId = payload.playerId;
        state.roomCode = payload.roomCode || state.roomCode;
        ui.roomInput.value = state.roomCode;
        setStatusMessage('You are seated. Share the invite link and deal once the table is ready.');
        refreshWalletSoon();
        render();
        return;
      }

      if (payload.type === 'state') {
        const previousPhase = state.snapshot?.phase;
        const previousSnapshot = state.snapshot;
        cueSnapshotSounds(previousSnapshot, payload.snapshot, payload.message);
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode;
        ui.roomInput.value = payload.snapshot.roomCode;
        setStatusMessage(payload.message || payload.snapshot.status || 'Table updated.');
        persistSettings();
        if (payload.snapshot.phase !== previousPhase || payload.message) {
          refreshWalletSoon();
        }
        render();
        return;
      }

      if (payload.type === 'error') {
        const message = payload.message || 'That blackjack action could not be completed.';
        if (
          !options.retriedCanonicalServer
          && /account sign-in is not configured/i.test(message)
          && state.serverUrl !== canonicalServerUrl()
        ) {
          state.serverUrl = canonicalServerUrl();
          ui.serverUrlInput.value = state.serverUrl;
          persistSettings();
          disconnectSocket();
          setStatusMessage('Switching blackjack to the current SIM server and trying again...');
          showToast('Switching to the current SIM server...');
          connectOnline(mode, { retriedCanonicalServer: true }).catch(() => {
            showToast('Could not reconnect to the current SIM blackjack server.');
          });
          return;
        }
        setStatusMessage(message);
        showToast(message);
        render();
      }
    };

    socket.onclose = () => {
      if (state.socket === socket) {
        state.socket = null;
        setStatusMessage('The SIM blackjack table disconnected. Host again or rejoin the same room code to continue.');
        render();
      }
    };

    socket.onerror = () => {
      if (state.socket === socket) {
        setStatusMessage('The blackjack connection hit an error. Check the server URL and try again.');
        render();
      }
    };
  }

  function sendSetBet(amount, mode) {
    if (sendMessage({ action: 'set-bet', amount, mode })) {
      setStatusMessage(amount < 0 ? 'Pulling chips back from the betting circle...' : 'Sending your next SIM wager to the table...');
    }
  }

  function sendDeal() {
    if (!currentControls().canStartRound) {
      showToast('Deal is not available yet.');
      return;
    }
    if (sendMessage({ action: 'start-hand' })) {
      setStatusMessage('Dealer is putting the next round in motion...');
    }
  }

  function sendAction(type) {
    const controls = currentControls();
    const allowed = {
      hit: controls.canHit,
      stand: controls.canStand,
      double: controls.canDouble,
      split: controls.canSplit,
    };
    if (!allowed[type]) {
      showToast(`${type.charAt(0).toUpperCase()}${type.slice(1)} is not available right now.`);
      return;
    }
    if (sendMessage({ action: 'act', type })) {
      setStatusMessage(`Sending ${type} to the dealer...`);
    }
  }

  function animateChipPlacement(trigger) {
    if (!trigger || trigger.classList.contains('minus')) {
      return;
    }
    const target = document.querySelector('.seat-bet-circle:not(.empty-circle)') ||
      document.querySelector('.seat-bet-circle') ||
      ui.chipRow;
    if (!target) {
      return;
    }

    const from = trigger.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'chip-flight';
    ghost.textContent = trigger.textContent.trim().replace(/^\+/, '');
    ghost.style.left = `${from.left + from.width / 2}px`;
    ghost.style.top = `${from.top + from.height / 2}px`;
    document.body.appendChild(ghost);

    target.classList.add('chip-catch');
    window.setTimeout(() => target.classList.remove('chip-catch'), 360);

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    window.requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.72) rotate(18deg)`;
      ghost.style.opacity = '0';
    });
    ghost.addEventListener('transitionend', () => ghost.remove(), { once: true });
    window.setTimeout(() => ghost.remove(), 900);
  }

  function sendResetTable() {
    if (!currentControls().canResetTable) {
      showToast('Reset is not available yet.');
      return;
    }
    if (sendMessage({ action: 'restart' })) {
      setStatusMessage('Refreshing SIM balances and loading a fresh shoe...');
      cueShuffle();
    }
  }

  async function handleSeatJoinRequest() {
    if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {
      showToast('Connection already in progress.');
      return;
    }
    if (state.mode === 'online' && getViewerSeat() !== null) {
      showToast('You are already seated at this table.');
      return;
    }

    const roomCode = sanitizeRoomCode(state.roomCode || ui.roomInput.value);
    if (roomCode) {
      ui.roomInput.value = roomCode;
      await connectOnline('join');
      return;
    }
    await connectOnline('host');
  }

  function hydrateSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = productionSafeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    ui.serverUrlInput.value = state.serverUrl;
    state.panels.setupHidden = true;
    state.panels.infoHidden = true;
    readTableLayout();
  }

  function bootFromQuery() {
    const roomCode = sanitizeRoomCode(query.get('room') || '');
    if (roomCode) {
      ui.roomInput.value = roomCode;
      connectOnline('join').catch(() => {
        showToast('Could not join the SIM blackjack table.');
      });
      return;
    }
    renderStatus();
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      if (Date.now() > state.tableDrag.suppressClickUntil) {
        return;
      }
      if (!event.target.closest('[data-drag-id]')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);

    document.addEventListener('pointerdown', (event) => {
      beginTableDrag(event);
      const button = event.target.closest('button');
      if (!button || button.disabled) {
        return;
      }
      unlockAudio();
      button.classList.add('is-pressing');
      window.setTimeout(() => button.classList.remove('is-pressing'), 180);
      if (!button.classList.contains('chip-btn')) {
        playSound('click');
      }
    });

    document.addEventListener('pointermove', moveTableDrag);
    document.addEventListener('pointerup', endTableDrag);
    document.addEventListener('pointercancel', endTableDrag);

    ui.nameInput.addEventListener('input', () => {
      persistSettings();
      render();
    });

    ui.roomInput.addEventListener('input', () => {
      ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
      renderControls();
    });

    ui.serverUrlInput.addEventListener('change', () => {
      state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
      ui.serverUrlInput.value = state.serverUrl;
      persistSettings();
      updateInviteUi();
    });

    ui.hostBtn.addEventListener('click', () => {
      connectOnline('host').catch(() => showToast('Could not host the SIM blackjack table.'));
    });
    ui.joinBtn.addEventListener('click', () => {
      connectOnline('join').catch(() => showToast('Could not join the SIM blackjack table.'));
    });
    ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
    ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.toggleSetupBtn.addEventListener('click', () => setPanelHidden('setupHidden', !state.panels.setupHidden));
    ui.toggleInfoBtn.addEventListener('click', () => setPanelHidden('infoHidden', !state.panels.infoHidden));
    ui.dealBtn.addEventListener('click', sendDeal);
    ui.hitBtn.addEventListener('click', () => sendAction('hit'));
    ui.standBtn.addEventListener('click', () => sendAction('stand'));
    ui.doubleBtn.addEventListener('click', () => sendAction('double'));
    ui.splitBtn.addEventListener('click', () => sendAction('split'));
    ui.resetTableBtn.addEventListener('click', sendResetTable);

    ui.chipRow.addEventListener('click', (event) => {
      if (Date.now() <= state.tableDrag.suppressClickUntil) {
        return;
      }
      const trigger = event.target.closest('[data-chip-amount]');
      if (!trigger) {
        return;
      }
      const amount = Number(trigger.getAttribute('data-chip-amount') || 0);
      if (amount > 0) {
        playSound('chip');
        animateChipPlacement(trigger);
      } else {
        playSound('click');
      }
      sendSetBet(amount);
    });

    ui.seatLayer.addEventListener('click', (event) => {
      if (Date.now() <= state.tableDrag.suppressClickUntil) {
        return;
      }
      const trigger = event.target.closest('[data-seat-action]');
      if (!trigger) {
        return;
      }
      handleSeatJoinRequest().catch(() => showToast('Could not sit at the SIM blackjack table.'));
    });

    window.addEventListener('keydown', (event) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'h') {
        sendAction('hit');
      } else if (key === 's') {
        sendAction('stand');
      } else if (key === 'd') {
        sendAction('double');
      } else if (key === 'p') {
        sendAction('split');
      }
    });
  }

  async function initAuth() {
    if (!window.NovaAuth || typeof window.NovaAuth.init !== 'function') {
      return;
    }
    try {
      await window.NovaAuth.init({
        onChange(profile) {
          state.authProfile = profile;
          if (!ui.nameInput.value.trim() && profile.signedIn && profile.displayName) {
            ui.nameInput.value = profile.displayName.slice(0, 18);
            persistSettings();
          }
          render();
        },
      });
      state.authProfile = window.NovaAuth.profile();
      if (!ui.nameInput.value.trim() && state.authProfile.signedIn && state.authProfile.displayName) {
        ui.nameInput.value = state.authProfile.displayName.slice(0, 18);
        persistSettings();
      }
    } catch (error) {
      state.authProfile = window.NovaAuth.profile();
      setStatusMessage(error.message || 'SIM wallet sign-in is not ready yet.');
    }
  }

  function init() {
    hydrateSettings();
    bindEvents();
    render();
    initAuth().then(() => {
      render();
      bootFromQuery();
    });
  }

  init();
})();
