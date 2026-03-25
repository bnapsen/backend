(() => {
  'use strict';

  const Core = window.NeonChessCore;
  const STORAGE_KEYS = {
    name: 'neonCrownChess.name',
    serverUrl: 'neonCrownChess.serverUrl',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const query = new URLSearchParams(window.location.search);

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    yourColor: null,
    roomCode: '',
    serverUrl: '',
    statusMessage: '',
    selected: null,
    legalMoves: [],
    promotionRequest: null,
    toastTimer: null,
    botTimer: null,
    flipBoard: false,
    pieceElements: new Map(),
  };

  const ui = {
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    turnText: document.getElementById('turnText'),
    phaseText: document.getElementById('phaseText'),
    winnerText: document.getElementById('winnerText'),
    presenceText: document.getElementById('presenceText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    boardGrid: document.getElementById('boardGrid'),
    playerCards: document.getElementById('playerCards'),
    historyList: document.getElementById('historyList'),
    historyStatus: document.getElementById('historyStatus'),
    legendList: document.getElementById('legendList'),
    whiteCaptured: document.getElementById('whiteCaptured'),
    blackCaptured: document.getElementById('blackCaptured'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    flipBtn: document.getElementById('flipBtn'),
    promotionModal: document.getElementById('promotionModal'),
    promotionOptions: document.getElementById('promotionOptions'),
    toast: document.getElementById('toast'),
    stepOne: document.getElementById('stepOne'),
    stepTwo: document.getElementById('stepTwo'),
    stepThree: document.getElementById('stepThree'),
  };

  const boardSquares = document.createElement('div');
  boardSquares.className = 'board-squares';
  const pieceLayer = document.createElement('div');
  pieceLayer.className = 'board-piece-layer';
  ui.boardGrid.append(boardSquares, pieceLayer);

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

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
  }

  function getPlayerName() {
    return ui.nameInput.value.trim().slice(0, 18) || 'Player';
  }

  function defaultOrientation() {
    if (state.mode === 'online' && state.yourColor === 'black') {
      return 'black';
    }
    return 'white';
  }

  function currentOrientation() {
    const base = defaultOrientation();
    if (!state.flipBoard) {
      return base;
    }
    return base === 'white' ? 'black' : 'white';
  }

  function displayCoords(x, y) {
    const orientation = currentOrientation();
    if (orientation === 'white') {
      return { displayX: x, displayY: y };
    }
    return {
      displayX: 7 - x,
      displayY: 7 - y,
    };
  }

  function boardCoords(displayX, displayY) {
    const orientation = currentOrientation();
    if (orientation === 'white') {
      return { x: displayX, y: displayY };
    }
    return {
      x: 7 - displayX,
      y: 7 - displayY,
    };
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
    ui.statusText.textContent = state.statusMessage || 'Host a match to create an invite link, join with a code from a friend, or play solo against the practice bot.';
  }

  function inviteUrl() {
    if (!state.roomCode || state.mode !== 'online') {
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
            <div class="player-color-label">${capitalize(color)} pieces</div>
          </div>
          <span class="inline-chip empty-chip">Waiting</span>
        </div>
      </div>
    `;
  }

  function renderPlayers() {
    if (!state.snapshot) {
      ui.playerCards.innerHTML = `${emptySeatCard('white')}${emptySeatCard('black')}`;
      ui.presenceText.textContent = 'Waiting for players...';
      return;
    }

    const players = Array.isArray(state.snapshot.players) ? state.snapshot.players : [];
    const byColor = new Map(players.map((player) => [player.color, player]));
    const cards = Core.COLORS.map((color) => {
      const player = byColor.get(color);
      if (!player) {
        return emptySeatCard(color);
      }
      const active = state.snapshot.turn === color && !state.snapshot.winner && !state.snapshot.drawReason;
      return `
        <div class="player-card ${active ? 'active-seat' : ''}">
          <div class="player-head">
            <div>
              <div class="player-name">${player.name}</div>
              <div class="player-color-label">${capitalize(color)} pieces</div>
            </div>
            <span class="inline-chip ${active ? 'turn-chip' : ''}">
              ${active ? 'Turn' : player.id === 'solo-bot' ? 'Bot' : 'Ready'}
            </span>
          </div>
        </div>
      `;
    }).join('');

    ui.playerCards.innerHTML = cards;

    if (state.mode === 'solo') {
      ui.presenceText.textContent = 'Solo practice against Crown Bot.';
    } else {
      ui.presenceText.textContent = `${players.length}/2 players connected`;
    }
  }

  function renderHistory() {
    const history = state.snapshot && Array.isArray(state.snapshot.history) ? state.snapshot.history : [];
    if (!history.length) {
      ui.historyList.innerHTML = '';
      ui.historyStatus.textContent = 'No moves yet.';
      return;
    }

    ui.historyStatus.textContent = `${history.length} move${history.length === 1 ? '' : 's'} played`;
    ui.historyList.innerHTML = history.map((entry) => `
      <li>
        <span class="move-index">${entry.color === 'white' ? `${entry.fullMove}.` : `${entry.fullMove}...`}</span>
        <span>${entry.notation}</span>
      </li>
    `).join('');
  }

  function renderCaptured() {
    const captured = state.snapshot ? state.snapshot.captured : { white: [], black: [] };
    ui.whiteCaptured.innerHTML = captured.white.length
      ? captured.white.map((piece) => `<span class="capture-chip" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
    ui.blackCaptured.innerHTML = captured.black.length
      ? captured.black.map((piece) => `<span class="capture-chip" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
  }

  function renderLegend() {
    const items = [
      {
        title: 'Standard rules',
        body: 'Castling, en passant, promotion, check, checkmate, stalemate, and the fifty-move rule are all supported.',
        token: '\u2654',
      },
      {
        title: 'Smooth remote play',
        body: 'The backend validates every move so both browsers stay synced, even if someone refreshes or reconnects later.',
        token: '\u2194',
      },
      {
        title: 'Solo warm-up',
        body: 'Play against Crown Bot while you wait. It is lightweight, quick, and strong enough for casual practice.',
        token: '\u2699',
      },
    ];

    ui.legendList.innerHTML = items.map((item) => `
      <div class="legend-item">
        <span class="piece-token">${item.token}</span>
        <div class="legend-copy">
          <strong>${item.title}</strong>
          <span>${item.body}</span>
        </div>
      </div>
    `).join('');
  }

  function boardPieceAt(x, y) {
    return state.snapshot ? Core.getPiece(state.snapshot.board, x, y) : null;
  }

  function getControlledColor() {
    if (state.mode === 'solo') {
      return 'white';
    }
    return state.yourColor;
  }

  function canInteract() {
    if (!state.snapshot || state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    const color = getControlledColor();
    return Boolean(color && state.snapshot.turn === color);
  }

  function renderBoardSquares() {
    boardSquares.innerHTML = '';
    const lastMove = state.snapshot ? state.snapshot.lastMove : null;
    const legalSet = new Map(state.legalMoves.map((move) => [`${move.x},${move.y}`, move]));
    const checkedColor = state.snapshot ? state.snapshot.check : null;

    for (let displayY = 0; displayY < 8; displayY += 1) {
      for (let displayX = 0; displayX < 8; displayX += 1) {
        const actual = boardCoords(displayX, displayY);
        const square = document.createElement('button');
        square.type = 'button';
        square.className = `board-square ${(actual.x + actual.y) % 2 === 0 ? 'light' : 'dark'}`;
        square.addEventListener('click', () => handleSquare(actual.x, actual.y));

        const key = `${actual.x},${actual.y}`;
        if (state.selected && state.selected.x === actual.x && state.selected.y === actual.y) {
          square.classList.add('selected');
        }
        if (
          lastMove &&
          ((lastMove.from.x === actual.x && lastMove.from.y === actual.y) || (lastMove.to.x === actual.x && lastMove.to.y === actual.y))
        ) {
          square.classList.add('last-move');
        }

        const piece = boardPieceAt(actual.x, actual.y);
        if (checkedColor && piece && piece.type === 'king' && piece.color === checkedColor) {
          square.classList.add('check');
        }

        const move = legalSet.get(key);
        if (move) {
          const marker = document.createElement('span');
          marker.className = move.capture ? 'move-ring' : 'move-dot';
          square.appendChild(marker);
        }

        if (displayY === 7) {
          const label = document.createElement('span');
          label.className = `square-label file ${(actual.x + actual.y) % 2 === 0 ? 'light-label' : 'dark-label'}`;
          label.textContent = Core.FILES[actual.x];
          square.appendChild(label);
        }

        if (displayX === 0) {
          const label = document.createElement('span');
          label.className = `square-label rank ${(actual.x + actual.y) % 2 === 0 ? 'light-label' : 'dark-label'}`;
          label.textContent = String(8 - actual.y);
          square.appendChild(label);
        }

        boardSquares.appendChild(square);
      }
    }
  }

  function renderPieces() {
    const seen = new Set();
    const selectedId = state.selected ? (boardPieceAt(state.selected.x, state.selected.y) || {}).id : null;
    const lastMove = state.snapshot ? state.snapshot.lastMove : null;

    if (!state.snapshot) {
      for (const element of state.pieceElements.values()) {
        element.remove();
      }
      state.pieceElements.clear();
      return;
    }

    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = boardPieceAt(x, y);
        if (!piece) {
          continue;
        }

        const { displayX, displayY } = displayCoords(x, y);
        let element = state.pieceElements.get(piece.id);
        if (!element) {
          element = document.createElement('button');
          element.type = 'button';
          element.className = 'board-piece piece-ghost';
          element.dataset.id = piece.id;
          element.innerHTML = '<span class="piece-face"></span>';
          pieceLayer.appendChild(element);
          state.pieceElements.set(piece.id, element);
          requestAnimationFrame(() => {
            element.classList.remove('piece-ghost');
          });
        }

        const isMovedPiece = Boolean(lastMove && lastMove.to.x === x && lastMove.to.y === y);
        element.className = `board-piece ${piece.color}${piece.id === selectedId ? ' active' : ''}${isMovedPiece ? ' moved' : ''}`;
        element.style.setProperty('--x', `calc(var(--square-size) * ${displayX})`);
        element.style.setProperty('--y', `calc(var(--square-size) * ${displayY})`);
        element.querySelector('.piece-face').textContent = Core.getPieceGlyph(piece);
        element.onclick = (event) => {
          event.stopPropagation();
          handleSquare(x, y);
        };
        seen.add(piece.id);
      }
    }

    for (const [id, element] of Array.from(state.pieceElements.entries())) {
      if (seen.has(id)) {
        continue;
      }
      element.classList.add('piece-ghost');
      window.setTimeout(() => {
        element.remove();
      }, 150);
      state.pieceElements.delete(id);
    }
  }

  function renderBoard() {
    renderBoardSquares();
    renderPieces();
  }

  function renderSummary() {
    if (!state.snapshot) {
      ui.roomCodeLabel.textContent = '-';
      ui.turnText.textContent = 'Waiting to begin';
      ui.phaseText.textContent = 'Start a match to begin.';
      ui.winnerText.textContent = 'No game running yet.';
      return;
    }

    const playerCount = Array.isArray(state.snapshot.players) ? state.snapshot.players.length : 0;
    ui.roomCodeLabel.textContent = state.roomCode || state.snapshot.roomCode || '-';
    ui.turnText.textContent = `${capitalize(state.snapshot.turn)} to move`;
    ui.phaseText.textContent = state.snapshot.status || 'Match in progress.';

    if (state.snapshot.winner) {
      ui.winnerText.textContent = `${capitalize(state.snapshot.winner)} wins by checkmate.`;
    } else if (state.snapshot.drawReason) {
      ui.winnerText.textContent = state.snapshot.status;
    } else if (state.mode === 'online' && playerCount < 2) {
      ui.winnerText.textContent = 'Waiting for the second player to join.';
    } else {
      ui.winnerText.textContent = 'Game in progress.';
    }
  }

  function renderPills() {
    if (state.mode === 'solo') {
      ui.networkStatus.dataset.tone = 'online';
      ui.networkStatus.textContent = 'Solo';
      ui.modePill.textContent = 'Practice match';
      return;
    }

    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      ui.networkStatus.dataset.tone = 'online';
      ui.networkStatus.textContent = 'Online';
    } else if (state.socket && state.socket.readyState === WebSocket.CONNECTING) {
      ui.networkStatus.dataset.tone = 'connecting';
      ui.networkStatus.textContent = 'Connecting';
    } else if (state.mode === 'online') {
      ui.networkStatus.dataset.tone = 'error';
      ui.networkStatus.textContent = 'Disconnected';
    } else {
      ui.networkStatus.dataset.tone = 'offline';
      ui.networkStatus.textContent = 'Offline';
    }

    if (state.mode === 'online') {
      ui.modePill.textContent = state.roomCode ? `Online room ${state.roomCode}` : 'Online setup';
    } else {
      ui.modePill.textContent = 'No match running';
    }
  }

  function renderControls() {
    const hasRoom = Boolean(state.roomCode && state.mode === 'online');
    ui.hostBtn.disabled = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    ui.joinBtn.disabled = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING) || !sanitizeRoomCode(ui.roomInput.value);
    ui.restartBtn.disabled = !state.snapshot;
    ui.flipBtn.disabled = !state.snapshot;
    ui.copyBtn.disabled = !hasRoom;
    ui.copyCodeBtn.disabled = !hasRoom;

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
    renderHistory();
    renderCaptured();
    renderBoard();
    renderControls();
  }

  function clearSelection() {
    state.selected = null;
    state.legalMoves = [];
    renderBoard();
  }

  function openPromotion(move) {
    state.promotionRequest = move;
    ui.promotionOptions.innerHTML = Core.PROMOTIONS.map((pieceType) => `
      <button type="button" class="promotion-choice" data-piece="${pieceType}">
        ${Core.PIECES[pieceType].glyphs.white} ${Core.PIECES[pieceType].name}
      </button>
    `).join('');

    for (const button of ui.promotionOptions.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const promotion = button.getAttribute('data-piece');
        ui.promotionModal.classList.add('hidden');
        const pending = state.promotionRequest;
        state.promotionRequest = null;
        submitMove({ ...pending, promotion });
      });
    }

    ui.promotionModal.classList.remove('hidden');
  }

  function closePromotion() {
    state.promotionRequest = null;
    ui.promotionModal.classList.add('hidden');
  }

  function decorateSoloSnapshot(snapshot) {
    const soloState = Core.cloneState(snapshot);
    soloState.roomCode = 'SOLO';
    soloState.maxPlayers = 2;
    soloState.players = [
      { id: 'solo-human', name: getPlayerName(), color: 'white' },
      { id: 'solo-bot', name: 'Crown Bot', color: 'black' },
    ];
    soloState.service = 'solo';
    return soloState;
  }

  function chooseBotMove(snapshot, color) {
    const moves = Core.getAllLegalMoves(snapshot, color);
    if (!moves.length) {
      return null;
    }

    let bestScore = -Infinity;
    let bestMove = moves[0];

    function evaluateBoard(current) {
      let score = 0;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const piece = Core.getPiece(current.board, x, y);
          if (!piece) {
            continue;
          }
          const value = Core.PIECES[piece.type].value;
          const centerBonus = (x >= 2 && x <= 5 && y >= 2 && y <= 5) ? 0.18 : 0;
          score += piece.color === color ? value + centerBonus : -(value + centerBonus);
        }
      }
      if (current.winner === color) score += 100000;
      if (current.winner === Core.otherColor(color)) score -= 100000;
      if (current.drawReason) score -= 15;
      if (current.check === Core.otherColor(color)) score += 2.5;
      return score;
    }

    for (const move of moves) {
      const sandbox = Core.cloneState(snapshot);
      const result = Core.applyMove(sandbox, {
        from: move.from,
        to: move.to,
        promotion: move.promotionRequired ? 'queen' : undefined,
      });
      if (!result.ok) {
        continue;
      }
      const score = evaluateBoard(sandbox);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  function queueBotTurn() {
    window.clearTimeout(state.botTimer);
    state.botTimer = window.setTimeout(() => {
      if (state.mode !== 'solo' || !state.snapshot || state.snapshot.turn !== 'black' || state.snapshot.winner || state.snapshot.drawReason) {
        return;
      }

      const botMove = chooseBotMove(state.snapshot, 'black');
      if (!botMove) {
        return;
      }

      const sandbox = Core.cloneState(state.snapshot);
      const result = Core.applyMove(sandbox, {
        from: botMove.from,
        to: botMove.to,
        promotion: botMove.promotionRequired ? 'queen' : undefined,
      });

      if (!result.ok) {
        return;
      }

      state.snapshot = decorateSoloSnapshot(sandbox);
      setStatusMessage(state.snapshot.status);
      clearSelection();
      render();
    }, 550);
  }

  function submitMove(move) {
    closePromotion();

    if (state.mode === 'online') {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        showToast('The connection is not open.');
        return;
      }
      state.socket.send(JSON.stringify({
        action: 'move',
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      }));
      clearSelection();
      return;
    }

    if (state.mode === 'solo') {
      const sandbox = Core.cloneState(state.snapshot);
      const result = Core.applyMove(sandbox, move);
      if (!result.ok) {
        showToast(result.error || 'That move is not legal.');
        return;
      }
      state.snapshot = decorateSoloSnapshot(sandbox);
      setStatusMessage(state.snapshot.status);
      clearSelection();
      render();
      queueBotTurn();
    }
  }

  function handleSquare(x, y) {
    if (!state.snapshot) {
      return;
    }

    const piece = boardPieceAt(x, y);
    const controlledColor = getControlledColor();
    const interactive = canInteract();

    if (state.selected) {
      const destination = state.legalMoves.find((move) => move.x === x && move.y === y);
      if (destination && interactive) {
        const move = {
          from: { ...state.selected },
          to: { x, y },
        };
        if (destination.promotionRequired) {
          openPromotion(move);
        } else {
          submitMove(move);
        }
        return;
      }
    }

    if (interactive && piece && piece.color === controlledColor) {
      state.selected = { x, y };
      state.legalMoves = Core.getLegalMoves(state.snapshot, x, y);
      renderBoard();
      return;
    }

    clearSelection();
  }

  function updateFromServerSnapshot(snapshot, message) {
    state.snapshot = snapshot;
    state.roomCode = snapshot.roomCode;
    ui.roomInput.value = snapshot.roomCode;
    if (state.selected) {
      const selectedPiece = boardPieceAt(state.selected.x, state.selected.y);
      if (!selectedPiece || selectedPiece.color !== getControlledColor() || !canInteract()) {
        clearSelection();
      }
    }
    setStatusMessage(message || snapshot.status || 'Match updated.');
    render();
  }

  function disconnectSocket() {
    if (!state.socket) {
      return;
    }
    const socket = state.socket;
    state.socket = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch (error) {
      // Ignore close failures.
    }
  }

  function connectOnline(mode) {
    const name = getPlayerName();
    const roomCode = sanitizeRoomCode(ui.roomInput.value);
    if (mode === 'join' && !roomCode) {
      showToast('Enter the room code from your host.');
      return;
    }

    disconnectSocket();
    window.clearTimeout(state.botTimer);
    closePromotion();
    state.mode = 'online';
    state.yourColor = null;
    state.snapshot = null;
    state.roomCode = roomCode;
    state.selected = null;
    state.legalMoves = [];
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    setStatusMessage(mode === 'host'
      ? 'Creating your room and opening the connection...'
      : 'Joining the room and syncing the board...');
    render();

    const socket = new WebSocket(state.serverUrl);
    state.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        action: 'join',
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
        state.yourColor = payload.color;
        state.roomCode = payload.roomCode;
        ui.roomInput.value = payload.roomCode;
        setStatusMessage(`${capitalize(payload.color)} pieces are yours. Share the invite link when you are ready.`);
        render();
        return;
      }

      if (payload.type === 'state') {
        updateFromServerSnapshot(payload.snapshot, payload.message);
        return;
      }

      if (payload.type === 'error') {
        showToast(payload.message || 'The server reported an error.');
        setStatusMessage(payload.message || 'Unable to complete that action.');
      }
    };

    socket.onerror = () => {
      setStatusMessage('The connection hit an error. Check the server URL and try again.');
      render();
    };

    socket.onclose = () => {
      state.socket = null;
      if (state.mode === 'online') {
        setStatusMessage('The online connection closed. Host again or rejoin the room to continue.');
        render();
      }
    };
  }

  function startSolo() {
    disconnectSocket();
    window.clearTimeout(state.botTimer);
    closePromotion();
    state.mode = 'solo';
    state.yourColor = 'white';
    state.roomCode = 'SOLO';
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    state.snapshot = decorateSoloSnapshot(Core.createGameState());
    state.selected = null;
    state.legalMoves = [];
    setStatusMessage('Solo practice started. You control White and Crown Bot controls Black.');
    render();
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
      if (state.mode === 'solo' && state.snapshot) {
        state.snapshot = decorateSoloSnapshot(state.snapshot);
        render();
        return;
      }
      renderControls();
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
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.restartBtn.addEventListener('click', () => {
      closePromotion();
      clearSelection();
      if (state.mode === 'online') {
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify({ action: 'restart' }));
        }
        return;
      }
      if (state.mode === 'solo') {
        startSolo();
      }
    });
    ui.flipBtn.addEventListener('click', () => {
      state.flipBoard = !state.flipBoard;
      renderBoard();
    });
    ui.promotionModal.addEventListener('click', (event) => {
      if (event.target === ui.promotionModal) {
        closePromotion();
      }
    });
  }

  function init() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(query.get('server') || localStorage.getItem(STORAGE_KEYS.serverUrl) || PROD_SERVER_URL);
    ui.serverUrlInput.value = state.serverUrl;
    const inviteRoom = sanitizeRoomCode(query.get('room'));
    if (inviteRoom) {
      ui.roomInput.value = inviteRoom;
      setStatusMessage('Invite link loaded. Enter your name and press Join match.');
    } else {
      renderStatus();
    }

    renderLegend();
    bindEvents();
    render();
  }

  init();
})();
