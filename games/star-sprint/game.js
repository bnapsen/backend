(() => {
  'use strict';

  const STORAGE_KEYS = {
    name: 'astralDominion.name',
    serverUrl: 'astralDominion.serverUrl',
  };
  const query = new URLSearchParams(window.location.search);
  const BOARD_SIZE = 10;
  const MAX_PLAYERS = 2;
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const BACK_RANK = ['bastion', 'knight', 'seer', 'sentinel', 'crown', 'vanguard', 'sentinel', 'seer', 'knight', 'bastion'];
  const PROMOTIONS = ['vanguard', 'bastion', 'seer', 'knight', 'sentinel'];
  const PIECES = {
    crown: { name: 'Crown', mark: 'C', mini: 'KR', value: 1000, desc: 'Moves 1 square in any direction. Lose it and the battle ends.' },
    bastion: { name: 'Bastion', mark: 'B', mini: 'RO', value: 9, desc: 'Slides any number of squares orthogonally.' },
    seer: { name: 'Seer', mark: 'S', mini: 'BI', value: 7, desc: 'Slides any number of squares diagonally.' },
    knight: { name: 'Knight', mark: 'K', mini: 'LN', value: 5, desc: 'Leaps in an L shape and ignores blockers.' },
    sentinel: { name: 'Sentinel', mark: 'T', mini: 'JP', value: 5, desc: 'Jumps exactly 2 squares orthogonally or diagonally.' },
    vanguard: { name: 'Vanguard', mark: 'V', mini: 'VG', value: 8, desc: 'Moves up to 2 squares in any direction without jumping.' },
    warden: { name: 'Warden', mark: 'W', mini: 'PN', value: 2, desc: 'Marches forward, captures diagonally, and promotes on the far rank.' },
  };
  const files = 'abcdefghij';

  const state = {
    mode: 'idle',
    socket: null,
    snapshot: null,
    roomCode: '',
    yourColor: null,
    isHost: false,
    serverUrl: '',
    selected: null,
    legalMoves: [],
    promotionContext: null,
    toastTimer: null,
    botTimer: null,
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
    promotionModal: document.getElementById('promotionModal'),
    promotionOptions: document.getElementById('promotionOptions'),
    toast: document.getElementById('toast'),
    stepOne: document.getElementById('stepOne'),
    stepTwo: document.getElementById('stepTwo'),
    stepThree: document.getElementById('stepThree'),
  };

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeServerUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return state.serverUrl;
    if (/^wss?:\/\//i.test(trimmed)) return trimmed;
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${trimmed}`;
  }

  function generateRoomCode() {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    return code;
  }

  function insideBoard(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
  }

  function getPiece(board, x, y) {
    if (!insideBoard(x, y)) return null;
    return board[y][x];
  }

  function clonePiece(piece) {
    return piece ? { ...piece } : null;
  }

  function cloneSnapshot(snapshot) {
    return {
      ...snapshot,
      players: snapshot.players.map((player) => ({ ...player })),
      captured: {
        white: [...snapshot.captured.white],
        black: [...snapshot.captured.black],
      },
      history: [...snapshot.history],
      board: snapshot.board.map((row) => row.map((piece) => clonePiece(piece))),
    };
  }

  function createPiece(type, color) {
    return {
      id: `${color}-${type}-${Math.random().toString(16).slice(2, 10)}`,
      type,
      color,
      moved: false,
    };
  }

  function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      board[0][x] = createPiece(BACK_RANK[x], 'black');
      board[1][x] = createPiece('warden', 'black');
      board[BOARD_SIZE - 2][x] = createPiece('warden', 'white');
      board[BOARD_SIZE - 1][x] = createPiece(BACK_RANK[x], 'white');
    }
    return board;
  }

  function createSoloSnapshot(name) {
    return {
      title: 'Astral Dominion',
      roomCode: 'SOLO',
      boardSize: BOARD_SIZE,
      board: createInitialBoard(),
      maxPlayers: MAX_PLAYERS,
      players: [
        { id: 'solo-white', name, color: 'white' },
        { id: 'solo-bot', name: 'Void Regent', color: 'black' },
      ],
      turn: 'white',
      winner: null,
      moveCount: 1,
      captured: { white: [], black: [] },
      history: [],
      promotions: [...PROMOTIONS],
      pieceInfo: Object.fromEntries(Object.entries(PIECES).map(([key, value]) => [key, value.name])),
    };
  }

  function pushStepMove(board, piece, moves, x, y) {
    if (!insideBoard(x, y)) return;
    const target = getPiece(board, x, y);
    if (!target || target.color !== piece.color) {
      moves.push({ x, y });
    }
  }

  function pushSlidingMoves(board, piece, x, y, directions, maxSteps = BOARD_SIZE) {
    const moves = [];
    for (const [dx, dy] of directions) {
      for (let step = 1; step <= maxSteps; step += 1) {
        const nextX = x + (dx * step);
        const nextY = y + (dy * step);
        if (!insideBoard(nextX, nextY)) break;
        const target = getPiece(board, nextX, nextY);
        if (!target) {
          moves.push({ x: nextX, y: nextY });
          continue;
        }
        if (target.color !== piece.color) {
          moves.push({ x: nextX, y: nextY });
        }
        break;
      }
    }
    return moves;
  }

  function getLegalMoves(board, x, y) {
    const piece = getPiece(board, x, y);
    if (!piece) return [];
    const moves = [];

    switch (piece.type) {
      case 'crown':
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (dx === 0 && dy === 0) continue;
            pushStepMove(board, piece, moves, x + dx, y + dy);
          }
        }
        return moves;

      case 'bastion':
        return pushSlidingMoves(board, piece, x, y, [[1, 0], [-1, 0], [0, 1], [0, -1]]);

      case 'seer':
        return pushSlidingMoves(board, piece, x, y, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);

      case 'vanguard':
        return pushSlidingMoves(
          board,
          piece,
          x,
          y,
          [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
          2
        );

      case 'knight': {
        const deltas = [
          [1, 2], [2, 1], [2, -1], [1, -2],
          [-1, -2], [-2, -1], [-2, 1], [-1, 2],
        ];
        for (const [dx, dy] of deltas) {
          pushStepMove(board, piece, moves, x + dx, y + dy);
        }
        return moves;
      }

      case 'sentinel': {
        const deltas = [
          [2, 0], [-2, 0], [0, 2], [0, -2],
          [2, 2], [2, -2], [-2, 2], [-2, -2],
        ];
        for (const [dx, dy] of deltas) {
          pushStepMove(board, piece, moves, x + dx, y + dy);
        }
        return moves;
      }

      case 'warden': {
        const forward = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ? BOARD_SIZE - 2 : 1;
        const nextY = y + forward;

        if (insideBoard(x, nextY) && !getPiece(board, x, nextY)) {
          moves.push({ x, y: nextY });
          const jumpY = y + (forward * 2);
          if (y === startRow && !getPiece(board, x, jumpY)) {
            moves.push({ x, y: jumpY });
          }
        }

        for (const dx of [-1, 1]) {
          const targetX = x + dx;
          const target = getPiece(board, targetX, nextY);
          if (target && target.color !== piece.color) {
            moves.push({ x: targetX, y: nextY });
          }
        }
        return moves;
      }

      default:
        return [];
    }
  }

  function currentPlayer() {
    return state.snapshot?.players?.find((player) => player.color === state.yourColor) || null;
  }

  function canAct() {
    return Boolean(state.snapshot && !state.snapshot.winner && state.snapshot.turn === state.yourColor);
  }

  function coordToNotation(x, y) {
    return `${files[x]}${BOARD_SIZE - y}`;
  }

  function promotionNeeded(piece, toY) {
    return piece.type === 'warden' && (toY === 0 || toY === BOARD_SIZE - 1);
  }

  function formatMoveText(piece, from, to, capturedPiece, promotion, turnColor, moveCount) {
    const prefix = turnColor === 'white' ? `${Math.ceil(moveCount / 2)}.` : '...';
    const captureMark = capturedPiece ? 'x' : '-';
    const promotionText = promotion ? `=${PIECES[promotion].name}` : '';
    return `${prefix} ${PIECES[piece.type].name} ${coordToNotation(from.x, from.y)}${captureMark}${coordToNotation(to.x, to.y)}${promotionText}`;
  }

  function applyMoveLocally(snapshot, payload, actingColor) {
    const from = payload.from;
    const to = payload.to;
    const board = snapshot.board;
    const piece = getPiece(board, from.x, from.y);
    if (!piece || piece.color !== actingColor) return false;

    const legal = getLegalMoves(board, from.x, from.y);
    if (!legal.some((move) => move.x === to.x && move.y === to.y)) return false;

    const target = getPiece(board, to.x, to.y);
    board[to.y][to.x] = piece;
    board[from.y][from.x] = null;
    piece.moved = true;

    let promotion = null;
    if (promotionNeeded(piece, to.y)) {
      promotion = PROMOTIONS.includes(payload.promotion) ? payload.promotion : 'vanguard';
      piece.type = promotion;
    }

    if (target) {
      snapshot.captured[actingColor].push(target.type);
      if (target.type === 'crown') {
        const winner = snapshot.players.find((player) => player.color === actingColor);
        snapshot.winner = {
          color: actingColor,
          name: winner?.name || actingColor,
          reason: 'crown-captured',
        };
      }
    }

    snapshot.history.push(
      formatMoveText(piece, from, to, target, promotion, actingColor, snapshot.moveCount)
    );

    if (!snapshot.winner) {
      snapshot.turn = actingColor === 'white' ? 'black' : 'white';
      snapshot.moveCount += 1;
    }

    return true;
  }

  function getAllMovesForColor(snapshot, color) {
    const moves = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const piece = getPiece(snapshot.board, x, y);
        if (!piece || piece.color !== color) continue;
        for (const move of getLegalMoves(snapshot.board, x, y)) {
          moves.push({
            from: { x, y },
            to: { x: move.x, y: move.y },
          });
        }
      }
    }
    return moves;
  }

  function pieceValue(type) {
    return PIECES[type]?.value || 0;
  }

  function chooseBotMove(snapshot) {
    const moves = getAllMovesForColor(snapshot, 'black');
    if (!moves.length) return null;

    let bestScore = -Infinity;
    const bestMoves = [];

    for (const move of moves) {
      const target = getPiece(snapshot.board, move.to.x, move.to.y);
      const piece = getPiece(snapshot.board, move.from.x, move.from.y);
      let score = Math.random() * 0.2;
      if (target) {
        score += pieceValue(target.type) * 12;
      }
      if (promotionNeeded(piece, move.to.y)) {
        score += 9;
        move.promotion = 'vanguard';
      }

      const centerDistance = Math.abs(4.5 - move.to.x) + Math.abs(4.5 - move.to.y);
      score += (10 - centerDistance);

      if (target?.type === 'crown') {
        score += 10000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMoves.length = 0;
        bestMoves.push(move);
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  function stopBot() {
    if (state.botTimer) {
      window.clearTimeout(state.botTimer);
      state.botTimer = null;
    }
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove('visible');
    }, 2200);
  }

  function setStatus(message) {
    ui.statusText.textContent = message;
  }

  function setConnectionState(label, tone) {
    ui.networkStatus.textContent = label;
    ui.networkStatus.dataset.tone = tone;
  }

  function setModePill() {
    if (state.mode === 'solo') {
      ui.modePill.textContent = 'Solo vs Void Regent';
      return;
    }
    if (state.mode === 'online' && state.yourColor) {
      ui.modePill.textContent = `Online as ${state.yourColor}`;
      return;
    }
    ui.modePill.textContent = 'No match running';
  }

  function setBusy(isBusy) {
    ui.hostBtn.disabled = isBusy;
    ui.joinBtn.disabled = isBusy;
    ui.soloBtn.disabled = isBusy;
  }

  function updateInvite() {
    if (state.mode === 'solo') {
      ui.inviteInput.value = 'Solo mode does not use invite links.';
      return '';
    }
    const room = sanitizeRoomCode(ui.roomInput.value || state.roomCode);
    const server = sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl);
    const invite = room
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}&server=${encodeURIComponent(server)}`
      : '';
    ui.inviteInput.value = invite;
    return invite;
  }

  function updateSteps() {
    const playerCount = state.snapshot?.players?.length || 0;
    const hasRoom = Boolean(state.roomCode || sanitizeRoomCode(ui.roomInput.value));

    if (state.mode === 'solo') {
      ui.stepOne.classList.add('active');
      ui.stepTwo.classList.add('active');
      ui.stepThree.classList.add('active');
      return;
    }

    ui.stepOne.classList.toggle('active', !hasRoom || !state.snapshot);
    ui.stepTwo.classList.toggle('active', hasRoom && playerCount < 2);
    ui.stepThree.classList.toggle('active', playerCount >= 2);
  }

  function renderLegend() {
    ui.legendList.innerHTML = '';
    for (const type of ['crown', 'bastion', 'seer', 'vanguard', 'knight', 'sentinel', 'warden']) {
      const piece = PIECES[type];
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <div class="legend-head">
          <span class="piece-badge white">${piece.mark}</span>
          <strong>${piece.name}</strong>
        </div>
        <p class="legend-copy">${piece.desc}</p>
      `;
      ui.legendList.appendChild(item);
    }
  }

  function renderPlayers(snapshot) {
    ui.playerCards.innerHTML = '';
    if (!snapshot.players.length) {
      ui.presenceText.textContent = 'Waiting for commanders...';
      return;
    }

    ui.presenceText.textContent = state.mode === 'solo'
      ? 'Solo duel active'
      : `${snapshot.players.length} / ${snapshot.maxPlayers} commanders seated`;

    for (const player of snapshot.players) {
      const card = document.createElement('div');
      card.className = 'player-card';
      if (player.color === snapshot.turn && !snapshot.winner) {
        card.classList.add('active-turn');
      }
      if (player.color === state.yourColor) {
        card.classList.add('you');
      }
      card.innerHTML = `
        <div class="player-head">
          <strong>${player.name}${player.color === state.yourColor ? ' (you)' : ''}</strong>
          <span class="piece-badge ${player.color}">${player.color}</span>
        </div>
        <p class="player-color-label">${player.color === 'white' ? 'Moves first' : 'Responds second'}</p>
      `;
      ui.playerCards.appendChild(card);
    }
  }

  function renderHistory(snapshot) {
    ui.historyList.innerHTML = '';
    if (!snapshot.history.length) {
      ui.historyStatus.textContent = 'No moves yet.';
      return;
    }

    ui.historyStatus.textContent = `${snapshot.history.length} moves recorded.`;
    snapshot.history.slice().reverse().forEach((entry, index) => {
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="history-turn">${snapshot.history.length - index}</span>
        <span>${entry}</span>
      `;
      ui.historyList.appendChild(item);
    });
  }

  function renderCaptured(snapshot) {
    for (const side of ['white', 'black']) {
      const row = side === 'white' ? ui.whiteCaptured : ui.blackCaptured;
      row.innerHTML = '';
      const captures = snapshot.captured[side];
      if (!captures.length) {
        row.textContent = 'No captures yet.';
        continue;
      }

      captures.forEach((type) => {
        const badge = document.createElement('span');
        badge.className = `capture-chip ${side}`;
        badge.textContent = PIECES[type].name;
        row.appendChild(badge);
      });
    }
  }

  function renderBoard(snapshot) {
    ui.boardGrid.innerHTML = '';
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `board-cell ${(x + y) % 2 === 0 ? 'light' : 'dark'}`;
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        if (y === BOARD_SIZE - 1) {
          cell.classList.add('file-label');
          cell.dataset.file = files[x];
        }
        if (x === 0) {
          cell.classList.add('rank-label');
          cell.dataset.rank = String(BOARD_SIZE - y);
        }

        const piece = getPiece(snapshot.board, x, y);
        if (state.selected && state.selected.x === x && state.selected.y === y) {
          cell.classList.add('selected');
        }

        const legal = state.legalMoves.find((move) => move.x === x && move.y === y);
        if (legal) {
          cell.classList.add('legal');
          if (getPiece(snapshot.board, x, y)) {
            cell.classList.add('capture');
          }
        }

        if (piece) {
          const token = document.createElement('div');
          token.className = `piece-token ${piece.color}`;
          token.innerHTML = `
            <span class="piece-mark">${PIECES[piece.type].mark}</span>
            <span class="piece-mini">${PIECES[piece.type].mini}</span>
          `;
          cell.appendChild(token);
        }

        cell.addEventListener('click', () => handleBoardClick(x, y));
        ui.boardGrid.appendChild(cell);
      }
    }
  }

  function renderSnapshot(snapshot) {
    state.snapshot = snapshot;
    state.roomCode = snapshot.roomCode;
    state.promotionContext = null;
    ui.promotionModal.classList.add('hidden');

    if (
      state.selected &&
      (!canAct() ||
        !getPiece(snapshot.board, state.selected.x, state.selected.y) ||
        getPiece(snapshot.board, state.selected.x, state.selected.y).color !== state.yourColor)
    ) {
      state.selected = null;
      state.legalMoves = [];
    }

    ui.roomCodeLabel.textContent = snapshot.roomCode;
    ui.roomInput.value = snapshot.roomCode === 'SOLO' ? '' : snapshot.roomCode;

    if (snapshot.winner) {
      ui.turnText.textContent = `${snapshot.winner.name} won`;
      ui.phaseText.textContent = 'Enemy Crown captured';
      ui.winnerText.textContent = `${snapshot.winner.name} captured the Crown and won the battle.`;
    } else {
      ui.turnText.textContent = `${snapshot.turn} to move`;
      ui.phaseText.textContent = state.yourColor ? `You control ${state.yourColor}` : 'Capture the enemy Crown';
      ui.winnerText.textContent = state.mode === 'solo'
        ? 'Defeat the Void Regent by taking the black Crown.'
        : snapshot.players.length < 2
          ? 'Waiting for the opposing commander to join.'
          : 'Choose a piece, highlight legal moves, and attack the enemy Crown.';
    }

    updateInvite();
    updateSteps();
    setModePill();
    renderPlayers(snapshot);
    renderHistory(snapshot);
    renderCaptured(snapshot);
    renderBoard(snapshot);
  }

  function clearSelection() {
    state.selected = null;
    state.legalMoves = [];
    state.promotionContext = null;
    ui.promotionModal.classList.add('hidden');
    if (state.snapshot) renderBoard(state.snapshot);
  }

  function openPromotionDialog(move) {
    state.promotionContext = move;
    ui.promotionOptions.innerHTML = '';
    for (const type of PROMOTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = PIECES[type].name;
      button.addEventListener('click', () => {
        ui.promotionModal.classList.add('hidden');
        const nextMove = { ...move, promotion: type };
        state.promotionContext = null;
        executeMove(nextMove);
      });
      ui.promotionOptions.appendChild(button);
    }
    ui.promotionModal.classList.remove('hidden');
  }

  function executeMove(move) {
    const piece = getPiece(state.snapshot.board, move.from.x, move.from.y);
    if (!piece) return;

    if (promotionNeeded(piece, move.to.y) && !move.promotion) {
      openPromotionDialog(move);
      return;
    }

    clearSelection();

    if (state.mode === 'online') {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify({ type: 'move', ...move }));
      return;
    }

    if (state.mode === 'solo') {
      const snapshot = cloneSnapshot(state.snapshot);
      if (!applyMoveLocally(snapshot, move, state.yourColor)) return;
      renderSnapshot(snapshot);
      maybeRunBotTurn();
    }
  }

  function handleBoardClick(x, y) {
    if (!state.snapshot || !canAct()) return;
    const board = state.snapshot.board;
    const piece = getPiece(board, x, y);

    if (state.selected) {
      const legal = state.legalMoves.find((move) => move.x === x && move.y === y);
      if (legal) {
        executeMove({
          from: { ...state.selected },
          to: { x, y },
        });
        return;
      }
    }

    if (!piece || piece.color !== state.yourColor) {
      clearSelection();
      return;
    }

    state.selected = { x, y };
    state.legalMoves = getLegalMoves(board, x, y);
    renderBoard(state.snapshot);
  }

  function chooseBotMove(snapshot) {
    const moves = getAllMovesForColor(snapshot, 'black');
    if (!moves.length) return null;

    let bestScore = -Infinity;
    const bestMoves = [];

    for (const move of moves) {
      const piece = getPiece(snapshot.board, move.from.x, move.from.y);
      const target = getPiece(snapshot.board, move.to.x, move.to.y);
      let score = Math.random() * 0.25;

      if (target) score += pieceValue(target.type) * 12;
      if (promotionNeeded(piece, move.to.y)) {
        move.promotion = 'vanguard';
        score += 10;
      }
      if (target?.type === 'crown') score += 10000;

      const centerDistance = Math.abs(4.5 - move.to.x) + Math.abs(4.5 - move.to.y);
      score += 10 - centerDistance;

      if (score > bestScore) {
        bestScore = score;
        bestMoves.length = 0;
        bestMoves.push(move);
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  function stopCurrentSession() {
    stopBot();
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
    clearSelection();
  }

  function stopBot() {
    if (state.botTimer) {
      window.clearTimeout(state.botTimer);
      state.botTimer = null;
    }
  }

  function maybeRunBotTurn() {
    stopBot();
    if (state.mode !== 'solo' || !state.snapshot || state.snapshot.winner || state.snapshot.turn !== 'black') return;
    state.botTimer = window.setTimeout(() => {
      const move = chooseBotMove(state.snapshot);
      if (!move) return;
      const snapshot = cloneSnapshot(state.snapshot);
      if (applyMoveLocally(snapshot, move, 'black')) {
        renderSnapshot(snapshot);
      }
    }, 650);
  }

  function startSolo() {
    stopCurrentSession();
    state.mode = 'solo';
    state.isHost = false;
    state.yourColor = 'white';
    state.roomCode = 'SOLO';
    setBusy(false);
    setConnectionState('Solo mode', 'online');
    setStatus('Solo battle started. You command White against the Void Regent.');
    const snapshot = createSoloSnapshot(getPlayerName());
    renderSnapshot(snapshot);
    showToast('Solo match ready.');
  }

  function getPlayerName() {
    const name = (ui.nameInput.value || '').trim().slice(0, 18);
    return name || 'Player';
  }

  function beginOnline(mode) {
    const name = getPlayerName();
    const room = sanitizeRoomCode(ui.roomInput.value) || (mode === 'host' ? generateRoomCode() : '');
    const serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);

    if (!room) {
      setStatus('Enter a room code to join, or host a duel to generate one automatically.');
      setConnectionState('Needs room', 'error');
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.name, name);
    window.localStorage.setItem(STORAGE_KEYS.serverUrl, serverUrl);

    stopCurrentSession();
    state.mode = 'online';
    state.isHost = mode === 'host';
    state.yourColor = null;
    state.roomCode = room;
    state.serverUrl = serverUrl;
    ui.roomInput.value = room;
    updateInvite();
    updateSteps();
    setBusy(true);
    setConnectionState('Connecting...', 'connecting');
    setStatus(mode === 'host' ? `Creating duel room ${room}...` : `Joining duel room ${room}...`);

    const socket = new WebSocket(serverUrl);
    state.socket = socket;

    socket.addEventListener('open', () => {
      if (state.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'join', room, name, mode }));
    });

    socket.addEventListener('message', (event) => {
      if (state.socket !== socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'welcome') {
        state.yourColor = message.yourColor;
        setBusy(false);
        setConnectionState(`Online as ${message.yourColor}`, 'online');
        setStatus(message.message || 'Connected.');
        renderSnapshot(message.state);
        if (state.isHost) {
          showToast('Duel room created. Copy the invite and send it.');
        }
        return;
      }

      if (message.type === 'state') {
        renderSnapshot(message.state);
        setBusy(false);
        return;
      }

      if (message.type === 'error') {
        setBusy(false);
        setConnectionState('Connection issue', 'error');
        setStatus(message.message || 'Something went wrong.');
        showToast(message.message || 'Something went wrong.');
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) return;
      setBusy(false);
      setConnectionState('Offline', 'offline');
      setStatus('Disconnected from the tactics server.');
    });

    socket.addEventListener('error', () => {
      if (state.socket !== socket) return;
      setBusy(false);
      setConnectionState('Connection issue', 'error');
      setStatus('Could not reach the tactics server.');
    });
  }

  async function copyText(text, success, empty) {
    if (!text) {
      showToast(empty);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(success);
    } catch {
      showToast('Clipboard access is blocked in this browser.');
    }
  }

  ui.hostBtn.addEventListener('click', () => beginOnline('host'));
  ui.joinBtn.addEventListener('click', () => beginOnline('join'));
  ui.soloBtn.addEventListener('click', startSolo);
  ui.copyBtn.addEventListener('click', async () => {
    await copyText(updateInvite(), 'Invite link copied.', 'No invite available yet.');
  });
  ui.copyCodeBtn.addEventListener('click', async () => {
    await copyText(state.roomCode || sanitizeRoomCode(ui.roomInput.value), 'Room code copied.', 'No room code available.');
  });
  ui.restartBtn.addEventListener('click', () => {
    if (!state.snapshot) return;
    if (state.mode === 'solo') {
      startSolo();
      return;
    }
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: 'restart' }));
    }
  });

  ui.nameInput.addEventListener('input', () => {
    window.localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim().slice(0, 18));
  });

  ui.roomInput.addEventListener('input', () => {
    ui.roomInput.value = sanitizeRoomCode(ui.roomInput.value);
    updateInvite();
    updateSteps();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearSelection();
    }
  });

  const rememberedName = window.localStorage.getItem(STORAGE_KEYS.name) || '';
  const rememberedServer = window.localStorage.getItem(STORAGE_KEYS.serverUrl) || '';
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const defaultServer = isLocal
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:8081`
    : PROD_SERVER_URL;

  state.serverUrl = sanitizeServerUrl(query.get('server') || rememberedServer || defaultServer);
  ui.nameInput.value = rememberedName;
  ui.roomInput.value = sanitizeRoomCode(query.get('room') || '');
  ui.serverUrlInput.value = state.serverUrl;

  renderLegend();
  updateInvite();
  updateSteps();
  setConnectionState('Offline', 'offline');
  setModePill();

  if (query.get('room')) {
    setStatus(`Invite loaded for room ${ui.roomInput.value}. Enter your name, then join the duel.`);
  }
})();
