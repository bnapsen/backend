(() => {
  'use strict';

  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const STORAGE_KEYS = {
    name: 'orbitHoldemLive.name',
    serverUrl: 'orbitHoldemLive.serverUrl',
    setupHidden: 'orbitHoldemLive.setupHidden',
    infoHidden: 'orbitHoldemLive.infoHidden',
    soundEnabled: 'orbitHoldemLive.soundEnabled',
  };
  const query = new URLSearchParams(window.location.search);
  const DEFAULT_MAX_SEATS = 10;
  const SOLO_BOT_TARGET = 6;

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    playerId: '',
    roomCode: '',
    serverUrl: '',
    statusMessage: '',
    toastTimer: 0,
    panels: {
      setupHidden: false,
      infoHidden: false,
    },
    pendingSoloLaunch: false,
    audio: {
      enabled: true,
      ctx: null,
      master: null,
      noiseBuffer: null,
    },
    renderMemo: {
      communitySignature: '',
      seatSignatures: new Map(),
    },
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    modePill: document.getElementById('modePill'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    stageLabel: document.getElementById('stageLabel'),
    potLabel: document.getElementById('potLabel'),
    turnLabel: document.getElementById('turnLabel'),
    boardHeadline: document.getElementById('boardHeadline'),
    boardSubline: document.getElementById('boardSubline'),
    potAmount: document.getElementById('potAmount'),
    betAmount: document.getElementById('betAmount'),
    communityRow: document.getElementById('communityRow'),
    seatLayer: document.getElementById('seatLayer'),
    actionPrompt: document.getElementById('actionPrompt'),
    logList: document.getElementById('logList'),
    soloBtn: document.getElementById('soloBtn'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleInfoBtn: document.getElementById('toggleInfoBtn'),
    fillBotsBtn: document.getElementById('fillBotsBtn'),
    clearBotsBtn: document.getElementById('clearBotsBtn'),
    startHandBtn: document.getElementById('startHandBtn'),
    resetTableBtn: document.getElementById('resetTableBtn'),
    checkCallBtn: document.getElementById('checkCallBtn'),
    foldBtn: document.getElementById('foldBtn'),
    minRaiseBtn: document.getElementById('minRaiseBtn'),
    potRaiseBtn: document.getElementById('potRaiseBtn'),
    allInBtn: document.getElementById('allInBtn'),
    raiseAmountInput: document.getElementById('raiseAmountInput'),
    customRaiseBtn: document.getElementById('customRaiseBtn'),
    toast: document.getElementById('toast'),
    layoutShell: document.getElementById('layoutShell'),
  };

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
    return ui.nameInput.value.trim().slice(0, 18) || 'Player';
  }

  function formatChips(value) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    return amount.toLocaleString('en-US');
  }

  function seatCapacity() {
    const liveCapacity = Number(state.snapshot?.maxPlayers);
    return Number.isFinite(liveCapacity) && liveCapacity > 0 ? liveCapacity : DEFAULT_MAX_SEATS;
  }

  function cardRankLabel(value) {
    switch (value) {
      case 14:
        return 'A';
      case 13:
        return 'K';
      case 12:
        return 'Q';
      case 11:
        return 'J';
      case 10:
        return '10';
      default:
        return String(value || '');
    }
  }

  function suitGlyph(suit) {
    switch (suit) {
      case 'S':
        return '♠';
      case 'H':
        return '♥';
      case 'D':
        return '♦';
      case 'C':
        return '♣';
      default:
        return '';
    }
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
    ui.statusText.textContent = state.statusMessage || base || 'Host a table to generate an invite link, or join with a room code to sit down right away.';
  }

  function renderSoundToggle() {
    if (!ui.soundToggleBtn) {
      return;
    }
    const supported = Boolean(window.AudioContext || window.webkitAudioContext);
    if (!supported) {
      ui.soundToggleBtn.textContent = 'Sound unavailable';
      ui.soundToggleBtn.disabled = true;
      ui.soundToggleBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    ui.soundToggleBtn.disabled = false;
    ui.soundToggleBtn.textContent = state.audio.enabled ? 'Sound on' : 'Sound off';
    ui.soundToggleBtn.setAttribute('aria-pressed', state.audio.enabled ? 'true' : 'false');
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.setupHidden, state.panels.setupHidden ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.infoHidden, state.panels.infoHidden ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.soundEnabled, state.audio.enabled ? '1' : '0');
  }

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
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

  function stageText(stage) {
    switch (stage) {
      case 'preflop':
        return 'Preflop';
      case 'flop':
        return 'Flop';
      case 'turn':
        return 'Turn';
      case 'river':
        return 'River';
      case 'showdown':
        return 'Showdown';
      default:
        return 'Waiting';
    }
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
    ui.copyBtn.disabled = !link;
    ui.copyCodeBtn.disabled = !(state.mode === 'online' && state.roomCode);
  }

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      showToast('Arcade Lounge bridge is not available.');
      return;
    }
    if (autoShare && !(state.mode === 'online' && state.roomCode)) {
      showToast('Host or join an online table before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: getPlayerName(),
      serverUrl: sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl || PROD_SERVER_URL),
      gameType: 'poker',
      roomCode: state.mode === 'online' ? state.roomCode : '',
      inviteUrl: state.mode === 'online' ? inviteUrl() : '',
      note: state.mode === 'online' && state.roomCode
        ? `Join my Orbit Holdem Live table in room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    showToast(autoShare ? 'Opening Arcade Lounge with your poker table ready to share.' : 'Opening Arcade Lounge in a new tab.');
  }

  function currentControls() {
    return state.snapshot?.controls || {
      canStartHand: false,
      canResetTable: false,
      canFillBots: false,
      canClearBots: false,
      canAct: false,
      toCall: 0,
      minRaiseTo: 0,
      maxRaiseTo: 0,
      quickTargets: [],
      checkLabel: 'Check',
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

  function canQuickSeatJoin() {
    return getViewerSeat() === null;
  }

  function getActionPlayer() {
    if (!state.snapshot || !Number.isInteger(state.snapshot.actionSeat)) {
      return null;
    }
    return getPlayerBySeat(state.snapshot.actionSeat);
  }

  function relativeSeatPosition(seat) {
    const viewerSeat = getViewerSeat();
    const capacity = seatCapacity();
    if (!Number.isInteger(viewerSeat)) {
      return seat;
    }
    return (seat - viewerSeat + capacity) % capacity;
  }

  function renderCard(card, options) {
    const settings = options || {};
    const hidden = Boolean(settings.hidden);
    const extraClass = settings.extraClass ? ` ${settings.extraClass}` : '';
    const animateClass = settings.animate ? ' animate-in' : '';
    const style = settings.style || '';
    const styleAttr = style ? ` style="${style}"` : '';
    if (!card || hidden) {
      return `<div class="card back${settings.dim ? ' hidden' : ''}${extraClass}${animateClass}"${styleAttr}></div>`;
    }
    const rank = cardRankLabel(card.value);
    const suit = suitEntity(card.suit);
    const tone = suitTone(card.suit);
    return `
      <div class="card ${tone}${extraClass}${animateClass}"${styleAttr}>
        <div class="card-ornament" aria-hidden="true">
          <span class="card-ornament-rank">${rank}</span>
          <span class="card-ornament-suit">${suit}</span>
        </div>
        <div class="card-watermark" aria-hidden="true">${suit}</div>
        <div class="card-corner top">
          <span class="card-rank">${rank}</span>
          <span class="card-suit">${suit}</span>
        </div>
        <div class="card-center">
          <span class="card-center-rank">${rank}</span>
          <span class="card-center-suit">${suit}</span>
        </div>
        <div class="card-corner bottom">
          <span class="card-rank">${rank}</span>
          <span class="card-suit">${suit}</span>
        </div>
      </div>
    `;
  }

  function renderCommunity() {
    const signature = state.snapshot
      ? state.snapshot.community.map((card) => (card ? `${card.value}${card.suit}` : '--')).join('|')
      : 'empty';
    const animate = signature !== state.renderMemo.communitySignature;

    if (!state.snapshot) {
      ui.communityRow.innerHTML = Array.from({ length: 5 }, () => renderCard(null, { dim: true })).join('');
      state.renderMemo.communitySignature = signature;
      return;
    }
    const slots = [];
    for (let index = 0; index < 5; index += 1) {
      const card = state.snapshot.community[index] || null;
      const lift = index === 2 ? 14 : index === 1 || index === 3 ? 8 : 0;
      slots.push(renderCard(card, {
        dim: !card,
        extraClass: 'community-card',
        animate: animate && Boolean(card),
        style: `--card-lift:${lift}px;--deal-delay:${140 + index * 55}ms;`,
      }));
    }
    ui.communityRow.innerHTML = slots.join('');
    state.renderMemo.communitySignature = signature;
  }

  function seatSignature(player) {
    if (!player) {
      return 'empty';
    }
    const cards = player.cards.map((card) => (card ? `${card.value}${card.suit}` : 'xx')).join('|');
    return `${player.id}|${cards}|${player.stack}|${player.folded ? 'f' : 'a'}|${player.allIn ? 'i' : 'n'}|${state.snapshot?.stage || 'waiting'}`;
  }

  function seatPlacementStyle(position, count) {
    const seatCount = Math.max(2, count || DEFAULT_MAX_SEATS);
    const angle = (Math.PI / 2) + ((position / seatCount) * Math.PI * 2);
    const radiusX = seatCount >= 8 ? 38 : 35;
    const radiusY = seatCount >= 8 ? 32 : 29;
    const x = 50 + (Math.cos(angle) * radiusX);
    const y = 50 + (Math.sin(angle) * radiusY);
    return `--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%;`;
  }

  function emptySeatMarkup(seat, position) {
    const hasJoinTarget = Boolean(sanitizeRoomCode(state.roomCode || ui.roomInput.value));
    const quickAction = canQuickSeatJoin()
      ? (hasJoinTarget ? 'join' : 'host')
      : '';
    const prompt = quickAction === 'join'
      ? 'Click to join.'
      : quickAction === 'host'
        ? 'Click to host.'
        : 'Open seat.';
    const tag = quickAction ? 'button' : 'div';
    const actionAttr = quickAction ? ` type="button" data-seat-action="${quickAction}" data-seat="${seat}"` : '';
    const joinClass = quickAction ? ' joinable' : '';
    return `
      <${tag} class="seat-card empty${joinClass}"${actionAttr} style="${seatPlacementStyle(position, seatCapacity())}">
        <div class="seat-topline">
          <div>
            <div class="seat-name">Seat ${seat + 1}</div>
            <div class="seat-stack">Buy-in 1,500</div>
          </div>
          <div class="seat-badges">
            <span class="badge">Open</span>
          </div>
        </div>
        <div class="hole-row seat-placeholder">
          ${renderCard(null, { dim: true, extraClass: 'hole-card left-card' })}
          ${renderCard(null, { dim: true, extraClass: 'hole-card right-card' })}
        </div>
        <div class="seat-cta">${prompt}</div>
      </${tag}>
    `;
  }

  function seatBadges(player, seat) {
    const badges = [];
    if (player.id === state.playerId) {
      badges.push('<span class="badge">You</span>');
    }
    if (player.isBot) {
      badges.push('<span class="badge bot">Bot</span>');
    }
    if (state.snapshot?.dealerSeat === seat) {
      badges.push('<span class="badge dealer">Dealer</span>');
    }
    if (state.snapshot?.smallBlindSeat === seat) {
      badges.push('<span class="badge blind">SB</span>');
    }
    if (state.snapshot?.bigBlindSeat === seat) {
      badges.push('<span class="badge blind">BB</span>');
    }
    if (state.snapshot?.actionSeat === seat && ['preflop', 'flop', 'turn', 'river'].includes(state.snapshot.stage)) {
      badges.push('<span class="badge turn">Acting</span>');
    }
    if (player.allIn) {
      badges.push('<span class="badge all-in">All-in</span>');
    }
    if (player.folded && state.snapshot?.stage !== 'waiting' && state.snapshot?.stage !== 'showdown') {
      badges.push('<span class="badge folded">Folded</span>');
    }
    if (player.leaving) {
      badges.push('<span class="badge">Disconnecting</span>');
    }
    return badges.join('');
  }

  function renderSeat(player, seat, position) {
    if (!player) {
      return emptySeatMarkup(seat, position);
    }

    const classes = ['seat-card', `seat-pos-${position}`];
    if (player.id === state.playerId) {
      classes.push('you');
    }
    if (player.folded) {
      classes.push('folded');
    }
    if (state.snapshot?.actionSeat === seat && ['preflop', 'flop', 'turn', 'river'].includes(state.snapshot.stage)) {
      classes.push('active');
    }

    const cards = player.cardCount
      ? Array.from({ length: 2 }, (_, index) => renderCard(player.cards[index], {
        hidden: !player.cards[index],
        extraClass: `hole-card ${index === 0 ? 'left-card' : 'right-card'}`,
        animate: state.renderMemo.seatSignatures.get(seat) !== seatSignature(player),
        style: `--deal-delay:${110 + index * 50}ms;`,
      }))
      : [
        renderCard(null, { dim: true, extraClass: 'hole-card left-card' }),
        renderCard(null, { dim: true, extraClass: 'hole-card right-card' }),
      ];

    return `
      <div class="${classes.join(' ')}" style="${seatPlacementStyle(position, seatCapacity())}">
        <div class="seat-topline">
          <div>
            <div class="seat-name">${player.name}</div>
          </div>
          <div class="seat-badges">
            ${seatBadges(player, seat)}
          </div>
        </div>
        <div class="hole-row">
          ${cards.join('')}
        </div>
        <div class="seat-stack">${formatChips(player.stack)} chips</div>
      </div>
    `;
  }

  function renderSeats() {
    const nextSignatures = new Map();
    const seats = [];
    for (let seat = 0; seat < seatCapacity(); seat += 1) {
      const player = getPlayerBySeat(seat);
      nextSignatures.set(seat, seatSignature(player));
      seats.push({
        seat,
        position: relativeSeatPosition(seat),
        player,
      });
    }
    ui.seatLayer.innerHTML = seats
      .sort((left, right) => left.position - right.position)
      .map((entry) => renderSeat(entry.player, entry.seat, entry.position))
      .join('');
    state.renderMemo.seatSignatures = nextSignatures;
  }

  function renderLog() {
    const entries = state.snapshot?.log || [];
    if (!entries.length) {
      ui.logList.innerHTML = '<div class="log-item"><span class="log-tag">Table</span><p>Host a table and start a hand once at least two seats are filled.</p></div>';
      return;
    }
    ui.logList.innerHTML = [...entries].reverse().map((entry) => {
      const tone = ['good', 'warn', 'bad'].includes(entry.tone) ? entry.tone : 'info';
      const tag = tone === 'good' ? 'Win' : tone === 'warn' ? 'Table' : tone === 'bad' ? 'Alert' : 'Action';
      return `
        <div class="log-item ${tone}">
          <span class="log-tag">${tag}</span>
          <p>${entry.text}</p>
        </div>
      `;
    }).join('');
  }

  function renderSummary() {
    if (!state.snapshot) {
      ui.roomCodeLabel.textContent = state.roomCode || '-';
      ui.stageLabel.textContent = 'Waiting';
      ui.potLabel.textContent = '0';
      ui.turnLabel.textContent = 'Seat players to begin';
      ui.boardHeadline.textContent = 'Orbit Holdem Live';
      ui.boardSubline.textContent = 'Ten seats, private cards, and backend-driven hands.';
      ui.potAmount.textContent = '0';
      ui.betAmount.textContent = '0';
      return;
    }

    const actor = getActionPlayer();
    const players = state.snapshot.players || [];
    ui.roomCodeLabel.textContent = state.roomCode || state.snapshot.roomCode || '-';
    ui.stageLabel.textContent = stageText(state.snapshot.stage);
    ui.potLabel.textContent = formatChips(state.snapshot.pot);
    ui.turnLabel.textContent = actor
      ? `${actor.name} to act`
      : state.snapshot.stage === 'showdown'
        ? 'Showdown live'
        : state.snapshot.stage === 'waiting'
          ? `${players.length}/${state.snapshot.maxPlayers} seats filled`
          : 'Table resolving';
    ui.boardHeadline.textContent = state.snapshot.handNumber
      ? `Hand ${state.snapshot.handNumber} - ${stageText(state.snapshot.stage)}`
      : 'Orbit Holdem Live';
    ui.boardSubline.textContent = state.snapshot.status || 'Seat players and start a hand.';
    ui.potAmount.textContent = formatChips(state.snapshot.pot);
    ui.betAmount.textContent = formatChips(state.snapshot.currentBet);
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
      return;
    }
    ui.modePill.textContent = 'No table connected';
  }

  function defaultRaiseTarget() {
    const snapshot = state.snapshot;
    const controls = currentControls();
    if (!snapshot || !controls.canAct) {
      return 0;
    }
    return controls.minRaiseTo || Math.max(snapshot.currentBet, snapshot.bigBlind || 0);
  }

  function potRaiseTarget() {
    const snapshot = state.snapshot;
    const controls = currentControls();
    if (!snapshot || !controls.canAct) {
      return 0;
    }
    if (snapshot.currentBet === 0) {
      return Math.min(
        controls.maxRaiseTo,
        Math.max(snapshot.bigBlind * 4, snapshot.pot || snapshot.bigBlind * 3)
      );
    }
    return Math.min(
      controls.maxRaiseTo,
      snapshot.currentBet + Math.max(snapshot.pot, snapshot.bigBlind * 2)
    );
  }

  function applyRaiseDraftBounds() {
    const controls = currentControls();
    const value = Number(ui.raiseAmountInput.value || 0);
    if (!controls.canAct) {
      ui.raiseAmountInput.value = '';
      return;
    }
    if (!value) {
      ui.raiseAmountInput.placeholder = controls.minRaiseTo
        ? `Min ${controls.minRaiseTo}`
        : 'Enter total bet';
      return;
    }
    const clamped = Math.max(controls.minRaiseTo || 0, Math.min(value, controls.maxRaiseTo || value));
    ui.raiseAmountInput.value = String(clamped);
  }

  function renderActionPrompt() {
    const snapshot = state.snapshot;
    const controls = currentControls();
    const actor = getActionPlayer();
    if (!snapshot) {
      ui.actionPrompt.textContent = 'Click an open seat to host or join. When the hand is live, only the active seat can send betting actions.';
      return;
    }
    if (controls.canFillBots) {
      ui.actionPrompt.textContent = 'Want a fast practice table? Fill the open seats with bots, then deal immediately or leave seats open for real players.';
      return;
    }
    if (controls.canAct) {
      const actionWord = controls.toCall > 0
        ? `You have ${formatChips(controls.toCall)} to call.`
        : 'Action is on you with a free check available.';
      ui.actionPrompt.textContent = `${actionWord} Quick actions fire instantly, or send a custom total bet size on the right.`;
      return;
    }
    if (controls.canStartHand) {
      ui.actionPrompt.textContent = 'Two or more players are seated with chips. Press Start hand when the table is ready.';
      return;
    }
    if (actor) {
      ui.actionPrompt.textContent = `${actor.name} is acting. Watch the board, then respond when the turn reaches your seat.`;
      return;
    }
    if (snapshot.stage === 'showdown') {
      ui.actionPrompt.textContent = 'Showdown is complete. Review the table feed, then deal the next hand when everyone is ready.';
      return;
    }
    ui.actionPrompt.textContent = "Seat at least two players with chips to begin a real Hold'em hand.";
  }

  function renderControls() {
    const snapshot = state.snapshot;
    const controls = currentControls();
    const pendingConnection = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    const connected = canSend();
    const canJoin = Boolean(sanitizeRoomCode(ui.roomInput.value));
    const minTarget = defaultRaiseTarget();
    const potTarget = potRaiseTarget();
    const allInTarget = controls.maxRaiseTo || 0;
    const currentBet = snapshot?.currentBet || 0;

    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !canJoin;
    ui.soloBtn.disabled = pendingConnection;
    ui.shareLoungeBtn.disabled = !(connected && state.mode === 'online' && state.roomCode);
    ui.fillBotsBtn.disabled = !(connected && controls.canFillBots);
    ui.clearBotsBtn.disabled = !(connected && controls.canClearBots);
    ui.startHandBtn.disabled = !(connected && controls.canStartHand);
    ui.resetTableBtn.disabled = !(connected && controls.canResetTable);
    ui.checkCallBtn.disabled = !(connected && controls.canAct);
    ui.foldBtn.disabled = !(connected && controls.canAct);
    ui.minRaiseBtn.disabled = !(connected && controls.canAct && minTarget > currentBet);
    ui.potRaiseBtn.disabled = !(connected && controls.canAct && potTarget > currentBet);
    ui.allInBtn.disabled = !(connected && controls.canAct && allInTarget > currentBet);
    ui.raiseAmountInput.disabled = !(connected && controls.canAct);
    ui.customRaiseBtn.disabled = !(connected && controls.canAct);

    ui.checkCallBtn.textContent = controls.checkLabel || 'Check';
    ui.minRaiseBtn.textContent = currentBet > 0
      ? `Min ${formatChips(minTarget)}`
      : `Bet ${formatChips(minTarget)}`;
    ui.potRaiseBtn.textContent = currentBet > 0
      ? `Pot ${formatChips(potTarget)}`
      : `Press ${formatChips(potTarget)}`;
    ui.allInBtn.textContent = `All in ${formatChips(allInTarget)}`;

    applyRaiseDraftBounds();
    renderActionPrompt();
  }

  function render() {
    renderChrome();
    renderPills();
    renderSoundToggle();
    renderStatus();
    updateInviteUi();
    renderSummary();
    renderCommunity();
    renderSeats();
    renderLog();
    renderControls();
  }

  function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.28), ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / channel.length, 1.5);
    }
    return buffer;
  }

  function ensureAudioContext() {
    if (!state.audio.enabled) {
      return null;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    if (!state.audio.ctx) {
      const ctx = new AudioCtor();
      const master = ctx.createGain();
      master.gain.value = 0.17;
      master.connect(ctx.destination);
      state.audio.ctx = ctx;
      state.audio.master = master;
      state.audio.noiseBuffer = createNoiseBuffer(ctx);
    }
    if (state.audio.ctx.state === 'suspended') {
      state.audio.ctx.resume().catch(() => {});
    }
    return state.audio.ctx;
  }

  function primeAudio() {
    ensureAudioContext();
  }

  function withAudio(callback) {
    const ctx = ensureAudioContext();
    if (!ctx || !state.audio.master) {
      return;
    }
    const run = () => {
      try {
        callback(ctx, ctx.currentTime + 0.01);
      } catch (error) {
        // Ignore isolated audio failures.
      }
    };
    if (ctx.state === 'running') {
      run();
      return;
    }
    ctx.resume().then(run).catch(() => {});
  }

  function playTone(ctx, when, options = {}) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const duration = Math.max(0.04, options.duration || 0.12);
    const startAt = when + (options.delay || 0);
    const attack = Math.min(duration * 0.25, options.attack || 0.01);
    const peak = options.gain || 0.05;
    oscillator.type = options.type || 'triangle';
    oscillator.frequency.setValueAtTime(options.startFreq || 220, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(48, options.endFreq || options.startFreq || 220), startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(state.audio.master);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.04);
  }

  function playNoise(ctx, when, options = {}) {
    if (!state.audio.noiseBuffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = state.audio.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filterType || 'bandpass';
    filter.frequency.value = options.frequency || 1200;
    filter.Q.value = options.q || 1.1;
    const gain = ctx.createGain();
    const duration = Math.max(0.04, options.duration || 0.09);
    const startAt = when + (options.delay || 0);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(options.gain || 0.032, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(state.audio.master);
    source.start(startAt);
    source.stop(startAt + duration + 0.03);
  }

  function playSoundCue(kind) {
    withAudio((ctx, when) => {
      if (kind === 'toggle') {
        playTone(ctx, when, { type: 'sine', startFreq: 620, endFreq: 880, duration: 0.08, gain: 0.04 });
        playTone(ctx, when, { type: 'triangle', startFreq: 900, endFreq: 1180, duration: 0.06, delay: 0.018, gain: 0.028 });
        return;
      }
      if (kind === 'deal') {
        playNoise(ctx, when, { duration: 0.08, gain: 0.03, frequency: 1600, q: 0.9 });
        playTone(ctx, when, { type: 'triangle', startFreq: 320, endFreq: 240, duration: 0.12, gain: 0.04 });
        playTone(ctx, when, { type: 'sine', startFreq: 410, endFreq: 310, duration: 0.09, delay: 0.04, gain: 0.03 });
        return;
      }
      if (kind === 'check') {
        playTone(ctx, when, { type: 'sine', startFreq: 540, endFreq: 420, duration: 0.08, gain: 0.03 });
        return;
      }
      if (kind === 'bet') {
        playNoise(ctx, when, { duration: 0.06, gain: 0.022, frequency: 950, q: 0.8 });
        playTone(ctx, when, { type: 'triangle', startFreq: 260, endFreq: 180, duration: 0.13, gain: 0.05 });
        playTone(ctx, when, { type: 'triangle', startFreq: 340, endFreq: 240, duration: 0.1, delay: 0.03, gain: 0.036 });
        return;
      }
      if (kind === 'fold') {
        playTone(ctx, when, { type: 'sawtooth', startFreq: 200, endFreq: 112, duration: 0.16, gain: 0.038 });
        return;
      }
      if (kind === 'seat') {
        playTone(ctx, when, { type: 'triangle', startFreq: 450, endFreq: 520, duration: 0.08, gain: 0.03 });
        playTone(ctx, when, { type: 'triangle', startFreq: 580, endFreq: 680, duration: 0.06, delay: 0.025, gain: 0.024 });
        return;
      }
      if (kind === 'win') {
        playTone(ctx, when, { type: 'triangle', startFreq: 520, endFreq: 520, duration: 0.18, gain: 0.045 });
        playTone(ctx, when, { type: 'triangle', startFreq: 660, endFreq: 660, duration: 0.2, delay: 0.09, gain: 0.05 });
        playTone(ctx, when, { type: 'triangle', startFreq: 880, endFreq: 880, duration: 0.24, delay: 0.18, gain: 0.055 });
      }
    });
  }

  function soundCueForMessage(message) {
    const text = String(message || '').toLowerCase();
    if (!text) {
      return '';
    }
    if (text.includes('dealt a new hand') || text.includes('started hand')) {
      return 'deal';
    }
    if (text.includes('wins ') || text.includes('scoops the pot') || text.includes('shows ')) {
      return 'win';
    }
    if (text.includes('raised') || text.includes('bet ') || text.includes('all-in')) {
      return 'bet';
    }
    if (text.includes('called') || text.includes('checked')) {
      return 'check';
    }
    if (text.includes('folded')) {
      return 'fold';
    }
    if (text.includes('joined the table') || text.includes('filled the empty seats') || text.includes('took the first seat')) {
      return 'seat';
    }
    return '';
  }

  function maybePlaySnapshotSound(previousSnapshot, nextSnapshot, message) {
    if (!state.audio.enabled) {
      return;
    }
    if (!previousSnapshot) {
      if (nextSnapshot && nextSnapshot.stage === 'preflop') {
        playSoundCue('deal');
      }
      return;
    }
    if ((nextSnapshot.handNumber || 0) > (previousSnapshot.handNumber || 0)) {
      playSoundCue('deal');
      return;
    }
    if ((nextSnapshot.community || []).length > (previousSnapshot.community || []).length) {
      playSoundCue('deal');
      return;
    }
    if (nextSnapshot.stage === 'showdown' && previousSnapshot.stage !== 'showdown') {
      playSoundCue('win');
      return;
    }
    const cue = soundCueForMessage(message);
    if (cue) {
      playSoundCue(cue);
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

  function connectOnline(mode) {
    const name = getPlayerName();
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (mode === 'join' && !roomCode) {
      showToast('Enter the room code from the host first.');
      return;
    }

    disconnectSocket();
    state.mode = 'online';
    state.snapshot = null;
    state.playerId = '';
    state.roomCode = roomCode;
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    if (!state.panels.setupHidden) {
      state.panels.setupHidden = true;
    }
    persistSettings();
    setStatusMessage(mode === 'host'
      ? state.pendingSoloLaunch
        ? 'Opening a solo table and seating bots...'
        : 'Opening your table and creating an invite link...'
      : 'Joining the table and syncing the cards...');
    render();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        action: 'join',
        game: 'poker',
        mode,
        name,
        roomCode,
      }));
      render();
    };

    socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        showToast('Received an unreadable server message.');
        return;
      }

      if (payload.type === 'welcome') {
        state.playerId = payload.playerId;
        state.roomCode = payload.roomCode;
        ui.roomInput.value = payload.roomCode;
        if (state.pendingSoloLaunch) {
          setStatusMessage('Filling the table with bots and dealing the first hand...');
          sendFillBots(true, SOLO_BOT_TARGET);
          render();
          return;
        }
        setStatusMessage('You are seated. Share the invite link and wait for players, or start a hand if the table is ready.');
        render();
        return;
      }

      if (payload.type === 'state') {
        maybePlaySnapshotSound(state.snapshot, payload.snapshot, payload.message);
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode;
        ui.roomInput.value = payload.snapshot.roomCode;
        state.pendingSoloLaunch = false;
        if (!ui.raiseAmountInput.value && payload.snapshot.controls?.minRaiseTo) {
          ui.raiseAmountInput.value = String(payload.snapshot.controls.minRaiseTo);
        }
        setStatusMessage(payload.message || payload.snapshot.status || 'Table updated.');
        render();
        return;
      }

      if (payload.type === 'error') {
        state.pendingSoloLaunch = false;
        showToast(payload.message || 'The table reported an error.');
        setStatusMessage(payload.message || 'Unable to complete that poker action.');
        render();
      }
    };

    socket.onerror = () => {
      state.pendingSoloLaunch = false;
      setStatusMessage('The connection hit an error. Check the server URL and try again.');
      render();
    };

    socket.onclose = () => {
      state.socket = null;
      state.pendingSoloLaunch = false;
      if (state.mode === 'online') {
        setStatusMessage('The online table disconnected. Host again or rejoin the same room code to continue.');
        render();
      }
    };
  }

  function sendStartHand() {
    if (sendMessage({ action: 'start-hand' })) {
      setStatusMessage('Dealing the next hand...');
    }
  }

  function sendFillBots(autoStart, targetSeats) {
    const payload = {
      action: 'fill-bots',
      targetSeats: targetSeats || SOLO_BOT_TARGET,
    };
    if (autoStart) {
      payload.autoStart = true;
    }
    if (sendMessage(payload)) {
      setStatusMessage(autoStart
        ? 'Seating bots and dealing the first hand...'
        : 'Filling the open seats with bots...');
      return true;
    }
    return false;
  }

  function sendClearBots() {
    if (sendMessage({ action: 'clear-bots' })) {
      setStatusMessage('Clearing the bot seats between hands...');
    }
  }

  function sendResetTable() {
    if (sendMessage({ action: 'restart' })) {
      setStatusMessage('Resetting stacks and clearing the table...');
    }
  }

  function sendCheckOrCall() {
    const controls = currentControls();
    const type = controls.toCall > 0 ? 'call' : 'check';
    if (sendMessage({ action: 'act', type })) {
      setStatusMessage(type === 'call' ? 'Calling the current bet...' : 'Checking.');
    }
  }

  function sendFold() {
    if (sendMessage({ action: 'act', type: 'fold' })) {
      setStatusMessage('Folding your hand.');
    }
  }

  function sendRaiseTo(amount) {
    const snapshot = state.snapshot;
    const controls = currentControls();
    const target = Number(amount || 0);
    if (!snapshot || !controls.canAct || !target) {
      return;
    }
    const type = snapshot.currentBet > 0 ? 'raise' : 'bet';
    if (sendMessage({ action: 'act', type, amount: target })) {
      setStatusMessage(type === 'raise'
        ? `Raising to ${formatChips(target)}...`
        : `Betting ${formatChips(target)}...`);
    }
  }

  function sendCustomRaise() {
    const target = Number(ui.raiseAmountInput.value || 0);
    if (!target) {
      showToast('Enter the total bet size you want to send.');
      return;
    }
    sendRaiseTo(target);
  }

  function handleSeatJoinRequest() {
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
      state.pendingSoloLaunch = false;
      ui.roomInput.value = roomCode;
      connectOnline('join');
      return;
    }

    state.pendingSoloLaunch = false;
    connectOnline('host');
  }

  function launchSoloWithBots() {
    if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {
      showToast('Connection already in progress.');
      return;
    }
    if (state.mode === 'online' && canSend() && getViewerSeat() !== null) {
      sendFillBots(true, SOLO_BOT_TARGET);
      return;
    }

    state.pendingSoloLaunch = true;
    ui.roomInput.value = '';
    connectOnline('host');
  }

  function bindEvents() {
    window.addEventListener('pointerdown', primeAudio, { passive: true });

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

    ui.raiseAmountInput.addEventListener('input', () => {
      ui.raiseAmountInput.value = ui.raiseAmountInput.value.replace(/[^\d]/g, '');
    });

    ui.raiseAmountInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendCustomRaise();
      }
    });

    ui.soundToggleBtn.addEventListener('click', () => {
      state.audio.enabled = !state.audio.enabled;
      persistSettings();
      renderSoundToggle();
      if (state.audio.enabled) {
        primeAudio();
        playSoundCue('toggle');
      }
    });
    ui.soloBtn.addEventListener('click', () => {
      primeAudio();
      launchSoloWithBots();
    });
    ui.hostBtn.addEventListener('click', () => {
      state.pendingSoloLaunch = false;
      primeAudio();
      connectOnline('host');
    });
    ui.joinBtn.addEventListener('click', () => {
      state.pendingSoloLaunch = false;
      primeAudio();
      connectOnline('join');
    });
    ui.toggleSetupBtn.addEventListener('click', () => {
      setPanelHidden('setupHidden', !state.panels.setupHidden);
    });
    ui.toggleInfoBtn.addEventListener('click', () => {
      setPanelHidden('infoHidden', !state.panels.infoHidden);
    });
    ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
    ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.fillBotsBtn.addEventListener('click', () => {
      primeAudio();
      sendFillBots(false, SOLO_BOT_TARGET);
    });
    ui.clearBotsBtn.addEventListener('click', sendClearBots);
    ui.startHandBtn.addEventListener('click', () => {
      primeAudio();
      sendStartHand();
    });
    ui.resetTableBtn.addEventListener('click', sendResetTable);
    ui.checkCallBtn.addEventListener('click', () => {
      primeAudio();
      sendCheckOrCall();
    });
    ui.foldBtn.addEventListener('click', () => {
      primeAudio();
      sendFold();
    });
    ui.minRaiseBtn.addEventListener('click', () => {
      primeAudio();
      sendRaiseTo(defaultRaiseTarget());
    });
    ui.potRaiseBtn.addEventListener('click', () => {
      primeAudio();
      sendRaiseTo(potRaiseTarget());
    });
    ui.allInBtn.addEventListener('click', () => {
      primeAudio();
      sendRaiseTo(currentControls().maxRaiseTo || 0);
    });
    ui.customRaiseBtn.addEventListener('click', () => {
      primeAudio();
      sendCustomRaise();
    });
    ui.seatLayer.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-seat-action]');
      if (!trigger) {
        return;
      }
      handleSeatJoinRequest();
    });

    window.addEventListener('keydown', (event) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'c') {
        sendCheckOrCall();
      } else if (key === 'f') {
        sendFold();
      } else if (key === 'n') {
        sendStartHand();
      } else if (key === 'b') {
        sendFillBots(false, SOLO_BOT_TARGET);
      }
    });
  }

  function hydrateSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(query.get('server') || localStorage.getItem(STORAGE_KEYS.serverUrl) || '');
    ui.serverUrlInput.value = state.serverUrl;
    ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
    state.panels.setupHidden = localStorage.getItem(STORAGE_KEYS.setupHidden) === '1';
    const savedInfoHidden = localStorage.getItem(STORAGE_KEYS.infoHidden);
    state.panels.infoHidden = savedInfoHidden === null ? true : savedInfoHidden === '1';
    const savedSoundEnabled = localStorage.getItem(STORAGE_KEYS.soundEnabled);
    state.audio.enabled = savedSoundEnabled === null ? true : savedSoundEnabled === '1';
  }

  function bootFromQuery() {
    if (ui.roomInput.value) {
      connectOnline('join');
      return;
    }
    renderStatus();
  }

  function init() {
    hydrateSettings();
    bindEvents();
    render();
    bootFromQuery();
  }

  init();
})();
