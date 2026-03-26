(() => {
  'use strict';

  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const STORAGE_KEYS = {
    name: 'royalBlackjackLive.name',
    serverUrl: 'royalBlackjackLive.serverUrl',
    setupHidden: 'royalBlackjackLive.setupHidden',
    infoHidden: 'royalBlackjackLive.infoHidden',
  };
  const DEFAULT_MAX_SEATS = 6;
  const query = new URLSearchParams(window.location.search);

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
    renderMemo: {
      dealerSignature: '',
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
    modePill: document.getElementById('modePill'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    phaseLabel: document.getElementById('phaseLabel'),
    tableBetLabel: document.getElementById('tableBetLabel'),
    shoeLabel: document.getElementById('shoeLabel'),
    tableHeadline: document.getElementById('tableHeadline'),
    tableSubline: document.getElementById('tableSubline'),
    dealerCards: document.getElementById('dealerCards'),
    dealerScoreLabel: document.getElementById('dealerScoreLabel'),
    handLabel: document.getElementById('handLabel'),
    tableBetAmount: document.getElementById('tableBetAmount'),
    turnLabel: document.getElementById('turnLabel'),
    seatLayer: document.getElementById('seatLayer'),
    chipRow: document.getElementById('chipRow'),
    nextBetLabel: document.getElementById('nextBetLabel'),
    activeBetLabel: document.getElementById('activeBetLabel'),
    actionPrompt: document.getElementById('actionPrompt'),
    logList: document.getElementById('logList'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleInfoBtn: document.getElementById('toggleInfoBtn'),
    clearBetBtn: document.getElementById('clearBetBtn'),
    dealBtn: document.getElementById('dealBtn'),
    hitBtn: document.getElementById('hitBtn'),
    standBtn: document.getElementById('standBtn'),
    doubleBtn: document.getElementById('doubleBtn'),
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
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
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
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/^http/i, 'ws');
    }
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'Player';
  }

  function formatChips(value) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `$${amount.toLocaleString('en-US')}`;
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
    ui.statusText.textContent = state.statusMessage || base || 'Host a table to create an invite link, or join with a room code to take the next open seat.';
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.setupHidden, state.panels.setupHidden ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.infoHidden, state.panels.infoHidden ? '1' : '0');
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
      betPresets: [5, 25, 100, -25],
    };
  }

  function seatCapacity() {
    const liveCapacity = Number(state.snapshot?.maxPlayers);
    return Number.isFinite(liveCapacity) && liveCapacity > 0 ? liveCapacity : DEFAULT_MAX_SEATS;
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

  function getActionPlayer() {
    if (!state.snapshot || !Number.isInteger(state.snapshot.actionSeat)) {
      return null;
    }
    return getPlayerBySeat(state.snapshot.actionSeat);
  }

  function canQuickSeatJoin() {
    return getViewerSeat() === null;
  }

  function relativeSeatPosition(seat) {
    const viewerSeat = getViewerSeat();
    const capacity = seatCapacity();
    if (!Number.isInteger(viewerSeat)) {
      return seat;
    }
    return (seat - viewerSeat + capacity) % capacity;
  }

  function seatPlacementStyle(position) {
    const placements = [
      { x: 50, y: 84 },
      { x: 23, y: 74 },
      { x: 13, y: 47 },
      { x: 30, y: 24 },
      { x: 70, y: 24 },
      { x: 87, y: 47 },
    ];
    const slot = placements[position] || placements[position % placements.length];
    return `--seat-x:${slot.x}%;--seat-y:${slot.y}%;`;
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
    if (!card) {
      const hiddenClass = settings.dim ? ' hidden' : '';
      return `<div class="card back${hiddenClass}${extraClass}${animateClass}"${styleAttr}></div>`;
    }
    const tone = suitTone(card.suit);
    const suit = suitEntity(card.suit);
    return `
      <div class="card ${tone}${extraClass}${animateClass}"${styleAttr}>
        <div class="card-corner top">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${suit}</span>
        </div>
        <div class="card-center">
          <span class="card-center-rank">${card.rank}</span>
          <span class="card-center-suit">${suit}</span>
        </div>
        <div class="card-corner bottom">
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${suit}</span>
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

  function renderDealer() {
    const signature = dealerSignature();
    const animate = signature !== state.renderMemo.dealerSignature;
    const cards = state.snapshot?.dealer?.cards || [];
    const rows = cards.length ? cards : [null, null];
    ui.dealerCards.innerHTML = rows.map((card, index) => cardMarkup(card, {
      animate: animate && Boolean(card),
      style: `--deal-delay:${100 + index * 70}ms;`,
    })).join('');
    state.renderMemo.dealerSignature = signature;
  }

  function seatSignature(player) {
    if (!player) {
      return 'empty';
    }
    const cards = player.cards.map((card) => (card ? `${card.rank}${card.suit}` : 'XX')).join('|');
    return `${player.id}|${cards}|${player.stack}|${player.bet}|${player.activeBet}|${player.statusText}|${player.result}`;
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

  function emptySeatMarkup(seat, position) {
    const roomCode = sanitizeRoomCode(state.roomCode || ui.roomInput.value);
    const quickAction = canQuickSeatJoin() ? (roomCode ? 'join' : 'host') : '';
    const prompt = quickAction === 'join'
      ? 'Click to join this table.'
      : quickAction === 'host'
        ? 'Click to host this table.'
        : 'Open seat.';
    const tag = quickAction ? 'button' : 'div';
    const actionAttr = quickAction ? ` type="button" data-seat-action="${quickAction}" data-seat="${seat}"` : '';
    const joinClass = quickAction ? ' joinable' : '';
    return `
      <${tag} class="seat-card empty${joinClass}"${actionAttr} style="${seatPlacementStyle(position)}">
        <div class="seat-topline">
          <div>
            <div class="seat-name">Seat ${seat + 1}</div>
            <div class="seat-meta">Buy-in 1,000</div>
          </div>
          <div class="seat-badges">
            <span class="badge">Open</span>
          </div>
        </div>
        <div class="hole-row">
          ${cardMarkup(null, { dim: true, extraClass: 'hole-card', style: seatCardStyle(0, 2) })}
          ${cardMarkup(null, { dim: true, extraClass: 'hole-card', style: seatCardStyle(1, 2) })}
        </div>
        <div class="seat-cta">${prompt}</div>
      </${tag}>
    `;
  }

  function renderSeat(player, seat, position) {
    if (!player) {
      return emptySeatMarkup(seat, position);
    }

    const classes = ['seat-card'];
    if (player.id === state.playerId) {
      classes.push('you');
    }
    if (state.snapshot?.actionSeat === seat && state.snapshot?.phase === 'player-turns') {
      classes.push('active');
    }

    const animate = state.renderMemo.seatSignatures.get(seat) !== seatSignature(player);
    const seatCards = player.cards && player.cards.length ? player.cards : [null, null];
    const cards = seatCards.map((card, index) => cardMarkup(card, {
      dim: !card,
      animate: animate && Boolean(card),
      extraClass: 'hole-card',
      style: `${seatCardStyle(index, seatCards.length)}--deal-delay:${120 + index * 60}ms;`,
    }));

    const betLine = player.activeBet > 0
      ? `Live ${formatChips(player.activeBet)}`
      : `Next ${formatChips(player.bet)}`;
    const scoreLine = player.cards.length ? `Hand ${player.scoreLabel}` : 'Waiting';

    return `
      <div class="${classes.join(' ')}" style="${seatPlacementStyle(position)}">
        <div class="seat-topline">
          <div>
            <div class="seat-name">${player.name}</div>
            <div class="seat-meta">${formatChips(player.stack)} stack</div>
          </div>
          <div class="seat-badges">
            ${seatBadges(player, seat)}
          </div>
        </div>
        <div class="hole-row">
          ${cards.join('')}
        </div>
        <div class="seat-footer">
          <div class="seat-totals">
            <div class="seat-score">${scoreLine}</div>
            <div class="seat-stack">${betLine}</div>
          </div>
          <div class="seat-status">${player.statusText || player.result || ''}</div>
        </div>
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
        player,
        position: relativeSeatPosition(seat),
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
      ui.logList.innerHTML = '<div class="log-item"><span class="log-tag">Dealer</span><p>Seat the table, set bets, and deal when ready.</p></div>';
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

  function renderSummary() {
    const snapshot = state.snapshot;
    const actor = getActionPlayer();
    const viewer = getViewer();

    if (!snapshot) {
      ui.roomCodeLabel.textContent = state.roomCode || '-';
      ui.phaseLabel.textContent = 'Waiting';
      ui.tableBetLabel.textContent = formatChips(0);
      ui.shoeLabel.textContent = '312 cards';
      ui.tableHeadline.textContent = 'Royal SuperSplash Blackjack Live';
      ui.tableSubline.textContent = 'Seat up, set wagers, and deal when ready.';
      ui.dealerScoreLabel.textContent = '?';
      ui.handLabel.textContent = '0';
      ui.tableBetAmount.textContent = formatChips(0);
      ui.turnLabel.textContent = 'Seat players';
      ui.nextBetLabel.textContent = formatChips(25);
      ui.activeBetLabel.textContent = formatChips(0);
      return;
    }

    ui.roomCodeLabel.textContent = state.roomCode || snapshot.roomCode || '-';
    ui.phaseLabel.textContent = phaseText(snapshot.phase);
    ui.tableBetLabel.textContent = formatChips(snapshot.tableBetTotal || 0);
    ui.shoeLabel.textContent = `${snapshot.shoeRemaining || 0} cards`;
    ui.tableHeadline.textContent = snapshot.handNumber
      ? `Hand ${snapshot.handNumber} live`
      : 'Royal SuperSplash Blackjack Live';
    ui.tableSubline.textContent = snapshot.status || 'Seat up and deal.';
    ui.dealerScoreLabel.textContent = snapshot.dealer?.scoreLabel || '?';
    ui.handLabel.textContent = String(snapshot.handNumber || 0);
    ui.tableBetAmount.textContent = formatChips(snapshot.tableBetTotal || 0);
    ui.turnLabel.textContent = actor
      ? `${actor.name} to act`
      : snapshot.phase === 'settled'
        ? 'Payouts settled'
        : snapshot.phase === 'dealer-turn'
          ? 'Dealer playing'
          : `${(snapshot.players || []).length}/${snapshot.maxPlayers} seated`;
    ui.nextBetLabel.textContent = formatChips(viewer?.bet || 0);
    ui.activeBetLabel.textContent = formatChips(viewer?.activeBet || 0);
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

  function renderActionPrompt() {
    const snapshot = state.snapshot;
    const controls = currentControls();
    const actor = getActionPlayer();

    if (!snapshot) {
      ui.actionPrompt.textContent = 'Click an open seat to host or join. Once seated, set your next wager and deal the round when the table is ready.';
      return;
    }
    if (controls.canAct) {
      ui.actionPrompt.textContent = 'Action is on you. Hit to draw, stand to hold, or double if this is still your opening two-card hand.';
      return;
    }
    if (controls.canAdjustBet) {
      ui.actionPrompt.textContent = 'Your seat is ready for the next deal. Adjust your wager with the chip buttons, then deal when the table is set.';
      return;
    }
    if (controls.canStartRound) {
      ui.actionPrompt.textContent = 'At least one seated player has a live wager. Press Deal round to put the next hand in motion.';
      return;
    }
    if (actor) {
      ui.actionPrompt.textContent = `${actor.name} is acting. Watch the dealer feed and wait for the next hand or your turn.`;
      return;
    }
    if (snapshot.phase === 'settled') {
      ui.actionPrompt.textContent = 'The hand is settled. Review payouts in the dealer feed, then set new wagers and deal again.';
      return;
    }
    ui.actionPrompt.textContent = 'Seat players and place at least one wager to start the table.';
  }

  function renderChips() {
    const controls = currentControls();
    ui.chipRow.innerHTML = (controls.betPresets || [5, 25, 100, -25]).map((amount) => {
      const sign = amount > 0 ? '+' : '';
      const className = amount < 0 ? 'chip-btn minus' : 'chip-btn';
      return `<button class="${className}" type="button" data-chip-amount="${amount}">${sign}${formatChips(Math.abs(amount))}</button>`;
    }).join('');
  }

  function renderControls() {
    const controls = currentControls();
    const pendingConnection = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    const connected = canSend();
    const canJoin = Boolean(sanitizeRoomCode(ui.roomInput.value));

    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !canJoin;
    ui.clearBetBtn.disabled = !(connected && controls.canClearBet);
    ui.dealBtn.disabled = !(connected && controls.canStartRound);
    ui.hitBtn.disabled = !(connected && controls.canHit);
    ui.standBtn.disabled = !(connected && controls.canStand);
    ui.doubleBtn.disabled = !(connected && controls.canDouble);
    ui.resetTableBtn.disabled = !(connected && controls.canResetTable);

    renderActionPrompt();
    renderChips();
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
      ? 'Opening your blackjack table and creating an invite link...'
      : 'Joining the blackjack table and syncing the felt...');
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
        render();
        return;
      }

      if (payload.type === 'state') {
        state.snapshot = payload.snapshot;
        state.roomCode = payload.snapshot.roomCode;
        ui.roomInput.value = payload.snapshot.roomCode;
        setStatusMessage(payload.message || payload.snapshot.status || 'Table updated.');
        persistSettings();
        render();
        return;
      }

      if (payload.type === 'error') {
        setStatusMessage(payload.message || 'That blackjack action could not be completed.');
        showToast(payload.message || 'That blackjack action could not be completed.');
        render();
      }
    };

    socket.onclose = () => {
      if (state.socket === socket) {
        state.socket = null;
        setStatusMessage('The live blackjack table disconnected. Host again or rejoin the same room code to continue.');
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
      setStatusMessage(mode === 'clear' ? 'Clearing your next wager...' : 'Sending your next wager to the table...');
    }
  }

  function sendDeal() {
    if (sendMessage({ action: 'start-hand' })) {
      setStatusMessage('Dealer is putting the next round in motion...');
    }
  }

  function sendAction(type) {
    if (sendMessage({ action: 'act', type })) {
      setStatusMessage(`Sending ${type} to the dealer...`);
    }
  }

  function sendResetTable() {
    if (sendMessage({ action: 'restart' })) {
      setStatusMessage('Reloading fresh stacks and a fresh shoe...');
    }
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

  function hydrateSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || defaultServerUrl());
    ui.serverUrlInput.value = state.serverUrl;
    state.panels.setupHidden = localStorage.getItem(STORAGE_KEYS.setupHidden) === '1';
    state.panels.infoHidden = localStorage.getItem(STORAGE_KEYS.infoHidden) === '1';
  }

  function bootFromQuery() {
    const roomCode = sanitizeRoomCode(query.get('room') || '');
    if (roomCode) {
      ui.roomInput.value = roomCode;
      connectOnline('join');
      return;
    }
    renderStatus();
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

    ui.hostBtn.addEventListener('click', () => connectOnline('host'));
    ui.joinBtn.addEventListener('click', () => connectOnline('join'));
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.toggleSetupBtn.addEventListener('click', () => setPanelHidden('setupHidden', !state.panels.setupHidden));
    ui.toggleInfoBtn.addEventListener('click', () => setPanelHidden('infoHidden', !state.panels.infoHidden));
    ui.clearBetBtn.addEventListener('click', () => sendSetBet(0, 'clear'));
    ui.dealBtn.addEventListener('click', sendDeal);
    ui.hitBtn.addEventListener('click', () => sendAction('hit'));
    ui.standBtn.addEventListener('click', () => sendAction('stand'));
    ui.doubleBtn.addEventListener('click', () => sendAction('double'));
    ui.resetTableBtn.addEventListener('click', sendResetTable);

    ui.chipRow.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-chip-amount]');
      if (!trigger) {
        return;
      }
      sendSetBet(Number(trigger.getAttribute('data-chip-amount') || 0));
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
      if (key === 'h') {
        sendAction('hit');
      } else if (key === 's') {
        sendAction('stand');
      } else if (key === 'd') {
        sendAction('double');
      }
    });
  }

  function init() {
    hydrateSettings();
    bindEvents();
    render();
    bootFromQuery();
  }

  init();
})();
