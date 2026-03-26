(() => {
  'use strict';

  const Core = window.NeonChessCore;
  const STORAGE_KEYS = {
    name: 'neonCrownChess.name',
    serverUrl: 'neonCrownChess.serverUrl',
    engineLevel: 'neonCrownChess.engineLevel',
    boardTheme: 'neonCrownChess.boardTheme',
    soundEnabled: 'neonCrownChess.soundEnabled',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const ENGINE_WORKER_VERSION = '20260325f';
  const ENGINE_INIT_TIMEOUT_MS = 12000;
  const ENGINE_MOVE_TIMEOUT_MS = 9000;
  const query = new URLSearchParams(window.location.search);
  const FILES = Core.FILES;
  const DIRECT_STOCKFISH_WORKER = `vendor/stockfish/stockfish-18-lite-single.js?v=${ENGINE_WORKER_VERSION}`;
  const ENGINE_LEVELS = {
    2: {
      label: 'Rookie',
      skill: 2,
      elo: 700,
      movetime: 180,
      meter: 16,
      summary: 'Gentle and forgiving, with fast replies and simple plans.',
    },
    6: {
      label: 'Casual',
      skill: 6,
      elo: 950,
      movetime: 340,
      meter: 32,
      summary: 'Good for new players who want a little pressure without brutal tactics.',
    },
    10: {
      label: 'Club',
      skill: 10,
      elo: 1300,
      movetime: 680,
      meter: 50,
      summary: 'Balanced club-strength games with solid tactics and quick replies.',
    },
    14: {
      label: 'Tournament',
      skill: 14,
      elo: 1750,
      movetime: 1300,
      meter: 68,
      summary: 'Sharper calculation, stronger opening play, and fewer tactical misses.',
    },
    18: {
      label: 'Master',
      skill: 18,
      elo: null,
      movetime: 2200,
      meter: 86,
      summary: 'Uncapped strength with fast, accurate middlegame pressure.',
    },
    20: {
      label: 'Grandmaster',
      skill: 20,
      elo: null,
      movetime: 3400,
      meter: 100,
      summary: 'The toughest solo setting here, with the deepest search and strongest tactics.',
    },
  };
  const BOARD_THEMES = {
    walnut: {
      label: 'Walnut Classic',
      summary: 'Warm walnut tones with carved-piece contrast and a traditional table look.',
    },
    marble: {
      label: 'Ivory Marble',
      summary: 'Bright ivory squares, cool slate darks, and a polished tournament-lobby finish.',
    },
    midnight: {
      label: 'Midnight Arena',
      summary: 'Deep navy squares with steel highlights for a sharper late-night match feel.',
    },
    emerald: {
      label: 'Emerald Study',
      summary: 'Rich green felt tones with brass woodwork for a club-room table vibe.',
    },
  };

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
    keyboardFocus: { x: 4, y: 6 },
    clickGuardUntil: 0,
    drag: null,
    dragGhost: null,
    engineLevel: 10,
    engineWorker: null,
    engineReady: false,
    engineStatus: 'Stockfish 18 idle.',
    engineFallback: false,
    engineInitPromise: null,
    engineInitResolve: null,
    engineInitReject: null,
    engineInitTimer: 0,
    engineRequestSeq: 0,
    enginePending: null,
    engineLastInfoAt: 0,
    engineNeedsNewGame: true,
    boardTheme: 'walnut',
    soundEnabled: true,
    audioContext: null,
  };

  const ui = {
    pageShell: document.getElementById('pageShell'),
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    engineLevelSelect: document.getElementById('engineLevelSelect'),
    engineLevelHint: document.getElementById('engineLevelHint'),
    engineLevelMeter: document.getElementById('engineLevelMeter'),
    boardThemeSelect: document.getElementById('boardThemeSelect'),
    boardThemeHint: document.getElementById('boardThemeHint'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    soundHint: document.getElementById('soundHint'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    engineStatus: document.getElementById('engineStatus'),
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
    retryEngineBtn: document.getElementById('retryEngineBtn'),
    engineMoveBtn: document.getElementById('engineMoveBtn'),
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function engineLevelProfile() {
    return ENGINE_LEVELS[state.engineLevel] || ENGINE_LEVELS[10];
  }

  function normalizeEngineLevel(value) {
    const numeric = Number(value);
    return ENGINE_LEVELS[numeric] ? numeric : 10;
  }

  function normalizeBoardTheme(value) {
    return BOARD_THEMES[value] ? value : 'walnut';
  }

  function engineReadyMessage() {
    return `Stockfish 18 ready - ${engineLevelProfile().label}`;
  }

  function boardThemeProfile() {
    return BOARD_THEMES[state.boardTheme] || BOARD_THEMES.walnut;
  }

  function audioSupported() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  function ensureAudioContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return null;
    }
    if (!state.audioContext) {
      try {
        state.audioContext = new AudioCtor();
      } catch (error) {
        return null;
      }
    }
    return state.audioContext;
  }

  async function primeAudio() {
    const context = ensureAudioContext();
    if (!context) {
      return false;
    }
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        return false;
      }
    }
    return context.state === 'running';
  }

  function playTone(options = {}) {
    if (!state.soundEnabled) {
      return;
    }
    const context = ensureAudioContext();
    if (!context || context.state !== 'running') {
      return;
    }
    const {
      frequency = 440,
      frequencyEnd = frequency,
      type = 'triangle',
      duration = 0.12,
      attack = 0.005,
      gain = 0.03,
      startOffset = 0,
      detune = 0,
      q = 1.2,
    } = options;
    const start = context.currentTime + startOffset;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(40, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequencyEnd), start + duration);
    oscillator.detune.setValueAtTime(detune, start);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(500, Math.max(frequency, frequencyEnd) * 4), start);
    filter.Q.setValueAtTime(q, start);

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(filter);
    filter.connect(amp);
    amp.connect(context.destination);

    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playSoundCue(kind) {
    if (!state.soundEnabled) {
      return;
    }
    if (!ensureAudioContext() || state.audioContext.state !== 'running') {
      return;
    }

    switch (kind) {
      case 'start':
        playTone({ frequency: 392, frequencyEnd: 440, duration: 0.13, gain: 0.022 });
        playTone({ frequency: 523.25, frequencyEnd: 659.25, duration: 0.18, gain: 0.018, startOffset: 0.07 });
        break;
      case 'move':
        playTone({ frequency: 720, frequencyEnd: 600, type: 'triangle', duration: 0.06, gain: 0.02 });
        playTone({ frequency: 980, frequencyEnd: 860, type: 'sine', duration: 0.08, gain: 0.012, startOffset: 0.025 });
        break;
      case 'capture':
        playTone({ frequency: 310, frequencyEnd: 170, type: 'sawtooth', duration: 0.12, gain: 0.026, q: 2 });
        playTone({ frequency: 680, frequencyEnd: 460, type: 'triangle', duration: 0.1, gain: 0.018, startOffset: 0.035 });
        break;
      case 'castle':
        playTone({ frequency: 440, frequencyEnd: 494, duration: 0.09, gain: 0.022 });
        playTone({ frequency: 587, frequencyEnd: 659, duration: 0.11, gain: 0.018, startOffset: 0.05 });
        break;
      case 'check':
        playTone({ frequency: 830, frequencyEnd: 760, type: 'square', duration: 0.09, gain: 0.02 });
        playTone({ frequency: 1046, frequencyEnd: 988, type: 'triangle', duration: 0.08, gain: 0.014, startOffset: 0.05 });
        break;
      case 'win':
        playTone({ frequency: 392, frequencyEnd: 440, duration: 0.12, gain: 0.024 });
        playTone({ frequency: 523.25, frequencyEnd: 659.25, duration: 0.18, gain: 0.02, startOffset: 0.08 });
        playTone({ frequency: 783.99, frequencyEnd: 880, duration: 0.22, gain: 0.018, startOffset: 0.18 });
        break;
      case 'draw':
        playTone({ frequency: 392, frequencyEnd: 370, duration: 0.16, gain: 0.018 });
        playTone({ frequency: 523.25, frequencyEnd: 493.88, duration: 0.18, gain: 0.014, startOffset: 0.04 });
        break;
      default:
        break;
    }
  }

  function moveSoundKey(snapshot) {
    if (!snapshot || !snapshot.lastMove) {
      return '';
    }
    const move = snapshot.lastMove;
    const historyLength = Array.isArray(snapshot.history) ? snapshot.history.length : snapshot.moveNumber || 0;
    return [
      historyLength,
      move.from ? `${move.from.x},${move.from.y}` : '-',
      move.to ? `${move.to.x},${move.to.y}` : '-',
      move.capture ? 'x' : '-',
      move.castleSide || '-',
      move.promotion || '-',
    ].join('|');
  }

  function resultSoundKey(snapshot) {
    if (!snapshot) {
      return '';
    }
    return `${snapshot.winner || '-'}|${snapshot.drawReason || '-'}`;
  }

  function setSnapshot(nextSnapshot, options = {}) {
    const previous = state.snapshot;
    state.snapshot = nextSnapshot;

    if (options.silent) {
      return;
    }

    if (options.startCue && nextSnapshot) {
      playSoundCue('start');
    }

    const previousMoveKey = moveSoundKey(previous);
    const nextMoveKey = moveSoundKey(nextSnapshot);
    if (nextMoveKey && nextMoveKey !== previousMoveKey) {
      if (nextSnapshot.lastMove && nextSnapshot.lastMove.castleSide) {
        playSoundCue('castle');
      } else if (nextSnapshot.lastMove && nextSnapshot.lastMove.capture) {
        playSoundCue('capture');
      } else {
        playSoundCue('move');
      }
      if (nextSnapshot.check && !nextSnapshot.winner) {
        window.setTimeout(() => playSoundCue('check'), 85);
      }
    }

    const previousResultKey = resultSoundKey(previous);
    const nextResultKey = resultSoundKey(nextSnapshot);
    if (nextResultKey !== previousResultKey) {
      if (nextSnapshot && nextSnapshot.winner) {
        window.setTimeout(() => playSoundCue('win'), 120);
      } else if (nextSnapshot && nextSnapshot.drawReason) {
        window.setTimeout(() => playSoundCue('draw'), 120);
      }
    }
  }

  function sendEngineCommand(command) {
    if (!state.engineWorker) {
      return;
    }
    state.engineWorker.postMessage(command);
  }

  function syncEngineOptions() {
    const profile = engineLevelProfile();
    sendEngineCommand('setoption name UCI_Chess960 value false');
    sendEngineCommand('setoption name MultiPV value 1');
    sendEngineCommand('setoption name Ponder value false');
    sendEngineCommand(`setoption name Skill Level value ${clamp(profile.skill || state.engineLevel, 0, 20)}`);
    if (profile.elo) {
      sendEngineCommand('setoption name UCI_LimitStrength value true');
      sendEngineCommand(`setoption name UCI_Elo value ${profile.elo}`);
    } else {
      sendEngineCommand('setoption name UCI_LimitStrength value false');
    }
  }

  function setEngineStatus(message) {
    state.engineStatus = message;
    ui.engineStatus.textContent = message;
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.name, ui.nameInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.serverUrl, state.serverUrl);
    localStorage.setItem(STORAGE_KEYS.engineLevel, String(state.engineLevel));
    localStorage.setItem(STORAGE_KEYS.boardTheme, state.boardTheme);
    localStorage.setItem(STORAGE_KEYS.soundEnabled, state.soundEnabled ? '1' : '0');
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

  function defaultFocusForControlledSide() {
    const color = state.mode === 'solo' ? 'white' : state.yourColor || 'white';
    return color === 'black' ? { x: 4, y: 1 } : { x: 4, y: 6 };
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

  function boardPointToCoords(clientX, clientY) {
    const rect = ui.boardGrid.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const squareSize = rect.width / 8;
    const displayX = clamp(Math.floor((clientX - rect.left) / squareSize), 0, 7);
    const displayY = clamp(Math.floor((clientY - rect.top) / squareSize), 0, 7);
    return boardCoords(displayX, displayY);
  }

  function coordToNotation(x, y) {
    return `${FILES[x]}${8 - y}`;
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
    ui.statusText.textContent = state.statusMessage || 'Host a match to create an invite link, join with a code from a friend, or play solo against Stockfish.';
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
              ${active ? 'Turn' : player.id === 'engine-black'
                ? (state.engineReady ? `Stockfish ${engineLevelProfile().label}` : state.engineFallback ? 'Backup bot' : 'Warming up')
                : 'Ready'}
            </span>
          </div>
        </div>
      `;
    }).join('');

    ui.playerCards.innerHTML = cards;

    if (state.mode === 'solo') {
      ui.presenceText.textContent = state.engineReady
        ? `Solo vs Stockfish 18 - ${engineLevelProfile().label}`
        : state.engineFallback
          ? 'Solo vs backup engine'
          : 'Solo vs Stockfish 18';
    } else {
      ui.presenceText.textContent = `${players.length}/2 players connected`;
    }
  }

  function renderDifficultyInfo() {
    const profile = engineLevelProfile();
    if (ui.engineLevelHint) {
      ui.engineLevelHint.textContent = profile.elo
        ? `${profile.summary} About ${profile.elo} Elo with human-style mistakes left in.`
        : `${profile.summary} Full-strength Stockfish search with no Elo cap.`;
    }
    if (ui.engineLevelMeter) {
      ui.engineLevelMeter.style.width = `${profile.meter}%`;
    }
  }

  function renderBoardThemeInfo() {
    const profile = boardThemeProfile();
    if (ui.pageShell) {
      ui.pageShell.dataset.boardTheme = state.boardTheme;
    }
    if (ui.boardThemeSelect) {
      ui.boardThemeSelect.value = state.boardTheme;
    }
    if (ui.boardThemeHint) {
      ui.boardThemeHint.textContent = profile.summary;
    }
  }

  function renderSoundInfo() {
    if (!ui.soundToggleBtn || !ui.soundHint) {
      return;
    }
    const supported = audioSupported();
    ui.soundToggleBtn.disabled = !supported;
    if (!supported) {
      ui.soundToggleBtn.textContent = 'Unavailable';
      ui.soundToggleBtn.dataset.enabled = 'false';
      ui.soundHint.textContent = 'This browser does not expose Web Audio for move sounds.';
      return;
    }
    ui.soundToggleBtn.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
    ui.soundToggleBtn.dataset.enabled = state.soundEnabled ? 'true' : 'false';
    ui.soundHint.textContent = state.soundEnabled
      ? 'Move, capture, check, and game-end cues are enabled.'
      : 'Audio is muted. Turn it back on any time.';
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
      ? captured.white.map((piece) => `<span class="capture-chip ${piece.color}" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
    ui.blackCaptured.innerHTML = captured.black.length
      ? captured.black.map((piece) => `<span class="capture-chip ${piece.color}" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
  }

  function renderLegend() {
    const items = [
      {
        title: 'Mouse, touch, or keyboard',
        body: 'Click squares, drag pieces with a mouse or phone, or use arrow keys plus Enter to play without the mouse.',
        token: '\u2658',
      },
      {
        title: 'Real engine support',
        body: 'Solo mode has six Stockfish 18 tiers, from Rookie through Grandmaster, and only falls back to a local move chooser if the engine cannot wake up.',
        token: '\u2699',
      },
      {
        title: 'Online sync',
        body: 'The backend still validates every multiplayer move, so both browsers stay locked to the same legal position.',
        token: '\u2194',
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

  function setKeyboardFocus(x, y) {
    state.keyboardFocus = {
      x: clamp(x, 0, 7),
      y: clamp(y, 0, 7),
    };
  }

  function moveKeyboardFocus(displayDx, displayDy) {
    const focused = state.keyboardFocus || defaultFocusForControlledSide();
    const visual = displayCoords(focused.x, focused.y);
    const next = boardCoords(
      clamp(visual.displayX + displayDx, 0, 7),
      clamp(visual.displayY + displayDy, 0, 7)
    );
    setKeyboardFocus(next.x, next.y);
    renderBoard();
  }

  function squareAriaLabel(x, y, piece) {
    const base = coordToNotation(x, y);
    if (!piece) {
      return `${base}, empty square`;
    }
    return `${base}, ${capitalize(piece.color)} ${Core.PIECES[piece.type].name}`;
  }

  function isMoveLegalTo(x, y) {
    return state.legalMoves.find((move) => move.x === x && move.y === y) || null;
  }

  function renderBoardSquares() {
    boardSquares.innerHTML = '';
    const lastMove = state.snapshot ? state.snapshot.lastMove : null;
    const checkedColor = state.snapshot ? state.snapshot.check : null;

    for (let displayY = 0; displayY < 8; displayY += 1) {
      for (let displayX = 0; displayX < 8; displayX += 1) {
        const actual = boardCoords(displayX, displayY);
        const square = document.createElement('button');
        square.type = 'button';
        square.className = `board-square ${(actual.x + actual.y) % 2 === 0 ? 'light' : 'dark'}`;
        square.tabIndex = -1;
        square.setAttribute('aria-label', squareAriaLabel(actual.x, actual.y, boardPieceAt(actual.x, actual.y)));
        square.addEventListener('click', () => {
          if (performance.now() < state.clickGuardUntil) {
            return;
          }
          ui.boardGrid.focus();
          setKeyboardFocus(actual.x, actual.y);
          handleSquare(actual.x, actual.y);
        });

        if (state.selected && state.selected.x === actual.x && state.selected.y === actual.y) {
          square.classList.add('selected');
        }
        if (state.keyboardFocus && state.keyboardFocus.x === actual.x && state.keyboardFocus.y === actual.y) {
          square.classList.add('focused');
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

        const move = isMoveLegalTo(actual.x, actual.y);
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

  function destroyDragGhost() {
    if (state.dragGhost) {
      state.dragGhost.remove();
      state.dragGhost = null;
    }
  }

  function positionDragGhost(clientX, clientY) {
    if (!state.dragGhost) {
      return;
    }
    const size = ui.boardGrid.getBoundingClientRect().width / 8;
    state.dragGhost.style.width = `${size}px`;
    state.dragGhost.style.height = `${size}px`;
    state.dragGhost.style.transform = `translate(${clientX - (size / 2)}px, ${clientY - (size / 2)}px)`;
  }

  function createDragGhost(piece, clientX, clientY) {
    destroyDragGhost();
    const ghost = document.createElement('div');
    ghost.className = `drag-ghost ${piece.color}`;
    ghost.innerHTML = `<span class="piece-face">${Core.getPieceGlyph(piece)}</span>`;
    document.body.appendChild(ghost);
    state.dragGhost = ghost;
    positionDragGhost(clientX, clientY);
  }

  function cleanupDrag() {
    if (!state.drag) {
      return;
    }
    if (state.drag.sourceElement) {
      state.drag.sourceElement.classList.remove('drag-source');
      try {
        if (state.drag.sourceElement.hasPointerCapture && state.drag.sourceElement.hasPointerCapture(state.drag.pointerId)) {
          state.drag.sourceElement.releasePointerCapture(state.drag.pointerId);
        }
      } catch (error) {
        // Ignore pointer capture release issues.
      }
    }
    window.removeEventListener('pointermove', handleGlobalPointerMove);
    window.removeEventListener('pointerup', handleGlobalPointerEnd);
    window.removeEventListener('pointercancel', handleGlobalPointerEnd);
    destroyDragGhost();
    state.drag = null;
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
        const isDragSource = Boolean(state.drag && state.drag.pieceId === piece.id);
        element.className = `board-piece ${piece.color}${piece.id === selectedId ? ' active' : ''}${isMovedPiece ? ' moved' : ''}${isDragSource ? ' drag-source' : ''}`;
        element.style.setProperty('--x', `calc(var(--square-size) * ${displayX})`);
        element.style.setProperty('--y', `calc(var(--square-size) * ${displayY})`);
        element.querySelector('.piece-face').textContent = Core.getPieceGlyph(piece);
        element.onpointerdown = (event) => {
          if (performance.now() < state.clickGuardUntil) {
            return;
          }
          handlePiecePointerDown(event, x, y, piece);
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
      ui.networkStatus.textContent = 'Stockfish';
      ui.modePill.textContent = state.engineReady
        ? `Vs Stockfish 18 - ${engineLevelProfile().label}`
        : state.engineFallback
          ? 'Vs backup engine'
          : 'Stockfish warm-up';
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
    const pendingConnection = Boolean(state.socket && state.socket.readyState === WebSocket.CONNECTING);
    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !sanitizeRoomCode(ui.roomInput.value);
    ui.retryEngineBtn.disabled = state.mode !== 'solo' || Boolean(state.engineInitPromise);
    ui.engineMoveBtn.disabled = state.mode !== 'solo' || !state.snapshot || Boolean(state.snapshot.winner || state.snapshot.drawReason);
    ui.restartBtn.disabled = !state.snapshot;
    ui.flipBtn.disabled = !state.snapshot;
    ui.copyBtn.disabled = !hasRoom;
    ui.copyCodeBtn.disabled = !hasRoom;
    ui.engineLevelSelect.disabled = state.mode === 'online';
    ui.boardThemeSelect.disabled = false;
    ui.retryEngineBtn.textContent = state.engineInitPromise
      ? 'Loading Stockfish 18...'
      : state.engineReady
        ? 'Reload Stockfish'
        : 'Retry Stockfish';

    ui.stepOne.classList.toggle('active', Boolean(ui.nameInput.value.trim()));
    ui.stepTwo.classList.toggle('active', state.mode === 'online' || state.mode === 'solo');
    ui.stepThree.classList.toggle('active', Boolean(state.snapshot));
  }

  function render() {
    renderPills();
    renderStatus();
    renderDifficultyInfo();
    renderBoardThemeInfo();
    renderSoundInfo();
    updateInviteUi();
    renderSummary();
    renderPlayers();
    renderHistory();
    renderCaptured();
    renderBoard();
    renderControls();
    setEngineStatus(state.engineStatus);
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
      { id: 'engine-black', name: state.engineReady ? `Stockfish 18 ${engineLevelProfile().label}` : state.engineFallback ? 'Backup bot' : 'Stockfish 18', color: 'black' },
    ];
    soloState.service = state.engineReady ? 'stockfish-18' : 'solo';
    return soloState;
  }

  function snapshotToFen(snapshot) {
    const pieceToFen = {
      pawn: 'p',
      knight: 'n',
      bishop: 'b',
      rook: 'r',
      queen: 'q',
      king: 'k',
    };

    const rows = [];
    for (let y = 0; y < 8; y += 1) {
      let empty = 0;
      let row = '';
      for (let x = 0; x < 8; x += 1) {
        const piece = Core.getPiece(snapshot.board, x, y);
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) {
          row += String(empty);
          empty = 0;
        }
        const symbol = pieceToFen[piece.type] || 'p';
        row += piece.color === 'white' ? symbol.toUpperCase() : symbol;
      }
      if (empty) {
        row += String(empty);
      }
      rows.push(row);
    }

    const castling = [];
    const whiteKing = Core.getPiece(snapshot.board, 4, 7);
    const blackKing = Core.getPiece(snapshot.board, 4, 0);
    const whiteKingRook = Core.getPiece(snapshot.board, 7, 7);
    const whiteQueenRook = Core.getPiece(snapshot.board, 0, 7);
    const blackKingRook = Core.getPiece(snapshot.board, 7, 0);
    const blackQueenRook = Core.getPiece(snapshot.board, 0, 0);

    if (whiteKing && whiteKing.type === 'king' && whiteKing.color === 'white' && !whiteKing.moved) {
      if (whiteKingRook && whiteKingRook.type === 'rook' && whiteKingRook.color === 'white' && !whiteKingRook.moved) castling.push('K');
      if (whiteQueenRook && whiteQueenRook.type === 'rook' && whiteQueenRook.color === 'white' && !whiteQueenRook.moved) castling.push('Q');
    }
    if (blackKing && blackKing.type === 'king' && blackKing.color === 'black' && !blackKing.moved) {
      if (blackKingRook && blackKingRook.type === 'rook' && blackKingRook.color === 'black' && !blackKingRook.moved) castling.push('k');
      if (blackQueenRook && blackQueenRook.type === 'rook' && blackQueenRook.color === 'black' && !blackQueenRook.moved) castling.push('q');
    }

    return [
      rows.join('/'),
      snapshot.turn === 'black' ? 'b' : 'w',
      castling.length ? castling.join('') : '-',
      snapshot.enPassant ? coordToNotation(snapshot.enPassant.x, snapshot.enPassant.y) : '-',
      snapshot.halfmoveClock || 0,
      snapshot.moveNumber || 1,
    ].join(' ');
  }

  function uciToMove(uci) {
    if (!uci || uci === '(none)' || uci.length < 4) {
      return null;
    }
    const fromFile = FILES.indexOf(uci[0]);
    const toFile = FILES.indexOf(uci[2]);
    const fromRank = Number(uci[1]);
    const toRank = Number(uci[3]);
    if (fromFile < 0 || toFile < 0 || Number.isNaN(fromRank) || Number.isNaN(toRank)) {
      return null;
    }
    return {
      from: { x: fromFile, y: 8 - fromRank },
      to: { x: toFile, y: 8 - toRank },
      promotion: uci[4] ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[uci[4]] || null) : null,
    };
  }

  function chooseFallbackMove(snapshot, color) {
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

    return {
      from: bestMove.from,
      to: bestMove.to,
      promotion: bestMove.promotionRequired ? 'queen' : undefined,
    };
  }

  function teardownEngineWorker() {
    window.clearTimeout(state.engineInitTimer);
    if (state.engineWorker) {
      try {
        state.engineWorker.postMessage('stop');
        state.engineWorker.postMessage('quit');
        state.engineWorker.terminate();
      } catch (error) {
        // Ignore engine shutdown issues.
      }
    }
    state.engineWorker = null;
    state.engineReady = false;
    state.enginePending = null;
    state.engineInitPromise = null;
    state.engineInitResolve = null;
    state.engineInitReject = null;
    state.engineInitTimer = 0;
    state.engineLastInfoAt = 0;
    state.engineNeedsNewGame = true;
  }

  function resetEngineBridge() {
    teardownEngineWorker();
    state.engineFallback = false;
    state.engineStatus = 'Stockfish 18 idle.';
  }

  function resolveEngineInit(ok, value) {
    const resolver = ok ? state.engineInitResolve : state.engineInitReject;
    state.engineInitResolve = null;
    state.engineInitReject = null;
    state.engineInitPromise = null;
    if (resolver) {
      resolver(value);
    }
  }

  function handleEngineMessage(event) {
    const payload = event.data;
    if (payload && typeof payload === 'object' && payload.type === 'ready') {
      window.clearTimeout(state.engineInitTimer);
      state.engineInitTimer = 0;
      state.engineReady = true;
      state.engineFallback = false;
      state.engineLastInfoAt = 0;
      setEngineStatus(engineReadyMessage());
      resolveEngineInit(true, true);
      render();
      return;
    }
    if (payload && typeof payload === 'object' && payload.type === 'error') {
      state.engineReady = false;
      state.engineFallback = true;
      state.engineLastInfoAt = 0;
      setEngineStatus('Stockfish 18 unavailable, using backup engine.');
      if (state.enginePending) {
        window.clearTimeout(state.enginePending.timer);
        state.enginePending.reject(new Error(payload.message || 'Engine error'));
        state.enginePending = null;
      }
      resolveEngineInit(false, new Error(payload.message || 'Engine error'));
      render();
      return;
    }
    if (payload && typeof payload === 'object' && payload.type === 'info' && state.enginePending) {
      const now = Date.now();
      if (now - state.engineLastInfoAt > 260) {
        const depth = /(?:^|\s)depth\s+(\d+)/.exec(payload.line || '');
        const pv = /(?:^|\s)pv\s+(.+)$/.exec(payload.line || '');
        const fragments = [`Stockfish 18 thinking - ${engineLevelProfile().label}`];
        if (depth) {
          fragments.push(`depth ${depth[1]}`);
        }
        if (pv) {
          fragments.push(pv[1].split(/\s+/).slice(0, 3).join(' '));
        }
        setEngineStatus(fragments.join(' | '));
        state.engineLastInfoAt = now;
      }
      return;
    }
    if (payload && typeof payload === 'object' && payload.type === 'bestmove' && state.enginePending && payload.requestId === state.enginePending.requestId) {
      const pending = state.enginePending;
      state.enginePending = null;
      window.clearTimeout(pending.timer);
      state.engineLastInfoAt = 0;
      pending.resolve(uciToMove(payload.move));
      return;
    }

    const text = typeof payload === 'string' ? payload : '';
    if (!text) {
      return;
    }

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line === 'uciok') {
        syncEngineOptions();
        sendEngineCommand('isready');
        continue;
      }
      if (line === 'readyok') {
        window.clearTimeout(state.engineInitTimer);
        state.engineInitTimer = 0;
        state.engineReady = true;
        state.engineFallback = false;
        state.engineLastInfoAt = 0;
        setEngineStatus(engineReadyMessage());
        resolveEngineInit(true, true);
        render();
        continue;
      }
      if (line.startsWith('info ') && state.enginePending) {
        const now = Date.now();
        if (now - state.engineLastInfoAt > 260) {
          const depth = /(?:^|\s)depth\s+(\d+)/.exec(line);
          const pv = /(?:^|\s)pv\s+(.+)$/.exec(line);
          const fragments = [`Stockfish 18 thinking - ${engineLevelProfile().label}`];
          if (depth) {
            fragments.push(`depth ${depth[1]}`);
          }
          if (pv) {
            fragments.push(pv[1].split(/\s+/).slice(0, 3).join(' '));
          }
          setEngineStatus(fragments.join(' | '));
          state.engineLastInfoAt = now;
        }
        continue;
      }
      if (line.startsWith('bestmove ') && state.enginePending) {
        const pending = state.enginePending;
        state.enginePending = null;
        window.clearTimeout(pending.timer);
        state.engineLastInfoAt = 0;
        pending.resolve(uciToMove(line.split(/\s+/)[1] || '(none)'));
      }
    }
  }

  function ensureEngineReady() {
    if (state.engineFallback) {
      return Promise.resolve(false);
    }
    if (state.engineReady && state.engineWorker) {
      return Promise.resolve(true);
    }
    if (state.engineInitPromise) {
      return state.engineInitPromise;
    }

    state.engineInitPromise = new Promise((resolve, reject) => {
      state.engineInitResolve = resolve;
      state.engineInitReject = reject;
    });
    setEngineStatus('Loading local Stockfish 18...');

    try {
      if (!state.engineWorker) {
        state.engineWorker = new Worker(DIRECT_STOCKFISH_WORKER);
        state.engineWorker.onmessage = handleEngineMessage;
        state.engineWorker.onerror = () => {
          window.clearTimeout(state.engineInitTimer);
          state.engineInitTimer = 0;
          state.engineFallback = true;
          state.engineReady = false;
          setEngineStatus('Stockfish 18 failed to load, using backup engine.');
          resolveEngineInit(false, new Error('Engine worker failed to load.'));
          render();
        };
      }
      window.clearTimeout(state.engineInitTimer);
      state.engineInitTimer = window.setTimeout(() => {
        if (state.engineReady || !state.engineInitPromise) {
          return;
        }
        state.engineFallback = true;
        state.engineReady = false;
        setEngineStatus('Stockfish 18 took too long to load, using backup engine.');
        if (state.engineWorker) {
          try {
            state.engineWorker.terminate();
          } catch (error) {
            // Ignore termination issues during fallback.
          }
        }
        state.engineWorker = null;
        resolveEngineInit(false, new Error('Engine init timed out.'));
        render();
      }, ENGINE_INIT_TIMEOUT_MS);
      state.engineWorker.postMessage('uci');
    } catch (error) {
      window.clearTimeout(state.engineInitTimer);
      state.engineInitTimer = 0;
      state.engineFallback = true;
      setEngineStatus('Stockfish 18 failed to start, using backup engine.');
      resolveEngineInit(false, error);
    }

    return state.engineInitPromise.catch(() => false);
  }

  function requestEngineMove(snapshot) {
    if (!state.engineWorker || !state.engineReady) {
      return Promise.resolve(chooseFallbackMove(snapshot, 'black'));
    }
    const requestId = ++state.engineRequestSeq;
    const profile = engineLevelProfile();
    state.engineLastInfoAt = 0;
    setEngineStatus(`Stockfish 18 thinking - ${profile.label}`);
    return new Promise((resolve, reject) => {
      if (state.enginePending) {
        window.clearTimeout(state.enginePending.timer);
        state.enginePending.reject(new Error('Superseded by a newer engine request.'));
      }
      const timer = window.setTimeout(() => {
        if (!state.enginePending || state.enginePending.requestId !== requestId) {
          return;
        }
        state.enginePending = null;
        state.engineFallback = true;
        state.engineReady = false;
        setEngineStatus('Stockfish 18 stalled, using backup engine.');
        reject(new Error('Engine move timed out.'));
        render();
      }, ENGINE_MOVE_TIMEOUT_MS);
      state.enginePending = { requestId, resolve, reject, timer };
      sendEngineCommand('stop');
      syncEngineOptions();
      if (state.engineNeedsNewGame) {
        sendEngineCommand('ucinewgame');
        state.engineNeedsNewGame = false;
      }
      sendEngineCommand(`position fen ${snapshotToFen(snapshot)}`);
      sendEngineCommand(`go movetime ${profile.movetime}`);
    });
  }

  function cancelEngineThinking() {
    window.clearTimeout(state.botTimer);
    if (state.engineWorker && state.enginePending) {
      sendEngineCommand('stop');
      window.clearTimeout(state.enginePending.timer);
      state.enginePending.reject(new Error('Engine request cancelled.'));
      state.enginePending = null;
    }
  }

  function queueEngineTurn() {
    window.clearTimeout(state.botTimer);
    state.botTimer = window.setTimeout(async () => {
      if (state.mode !== 'solo' || !state.snapshot || state.snapshot.turn !== 'black' || state.snapshot.winner || state.snapshot.drawReason) {
        return;
      }

      const fenAtStart = snapshotToFen(state.snapshot);
      const workingSnapshot = Core.cloneState(state.snapshot);
      let move = null;
      try {
        const engineReady = await ensureEngineReady();
        move = engineReady
          ? await requestEngineMove(workingSnapshot)
          : chooseFallbackMove(workingSnapshot, 'black');
      } catch (error) {
        move = chooseFallbackMove(workingSnapshot, 'black');
      }
      if (!move || state.mode !== 'solo' || !state.snapshot || snapshotToFen(state.snapshot) !== fenAtStart) {
        return;
      }
      const sandbox = Core.cloneState(state.snapshot);
      const result = Core.applyMove(sandbox, move);
      if (!result.ok) {
        return;
      }
      setSnapshot(decorateSoloSnapshot(sandbox));
      setStatusMessage(state.snapshot.status);
      if (state.engineReady) {
        setEngineStatus(engineReadyMessage());
      }
      clearSelection();
      render();
    }, 260);
  }

  async function forceEngineMoveNow() {
    if (state.mode !== 'solo' || !state.snapshot || state.snapshot.winner || state.snapshot.drawReason) {
      return;
    }

    cancelEngineThinking();
    const fenAtStart = snapshotToFen(state.snapshot);
    const sideToMove = state.snapshot.turn;
    let move = null;

    if (state.engineFallback) {
      resetEngineBridge();
    }

    try {
      const engineReady = await ensureEngineReady();
      move = engineReady
        ? await requestEngineMove(Core.cloneState(state.snapshot))
        : chooseFallbackMove(state.snapshot, sideToMove);
    } catch (error) {
      move = chooseFallbackMove(state.snapshot, sideToMove);
    }

    if (!move || !state.snapshot || snapshotToFen(state.snapshot) !== fenAtStart) {
      return;
    }

    const sandbox = Core.cloneState(state.snapshot);
    const result = Core.applyMove(sandbox, move);
    if (!result.ok) {
      showToast(result.error || 'Engine move failed.');
      return;
    }

    setSnapshot(decorateSoloSnapshot(sandbox));
    setStatusMessage(state.snapshot.status);
    if (state.engineReady) {
      setEngineStatus(engineReadyMessage());
    }
    clearSelection();
    render();
  }

  async function retryEngineNow() {
    if (state.mode !== 'solo') {
      return;
    }

    cancelEngineThinking();
    resetEngineBridge();
    updateSoloEngineLabel();
    setEngineStatus('Reloading Stockfish 18...');
    render();

    const ready = await ensureEngineReady();
    if (state.mode !== 'solo') {
      return;
    }

    updateSoloEngineLabel();
    if (ready) {
      setEngineStatus(engineReadyMessage());
      showToast('Stockfish 18 is ready.');
      render();
      if (state.snapshot && state.snapshot.turn === 'black' && !state.snapshot.winner && !state.snapshot.drawReason) {
        queueEngineTurn();
      }
      return;
    }

    setEngineStatus('Stockfish 18 is still unavailable, using backup engine.');
    showToast('Still using the backup engine.');
    render();
  }

  function submitMove(move) {
    closePromotion();
    cancelEngineThinking();

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
      setSnapshot(decorateSoloSnapshot(sandbox));
      setStatusMessage(state.snapshot.status);
      clearSelection();
      render();
      queueEngineTurn();
    }
  }

  function selectSquare(x, y) {
    const piece = boardPieceAt(x, y);
    if (!canInteract() || !piece || piece.color !== getControlledColor()) {
      return false;
    }
    state.selected = { x, y };
    state.legalMoves = Core.getLegalMoves(state.snapshot, x, y);
    setKeyboardFocus(x, y);
    renderBoard();
    return true;
  }

  function attemptMoveTo(x, y) {
    const destination = isMoveLegalTo(x, y);
    if (!destination || !state.selected) {
      return false;
    }
    const move = {
      from: { ...state.selected },
      to: { x, y },
    };
    if (destination.promotionRequired) {
      openPromotion(move);
    } else {
      submitMove(move);
    }
    return true;
  }

  function handleSquare(x, y) {
    if (!state.snapshot) {
      return;
    }

    setKeyboardFocus(x, y);
    const piece = boardPieceAt(x, y);
    const controlledColor = getControlledColor();
    const interactive = canInteract();

    if (state.selected && attemptMoveTo(x, y)) {
      return;
    }

    if (interactive && piece && piece.color === controlledColor) {
      if (state.selected && state.selected.x === x && state.selected.y === y) {
        clearSelection();
        return;
      }
      selectSquare(x, y);
      return;
    }

    clearSelection();
  }

  function handlePiecePointerDown(event, x, y, piece) {
    if (!canInteract() || piece.color !== getControlledColor()) {
      return;
    }
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    event.preventDefault();
    ui.boardGrid.focus();
    setKeyboardFocus(x, y);
    selectSquare(x, y);
    createDragGhost(piece, event.clientX, event.clientY);
    state.drag = {
      pointerId: event.pointerId,
      pieceId: piece.id,
      from: { x, y },
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      sourceElement: event.currentTarget,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture issues.
    }
    event.currentTarget.classList.add('drag-source');
    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerEnd);
    window.addEventListener('pointercancel', handleGlobalPointerEnd);
  }

  function handleGlobalPointerMove(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }
    if (Math.hypot(event.clientX - state.drag.startX, event.clientY - state.drag.startY) > 8) {
      state.drag.moved = true;
    }
    positionDragGhost(event.clientX, event.clientY);
    const hoverSquare = boardPointToCoords(event.clientX, event.clientY);
    if (hoverSquare) {
      setKeyboardFocus(hoverSquare.x, hoverSquare.y);
      renderBoardSquares();
    }
  }

  function handleGlobalPointerEnd(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }
    const dragInfo = state.drag;
    const dropSquare = boardPointToCoords(event.clientX, event.clientY);
    cleanupDrag();
    state.clickGuardUntil = performance.now() + 180;
    if (dropSquare && dragInfo.moved) {
      setKeyboardFocus(dropSquare.x, dropSquare.y);
      if (attemptMoveTo(dropSquare.x, dropSquare.y)) {
        return;
      }
      selectSquare(dragInfo.from.x, dragInfo.from.y);
      return;
    }
    handleSquare(dragInfo.from.x, dragInfo.from.y);
  }

  function handleBoardKeydown(event) {
    if (event.target !== ui.boardGrid) {
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveKeyboardFocus(0, -1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveKeyboardFocus(0, 1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveKeyboardFocus(-1, 0);
        return;
      case 'ArrowRight':
        event.preventDefault();
        moveKeyboardFocus(1, 0);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        handleSquare(state.keyboardFocus.x, state.keyboardFocus.y);
        return;
      case 'Escape':
        event.preventDefault();
        clearSelection();
        return;
      default:
        return;
    }
  }

  function updateSoloEngineLabel() {
    if (state.mode === 'solo' && state.snapshot) {
      setSnapshot(decorateSoloSnapshot(state.snapshot), { silent: true });
      render();
    }
  }

  function updateFromServerSnapshot(snapshot, message) {
    setSnapshot(snapshot);
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
    cancelEngineThinking();
    cleanupDrag();
    closePromotion();
    state.mode = 'online';
    state.yourColor = null;
    setSnapshot(null, { silent: true });
    state.roomCode = roomCode;
    state.selected = null;
    state.legalMoves = [];
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
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
        setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
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
    cancelEngineThinking();
    cleanupDrag();
    resetEngineBridge();
    closePromotion();
    state.mode = 'solo';
    state.yourColor = 'white';
    state.roomCode = 'SOLO';
    state.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value);
    persistSettings();
    setSnapshot(decorateSoloSnapshot(Core.createGameState()), { startCue: true });
    state.selected = null;
    state.legalMoves = [];
    setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
    setStatusMessage(`Stockfish 18 ${engineLevelProfile().label} match started. You control White. Mouse, touch, and keyboard controls are all enabled.`);
    setEngineStatus('Warming up local Stockfish 18...');
    render();
    ensureEngineReady().then((ready) => {
      if (state.mode !== 'solo') {
        return;
      }
      if (ready) {
        updateSoloEngineLabel();
      } else {
        setEngineStatus('Stockfish 18 unavailable, using backup engine.');
      }
      render();
    });
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
        setSnapshot(decorateSoloSnapshot(state.snapshot), { silent: true });
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

    ui.engineLevelSelect.addEventListener('change', () => {
      state.engineLevel = normalizeEngineLevel(ui.engineLevelSelect.value);
      persistSettings();
      if (state.engineReady) {
        syncEngineOptions();
        setEngineStatus(engineReadyMessage());
      } else if (state.mode === 'solo') {
        setEngineStatus('Warming up local Stockfish 18...');
      }
      updateSoloEngineLabel();
      render();
    });

    ui.boardThemeSelect.addEventListener('change', () => {
      state.boardTheme = normalizeBoardTheme(ui.boardThemeSelect.value);
      persistSettings();
      renderBoardThemeInfo();
      showToast(`${boardThemeProfile().label} board selected.`);
    });

    ui.soundToggleBtn.addEventListener('click', async () => {
      if (!audioSupported()) {
        showToast('This browser does not expose Web Audio here.');
        return;
      }
      state.soundEnabled = !state.soundEnabled;
      persistSettings();
      renderSoundInfo();
      if (state.soundEnabled) {
        await primeAudio();
        playSoundCue('move');
        showToast('Sound enabled.');
      } else {
        showToast('Sound muted.');
      }
    });

    window.addEventListener('pointerdown', () => {
      if (state.soundEnabled) {
        primeAudio();
      }
    }, { passive: true });
    window.addEventListener('keydown', () => {
      if (state.soundEnabled) {
        primeAudio();
      }
    });

    ui.hostBtn.addEventListener('click', () => {
      if (state.soundEnabled) {
        primeAudio();
      }
      connectOnline('host');
    });
    ui.joinBtn.addEventListener('click', () => {
      if (state.soundEnabled) {
        primeAudio();
      }
      connectOnline('join');
    });
    ui.soloBtn.addEventListener('click', () => {
      if (state.soundEnabled) {
        primeAudio();
      }
      startSolo();
    });
    ui.retryEngineBtn.addEventListener('click', () => {
      retryEngineNow();
    });
    ui.engineMoveBtn.addEventListener('click', () => {
      forceEngineMoveNow();
    });
    ui.copyBtn.addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied.'));
    ui.copyCodeBtn.addEventListener('click', () => copyText(state.roomCode, 'Room code copied.'));
    ui.restartBtn.addEventListener('click', () => {
      cleanupDrag();
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
      ui.boardGrid.focus();
    });
    ui.promotionModal.addEventListener('click', (event) => {
      if (event.target === ui.promotionModal) {
        closePromotion();
      }
    });
    ui.boardGrid.tabIndex = 0;
    ui.boardGrid.addEventListener('keydown', handleBoardKeydown);
    ui.boardGrid.addEventListener('focus', () => {
      if (!state.keyboardFocus) {
        setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
        renderBoard();
      }
    });
  }

  function init() {
    ui.nameInput.value = localStorage.getItem(STORAGE_KEYS.name) || '';
    state.serverUrl = sanitizeServerUrl(query.get('server') || localStorage.getItem(STORAGE_KEYS.serverUrl) || PROD_SERVER_URL);
    ui.serverUrlInput.value = state.serverUrl;
    state.engineLevel = normalizeEngineLevel(localStorage.getItem(STORAGE_KEYS.engineLevel) || '10');
    ui.engineLevelSelect.value = String(state.engineLevel);
    state.boardTheme = normalizeBoardTheme(localStorage.getItem(STORAGE_KEYS.boardTheme) || 'walnut');
    ui.boardThemeSelect.value = state.boardTheme;
    state.soundEnabled = localStorage.getItem(STORAGE_KEYS.soundEnabled) !== '0';
    setEngineStatus('Stockfish 18 idle.');
    const inviteRoom = sanitizeRoomCode(query.get('room'));
    if (inviteRoom) {
      ui.roomInput.value = inviteRoom;
      setStatusMessage('Invite link loaded. Enter your name and press Join match.');
    } else {
      renderStatus();
    }

    setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
    renderLegend();
    bindEvents();
    render();
  }

  init();
})();
