(() => {
  'use strict';

  const Core = window.NeonBackgammonCore;
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const STORAGE_KEYS = {
    name: 'neonBackgammon.name',
    serverUrl: 'neonBackgammon.serverUrl',
  };
  const query = new URLSearchParams(window.location.search);
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hitRadiusBoost = isCoarsePointer ? 14 : 0;

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    rollBtn: document.getElementById('rollBtn'),
    autoBtn: document.getElementById('autoBtn'),
    restartBtn: document.getElementById('restartBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    inviteInput: document.getElementById('inviteInput'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    turnText: document.getElementById('turnText'),
    phaseText: document.getElementById('phaseText'),
    diceLabel: document.getElementById('diceLabel'),
    diceText: document.getElementById('diceText'),
    diceStageLabel: document.getElementById('diceStageLabel'),
    barWhite: document.getElementById('barWhite'),
    barBlack: document.getElementById('barBlack'),
    raceLabel: document.getElementById('raceLabel'),
    playerCards: document.getElementById('playerCards'),
    presenceText: document.getElementById('presenceText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    statusText: document.getElementById('statusText'),
    boardStage: document.querySelector('.board-stage'),
    die1: document.getElementById('die1'),
    die2: document.getElementById('die2'),
    dieShell1: document.getElementById('dieShell1'),
    dieShell2: document.getElementById('dieShell2'),
    diceVisuals: document.getElementById('diceVisuals'),
    toast: document.getElementById('toast'),
    stepOne: document.getElementById('stepOne'),
    stepTwo: document.getElementById('stepTwo'),
    stepThree: document.getElementById('stepThree'),
  };

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    yourColor: null,
    roomCode: '',
    serverUrl: '',
    selected: null,
    legalForSelected: [],
    drag: null,
    toastTimer: 0,
    botTimer: 0,
    diceTimer: 0,
    statusMessage: '',
    pointRects: [],
    drawQueued: false,
    anim: {
      move: null,
      pulses: [],
      trail: [],
    },
  };

  const pipLayouts = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
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

  function playerLabel(player) {
    return Core.playerName(player);
  }

  function controlledSide() {
    if (state.mode === 'online') {
      return state.yourColor;
    }
    if (state.mode === 'solo') {
      return Core.WHITE;
    }
    return null;
  }

  function canAct() {
    if (!state.snapshot || state.snapshot.winner) {
      return false;
    }
    if (state.mode === 'online') {
      return Boolean(
        state.socket &&
        state.socket.readyState === WebSocket.OPEN &&
        controlledSide() === state.snapshot.current
      );
    }
    return state.mode === 'solo' && controlledSide() === state.snapshot.current;
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
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
    renderStatus();
  }

  function renderStatus() {
    const base = state.snapshot?.status || '';
    ui.statusText.textContent = state.statusMessage || base || 'Host a room to invite a friend, join with a room code, or play a solo warm-up against the bot.';
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
    ui.copyCodeBtn.disabled = !state.roomCode || state.mode !== 'online';
  }

  function emptySeatCard(color) {
    return `
      <div class="player-card">
        <div class="player-head">
          <div>
            <div class="player-name">Open seat</div>
            <div class="player-color-label">${color} checkers</div>
          </div>
          <span class="inline-chip empty-chip">Waiting</span>
        </div>
      </div>
    `;
  }

  function renderPlayers() {
    if (!state.snapshot || state.mode !== 'online') {
      ui.playerCards.innerHTML = `
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">${getPlayerName()}</div>
              <div class="player-color-label">White checkers</div>
            </div>
            <span class="inline-chip ready-chip">You</span>
          </div>
        </div>
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">Blitz Bot</div>
              <div class="player-color-label">Black checkers</div>
            </div>
            <span class="inline-chip ready-chip">Solo</span>
          </div>
        </div>
      `;
      ui.presenceText.textContent = state.mode === 'solo' ? 'Solo warm-up live.' : 'Waiting for players...';
      return;
    }

    const players = Array.isArray(state.snapshot.players) ? state.snapshot.players : [];
    const byColor = new Map(players.map((player) => [player.color, player]));
    const ordered = ['white', 'black'].map((color) => byColor.get(color));
    ui.playerCards.innerHTML = ordered.map((player, index) => {
      const color = index === 0 ? 'White' : 'Black';
      if (!player) {
        return emptySeatCard(color);
      }
      const isYou = (state.yourColor === Core.WHITE && player.color === 'white') ||
        (state.yourColor === Core.BLACK && player.color === 'black');
      return `
        <div class="player-card">
          <div class="player-head">
            <div>
              <div class="player-name">${player.name}</div>
              <div class="player-color-label">${color} checkers</div>
            </div>
            <span class="inline-chip ready-chip">${isYou ? 'You' : 'Ready'}</span>
          </div>
        </div>
      `;
    }).join('');

    ui.presenceText.textContent = players.length >= 2
      ? 'Both players are seated.'
      : 'Waiting for the second player...';
  }

  function pipCount(player) {
    if (!state.snapshot) {
      return 0;
    }
    let total = state.snapshot.bar[player] * 25;
    for (let index = 0; index < 24; index += 1) {
      const count = player === Core.WHITE
        ? Math.max(0, state.snapshot.points[index])
        : Math.max(0, -state.snapshot.points[index]);
      if (!count) {
        continue;
      }
      const distance = player === Core.WHITE ? index + 1 : 24 - index;
      total += count * distance;
    }
    return total;
  }

  function renderSummary() {
    if (!state.snapshot) {
      ui.roomCodeLabel.textContent = '-';
      ui.turnText.textContent = 'White to roll';
      ui.phaseText.textContent = 'Start a match to begin.';
      ui.diceLabel.textContent = 'Roll to start';
      ui.diceText.textContent = 'Roll to start';
      ui.diceStageLabel.textContent = 'Top rail ready';
      ui.barWhite.textContent = '0';
      ui.barBlack.textContent = '0';
      ui.raceLabel.textContent = 'White 0 / Black 0';
      return;
    }

    ui.roomCodeLabel.textContent = state.mode === 'online' ? state.roomCode || state.snapshot.roomCode || '-' : 'SOLO';
    ui.turnText.textContent = state.snapshot.winner
      ? `${playerLabel(state.snapshot.winner)} wins`
      : `${playerLabel(state.snapshot.current)} ${state.snapshot.dice.length ? 'to move' : 'to roll'}`;
    ui.phaseText.textContent = state.snapshot.status || 'Match in progress.';
    ui.diceLabel.textContent = state.snapshot.dice.length ? state.snapshot.dice.join(', ') : 'Awaiting roll';
    ui.diceText.textContent = state.snapshot.dice.length
      ? `Live dice: ${state.snapshot.dice.join(', ')}`
      : `Last roll: ${state.snapshot.lastRoll?.[0] || '-'} / ${state.snapshot.lastRoll?.[1] || '-'}`;
    ui.diceStageLabel.textContent = state.snapshot.dice.length
      ? 'Dice in play'
      : (state.snapshot.lastRoll?.[0] ? 'Roll settled' : 'Top rail ready');
    ui.barWhite.textContent = String(state.snapshot.bar[Core.WHITE]);
    ui.barBlack.textContent = String(state.snapshot.bar[Core.BLACK]);
    ui.raceLabel.textContent = `White ${pipCount(Core.WHITE)} / Black ${pipCount(Core.BLACK)}`;
  }

  function renderPills() {
    if (state.mode === 'online' && state.socket && state.socket.readyState === WebSocket.OPEN) {
      ui.networkStatus.dataset.tone = 'online';
      ui.networkStatus.textContent = 'Online';
    } else if (state.mode === 'online' && state.socket && state.socket.readyState === WebSocket.CONNECTING) {
      ui.networkStatus.dataset.tone = 'connecting';
      ui.networkStatus.textContent = 'Connecting';
    } else if (state.mode === 'online') {
      ui.networkStatus.dataset.tone = 'error';
      ui.networkStatus.textContent = 'Disconnected';
    } else if (state.mode === 'solo') {
      ui.networkStatus.dataset.tone = 'online';
      ui.networkStatus.textContent = 'Solo';
    } else {
      ui.networkStatus.dataset.tone = 'offline';
      ui.networkStatus.textContent = 'Offline';
    }

    if (state.mode === 'online') {
      ui.modePill.textContent = state.roomCode ? `Online room ${state.roomCode}` : 'Online setup';
    } else if (state.mode === 'solo') {
      ui.modePill.textContent = 'Solo vs Blitz Bot';
    } else {
      ui.modePill.textContent = 'No match running';
    }
  }

  function renderControls() {
    const pendingConnection = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    const canJoin = Boolean(sanitizeRoomCode(ui.roomInput.value));
    const activeTurn = canAct();

    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !canJoin;
    ui.rollBtn.disabled = !activeTurn || !state.snapshot || state.snapshot.winner || state.snapshot.dice.length > 0;
    ui.autoBtn.disabled = !activeTurn || !state.snapshot || state.snapshot.winner || !state.snapshot.dice.length;
    ui.restartBtn.disabled = !state.snapshot;
    ui.stepOne.classList.toggle('active', Boolean(ui.nameInput.value.trim()));
    ui.stepTwo.classList.toggle('active', state.mode === 'online' || state.mode === 'solo');
    ui.stepThree.classList.toggle('active', Boolean(state.snapshot));
  }

  function render() {
    renderPills();
    renderStatus();
    updateInviteUi();
    renderSummary();
    renderPlayers();
    renderControls();
    scheduleDraw();
  }

  function syncDieFace(die, value) {
    const pips = die.querySelectorAll('.pip');
    pips.forEach((pip, index) => {
      pip.style.opacity = pipLayouts[value].includes(index) ? '1' : '0';
    });
  }

  function initDiceVisuals() {
    [ui.die1, ui.die2].forEach((die) => {
      die.innerHTML = '';
      for (let index = 0; index < 9; index += 1) {
        const pip = document.createElement('span');
        pip.className = 'pip';
        die.appendChild(pip);
      }
      syncDieFace(die, 1);
    });
    syncDiceRestPose();
  }

  function syncDiceRestPose() {
    const boardRect = ui.boardStage.getBoundingClientRect();
    if (!boardRect.width) {
      return;
    }
    const shellSize = 70;
    const settleY = Math.max(18, Math.min(40, boardRect.height * 0.04));
    const centerX = boardRect.width / 2;
    const settleLeft = Math.round(centerX - shellSize - 10);
    const settleRight = Math.round(centerX + 10);

    ui.dieShell1.style.setProperty('--end-x', `${settleLeft}px`);
    ui.dieShell1.style.setProperty('--end-y', `${settleY}px`);
    ui.dieShell1.style.setProperty('--end-rot', '-8deg');
    ui.dieShell1.style.transform = `translate3d(${settleLeft}px, ${settleY}px, 0) rotate(-8deg)`;

    ui.dieShell2.style.setProperty('--end-x', `${settleRight}px`);
    ui.dieShell2.style.setProperty('--end-y', `${Math.round(settleY + 2)}px`);
    ui.dieShell2.style.setProperty('--end-rot', '10deg');
    ui.dieShell2.style.transform = `translate3d(${settleRight}px, ${Math.round(settleY + 2)}px, 0) rotate(10deg)`;
  }

  function animateDiceRoll(first, second) {
    const shells = [ui.dieShell1, ui.dieShell2];
    const boardRect = ui.boardStage.getBoundingClientRect();
    const shellSize = 70;
    const settleY = Math.max(18, Math.min(40, boardRect.height * 0.04));
    const centerX = boardRect.width / 2;
    const settleLeft = Math.round(centerX - shellSize - 10);
    const settleRight = Math.round(centerX + 10);
    const leftStartX = Math.round(boardRect.width * 0.08);
    const rightStartX = Math.round(boardRect.width * 0.82);
    const midY = Math.round(settleY + 8);
    const lateY = Math.round(settleY + 16);

    window.clearTimeout(state.diceTimer);
    ui.boardStage.classList.add('is-rolling');
    ui.diceStageLabel.textContent = 'Board roll live';

    const setups = [
      {
        shell: ui.dieShell1,
        startX: leftStartX,
        startY: 26,
        midX: Math.round(boardRect.width * 0.34),
        midY,
        lateX: Math.round(settleLeft - 16),
        lateY,
        endX: settleLeft,
        endY: settleY,
        startRot: '-34deg',
        endRot: '-8deg',
      },
      {
        shell: ui.dieShell2,
        startX: rightStartX,
        startY: 16,
        midX: Math.round(boardRect.width * 0.62),
        midY: Math.round(midY - 6),
        lateX: Math.round(settleRight + 14),
        lateY: Math.round(lateY - 4),
        endX: settleRight,
        endY: Math.round(settleY + 2),
        startRot: '28deg',
        endRot: '10deg',
      },
    ];

    setups.forEach((setup) => {
      setup.shell.style.setProperty('--start-x', `${setup.startX}px`);
      setup.shell.style.setProperty('--start-y', `${setup.startY}px`);
      setup.shell.style.setProperty('--mid-x', `${setup.midX}px`);
      setup.shell.style.setProperty('--mid-y', `${setup.midY}px`);
      setup.shell.style.setProperty('--late-x', `${setup.lateX}px`);
      setup.shell.style.setProperty('--late-y', `${setup.lateY}px`);
      setup.shell.style.setProperty('--end-x', `${setup.endX}px`);
      setup.shell.style.setProperty('--end-y', `${setup.endY}px`);
      setup.shell.style.setProperty('--start-rot', setup.startRot);
      setup.shell.style.setProperty('--end-rot', setup.endRot);
      setup.shell.classList.remove('launch');
      void setup.shell.offsetWidth;
      setup.shell.classList.add('launch');
    });

    [ui.die1, ui.die2].forEach((die) => die.classList.add('rolling'));
    const scramble = window.setInterval(() => {
      syncDieFace(ui.die1, 1 + Math.floor(Math.random() * 6));
      syncDieFace(ui.die2, 1 + Math.floor(Math.random() * 6));
    }, 60);
    state.diceTimer = window.setTimeout(() => {
      window.clearInterval(scramble);
      [ui.die1, ui.die2].forEach((die) => die.classList.remove('rolling'));
      syncDieFace(ui.die1, first);
      syncDieFace(ui.die2, second);
      shells.forEach((shell) => {
        shell.classList.remove('launch');
        shell.style.transform = `translate3d(${shell.style.getPropertyValue('--end-x')}, ${shell.style.getPropertyValue('--end-y')}, 0) rotate(${shell.style.getPropertyValue('--end-rot')})`;
      });
      ui.boardStage.classList.remove('is-rolling');
      ui.diceStageLabel.textContent = 'Roll settled';
    }, 760);
  }

  function clearSelection() {
    state.selected = null;
    state.legalForSelected = [];
  }

  function cleanupDrag() {
    state.drag = null;
  }

  function cancelBotTurn() {
    window.clearTimeout(state.botTimer);
  }

  function applyIncomingSnapshot(snapshot, message) {
    const previousRoll = state.snapshot?.lastRoll?.join('-') || '';
    const nextRoll = snapshot?.lastRoll?.join('-') || '';
    if (nextRoll && nextRoll !== '0-0' && nextRoll !== previousRoll) {
      animateDiceRoll(snapshot.lastRoll[0], snapshot.lastRoll[1]);
    }
    state.snapshot = snapshot;
    clearSelection();
    cleanupDrag();
    if (message) {
      setStatusMessage(message);
    } else if (snapshot?.status) {
      setStatusMessage(snapshot.status);
    }
    render();
  }

  function disconnectSocket() {
    if (state.socket) {
      state.socket.onopen = null;
      state.socket.onmessage = null;
      state.socket.onerror = null;
      state.socket.onclose = null;
      try {
        state.socket.close();
      } catch (error) {
        // Ignore close failures.
      }
    }
    state.socket = null;
  }

  function handleOnlineMessage(payload) {
    if (payload.type === 'welcome') {
      state.roomCode = payload.roomCode;
      state.yourColor = payload.color === 'white' ? Core.WHITE : Core.BLACK;
      setStatusMessage(`Connected as ${payload.color}. Share the invite when the room is ready.`);
      render();
      return;
    }

    if (payload.type === 'state') {
      applyIncomingSnapshot(payload.snapshot, payload.message);
      return;
    }

    if (payload.type === 'error') {
      setStatusMessage(payload.message || 'The server rejected that action.');
      showToast(payload.message || 'That move was rejected.');
      render();
    }
  }

  function connectOnline(mode) {
    cancelBotTurn();
    disconnectSocket();
    clearSelection();
    cleanupDrag();

    state.mode = 'online';
    state.snapshot = null;
    state.yourColor = null;
    state.roomCode = sanitizeRoomCode(ui.roomInput.value);
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    ui.serverUrlInput.value = state.serverUrl;
    persistSettings();

    setStatusMessage(mode === 'host' ? 'Creating your room...' : 'Joining room...');
    render();

    try {
      const socket = new WebSocket(state.serverUrl);
      state.socket = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({
          action: 'join',
          game: 'backgammon',
          mode,
          roomCode: sanitizeRoomCode(ui.roomInput.value),
          name: getPlayerName(),
        }));
        render();
      };

      socket.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          showToast('Received an unreadable server update.');
          return;
        }
        handleOnlineMessage(payload);
      };

      socket.onerror = () => {
        setStatusMessage('The online connection had a problem.');
        render();
      };

      socket.onclose = () => {
        if (state.mode === 'online') {
          setStatusMessage('The online connection closed. Host again or rejoin the room.');
          render();
        }
      };
    } catch (error) {
      setStatusMessage('Could not open the multiplayer connection.');
      render();
    }
  }

  function startSolo() {
    disconnectSocket();
    cancelBotTurn();
    clearSelection();
    cleanupDrag();
    state.mode = 'solo';
    state.roomCode = 'SOLO';
    state.yourColor = Core.WHITE;
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    applyIncomingSnapshot(Core.createGameState(), 'Solo match started. White opens the race.');
  }

  function queueBotTurn() {
    cancelBotTurn();
    if (state.mode !== 'solo' || !state.snapshot || state.snapshot.winner || state.snapshot.current !== Core.BLACK) {
      return;
    }

    state.botTimer = window.setTimeout(() => {
      if (state.mode !== 'solo' || !state.snapshot || state.snapshot.winner || state.snapshot.current !== Core.BLACK) {
        return;
      }

      if (!state.snapshot.dice.length) {
        const roll = Core.rollDice(state.snapshot);
        if (roll.ok) {
          animateDiceRoll(roll.rolled[0], roll.rolled[1]);
          setStatusMessage(state.snapshot.status);
          render();
        }
      }

      if (!state.snapshot || state.snapshot.current !== Core.BLACK || !state.snapshot.dice.length || state.snapshot.winner) {
        render();
        return;
      }

      const pick = Core.chooseBestMove(state.snapshot, Core.BLACK, state.snapshot.dice);
      const move = pick?.move || Core.furthestMove(Core.getAllLegalMoves(state.snapshot, Core.BLACK), Core.BLACK);
      if (!move) {
        setStatusMessage('Bot had no legal move. Your turn.');
        render();
        return;
      }

      state.selected = move.from;
      state.legalForSelected = [move];
      scheduleDraw();

      window.setTimeout(() => {
        if (state.mode !== 'solo' || !state.snapshot || state.snapshot.current !== Core.BLACK) {
          return;
        }
        const result = Core.applyMove(state.snapshot, move);
        if (result.ok) {
          startMoveAnimation(result.move, Core.BLACK);
          setStatusMessage(state.snapshot.status);
          clearSelection();
          render();
          if (state.snapshot.current === Core.BLACK && !state.snapshot.winner) {
            queueBotTurn();
          }
        }
      }, 320);
    }, 480);
  }

  function sendMove(move) {
    if (state.mode === 'online') {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        showToast('The connection is not open.');
        return;
      }
      state.socket.send(JSON.stringify({
        action: 'move',
        from: move.from,
        to: move.to,
        di: move.di,
        die: move.die,
      }));
      clearSelection();
      render();
      return;
    }

    const result = Core.applyMove(state.snapshot, move);
    if (!result.ok) {
      showToast(result.error || 'That move is not legal.');
      return;
    }
    startMoveAnimation(result.move, controlledSide() || Core.WHITE);
    setStatusMessage(state.snapshot.status);
    clearSelection();
    render();
    queueBotTurn();
  }

  function rollTurn() {
    if (!canAct() || !state.snapshot || state.snapshot.winner) {
      return;
    }

    if (state.mode === 'online') {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        showToast('The connection is not open.');
        return;
      }
      state.socket.send(JSON.stringify({ action: 'roll' }));
      return;
    }

    const result = Core.rollDice(state.snapshot);
    if (!result.ok) {
      showToast(result.error || 'You cannot roll right now.');
      return;
    }
    animateDiceRoll(result.rolled[0], result.rolled[1]);
    setStatusMessage(state.snapshot.status);
    render();
    queueBotTurn();
  }

  function autoMove() {
    if (!canAct() || !state.snapshot || !state.snapshot.dice.length) {
      return;
    }
    const allMoves = Core.getAllLegalMoves(state.snapshot, state.snapshot.current);
    const move = Core.furthestMove(allMoves, state.snapshot.current);
    if (!move) {
      showToast('No legal move is available.');
      return;
    }
    state.selected = move.from;
    state.legalForSelected = [move];
    setStatusMessage('Auto-moving the clearest legal play.');
    sendMove(move);
  }

  function restartMatch() {
    cancelBotTurn();
    clearSelection();
    cleanupDrag();

    if (state.mode === 'online') {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ action: 'restart' }));
      }
      return;
    }

    startSolo();
  }

  function applySelectedSource(source) {
    if (!state.snapshot || !canAct()) {
      return false;
    }
    const legal = Core.getLegalMovesForSource(state.snapshot, source);
    if (!legal.length) {
      setStatusMessage('No legal move from that checker with the current dice.');
      showToast('That checker cannot move with this roll.');
      return false;
    }
    state.selected = source;
    state.legalForSelected = legal;
    setStatusMessage(`Selected ${source === 'bar' ? 'the bar' : `point ${source + 1}`}. Drop onto a glowing landing ring.`);
    render();
    return true;
  }

  function barCheckerPos(player, stackIndex) {
    return {
      x: W / 2,
      y: player === Core.WHITE ? H / 2 + 36 + stackIndex * 26 : H / 2 - 36 - stackIndex * 26,
      r: 20,
    };
  }

  function offTargetPos(player) {
    return {
      x: player === Core.WHITE ? W - 55 : 55,
      y: H / 2,
      r: 22,
    };
  }

  function spawnPulse(x, y, color) {
    state.anim.pulses.push({
      x,
      y,
      color: color || 'rgba(255,210,105,0.9)',
      start: performance.now(),
      duration: 520,
    });
  }

  function spawnTrailSpark(x, y, owner) {
    state.anim.trail.push({
      x,
      y,
      owner,
      start: performance.now(),
      duration: 260 + Math.random() * 220,
      driftX: (Math.random() - 0.5) * 18,
      driftY: -10 - Math.random() * 12,
      size: 3 + Math.random() * 4,
    });
  }

  function stackMetrics(point, count) {
    const rect = state.pointRects[point];
    const radius = Math.min(24, rect.w * 0.42);
    const available = rect.h - 64;
    const idealStep = radius * 2 + 2;
    const step = count <= 1
      ? 0
      : ((count - 1) * idealStep <= available ? idealStep : available / (count - 1));
    return { rect, radius, step };
  }

  function checkerPos(point, stackIndex, count) {
    const total = count === undefined ? Math.abs(state.snapshot.points[point]) : count;
    const { rect, radius, step } = stackMetrics(point, Math.max(1, total));
    const x = rect.x + rect.w / 2;
    const y = rect.top
      ? (rect.y + 32 + stackIndex * step)
      : (rect.y + rect.h * 2 - 32 - stackIndex * step);
    return { x, y, r: radius };
  }

  function startMoveAnimation(move, player) {
    if (!state.snapshot) {
      return;
    }
    const from = move.from === 'bar'
      ? barCheckerPos(player, Math.max(0, state.snapshot.bar[player] - 1))
      : checkerPos(move.from, Math.max(0, Math.abs(state.snapshot.points[move.from]) - 1));
    const to = move.to === 'off'
      ? offTargetPos(player)
      : checkerPos(move.to, Math.abs(state.snapshot.points[move.to]) + 1);
    state.anim.move = {
      owner: player,
      startX: from.x,
      startY: from.y,
      endX: to.x,
      endY: to.y,
      r: from.r,
      startedAt: performance.now(),
      duration: 430,
      lift: move.to === 'off' ? 34 : 24,
    };
  }

  function drawChecker(x, y, r, owner) {
    ctx.beginPath();
    ctx.ellipse(x + 3, y + r * 0.7, r * 0.86, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 2, x, y, r);
    if (owner === Core.WHITE) {
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#c8e5ff');
    } else {
      gradient.addColorStop(0, '#525872');
      gradient.addColorStop(1, '#090b16');
    }
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = owner === Core.WHITE ? 'rgba(88,235,255,.9)' : 'rgba(255,116,186,.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill();
  }

  function drawBoardBase() {
    ctx.clearRect(0, 0, W, H);
    const margin = 34;
    const boardX = margin;
    const boardY = margin;
    const boardW = W - margin * 2;
    const boardH = H - margin * 2;
    const middle = boardX + boardW / 2;

    const glow = ctx.createLinearGradient(boardX, boardY, boardX + boardW, boardY + boardH);
    glow.addColorStop(0, 'rgba(255, 196, 130, 0.17)');
    glow.addColorStop(1, 'rgba(118, 185, 226, 0.18)');
    ctx.fillStyle = glow;
    ctx.fillRect(boardX, boardY, boardW, boardH);

    const wood = ctx.createLinearGradient(boardX, boardY, boardX, boardY + boardH);
    wood.addColorStop(0, '#a26f47');
    wood.addColorStop(0.5, '#755036');
    wood.addColorStop(1, '#3b2a1d');
    ctx.fillStyle = wood;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(boardX + 8, boardY + 8, boardW - 16, boardH - 16);
    ctx.globalAlpha = 1;

    for (let index = 0; index < 26; index += 1) {
      const y = boardY + 10 + index * ((boardH - 20) / 26);
      ctx.strokeStyle = `rgba(255,255,255,${index % 2 ? 0.03 : 0.015})`;
      ctx.lineWidth = index % 2 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(boardX + 10, y);
      ctx.lineTo(boardX + boardW - 10, y + (index % 3) * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(middle - 25, boardY, 50, boardH);
    ctx.strokeStyle = 'rgba(179, 213, 236, .78)';
    ctx.lineWidth = 2;
    ctx.strokeRect(middle - 25, boardY, 50, boardH);

    const triangleW = (boardW - 50) / 12;
    state.pointRects.length = 24;

    const pointAt = (half, indexInHalf, top) => {
      const xBase = half === 0 ? boardX + indexInHalf * triangleW : middle + 25 + indexInHalf * triangleW;
      const pointIndex = top
        ? (half === 0 ? 12 + indexInHalf : 18 + indexInHalf)
        : (half === 0 ? 11 - indexInHalf : 5 - indexInHalf);
      state.pointRects[pointIndex] = { x: xBase, y: boardY, w: triangleW, h: boardH / 2, top };
      ctx.fillStyle = indexInHalf % 2 === 0 ? '#d9ac7a' : '#6ea8d1';
      ctx.beginPath();
      if (top) {
        ctx.moveTo(xBase + 1, boardY + 1);
        ctx.lineTo(xBase + triangleW - 1, boardY + 1);
        ctx.lineTo(xBase + triangleW / 2, boardY + boardH / 2 - 8);
      } else {
        ctx.moveTo(xBase + 1, boardY + boardH - 1);
        ctx.lineTo(xBase + triangleW - 1, boardY + boardH - 1);
        ctx.lineTo(xBase + triangleW / 2, boardY + boardH / 2 + 8);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    for (let index = 0; index < 6; index += 1) pointAt(0, index, true);
    for (let index = 0; index < 6; index += 1) pointAt(1, index, true);
    for (let index = 0; index < 6; index += 1) pointAt(0, index, false);
    for (let index = 0; index < 6; index += 1) pointAt(1, index, false);

    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = '14px Inter, sans-serif';
    for (let index = 0; index < 24; index += 1) {
      const rect = state.pointRects[index];
      ctx.fillText(String(index + 1), rect.x + rect.w / 2 - 6, rect.top ? boardY + boardH / 2 + 22 : boardY + boardH / 2 - 14);
    }
  }

  function drawCheckers() {
    if (!state.snapshot) {
      return;
    }
    for (let index = 0; index < 24; index += 1) {
      const count = Math.abs(state.snapshot.points[index]);
      const owner = Math.sign(state.snapshot.points[index]);
      if (!owner) {
        continue;
      }
      for (let stackIndex = 0; stackIndex < count; stackIndex += 1) {
        const point = checkerPos(index, stackIndex);
        drawChecker(point.x, point.y, point.r, owner);
      }
      const { step, radius } = stackMetrics(index, count);
      if (count > 1 && step < radius * 2 + 2) {
        const point = checkerPos(index, count - 1, count);
        ctx.fillStyle = owner === Core.WHITE ? '#0f1120' : '#f0f5ff';
        ctx.font = 'bold 16px Inter';
        ctx.fillText(`x${count}`, point.x - 11, point.y + 6);
      }
    }

    const barX = W / 2;
    for (let index = 0; index < Math.min(state.snapshot.bar[Core.WHITE], 5); index += 1) {
      drawChecker(barX, H / 2 + 36 + index * 26, 20, Core.WHITE);
    }
    for (let index = 0; index < Math.min(state.snapshot.bar[Core.BLACK], 5); index += 1) {
      drawChecker(barX, H / 2 - 36 - index * 26, 20, Core.BLACK);
    }
  }

  function drawPulses() {
    if (!state.anim.pulses.length) {
      return false;
    }
    const now = performance.now();
    state.anim.pulses = state.anim.pulses.filter((pulse) => {
      const time = (now - pulse.start) / pulse.duration;
      if (time >= 1) {
        return false;
      }
      const radius = 14 + time * 34;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = pulse.color.replace('0.9', String(Math.max(0.08, 0.9 - time * 0.9))).replace('0.95', String(Math.max(0.08, 0.95 - time * 0.9)));
      ctx.lineWidth = 4.6 - time * 3;
      ctx.stroke();
      return true;
    });
    return state.anim.pulses.length > 0;
  }

  function drawTrail() {
    if (!state.anim.trail.length) {
      return false;
    }
    const now = performance.now();
    state.anim.trail = state.anim.trail.filter((spark) => {
      const time = (now - spark.start) / spark.duration;
      if (time >= 1) {
        return false;
      }
      const fade = 1 - time;
      const x = spark.x + spark.driftX * time;
      const y = spark.y + spark.driftY * time;
      ctx.beginPath();
      ctx.arc(x, y, spark.size * fade, 0, Math.PI * 2);
      ctx.fillStyle = spark.owner === Core.WHITE
        ? `rgba(136, 225, 255, ${Math.max(0, fade * 0.75)})`
        : `rgba(255, 147, 194, ${Math.max(0, fade * 0.72)})`;
      ctx.fill();
      return true;
    });
    return state.anim.trail.length > 0;
  }

  function drawMoveAnimation() {
    if (!state.anim.move) {
      return false;
    }
    const now = performance.now();
    const move = state.anim.move;
    const raw = (now - move.startedAt) / move.duration;
    if (raw >= 1) {
      state.anim.move = null;
      return false;
    }
    const time = Math.max(0, Math.min(1, raw));
    const ease = time < 0.5 ? 4 * time * time * time : 1 - Math.pow(-2 * time + 2, 3) / 2;
    const arc = Math.sin(ease * Math.PI) * move.lift;
    const x = move.startX + (move.endX - move.startX) * ease;
    const y = move.startY + (move.endY - move.startY) * ease - arc;
    if (Math.random() < 0.45) {
      spawnTrailSpark(x, y, move.owner);
    }
    drawChecker(x, y, move.r, move.owner);
    return true;
  }

  function drawSelectionHints() {
    if (!state.snapshot) {
      return;
    }
    if (state.selected === 'bar') {
      ctx.strokeStyle = '#ffe78d';
      ctx.lineWidth = 4;
      ctx.strokeRect(W / 2 - 28, H / 2 - 86, 56, 172);
    } else if (Number.isInteger(state.selected)) {
      const count = Math.abs(state.snapshot.points[state.selected]);
      const point = checkerPos(state.selected, count - 1);
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffe78d';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    state.legalForSelected.forEach((move, index) => {
      let x;
      let y;
      if (move.to === 'off') {
        x = state.snapshot.current === Core.WHITE ? W - 55 : 55;
        y = H / 2;
      } else {
        const point = checkerPos(move.to, Math.abs(state.snapshot.points[move.to]) + 1);
        x = point.x;
        y = point.y;
      }
      ctx.beginPath();
      ctx.arc(x, y, 18 + index * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,210,105,.95)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,210,105,.18)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Inter';
      ctx.fillText(String(move.die), x - 4, y + 5);
    });
  }

  function draw() {
    drawBoardBase();
    drawCheckers();
    const pulseActive = drawPulses();
    const trailActive = drawTrail();
    drawSelectionHints();
    const moveActive = drawMoveAnimation();
    if (state.drag) {
      drawChecker(state.drag.mx, state.drag.my, state.drag.r, controlledSide() || Core.WHITE);
    }
    if (pulseActive || trailActive || moveActive) {
      requestAnimationFrame(draw);
    }
  }

  function scheduleDraw() {
    if (state.drawQueued) {
      return;
    }
    state.drawQueued = true;
    requestAnimationFrame(() => {
      state.drawQueued = false;
      draw();
    });
  }

  function getBoardPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      mx: (event.clientX - rect.left) * (W / rect.width),
      my: (event.clientY - rect.top) * (H / rect.height),
    };
  }

  function pickSource(mx, my) {
    if (!state.snapshot) {
      return null;
    }
    if (state.snapshot.bar[state.snapshot.current] > 0) {
      return mx > W / 2 - 45 && mx < W / 2 + 45 && my > H / 2 - 120 && my < H / 2 + 120 ? 'bar' : null;
    }
    for (let index = 0; index < 24; index += 1) {
      const rect = state.pointRects[index];
      if (mx < rect.x || mx > rect.x + rect.w) {
        continue;
      }
      if (rect.top && my > H / 2) {
        continue;
      }
      if (!rect.top && my < H / 2) {
        continue;
      }
      const value = state.snapshot.points[index];
      if ((state.snapshot.current === Core.WHITE && value > 0) || (state.snapshot.current === Core.BLACK && value < 0)) {
        return index;
      }
    }
    return null;
  }

  function pickMove(mx, my) {
    for (const move of state.legalForSelected) {
      if (move.to === 'off') {
        const x = state.snapshot.current === Core.WHITE ? W - 55 : 55;
        const y = H / 2;
        if (Math.hypot(mx - x, my - y) < 32 + hitRadiusBoost) {
          return move;
        }
      } else {
        const point = checkerPos(move.to, Math.abs(state.snapshot.points[move.to]) + 1);
        if (Math.hypot(mx - point.x, my - point.y) < point.r + 20 + hitRadiusBoost) {
          return move;
        }
      }
    }
    return null;
  }

  function beginDrag(mx, my) {
    if (!canAct()) {
      return false;
    }
    if (!state.snapshot.dice.length) {
      setStatusMessage('Roll dice first.');
      return false;
    }
    const source = pickSource(mx, my);
    if (source === null || !applySelectedSource(source)) {
      return false;
    }
    state.drag = { source, mx, my, r: 24 };
    scheduleDraw();
    return true;
  }

  function updateDrag(mx, my) {
    if (!state.drag) {
      return;
    }
    state.drag.mx = mx;
    state.drag.my = my;
    scheduleDraw();
  }

  function finishDrag(mx, my) {
    if (!state.drag) {
      return;
    }
    const move = pickMove(mx, my);
    state.drag = null;
    if (move) {
      sendMove(move);
      return;
    }
    setStatusMessage('Drop on a glowing destination to move the checker.');
    scheduleDraw();
  }

  async function copyText(value, successMessage) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage);
    } catch (error) {
      showToast('Copy failed on this browser.');
    }
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
    ui.soloBtn.addEventListener('click', startSolo);
    ui.rollBtn.addEventListener('click', rollTurn);
    ui.autoBtn.addEventListener('click', autoMove);
    ui.restartBtn.addEventListener('click', restartMatch);
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));

    canvas.addEventListener('click', (event) => {
      if (!canAct() || !state.snapshot) {
        return;
      }
      if (!state.snapshot.dice.length) {
        setStatusMessage('Roll dice first.');
        return;
      }
      const { mx, my } = getBoardPos(event);
      if (state.selected !== null) {
        const move = pickMove(mx, my);
        if (move) {
          sendMove(move);
          return;
        }
      }
      const source = pickSource(mx, my);
      if (source === null) {
        clearSelection();
        render();
        return;
      }
      applySelectedSource(source);
    });

    canvas.addEventListener('dblclick', (event) => {
      if (!canAct() || !state.snapshot || !state.snapshot.dice.length) {
        return;
      }
      const { mx, my } = getBoardPos(event);
      const source = pickSource(mx, my);
      if (source === null) {
        return;
      }
      const legal = Core.getLegalMovesForSource(state.snapshot, source);
      const move = Core.furthestMove(legal, state.snapshot.current);
      if (!move) {
        return;
      }
      state.selected = source;
      state.legalForSelected = [move];
      setStatusMessage('Auto-moving that checker to the furthest legal destination.');
      sendMove(move);
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      canvas.setPointerCapture(event.pointerId);
      const { mx, my } = getBoardPos(event);
      beginDrag(mx, my);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!state.drag) {
        return;
      }
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      const { mx, my } = getBoardPos(event);
      updateDrag(mx, my);
    });
    const endPointerDrag = (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      const { mx, my } = getBoardPos(event);
      finishDrag(mx, my);
    };
    canvas.addEventListener('pointerup', endPointerDrag);
    canvas.addEventListener('pointercancel', () => {
      cleanupDrag();
      scheduleDraw();
    });
    canvas.addEventListener('pointerleave', () => {
      cleanupDrag();
      scheduleDraw();
    });
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'Space') {
        return;
      }
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) {
        return;
      }
      event.preventDefault();
      rollTurn();
    });
    window.addEventListener('resize', syncDiceRestPose);
  }

  function hydrateSettings() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(localStorage.getItem(STORAGE_KEYS.serverUrl) || query.get('server') || '');
    ui.serverUrlInput.value = state.serverUrl;
    ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
  }

  function bootFromQuery() {
    if (ui.roomInput.value) {
      connectOnline('join');
      return;
    }
    render();
  }

  initDiceVisuals();
  hydrateSettings();
  bindEvents();
  render();
  bootFromQuery();
})();
