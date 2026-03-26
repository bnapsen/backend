(() => {
  'use strict';

  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const STORAGE_KEYS = {
    name: 'orbitHoldemLive.name',
    serverUrl: 'orbitHoldemLive.serverUrl',
    setupHidden: 'orbitHoldemLive.setupHidden',
    infoHidden: 'orbitHoldemLive.infoHidden',
  };
  const query = new URLSearchParams(window.location.search);
  const MAX_SEATS = 5;

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
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    networkStatus: document.getElementById('networkStatus'),
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
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleInfoBtn: document.getElementById('toggleInfoBtn'),
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

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.setupHidden, state.panels.setupHidden ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.infoHidden, state.panels.infoHidden ? '1' : '0');
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

  function currentControls() {
    return state.snapshot?.controls || {
      canStartHand: false,
      canResetTable: false,
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
    if (!Number.isInteger(viewerSeat)) {
      return seat;
    }
    return (seat - viewerSeat + MAX_SEATS) % MAX_SEATS;
  }

  function renderCard(card, options) {
    const settings = options || {};
    const hidden = Boolean(settings.hidden);
    const extraClass = settings.extraClass ? ` ${settings.extraClass}` : '';
    if (!card || hidden) {
      return `<div class="card back${settings.dim ? ' hidden' : ''}${extraClass}"></div>`;
    }
    const red = card.suit === 'H' || card.suit === 'D';
    return `
      <div class="card${red ? ' red' : ''}${extraClass}">
        <div class="card-rank">${cardRankLabel(card.value)}</div>
        <div class="card-suit">${suitGlyph(card.suit)}</div>
      </div>
    `;
  }

  function renderCommunity() {
    if (!state.snapshot) {
      ui.communityRow.innerHTML = Array.from({ length: 5 }, () => renderCard(null, { dim: true })).join('');
      return;
    }
    const slots = [];
    for (let index = 0; index < 5; index += 1) {
      const card = state.snapshot.community[index] || null;
      slots.push(renderCard(card, { dim: !card }));
    }
    ui.communityRow.innerHTML = slots.join('');
  }

  function emptySeatMarkup(seat, position) {
    const hasJoinTarget = Boolean(sanitizeRoomCode(state.roomCode || ui.roomInput.value));
    const quickAction = canQuickSeatJoin()
      ? (hasJoinTarget ? 'join' : 'host')
      : '';
    const prompt = quickAction === 'join'
      ? 'Click to join this table.'
      : quickAction === 'host'
        ? 'Click to host this table.'
        : 'Open seat for another player.';
    const tag = quickAction ? 'button' : 'div';
    const actionAttr = quickAction ? ` type="button" data-seat-action="${quickAction}" data-seat="${seat}"` : '';
    const joinClass = quickAction ? ' joinable' : '';
    return `
      <${tag} class="seat-card empty seat-pos-${position}${joinClass}"${actionAttr}>
        <div class="seat-topline">
          <div>
            <div class="seat-name">Open seat ${seat + 1}</div>
            <div class="seat-stack">1,500 buy-in</div>
          </div>
          <div class="seat-badges">
            <span class="badge">Open</span>
          </div>
        </div>
        <div class="hole-row seat-placeholder">
          ${renderCard(null, { dim: true })}
          ${renderCard(null, { dim: true })}
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
      ? Array.from({ length: 2 }, (_, index) => renderCard(player.cards[index], { hidden: !player.cards[index] }))
      : [renderCard(null, { dim: true }), renderCard(null, { dim: true })];

    return `
      <div class="${classes.join(' ')}">
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
    const seats = [];
    for (let seat = 0; seat < MAX_SEATS; seat += 1) {
      seats.push({
        seat,
        position: relativeSeatPosition(seat),
        player: getPlayerBySeat(seat),
      });
    }
    ui.seatLayer.innerHTML = seats
      .sort((left, right) => left.position - right.position)
      .map((entry) => renderSeat(entry.player, entry.seat, entry.position))
      .join('');
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
      ui.boardSubline.textContent = 'Five seats, private cards, and backend-driven hands.';
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
    renderStatus();
    updateInviteUi();
    renderSummary();
    renderCommunity();
    renderSeats();
    renderLog();
    renderControls();
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
      ? 'Opening your table and creating an invite link...'
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
        setStatusMessage('You are seated. Share the invite link and wait for players, or start a hand if the table is ready.');
        render();
        return;
      }

      if (payload.type === 'state') {
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode;
        ui.roomInput.value = payload.snapshot.roomCode;
        if (!ui.raiseAmountInput.value && payload.snapshot.controls?.minRaiseTo) {
          ui.raiseAmountInput.value = String(payload.snapshot.controls.minRaiseTo);
        }
        setStatusMessage(payload.message || payload.snapshot.status || 'Table updated.');
        render();
        return;
      }

      if (payload.type === 'error') {
        showToast(payload.message || 'The table reported an error.');
        setStatusMessage(payload.message || 'Unable to complete that poker action.');
        render();
      }
    };

    socket.onerror = () => {
      setStatusMessage('The connection hit an error. Check the server URL and try again.');
      render();
    };

    socket.onclose = () => {
      state.socket = null;
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
      ui.roomInput.value = roomCode;
      connectOnline('join');
      return;
    }

    connectOnline('host');
  }

  function bindEvents() {
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

    ui.hostBtn.addEventListener('click', () => connectOnline('host'));
    ui.joinBtn.addEventListener('click', () => connectOnline('join'));
    ui.toggleSetupBtn.addEventListener('click', () => {
      setPanelHidden('setupHidden', !state.panels.setupHidden);
    });
    ui.toggleInfoBtn.addEventListener('click', () => {
      setPanelHidden('infoHidden', !state.panels.infoHidden);
    });
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.startHandBtn.addEventListener('click', sendStartHand);
    ui.resetTableBtn.addEventListener('click', sendResetTable);
    ui.checkCallBtn.addEventListener('click', sendCheckOrCall);
    ui.foldBtn.addEventListener('click', sendFold);
    ui.minRaiseBtn.addEventListener('click', () => sendRaiseTo(defaultRaiseTarget()));
    ui.potRaiseBtn.addEventListener('click', () => sendRaiseTo(potRaiseTarget()));
    ui.allInBtn.addEventListener('click', () => sendRaiseTo(currentControls().maxRaiseTo || 0));
    ui.customRaiseBtn.addEventListener('click', sendCustomRaise);
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
