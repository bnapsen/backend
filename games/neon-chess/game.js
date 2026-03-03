(() => {
  'use strict';

  const boardEl = document.getElementById('board');
  const statusText = document.getElementById('statusText');
  const turnText = document.getElementById('turnText');
  const moveLogEl = document.getElementById('moveLog');
  const networkText = document.getElementById('networkText');
  const roomInput = document.getElementById('roomInput');
  const serverInput = document.getElementById('serverInput');

  const symbols = {
    wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
    bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
  };

  const files = 'abcdefgh';
  const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 10000 };

  const state = {
    board: createInitialBoard(),
    turn: 'w',
    selected: null,
    legalMoves: [],
    mode: 'bot',
    winner: null,
    moveHistory: [],
    botThinking: false,
    online: { ws: null, role: null, room: '', connected: false }
  };

  serverInput.value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:8090`;
  roomInput.value = 'PUBLIC';

  document.getElementById('vsBotBtn').addEventListener('click', () => setMode('bot'));
  document.getElementById('localBtn').addEventListener('click', () => setMode('local'));
  document.getElementById('onlineBtn').addEventListener('click', () => setMode('online'));
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  document.getElementById('hostBtn').addEventListener('click', () => connectOnline(true));
  document.getElementById('joinBtn').addEventListener('click', () => connectOnline(false));

  function createInitialBoard() {
    const setup = [
      ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
      ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'],
      ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr']
    ];
    return setup.map((row) => row.slice());
  }

  function cloneBoard(board) { return board.map((row) => row.slice()); }
  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function colorOf(piece) { return piece ? piece[0] : null; }
  function typeOf(piece) { return piece ? piece[1] : null; }

  function squareName(r, c) { return `${files[c]}${8 - r}`; }

  function setMode(mode) {
    state.mode = mode;
    disconnectOnline();
    resetGame();
  }

  function resetGame() {
    state.board = createInitialBoard();
    state.turn = 'w';
    state.selected = null;
    state.legalMoves = [];
    state.winner = null;
    state.moveHistory = [];
    state.botThinking = false;
    renderMoveLog();
    render();
    if (state.mode === 'bot' && state.turn === 'b') botMove();
  }

  function render() {
    boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('button');
        sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
        sq.addEventListener('click', () => onSquareClick(r, c));
        const selected = state.selected && state.selected.r === r && state.selected.c === c;
        if (selected) sq.classList.add('selected');

        const legal = state.legalMoves.find((m) => m.to.r === r && m.to.c === c);
        if (legal) sq.classList.add(state.board[r][c] ? 'capture' : 'legal');

        const piece = state.board[r][c];
        sq.textContent = piece ? symbols[piece] : '';
        boardEl.appendChild(sq);
      }
    }

    const turnLabel = state.turn === 'w' ? 'White' : 'Black';
    turnText.textContent = `Turn: ${turnLabel}`;

    if (state.winner) {
      statusText.textContent = state.winner === 'draw' ? 'Draw by stalemate.' : `${state.winner === 'w' ? 'White' : 'Black'} wins by checkmate!`;
    } else {
      const inCheck = isInCheck(state.board, state.turn);
      statusText.textContent = inCheck ? `${turnLabel} is in check.` : `${turnLabel} to move.`;
    }

    if (state.mode === 'online') {
      const side = state.online.role === 'host' ? 'White' : state.online.role === 'guest' ? 'Black' : 'Spectator';
      networkText.textContent = state.online.connected ? `Connected (${side}) in room ${state.online.room}` : 'Offline';
    } else {
      networkText.textContent = state.mode === 'bot' ? 'Local bot enabled' : 'Local 2-player mode';
    }
  }

  function onSquareClick(r, c) {
    if (state.winner || state.botThinking) return;
    if (state.mode === 'online') {
      if (!state.online.connected || !isMyTurnOnline()) return;
    } else if (state.mode === 'bot' && state.turn === 'b') {
      return;
    }

    const piece = state.board[r][c];
    const ownPiece = piece && colorOf(piece) === state.turn;

    const chosenMove = state.legalMoves.find((m) => m.to.r === r && m.to.c === c);
    if (state.selected && chosenMove) {
      applyMove(chosenMove);
      return;
    }

    if (ownPiece) {
      state.selected = { r, c };
      state.legalMoves = legalMovesForPiece(state.board, r, c, state.turn);
    } else {
      state.selected = null;
      state.legalMoves = [];
    }
    render();
  }

  function applyMove(move, fromNetwork = false) {
    const movingPiece = state.board[move.from.r][move.from.c];
    const capture = state.board[move.to.r][move.to.c];

    state.board[move.to.r][move.to.c] = movingPiece;
    state.board[move.from.r][move.from.c] = null;

    if (typeOf(movingPiece) === 'p' && (move.to.r === 0 || move.to.r === 7)) {
      state.board[move.to.r][move.to.c] = `${colorOf(movingPiece)}q`;
    }

    state.moveHistory.push(`${state.moveHistory.length + 1}. ${squareName(move.from.r, move.from.c)}${capture ? 'x' : '-'}${squareName(move.to.r, move.to.c)}`);
    renderMoveLog();

    state.turn = state.turn === 'w' ? 'b' : 'w';
    state.selected = null;
    state.legalMoves = [];

    resolveEndgame();
    render();

    if (state.mode === 'online' && !fromNetwork && state.online.ws?.readyState === WebSocket.OPEN) {
      state.online.ws.send(JSON.stringify({ type: 'move', move, board: state.board, turn: state.turn, winner: state.winner, history: state.moveHistory }));
    }

    if (!state.winner && state.mode === 'bot' && state.turn === 'b') {
      botMove();
    }
  }

  function renderMoveLog() {
    moveLogEl.innerHTML = '';
    state.moveHistory.forEach((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      moveLogEl.appendChild(li);
    });
  }

  function resolveEndgame() {
    const moves = allLegalMoves(state.board, state.turn);
    if (moves.length > 0) return;
    state.winner = isInCheck(state.board, state.turn) ? (state.turn === 'w' ? 'b' : 'w') : 'draw';
  }

  function allLegalMoves(board, turn) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] && colorOf(board[r][c]) === turn) {
          moves.push(...legalMovesForPiece(board, r, c, turn));
        }
      }
    }
    return moves;
  }

  function legalMovesForPiece(board, r, c, turn) {
    const pseudo = pseudoMovesForPiece(board, r, c, turn);
    return pseudo.filter((move) => {
      const next = cloneBoard(board);
      next[move.to.r][move.to.c] = next[move.from.r][move.from.c];
      next[move.from.r][move.from.c] = null;
      if (typeOf(next[move.to.r][move.to.c]) === 'p' && (move.to.r === 0 || move.to.r === 7)) {
        next[move.to.r][move.to.c] = `${turn}q`;
      }
      return !isInCheck(next, turn);
    });
  }

  function pseudoMovesForPiece(board, r, c, turn) {
    const piece = board[r][c];
    if (!piece || colorOf(piece) !== turn) return [];
    const enemy = turn === 'w' ? 'b' : 'w';
    const type = typeOf(piece);
    const out = [];

    if (type === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      const one = r + dir;
      if (inBounds(one, c) && !board[one][c]) out.push({ from: { r, c }, to: { r: one, c } });
      const two = r + dir * 2;
      if (r === startRow && !board[one][c] && inBounds(two, c) && !board[two][c]) out.push({ from: { r, c }, to: { r: two, c } });
      for (const dc of [-1, 1]) {
        const nr = r + dir;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (board[nr][nc] && colorOf(board[nr][nc]) === enemy) out.push({ from: { r, c }, to: { r: nr, c: nc } });
      }
      return out;
    }

    const addStepMoves = (dirs, max = 8) => {
      for (const [dr, dc] of dirs) {
        for (let i = 1; i <= max; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (!inBounds(nr, nc)) break;
          const target = board[nr][nc];
          if (!target) {
            out.push({ from: { r, c }, to: { r: nr, c: nc } });
            continue;
          }
          if (colorOf(target) === enemy) out.push({ from: { r, c }, to: { r: nr, c: nc } });
          break;
        }
      }
    };

    if (type === 'n') addStepMoves([[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]], 1);
    if (type === 'b') addStepMoves([[1,1],[1,-1],[-1,1],[-1,-1]]);
    if (type === 'r') addStepMoves([[1,0],[-1,0],[0,1],[0,-1]]);
    if (type === 'q') addStepMoves([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]);
    if (type === 'k') addStepMoves([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]], 1);

    return out;
  }

  function isInCheck(board, turn) {
    let kingPos = null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === `${turn}k`) kingPos = { r, c };
      }
    }
    if (!kingPos) return true;

    const enemy = turn === 'w' ? 'b' : 'w';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] && colorOf(board[r][c]) === enemy) {
          const attacks = pseudoMovesForPiece(board, r, c, enemy);
          if (attacks.some((m) => m.to.r === kingPos.r && m.to.c === kingPos.c)) return true;
        }
      }
    }
    return false;
  }

  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const val = pieceValues[typeOf(piece)] || 0;
        score += colorOf(piece) === 'w' ? val : -val;
      }
    }
    return score;
  }

  function chooseBotMove() {
    const moves = allLegalMoves(state.board, 'b');
    if (!moves.length) return null;

    let bestScore = Infinity;
    let best = moves[0];
    for (const move of moves) {
      const next = cloneBoard(state.board);
      next[move.to.r][move.to.c] = next[move.from.r][move.from.c];
      next[move.from.r][move.from.c] = null;
      const replyMoves = allLegalMoves(next, 'w');
      let worstReply = -Infinity;
      if (!replyMoves.length) {
        worstReply = evaluate(next);
      } else {
        for (const reply of replyMoves) {
          const future = cloneBoard(next);
          future[reply.to.r][reply.to.c] = future[reply.from.r][reply.from.c];
          future[reply.from.r][reply.from.c] = null;
          worstReply = Math.max(worstReply, evaluate(future));
        }
      }
      if (worstReply < bestScore) {
        bestScore = worstReply;
        best = move;
      }
    }
    return best;
  }

  function botMove() {
    state.botThinking = true;
    setTimeout(() => {
      const move = chooseBotMove();
      state.botThinking = false;
      if (move) applyMove(move);
    }, 350);
  }

  function sanitizeRoom(input) {
    return String(input || 'PUBLIC').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'PUBLIC';
  }

  function isMyTurnOnline() {
    if (state.online.role === 'host') return state.turn === 'w';
    if (state.online.role === 'guest') return state.turn === 'b';
    return false;
  }

  function disconnectOnline() {
    if (state.online.ws) state.online.ws.close();
    state.online = { ws: null, role: null, room: '', connected: false };
  }

  function connectOnline(host) {
    setMode('online');

    const room = sanitizeRoom(roomInput.value);
    roomInput.value = room;
    const url = String(serverInput.value || '').trim();
    if (!url) {
      networkText.textContent = 'Missing server URL';
      return;
    }

    disconnectOnline();

    const ws = new WebSocket(url);
    state.online.ws = ws;
    state.online.room = room;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', room, requestedRole: host ? 'host' : 'guest' }));
      networkText.textContent = 'Connected, waiting for role...';
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'welcome') {
        state.online.connected = true;
        state.online.role = msg.role;
        networkText.textContent = `Connected as ${msg.role}`;
        return;
      }

      if (msg.type === 'sync') {
        state.board = msg.board;
        state.turn = msg.turn;
        state.winner = msg.winner;
        state.moveHistory = msg.history || [];
        state.selected = null;
        state.legalMoves = [];
        renderMoveLog();
        render();
        return;
      }

      if (msg.type === 'error') {
        networkText.textContent = msg.message || 'Server error';
      }
    });

    ws.addEventListener('close', () => {
      state.online.connected = false;
      state.online.role = null;
      networkText.textContent = 'Disconnected';
      render();
    });

    ws.addEventListener('error', () => {
      networkText.textContent = 'Connection error';
    });
  }

  render();
})();
