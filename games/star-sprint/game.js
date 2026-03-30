(() => {
  'use strict';

  const Core = window.NeonChessCore;
  const STORAGE_KEYS = {
    name: 'neonCrownChess.name',
    serverUrl: 'neonCrownChess.serverUrl',
    engineLevel: 'neonCrownChess.engineLevel',
    timeControlPreset: 'neonCrownChess.timeControlPreset',
    setupCollapsed: 'neonCrownChess.setupCollapsed',
    sidebarCollapsed: 'neonCrownChess.sidebarCollapsed',
    boardTheme: 'neonCrownChess.boardTheme',
    pieceStyle: 'neonCrownChess.pieceStyle',
    soundEnabled: 'neonCrownChess.soundEnabled',
    soundProfile: 'neonCrownChess.soundProfile',
  };
  const PROD_SERVER_URL = 'wss://backend-ujaa.onrender.com';
  const ENGINE_WORKER_VERSION = '20260325f';
  const PIECE_ASSET_VERSION = '20260329f';
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
  const TIME_CONTROL_PRESETS = {
    untimed: {
      id: 'untimed',
      label: 'Untimed',
      shortLabel: 'No clock',
      baseMs: 0,
      summary: 'No countdown clock. Good for relaxed games and testing.',
    },
    '1m': {
      id: '1m',
      label: '1 minute bullet',
      shortLabel: '1+0',
      baseMs: 60 * 1000,
      summary: 'Fast bullet chess with almost no think time.',
    },
    '2m': {
      id: '2m',
      label: '2 minute sprint',
      shortLabel: '2+0',
      baseMs: 2 * 60 * 1000,
      summary: 'Quick sprint games where both players need to move with intent.',
    },
    '3m': {
      id: '3m',
      label: '3 minute blitz',
      shortLabel: '3+0',
      baseMs: 3 * 60 * 1000,
      summary: 'Classic blitz pressure with just enough time for tactics.',
    },
    '5m': {
      id: '5m',
      label: '5 minute blitz',
      shortLabel: '5+0',
      baseMs: 5 * 60 * 1000,
      summary: 'A balanced blitz preset for most fast online games.',
    },
    '10m': {
      id: '10m',
      label: '10 minute rapid',
      shortLabel: '10+0',
      baseMs: 10 * 60 * 1000,
      summary: 'A calmer rapid game with room for longer plans.',
    },
  };
  const BOARD_THEMES = {
    walnut: {
      label: 'Walnut Classic',
      pieceStyle: 'walnut',
      soundProfile: 'walnut',
      summary: 'Warm walnut tones with a traditional table look and classic contrast.',
    },
    marble: {
      label: 'Ivory Marble',
      pieceStyle: 'marble',
      soundProfile: 'marble',
      summary: 'Bright ivory squares, cool slate darks, and a polished tournament-lobby finish.',
    },
    midnight: {
      label: 'Midnight Arena',
      pieceStyle: 'midnight',
      soundProfile: 'midnight',
      summary: 'Deep navy squares with steel highlights for a sharper late-night match feel.',
    },
    emerald: {
      label: 'Emerald Study',
      pieceStyle: 'emerald',
      soundProfile: 'emerald',
      summary: 'Rich green felt tones with brass woodwork for a club-room table vibe.',
    },
    rosewood: {
      label: 'Rosewood Salon',
      pieceStyle: 'regal',
      soundProfile: 'walnut',
      summary: 'Deep wine-red woods, warm ivory lights, and a more dramatic parlor-table contrast.',
    },
    onyx: {
      label: 'Onyx Slate',
      pieceStyle: 'onyx',
      soundProfile: 'midnight',
      summary: 'Sharp black-and-stone tournament tones with high contrast and a colder modern feel.',
    },
    sandstone: {
      label: 'Sandstone Court',
      pieceStyle: 'porcelain',
      soundProfile: 'walnut',
      summary: 'Warm sandstone tones with desert-club contrast and a softer premium tournament finish.',
    },
    storm: {
      label: 'Stormglass Arena',
      pieceStyle: 'steel',
      soundProfile: 'marble',
      summary: 'Cool steel-blue squares with a sharper modern arena palette and crisp contrast.',
    },
  };
  const PIECE_STYLES = {
    auto: {
      label: 'Match board',
      summary: 'Automatically uses the piece set paired with the active board theme.',
      artFamily: 'merida',
    },
    walnut: {
      label: 'Carved Walnut',
      summary: 'Ivory and ebony medallion pieces with a carved old-club character.',
      artFamily: 'merida',
    },
    marble: {
      label: 'Marble Tournament',
      summary: 'Polished stone pieces with silver trim and a cleaner tournament look.',
      artFamily: 'dgra',
    },
    midnight: {
      label: 'Neon Glass',
      summary: 'Arena-style pieces with sharper glow, darker obsidian bodies, and brighter rims.',
      artFamily: 'dgra',
    },
    emerald: {
      label: 'Brass Study',
      summary: 'Brass-and-ivory pieces with a quieter library-table personality.',
      artFamily: 'merida',
    },
    regal: {
      label: 'Royal Crown',
      summary: 'High-polish ivory and lacquered garnet pieces with a richer ceremonial feel.',
      artFamily: 'dgra',
    },
    onyx: {
      label: 'Onyx Tournament',
      summary: 'Matte monochrome pieces with crisp silver rims and stronger silhouette contrast.',
      artFamily: 'merida',
    },
    porcelain: {
      label: 'Porcelain Elite',
      summary: 'High-gloss porcelain and obsidian pieces with cleaner contours and stronger contrast.',
      artFamily: 'dgra',
    },
    steel: {
      label: 'Forged Steel',
      summary: 'Brushed steel and carbon pieces with colder tournament contrast and sharper edges.',
      artFamily: 'dgra',
    },
  };
  const PIECE_ART_FAMILIES = {
    merida: {
      id: 'merida',
      kind: 'single',
    },
    dgra: {
      id: 'dgra',
      kind: 'sprite',
      src: `assets/pieces/dgra/set.svg?v=${PIECE_ASSET_VERSION}`,
      cols: 6,
      rows: 2,
      typeColumns: {
        king: 0,
        queen: 1,
        rook: 2,
        bishop: 3,
        knight: 4,
        pawn: 5,
      },
      colorRows: {
        white: 0,
        black: 1,
      },
    },
  };
  const SOUND_PROFILES = {
    auto: {
      label: 'Match board',
      summary: 'Automatically uses the sound palette paired with the active board theme.',
    },
    walnut: {
      label: 'Wood Hall',
      summary: 'Warm wooden clicks and darker felt-table thumps.',
    },
    marble: {
      label: 'Crystal Room',
      summary: 'Clean glassy pings with crisp tournament-room definition.',
    },
    midnight: {
      label: 'Synth Arena',
      summary: 'Sharper neon synth blips and arcade-style pressure cues.',
    },
    emerald: {
      label: 'Club Lounge',
      summary: 'Soft brass notes and calmer low-end cues for longer games.',
    },
  };

  function pieceAssetConfig(piece) {
    if (!piece) {
      return null;
    }
    const style = pieceStyleProfile();
    const family = PIECE_ART_FAMILIES[style.artFamily] || PIECE_ART_FAMILIES.merida;
    if (family.kind === 'sprite') {
      const column = family.typeColumns[piece.type] ?? 0;
      const row = family.colorRows[piece.color] ?? 0;
      return {
        familyId: family.id,
        kind: family.kind,
        src: family.src,
        column,
        row,
        sizeX: `${family.cols * 100}%`,
        sizeY: `${family.rows * 100}%`,
        positionX: family.cols > 1 ? `${(column / (family.cols - 1)) * 100}%` : '0%',
        positionY: family.rows > 1 ? `${(row / (family.rows - 1)) * 100}%` : '0%',
      };
    }
    return {
      familyId: family.id,
      kind: family.kind,
      src: `assets/pieces/${family.id}/${piece.color}-${piece.type}.svg?v=${PIECE_ASSET_VERSION}`,
    };
  }

  function pieceFaceMarkup(piece) {
    const art = pieceAssetConfig(piece);
    const glyph = Core.getPieceGlyph(piece);
    const artKey = art
      ? art.kind === 'sprite'
        ? `${art.familyId}:${art.src}:${art.column}:${art.row}`
        : `${art.familyId}:${art.src}`
      : `fallback:${piece.color}:${piece.type}`;
    if (!art) {
      return `<span class="piece-face piece-face-svg" data-piece-type="${piece.type}" data-piece-color="${piece.color}" data-art-key="${artKey}"><span class="piece-fallback" aria-hidden="true">${glyph}</span></span>`;
    }
    if (art.kind === 'sprite') {
      return `<span class="piece-face piece-face-svg piece-face-sprite" data-piece-type="${piece.type}" data-piece-color="${piece.color}" data-art-family="${art.familyId}" data-piece-src="${art.src}" data-art-key="${artKey}"><span class="piece-art piece-art-sprite" style="background-image:url('${art.src}');--sprite-size-x:${art.sizeX};--sprite-size-y:${art.sizeY};--sprite-pos-x:${art.positionX};--sprite-pos-y:${art.positionY};" aria-hidden="true"></span><span class="piece-fallback" aria-hidden="true">${glyph}</span></span>`;
    }
    return `<span class="piece-face piece-face-svg" data-piece-type="${piece.type}" data-piece-color="${piece.color}" data-art-family="${art.familyId}" data-piece-src="${art.src}" data-art-key="${artKey}"><img class="piece-art piece-art-single" src="${art.src}" alt="" draggable="false" decoding="async" /><span class="piece-fallback" aria-hidden="true">${glyph}</span></span>`;
  }

  function syncPieceFace(face, piece) {
    if (!face) {
      return;
    }
    const art = pieceAssetConfig(piece);
    const artKey = art
      ? art.kind === 'sprite'
        ? `${art.familyId}:${art.src}:${art.column}:${art.row}`
        : `${art.familyId}:${art.src}`
      : `fallback:${piece.color}:${piece.type}`;
    if (face.dataset.artKey === artKey) {
      return;
    }
    face.outerHTML = pieceFaceMarkup(piece);
  }
  const SOUND_CUE_LIBRARY = {
    walnut: {
      start: [
        { frequency: 293.66, frequencyEnd: 329.63, duration: 0.12, gain: 0.018, type: 'triangle' },
        { frequency: 392, frequencyEnd: 440, duration: 0.18, gain: 0.014, startOffset: 0.08, type: 'triangle' },
      ],
      move: [
        { frequency: 460, frequencyEnd: 390, duration: 0.07, gain: 0.018, type: 'triangle' },
      ],
      capture: [
        { frequency: 255, frequencyEnd: 145, duration: 0.12, gain: 0.022, type: 'sawtooth', q: 1.9 },
        { frequency: 420, frequencyEnd: 280, duration: 0.09, gain: 0.012, startOffset: 0.03, type: 'triangle' },
      ],
      castle: [
        { frequency: 392, frequencyEnd: 440, duration: 0.08, gain: 0.018, type: 'triangle' },
        { frequency: 523.25, frequencyEnd: 587.33, duration: 0.1, gain: 0.014, startOffset: 0.05, type: 'triangle' },
      ],
      check: [
        { frequency: 690, frequencyEnd: 620, duration: 0.08, gain: 0.017, type: 'square' },
        { frequency: 880, frequencyEnd: 780, duration: 0.08, gain: 0.012, startOffset: 0.05, type: 'triangle' },
      ],
      win: [
        { frequency: 392, frequencyEnd: 440, duration: 0.12, gain: 0.02, type: 'triangle' },
        { frequency: 523.25, frequencyEnd: 659.25, duration: 0.17, gain: 0.016, startOffset: 0.08, type: 'triangle' },
        { frequency: 659.25, frequencyEnd: 783.99, duration: 0.22, gain: 0.014, startOffset: 0.18, type: 'triangle' },
      ],
      draw: [
        { frequency: 349.23, frequencyEnd: 329.63, duration: 0.14, gain: 0.015, type: 'triangle' },
        { frequency: 440, frequencyEnd: 392, duration: 0.17, gain: 0.012, startOffset: 0.05, type: 'triangle' },
      ],
    },
    marble: {
      start: [
        { frequency: 659.25, frequencyEnd: 783.99, duration: 0.11, gain: 0.012, type: 'sine' },
        { frequency: 987.77, frequencyEnd: 1174.66, duration: 0.16, gain: 0.01, startOffset: 0.08, type: 'sine' },
      ],
      move: [
        { frequency: 1174.66, frequencyEnd: 932.33, duration: 0.06, gain: 0.012, type: 'sine' },
      ],
      capture: [
        { frequency: 622.25, frequencyEnd: 329.63, duration: 0.11, gain: 0.017, type: 'triangle' },
        { frequency: 1244.51, frequencyEnd: 880, duration: 0.08, gain: 0.009, startOffset: 0.035, type: 'sine' },
      ],
      castle: [
        { frequency: 783.99, frequencyEnd: 987.77, duration: 0.08, gain: 0.012, type: 'sine' },
        { frequency: 1174.66, frequencyEnd: 1318.51, duration: 0.09, gain: 0.009, startOffset: 0.05, type: 'sine' },
      ],
      check: [
        { frequency: 932.33, frequencyEnd: 830.61, duration: 0.08, gain: 0.012, type: 'square' },
        { frequency: 1396.91, frequencyEnd: 1174.66, duration: 0.08, gain: 0.008, startOffset: 0.05, type: 'triangle' },
      ],
      win: [
        { frequency: 783.99, frequencyEnd: 987.77, duration: 0.1, gain: 0.013, type: 'sine' },
        { frequency: 1174.66, frequencyEnd: 1567.98, duration: 0.16, gain: 0.01, startOffset: 0.08, type: 'sine' },
        { frequency: 1567.98, frequencyEnd: 1760, duration: 0.22, gain: 0.008, startOffset: 0.18, type: 'triangle' },
      ],
      draw: [
        { frequency: 587.33, frequencyEnd: 554.37, duration: 0.13, gain: 0.011, type: 'sine' },
        { frequency: 783.99, frequencyEnd: 739.99, duration: 0.16, gain: 0.009, startOffset: 0.04, type: 'sine' },
      ],
    },
    midnight: {
      start: [
        { frequency: 392, frequencyEnd: 440, duration: 0.13, gain: 0.022, type: 'triangle' },
        { frequency: 523.25, frequencyEnd: 659.25, duration: 0.18, gain: 0.018, startOffset: 0.07, type: 'triangle' },
      ],
      move: [
        { frequency: 720, frequencyEnd: 600, duration: 0.06, gain: 0.02, type: 'triangle' },
        { frequency: 980, frequencyEnd: 860, duration: 0.08, gain: 0.012, startOffset: 0.025, type: 'sine' },
      ],
      capture: [
        { frequency: 310, frequencyEnd: 170, duration: 0.12, gain: 0.026, type: 'sawtooth', q: 2 },
        { frequency: 680, frequencyEnd: 460, duration: 0.1, gain: 0.018, startOffset: 0.035, type: 'triangle' },
      ],
      castle: [
        { frequency: 440, frequencyEnd: 494, duration: 0.09, gain: 0.022, type: 'triangle' },
        { frequency: 587, frequencyEnd: 659, duration: 0.11, gain: 0.018, startOffset: 0.05, type: 'triangle' },
      ],
      check: [
        { frequency: 830, frequencyEnd: 760, duration: 0.09, gain: 0.02, type: 'square' },
        { frequency: 1046, frequencyEnd: 988, duration: 0.08, gain: 0.014, startOffset: 0.05, type: 'triangle' },
      ],
      win: [
        { frequency: 392, frequencyEnd: 440, duration: 0.12, gain: 0.024, type: 'triangle' },
        { frequency: 523.25, frequencyEnd: 659.25, duration: 0.18, gain: 0.02, startOffset: 0.08, type: 'triangle' },
        { frequency: 783.99, frequencyEnd: 880, duration: 0.22, gain: 0.018, startOffset: 0.18, type: 'triangle' },
      ],
      draw: [
        { frequency: 392, frequencyEnd: 370, duration: 0.16, gain: 0.018, type: 'triangle' },
        { frequency: 523.25, frequencyEnd: 493.88, duration: 0.18, gain: 0.014, startOffset: 0.04, type: 'triangle' },
      ],
    },
    emerald: {
      start: [
        { frequency: 329.63, frequencyEnd: 349.23, duration: 0.14, gain: 0.015, type: 'triangle' },
        { frequency: 493.88, frequencyEnd: 523.25, duration: 0.18, gain: 0.012, startOffset: 0.09, type: 'sine' },
      ],
      move: [
        { frequency: 520, frequencyEnd: 460, duration: 0.08, gain: 0.014, type: 'triangle' },
      ],
      capture: [
        { frequency: 280, frequencyEnd: 190, duration: 0.12, gain: 0.018, type: 'triangle' },
        { frequency: 392, frequencyEnd: 310, duration: 0.11, gain: 0.012, startOffset: 0.035, type: 'sine' },
      ],
      castle: [
        { frequency: 392, frequencyEnd: 440, duration: 0.09, gain: 0.015, type: 'triangle' },
        { frequency: 493.88, frequencyEnd: 587.33, duration: 0.11, gain: 0.011, startOffset: 0.05, type: 'sine' },
      ],
      check: [
        { frequency: 740, frequencyEnd: 660, duration: 0.09, gain: 0.013, type: 'square' },
        { frequency: 880, frequencyEnd: 784, duration: 0.08, gain: 0.01, startOffset: 0.05, type: 'triangle' },
      ],
      win: [
        { frequency: 349.23, frequencyEnd: 392, duration: 0.12, gain: 0.016, type: 'triangle' },
        { frequency: 440, frequencyEnd: 523.25, duration: 0.17, gain: 0.013, startOffset: 0.08, type: 'sine' },
        { frequency: 659.25, frequencyEnd: 739.99, duration: 0.2, gain: 0.011, startOffset: 0.18, type: 'sine' },
      ],
      draw: [
        { frequency: 329.63, frequencyEnd: 311.13, duration: 0.15, gain: 0.012, type: 'triangle' },
        { frequency: 440, frequencyEnd: 415.3, duration: 0.18, gain: 0.01, startOffset: 0.04, type: 'sine' },
      ],
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
    premove: null,
    promotionRequest: null,
    toastTimer: null,
    botTimer: null,
    flipBoard: false,
    pieceElements: new Map(),
    keyboardFocus: { x: 4, y: 6 },
    clickGuardUntil: 0,
    boardSizeFrame: 0,
    boardLayoutObserver: null,
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
    timeControlPreset: 'untimed',
    setupCollapsed: false,
    sidebarCollapsed: true,
    boardTheme: 'walnut',
    pieceStyle: 'auto',
    soundEnabled: true,
    soundProfile: 'auto',
    audioContext: null,
    focusMode: false,
  };

  const ui = {
    pageShell: document.getElementById('pageShell'),
    setupColumn: document.getElementById('setupColumn'),
    sidebarColumn: document.getElementById('sidebarColumn'),
    nameInput: document.getElementById('nameInput'),
    roomInput: document.getElementById('roomInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    engineLevelSelect: document.getElementById('engineLevelSelect'),
    engineLevelHint: document.getElementById('engineLevelHint'),
    engineLevelMeter: document.getElementById('engineLevelMeter'),
    timeControlSelect: document.getElementById('timeControlSelect'),
    timeControlHint: document.getElementById('timeControlHint'),
    boardThemeSelect: document.getElementById('boardThemeSelect'),
    boardThemeHint: document.getElementById('boardThemeHint'),
    pieceStyleSelect: document.getElementById('pieceStyleSelect'),
    pieceStyleHint: document.getElementById('pieceStyleHint'),
    soundProfileSelect: document.getElementById('soundProfileSelect'),
    soundProfileHint: document.getElementById('soundProfileHint'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    soundHint: document.getElementById('soundHint'),
    inviteInput: document.getElementById('inviteInput'),
    statusText: document.getElementById('statusText'),
    engineStatus: document.getElementById('engineStatus'),
    roomCodeLabel: document.getElementById('roomCodeLabel'),
    turnText: document.getElementById('turnText'),
    phaseText: document.getElementById('phaseText'),
    winnerText: document.getElementById('winnerText'),
    whiteClockCard: document.getElementById('whiteClockCard'),
    whiteClockValue: document.getElementById('whiteClockValue'),
    whiteClockMeta: document.getElementById('whiteClockMeta'),
    blackClockCard: document.getElementById('blackClockCard'),
    blackClockValue: document.getElementById('blackClockValue'),
    blackClockMeta: document.getElementById('blackClockMeta'),
    timeControlBadge: document.getElementById('timeControlBadge'),
    clockStatus: document.getElementById('clockStatus'),
    focusHint: document.getElementById('focusHint'),
    presenceText: document.getElementById('presenceText'),
    networkStatus: document.getElementById('networkStatus'),
    modePill: document.getElementById('modePill'),
    boardStage: document.querySelector('.board-stage'),
    boardColumn: document.querySelector('.board-column'),
    boardPanel: document.querySelector('.board-panel'),
    boardHeader: document.querySelector('.board-header'),
    boardFooter: document.querySelector('.board-footer'),
    resultOverlay: document.getElementById('resultOverlay'),
    resultOverlayTitle: document.getElementById('resultOverlayTitle'),
    resultOverlayKicker: document.getElementById('resultOverlayKicker'),
    resultOverlaySubtitle: document.getElementById('resultOverlaySubtitle'),
    battleStrip: document.querySelector('.battle-strip'),
    clockStrip: document.getElementById('clockStrip'),
    boardGrid: document.getElementById('boardGrid'),
    playerCards: document.getElementById('playerCards'),
    historyList: document.getElementById('historyList'),
    historyStatus: document.getElementById('historyStatus'),
    whiteCaptured: document.getElementById('whiteCaptured'),
    blackCaptured: document.getElementById('blackCaptured'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    hostBtn: document.getElementById('hostBtn'),
    joinBtn: document.getElementById('joinBtn'),
    soloBtn: document.getElementById('soloBtn'),
    openLoungeBtn: document.getElementById('openLoungeBtn'),
    shareLoungeBtn: document.getElementById('shareLoungeBtn'),
    retryEngineBtn: document.getElementById('retryEngineBtn'),
    engineMoveBtn: document.getElementById('engineMoveBtn'),
    focusBtn: document.getElementById('focusBtn'),
    focusExitBtn: document.getElementById('focusExitBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    flipBtn: document.getElementById('flipBtn'),
    promotionModal: document.getElementById('promotionModal'),
    promotionOptions: document.getElementById('promotionOptions'),
    toast: document.getElementById('toast'),
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

  function normalizeTimeControlPreset(value) {
    return TIME_CONTROL_PRESETS[value] ? value : 'untimed';
  }

  function timeControlProfile(presetId = state.timeControlPreset) {
    return TIME_CONTROL_PRESETS[normalizeTimeControlPreset(presetId)] || TIME_CONTROL_PRESETS.untimed;
  }

  function normalizeBoardTheme(value) {
    return BOARD_THEMES[value] ? value : 'walnut';
  }

  function normalizePieceStyle(value) {
    return PIECE_STYLES[value] ? value : 'auto';
  }

  function normalizeSoundProfile(value) {
    return SOUND_PROFILES[value] ? value : 'auto';
  }

  function engineReadyMessage() {
    return `Stockfish 18 ready - ${engineLevelProfile().label}`;
  }

  function boardThemeProfile() {
    return BOARD_THEMES[state.boardTheme] || BOARD_THEMES.walnut;
  }

  function resolvePieceStyle() {
    return state.pieceStyle === 'auto'
      ? boardThemeProfile().pieceStyle || state.boardTheme
      : normalizePieceStyle(state.pieceStyle);
  }

  function resolveSoundProfile() {
    return state.soundProfile === 'auto'
      ? boardThemeProfile().soundProfile || state.boardTheme
      : normalizeSoundProfile(state.soundProfile);
  }

  function normalizeClockState(rawClock) {
    const profile = timeControlProfile(rawClock && rawClock.presetId);
    const remaining = rawClock && rawClock.remainingMs ? rawClock.remainingMs : null;
    const whiteRemaining = remaining && remaining.white !== undefined && remaining.white !== null
      ? Number(remaining.white)
      : profile.baseMs;
    const blackRemaining = remaining && remaining.black !== undefined && remaining.black !== null
      ? Number(remaining.black)
      : profile.baseMs;
    return {
      enabled: Boolean(rawClock && rawClock.enabled && profile.baseMs > 0),
      presetId: profile.id,
      label: profile.label,
      shortLabel: profile.shortLabel,
      summary: profile.summary,
      baseMs: profile.baseMs,
      incrementMs: Number(rawClock && rawClock.incrementMs) || 0,
      remainingMs: {
        white: Math.max(0, Number.isFinite(whiteRemaining) ? whiteRemaining : profile.baseMs),
        black: Math.max(0, Number.isFinite(blackRemaining) ? blackRemaining : profile.baseMs),
      },
      runningColor: rawClock && (rawClock.runningColor === 'white' || rawClock.runningColor === 'black')
        ? rawClock.runningColor
        : null,
      clientReceivedAt: Date.now(),
    };
  }

  function createLocalClockSnapshot(presetId) {
    const profile = timeControlProfile(presetId);
    return normalizeClockState({
      enabled: profile.baseMs > 0,
      presetId: profile.id,
      incrementMs: 0,
      remainingMs: {
        white: profile.baseMs,
        black: profile.baseMs,
      },
      runningColor: profile.baseMs > 0 ? 'white' : null,
    });
  }

  function hydrateClockSnapshot(snapshot) {
    if (!snapshot || !snapshot.clock) {
      return;
    }
    snapshot.clock = normalizeClockState(snapshot.clock);
    if (snapshot.winner || snapshot.drawReason || !snapshot.clock.enabled) {
      snapshot.clock.runningColor = null;
    }
  }

  function syncSnapshotClockToNow(snapshot, now = Date.now()) {
    if (!snapshot || !snapshot.clock) {
      return;
    }
    const clock = snapshot.clock;
    if (!clock.enabled || !clock.runningColor || snapshot.winner || snapshot.drawReason) {
      clock.clientReceivedAt = now;
      if (snapshot.winner || snapshot.drawReason || !clock.enabled) {
        clock.runningColor = null;
      }
      return;
    }
    const elapsed = Math.max(0, now - (clock.clientReceivedAt || now));
    if (elapsed > 0) {
      const color = clock.runningColor;
      clock.remainingMs[color] = Math.max(0, clock.remainingMs[color] - elapsed);
    }
    clock.clientReceivedAt = now;
  }

  function projectClock(snapshot, now = Date.now()) {
    const profile = timeControlProfile(snapshot && snapshot.clock ? snapshot.clock.presetId : state.timeControlPreset);
    const clock = snapshot && snapshot.clock ? snapshot.clock : null;
    const projection = {
      enabled: Boolean(clock && clock.enabled && profile.baseMs > 0),
      presetId: profile.id,
      label: profile.label,
      shortLabel: profile.shortLabel,
      summary: profile.summary,
      whiteMs: clock ? clock.remainingMs.white : profile.baseMs,
      blackMs: clock ? clock.remainingMs.black : profile.baseMs,
      runningColor: clock ? clock.runningColor : null,
    };
    if (
      projection.enabled &&
      projection.runningColor &&
      snapshot &&
      !snapshot.winner &&
      !snapshot.drawReason
    ) {
      const elapsed = Math.max(0, now - (clock.clientReceivedAt || now));
      if (projection.runningColor === 'white') {
        projection.whiteMs = Math.max(0, projection.whiteMs - elapsed);
      } else {
        projection.blackMs = Math.max(0, projection.blackMs - elapsed);
      }
    }
    return projection;
  }

  function setSnapshotClockRunning(snapshot, color, now = Date.now()) {
    if (!snapshot || !snapshot.clock) {
      return;
    }
    syncSnapshotClockToNow(snapshot, now);
    if (!snapshot.clock.enabled || snapshot.winner || snapshot.drawReason) {
      snapshot.clock.runningColor = null;
      snapshot.clock.clientReceivedAt = now;
      return;
    }
    snapshot.clock.runningColor = color;
    snapshot.clock.clientReceivedAt = now;
  }

  function finishSnapshotOnTimeout(snapshot, expiredColor, now = Date.now()) {
    if (!snapshot || !snapshot.clock || !snapshot.clock.enabled) {
      return false;
    }
    syncSnapshotClockToNow(snapshot, now);
    snapshot.clock.remainingMs[expiredColor] = 0;
    snapshot.clock.runningColor = null;
    snapshot.clock.clientReceivedAt = now;
    snapshot.winner = Core.otherColor(expiredColor);
    snapshot.winReason = 'timeout';
    snapshot.drawReason = null;
    snapshot.check = null;
    snapshot.status = `${capitalize(expiredColor)} ran out of time. ${capitalize(snapshot.winner)} wins on time.`;
    return true;
  }

  function maybeHandleSoloTimeout() {
    if (
      state.mode !== 'solo' ||
      !state.snapshot ||
      !state.snapshot.clock ||
      !state.snapshot.clock.enabled ||
      state.snapshot.winner ||
      state.snapshot.drawReason
    ) {
      return false;
    }
    const activeColor = state.snapshot.clock.runningColor;
    if (!activeColor) {
      return false;
    }
    const projected = projectClock(state.snapshot);
    const remaining = activeColor === 'white' ? projected.whiteMs : projected.blackMs;
    if (remaining > 0) {
      return false;
    }
    if (!finishSnapshotOnTimeout(state.snapshot, activeColor)) {
      return false;
    }
    cancelEngineThinking();
    clearSelection();
    setStatusMessage(state.snapshot.status);
    if (state.engineReady) {
      setEngineStatus(engineReadyMessage());
    }
    render();
    return true;
  }

  function formatClock(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    if (safeMs < 10000) {
      const totalTenths = Math.ceil(safeMs / 100);
      const minutes = Math.floor(totalTenths / 600);
      const seconds = Math.floor((totalTenths % 600) / 10);
      const tenths = totalTenths % 10;
      return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
    }
    const totalSeconds = Math.ceil(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function pieceStyleProfile() {
    return PIECE_STYLES[resolvePieceStyle()] || PIECE_STYLES.walnut;
  }

  function soundProfileProfile() {
    return SOUND_PROFILES[resolveSoundProfile()] || SOUND_PROFILES.midnight;
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
    const cues = SOUND_CUE_LIBRARY[resolveSoundProfile()] || SOUND_CUE_LIBRARY.midnight;
    const sequence = Array.isArray(cues[kind]) ? cues[kind] : [];
    for (const tone of sequence) {
      playTone(tone);
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
    if (state.snapshot) {
      hydrateClockSnapshot(state.snapshot);
    }

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
    localStorage.setItem(STORAGE_KEYS.timeControlPreset, state.timeControlPreset);
    localStorage.setItem(STORAGE_KEYS.setupCollapsed, state.setupCollapsed ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, state.sidebarCollapsed ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.boardTheme, state.boardTheme);
    localStorage.setItem(STORAGE_KEYS.pieceStyle, state.pieceStyle);
    localStorage.setItem(STORAGE_KEYS.soundEnabled, state.soundEnabled ? '1' : '0');
    localStorage.setItem(STORAGE_KEYS.soundProfile, state.soundProfile);
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
    ui.statusText.textContent = state.statusMessage || 'Host a room, join by code, or start a solo Stockfish game.';
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

  function openArcadeLounge(autoShare) {
    if (!window.NovaArcadeLoungeBridge) {
      showToast('Arcade Lounge bridge is not available.');
      return;
    }
    if (autoShare && !(state.mode === 'online' && state.roomCode)) {
      showToast('Host or join an online room before sharing it to the lounge.');
      return;
    }
    window.NovaArcadeLoungeBridge.open({
      name: getPlayerName(),
      serverUrl: sanitizeServerUrl(ui.serverUrlInput.value || state.serverUrl || PROD_SERVER_URL),
      gameType: 'chess',
      roomCode: state.mode === 'online' ? state.roomCode : '',
      inviteUrl: state.mode === 'online' ? inviteUrl() : '',
      note: state.mode === 'online' && state.roomCode
        ? `Join my Neon Crown Chess match in room ${state.roomCode}.`
        : '',
      autoShare: Boolean(autoShare),
    });
    showToast(autoShare ? 'Opening Arcade Lounge with your chess room ready to share.' : 'Opening Arcade Lounge in a new tab.');
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
      const profile = timeControlProfile(state.snapshot.clock ? state.snapshot.clock.presetId : state.timeControlPreset);
      ui.presenceText.textContent = `${players.length}/2 players connected${profile.baseMs > 0 ? ` - ${profile.shortLabel}` : ''}`;
    }
  }

  function renderTimeControlInfo() {
    const profile = timeControlProfile(state.snapshot && state.snapshot.clock ? state.snapshot.clock.presetId : state.timeControlPreset);
    if (ui.timeControlSelect) {
      ui.timeControlSelect.value = profile.id;
    }
    if (ui.timeControlHint) {
      ui.timeControlHint.textContent = profile.baseMs > 0
        ? `${profile.summary} Online rooms use the backend clock, and solo mode uses the same countdown locally.`
        : profile.summary;
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
    const pairedPieces = PIECE_STYLES[profile.pieceStyle] || pieceStyleProfile();
    const pairedSounds = SOUND_PROFILES[profile.soundProfile] || soundProfileProfile();
    if (ui.pageShell) {
      ui.pageShell.dataset.boardTheme = state.boardTheme;
    }
    if (ui.boardThemeSelect) {
      ui.boardThemeSelect.value = state.boardTheme;
    }
    if (ui.boardThemeHint) {
      ui.boardThemeHint.textContent = `${profile.summary} Best with ${pairedPieces.label} pieces and ${pairedSounds.label} cues.`;
    }
  }

  function renderPieceStyleInfo() {
    const activeStyle = resolvePieceStyle();
    const activeProfile = pieceStyleProfile();
    if (ui.pageShell) {
      ui.pageShell.dataset.pieceStyle = activeStyle;
    }
    if (ui.pieceStyleSelect) {
      ui.pieceStyleSelect.value = state.pieceStyle;
    }
    if (ui.pieceStyleHint) {
      ui.pieceStyleHint.textContent = state.pieceStyle === 'auto'
        ? `Matching ${boardThemeProfile().label} with ${activeProfile.label}. ${activeProfile.summary}`
        : activeProfile.summary;
    }
  }

  function renderSoundProfileInfo() {
    const activeProfile = soundProfileProfile();
    if (ui.soundProfileSelect) {
      ui.soundProfileSelect.value = state.soundProfile;
    }
    if (ui.soundProfileHint) {
      ui.soundProfileHint.textContent = state.soundProfile === 'auto'
        ? `Matching ${boardThemeProfile().label} with ${activeProfile.label}. ${activeProfile.summary}`
        : activeProfile.summary;
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
    const activeProfile = soundProfileProfile();
    ui.soundToggleBtn.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
    ui.soundToggleBtn.dataset.enabled = state.soundEnabled ? 'true' : 'false';
    ui.soundHint.textContent = state.soundEnabled
      ? `${activeProfile.label} is active for move, capture, check, and result cues.`
      : `${activeProfile.label} is selected, but audio is muted.`;
  }

  function renderFocusModeInfo() {
    if (ui.pageShell) {
      ui.pageShell.dataset.focusMode = state.focusMode ? 'true' : 'false';
    }
    document.body.classList.toggle('focus-mode', state.focusMode);
    if (ui.focusBtn) {
      ui.focusBtn.textContent = state.focusMode ? 'Exit focus' : 'Focus mode';
      ui.focusBtn.setAttribute('aria-pressed', state.focusMode ? 'true' : 'false');
    }
    if (ui.focusExitBtn) {
      ui.focusExitBtn.hidden = !state.focusMode;
    }
    if (ui.focusHint) {
      ui.focusHint.textContent = state.focusMode
        ? 'Focus mode is on. Press Escape or use Exit focus to bring the full layout back.'
        : 'Focus mode hides the rest of the page. Press Escape to leave.';
    }
  }

  function renderRailLayout() {
    if (ui.pageShell) {
      ui.pageShell.dataset.setupCollapsed = state.setupCollapsed ? 'true' : 'false';
      ui.pageShell.dataset.sidebarCollapsed = state.sidebarCollapsed ? 'true' : 'false';
    }
    if (ui.toggleSetupBtn) {
      ui.toggleSetupBtn.textContent = state.setupCollapsed ? 'Show setup' : 'Hide setup';
      ui.toggleSetupBtn.setAttribute('aria-pressed', state.setupCollapsed ? 'true' : 'false');
    }
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = state.sidebarCollapsed ? 'Show moves' : 'Hide moves';
      ui.toggleSidebarBtn.setAttribute('aria-pressed', state.sidebarCollapsed ? 'true' : 'false');
    }
  }

  function responsiveBoardSizeCap() {
    if (window.innerWidth <= 820) {
      return state.focusMode ? 82 : 60;
    }
    return state.focusMode ? 140 : 126;
  }

  function syncResponsiveBoardSize() {
    state.boardSizeFrame = 0;
    if (!ui.boardStage || !ui.boardGrid) {
      return;
    }

    const stageRect = ui.boardStage.getBoundingClientRect();
    if (!stageRect.width) {
      return;
    }

    const stageStyles = window.getComputedStyle(ui.boardStage);
    const paddingX = parseFloat(stageStyles.paddingLeft || '0') + parseFloat(stageStyles.paddingRight || '0');
    const paddingY = parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
    const panelStyles = ui.boardPanel ? window.getComputedStyle(ui.boardPanel) : null;
    const panelPaddingX = panelStyles
      ? parseFloat(panelStyles.paddingLeft || '0') + parseFloat(panelStyles.paddingRight || '0')
      : 0;
    const widthBudget = ui.boardPanel
      ? Math.max(0, ui.boardPanel.clientWidth - panelPaddingX - 4)
      : Math.max(0, ui.boardStage.clientWidth - paddingX);

    let heightBudget = 0;
    if (state.focusMode) {
      heightBudget = Math.max(0, ui.boardStage.clientHeight - paddingY);
    } else if (ui.boardColumn && ui.boardPanel) {
      const columnRect = ui.boardColumn.getBoundingClientRect();
      const columnStyles = window.getComputedStyle(ui.boardColumn);
      const columnGap = parseFloat(columnStyles.rowGap || columnStyles.gap || '0');
      const battleStripHeight = ui.battleStrip ? ui.battleStrip.getBoundingClientRect().height : 0;
      const panelPaddingY = parseFloat(panelStyles.paddingTop || '0') + parseFloat(panelStyles.paddingBottom || '0');
      const boardHeaderHeight = ui.boardHeader ? ui.boardHeader.getBoundingClientRect().height : 0;
      const clockStripHeight = ui.clockStrip ? ui.clockStrip.getBoundingClientRect().height : 0;
      const clockStripMarginTop = ui.clockStrip ? parseFloat(window.getComputedStyle(ui.clockStrip).marginTop || '0') : 0;
      const boardFooterHeight = ui.boardFooter ? ui.boardFooter.getBoundingClientRect().height : 0;
      const boardFooterMarginTop = ui.boardFooter ? parseFloat(window.getComputedStyle(ui.boardFooter).marginTop || '0') : 0;
      const stageMarginTop = parseFloat(stageStyles.marginTop || '0');
      const viewportBottomReserve = window.innerWidth <= 820 ? 14 : 14;
      const boardColumnHeightBudget = Math.max(
        0,
        window.innerHeight - columnRect.top - battleStripHeight - (battleStripHeight ? columnGap : 0) - viewportBottomReserve
      );
      const boardPanelHeightBudget = Math.max(0, boardColumnHeightBudget - panelPaddingY);
      heightBudget = Math.max(
        0,
        boardPanelHeightBudget
          - boardHeaderHeight
          - clockStripHeight
          - clockStripMarginTop
          - boardFooterHeight
          - boardFooterMarginTop
          - stageMarginTop
      );
    } else {
      heightBudget = Math.max(0, window.innerHeight - stageRect.top - paddingY - 22);
    }

    const widthSquareBudget = widthBudget / 8;
    const heightSquareBudget = heightBudget / 8;
    const rawSquareSize = Math.min(widthSquareBudget, heightSquareBudget, responsiveBoardSizeCap());
    if (!Number.isFinite(rawSquareSize) || rawSquareSize <= 0) {
      return;
    }

    const minimumSquare = window.innerWidth <= 820 ? 34 : 42;
    const emergencyMinimum = window.innerWidth <= 820 ? 28 : 32;
    const heightLimited = heightSquareBudget < widthSquareBudget;
    const squareSize = heightLimited
      ? Math.max(emergencyMinimum, Math.floor(rawSquareSize))
      : Math.max(minimumSquare, Math.floor(rawSquareSize));
    ui.boardGrid.style.setProperty('--square-size', `${squareSize}px`);
  }

  function queueResponsiveBoardSizeSync() {
    if (state.boardSizeFrame) {
      window.cancelAnimationFrame(state.boardSizeFrame);
    }
    state.boardSizeFrame = window.requestAnimationFrame(syncResponsiveBoardSize);
  }

  function installResponsiveBoardObserver() {
    if (state.boardLayoutObserver || typeof window.ResizeObserver !== 'function') {
      return;
    }
    const observer = new window.ResizeObserver(() => {
      queueResponsiveBoardSizeSync();
    });
    [
      ui.pageShell,
      ui.setupColumn,
      ui.sidebarColumn,
      ui.boardColumn,
      ui.boardPanel,
      ui.boardHeader,
      ui.clockStrip,
      ui.boardStage,
      ui.boardFooter,
      ui.battleStrip,
    ].filter(Boolean).forEach((element) => observer.observe(element));
    state.boardLayoutObserver = observer;
  }

  function setFocusMode(enabled, options = {}) {
    const next = Boolean(enabled);
    if (state.focusMode === next) {
      if (next && options.focusBoard !== false) {
        window.setTimeout(() => ui.boardGrid.focus(), 10);
      }
      queueResponsiveBoardSizeSync();
      return;
    }
    state.focusMode = next;
    renderFocusModeInfo();
    queueResponsiveBoardSizeSync();
    if (next) {
      if (!options.silent) {
        showToast('Focus mode on. Press Escape to leave.');
      }
      if (options.focusBoard !== false) {
        window.setTimeout(() => ui.boardGrid.focus(), 20);
      }
      return;
    }
    if (!options.silent) {
      showToast('Focus mode off.');
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
      ? captured.white.map((piece) => `<span class="capture-chip ${piece.color}" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
    ui.blackCaptured.innerHTML = captured.black.length
      ? captured.black.map((piece) => `<span class="capture-chip ${piece.color}" title="${capitalize(piece.color)} ${Core.PIECES[piece.type].name}">${Core.getPieceGlyph(piece)}</span>`).join('')
      : '<span class="mini-status">None yet.</span>';
  }

  function renderLegend() {
    if (!ui.legendList) {
      return;
    }
    const items = [
      {
        title: 'Mouse, touch, or keyboard',
        body: 'Click squares, drag pieces with a mouse or phone, or use arrow keys plus Enter to play without the mouse.',
        token: '\u2658',
      },
      {
        title: 'Real chess clocks',
        body: 'Choose untimed, bullet, blitz, or rapid presets. Online matches use a server-authoritative clock so both players see the same flag fall.',
        token: '\u23f1',
      },
      {
        title: 'Real engine support',
        body: 'Solo mode has six Stockfish 18 tiers, from Rookie through Grandmaster, and only falls back to a local move chooser if the engine cannot wake up.',
        token: '\u2699',
      },
      {
        title: 'Online sync',
        body: 'The backend validates multiplayer moves and timed rooms, so both browsers stay locked to the same legal position and clock state.',
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

  function renderClockStrip() {
    const profile = timeControlProfile(state.snapshot && state.snapshot.clock ? state.snapshot.clock.presetId : state.timeControlPreset);
    const projection = projectClock(state.snapshot);
    const timed = Boolean(state.snapshot && state.snapshot.clock && projection.enabled);
    const players = state.snapshot && Array.isArray(state.snapshot.players) ? state.snapshot.players.length : 0;
    const winner = state.snapshot ? state.snapshot.winner : null;
    const timeoutLoss = winner && state.snapshot && state.snapshot.winReason === 'timeout'
      ? Core.otherColor(winner)
      : null;

    ui.timeControlBadge.textContent = profile.shortLabel;
    if (ui.clockStrip) {
      ui.clockStrip.dataset.timed = timed ? 'true' : 'false';
    }

    if (!timed) {
      ui.whiteClockValue.textContent = '--:--';
      ui.blackClockValue.textContent = '--:--';
      ui.whiteClockMeta.textContent = 'Clock off';
      ui.blackClockMeta.textContent = 'Clock off';
      ui.clockStatus.textContent = state.snapshot
        ? 'Untimed game. No countdown clock is running.'
        : 'Pick a timer preset before hosting if you want a real chess clock.';
      ui.whiteClockCard.classList.remove('active-clock', 'low-clock', 'flagged-clock');
      ui.blackClockCard.classList.remove('active-clock', 'low-clock', 'flagged-clock');
      return;
    }

    ui.whiteClockValue.textContent = formatClock(projection.whiteMs);
    ui.blackClockValue.textContent = formatClock(projection.blackMs);
    ui.whiteClockMeta.textContent = winner === 'white'
      ? 'Winner'
      : timeoutLoss === 'white'
        ? 'Flag fell'
        : projection.runningColor === 'white'
          ? 'Running'
          : players < 2
            ? 'Waiting'
            : 'Ready';
    ui.blackClockMeta.textContent = winner === 'black'
      ? 'Winner'
      : timeoutLoss === 'black'
        ? 'Flag fell'
        : projection.runningColor === 'black'
          ? 'Running'
          : players < 2
            ? 'Waiting'
            : 'Ready';

    ui.whiteClockCard.classList.toggle('active-clock', projection.runningColor === 'white' && !winner && !(state.snapshot && state.snapshot.drawReason));
    ui.blackClockCard.classList.toggle('active-clock', projection.runningColor === 'black' && !winner && !(state.snapshot && state.snapshot.drawReason));
    ui.whiteClockCard.classList.toggle('low-clock', projection.whiteMs > 0 && projection.whiteMs <= 10000);
    ui.blackClockCard.classList.toggle('low-clock', projection.blackMs > 0 && projection.blackMs <= 10000);
    ui.whiteClockCard.classList.toggle('flagged-clock', timeoutLoss === 'white');
    ui.blackClockCard.classList.toggle('flagged-clock', timeoutLoss === 'black');

    if (!state.snapshot) {
      ui.clockStatus.textContent = 'Clock starts as soon as the game begins.';
    } else if (timeoutLoss) {
      ui.clockStatus.textContent = `${capitalize(timeoutLoss)} flagged. ${capitalize(winner)} wins on time.`;
    } else if (winner || state.snapshot.drawReason) {
      ui.clockStatus.textContent = 'Clock stopped.';
    } else if (state.mode === 'online' && players < 2) {
      ui.clockStatus.textContent = 'Clock starts when both players join the room.';
    } else if (projection.runningColor) {
      ui.clockStatus.textContent = `${capitalize(projection.runningColor)} clock is running.`;
    } else {
      ui.clockStatus.textContent = 'Clock paused.';
    }
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

  function getLegalMovesForColor(snapshot, x, y, color) {
    if (!snapshot || !color) {
      return [];
    }
    const piece = Core.getPiece(snapshot.board, x, y);
    if (!piece || piece.color !== color) {
      return [];
    }
    if (snapshot.turn === color) {
      return Core.getLegalMoves(snapshot, x, y);
    }
    return Core.getLegalMoves({ ...snapshot, turn: color }, x, y);
  }

  function canInteract() {
    if (!state.snapshot || state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    const color = getControlledColor();
    return Boolean(color && state.snapshot.turn === color);
  }

  function canQueuePremove() {
    if (!state.snapshot || state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    const color = getControlledColor();
    return Boolean(color && (state.mode === 'online' || state.mode === 'solo') && state.snapshot.turn !== color);
  }

  function sameMove(a, b) {
    return Boolean(
      a &&
      b &&
      a.from && b.from &&
      a.to && b.to &&
      a.from.x === b.from.x &&
      a.from.y === b.from.y &&
      a.to.x === b.to.x &&
      a.to.y === b.to.y &&
      (a.promotion || '') === (b.promotion || '')
    );
  }

  function clearPremove(options = {}) {
    if (!state.premove) {
      return;
    }
    state.premove = null;
    if (!options.silent) {
      renderStatus();
      renderBoard();
    }
  }

  function resolveQueuedMove(snapshot = state.snapshot) {
    if (!state.premove || !snapshot) {
      return null;
    }
    const color = getControlledColor();
    if (!color || state.premove.color !== color) {
      return null;
    }
    const legalMoves = getLegalMovesForColor(snapshot, state.premove.from.x, state.premove.from.y, color);
    const matchedMove = legalMoves.find((move) => move.x === state.premove.to.x && move.y === state.premove.to.y);
    if (!matchedMove) {
      return null;
    }
    return {
      from: { ...state.premove.from },
      to: { ...state.premove.to },
      promotion: state.premove.promotion || (matchedMove.promotionRequired ? 'queen' : undefined),
    };
  }

  function queuePremove(move) {
    const premove = {
      from: { ...move.from },
      to: { ...move.to },
      color: getControlledColor(),
      promotion: move.promotion,
    };
    if (sameMove(state.premove, premove)) {
      clearPremove({ silent: true });
      state.selected = null;
      state.legalMoves = [];
      render();
      return true;
    }
    state.premove = premove;
    state.selected = null;
    state.legalMoves = [];
    render();
    return true;
  }

  function maybeExecuteQueuedMove() {
    if (!state.premove || !state.snapshot || state.snapshot.winner || state.snapshot.drawReason) {
      return false;
    }
    const color = getControlledColor();
    if (!color || state.snapshot.turn !== color) {
      return false;
    }
    const move = resolveQueuedMove(state.snapshot);
    if (!move) {
      clearPremove({ silent: true });
      renderStatus();
      renderBoard();
      return false;
    }
    clearPremove({ silent: true });
    submitMove(move);
    return true;
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
    ghost.innerHTML = pieceFaceMarkup(piece);
    ui.pageShell.appendChild(ghost);
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

  function restartPieceClassAnimation(element, className, duration) {
    if (!element) {
      return;
    }
    if (!element._codexAnimTimers) {
      element._codexAnimTimers = new Map();
    }
    const existingTimer = element._codexAnimTimers.get(className);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const timer = window.setTimeout(() => {
      element.classList.remove(className);
      element._codexAnimTimers.delete(className);
    }, duration);
    element._codexAnimTimers.set(className, timer);
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
          element.innerHTML = pieceFaceMarkup(piece);
          pieceLayer.appendChild(element);
          state.pieceElements.set(piece.id, element);
          requestAnimationFrame(() => {
            element.classList.remove('piece-ghost');
            restartPieceClassAnimation(element, 'spawn-animating', 320);
          });
        }

        const isMovedPiece = Boolean(lastMove && lastMove.to.x === x && lastMove.to.y === y);
        const isDragSource = Boolean(state.drag && state.drag.pieceId === piece.id);
        const previousBoardX = Number(element.dataset.boardX);
        const previousBoardY = Number(element.dataset.boardY);
        const movedBetweenSquares = Number.isFinite(previousBoardX) && Number.isFinite(previousBoardY)
          && (previousBoardX !== x || previousBoardY !== y);
        element.className = `board-piece ${piece.color}${piece.id === selectedId ? ' active' : ''}${isMovedPiece ? ' moved' : ''}${isDragSource ? ' drag-source' : ''}`;
        element.dataset.pieceType = piece.type;
        element.dataset.boardX = String(x);
        element.dataset.boardY = String(y);
        element.setAttribute('aria-label', `${piece.color === 'white' ? 'White' : 'Black'} ${piece.type}`);
        element.style.setProperty('--x', `calc(var(--square-size) * ${displayX})`);
        element.style.setProperty('--y', `calc(var(--square-size) * ${displayY})`);
        syncPieceFace(element.querySelector('.piece-face'), piece);
        if (movedBetweenSquares && !isDragSource) {
          restartPieceClassAnimation(element, 'move-animating', 360);
        }
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
      if (lastMove && lastMove.capture) {
        restartPieceClassAnimation(element, 'capture-animating', 220);
      } else {
        element.classList.add('piece-ghost');
      }
      window.setTimeout(() => {
        element.remove();
      }, lastMove && lastMove.capture ? 220 : 150);
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
      ui.winnerText.textContent = state.snapshot.winReason === 'timeout'
        ? `${capitalize(state.snapshot.winner)} wins on time.`
        : `${capitalize(state.snapshot.winner)} wins by checkmate.`;
    } else if (state.snapshot.drawReason) {
      ui.winnerText.textContent = state.snapshot.status;
    } else if (state.mode === 'online' && playerCount < 2) {
      ui.winnerText.textContent = 'Waiting for the second player to join.';
    } else {
      ui.winnerText.textContent = 'Game in progress.';
    }
  }

  function renderResultOverlay() {
    if (!ui.resultOverlay || !ui.resultOverlayTitle || !ui.resultOverlaySubtitle || !ui.resultOverlayKicker) {
      return;
    }
    if (!state.snapshot || !state.snapshot.winner) {
      ui.resultOverlay.classList.add('hidden');
      ui.resultOverlay.dataset.tone = '';
      return;
    }

    const controlledColor = getControlledColor();
    const youWon = Boolean(controlledColor && state.snapshot.winner === controlledColor);
    const youLost = Boolean(controlledColor && state.snapshot.winner !== controlledColor);
    const title = youWon
      ? 'YOU WIN!'
      : youLost
        ? 'YOU LOSE!'
        : `${capitalize(state.snapshot.winner)} WINS`;
    const kicker = state.snapshot.winReason === 'timeout' ? 'Clock breaker' : 'Board decided';
    const subtitle = state.snapshot.winReason === 'timeout'
      ? youWon
        ? 'You won on time.'
        : youLost
          ? 'You lost on time.'
          : `${capitalize(state.snapshot.winner)} won on time.`
      : youWon
        ? 'Checkmate. Clean finish.'
        : youLost
          ? 'Checkmate. Reset and run it back.'
          : `${capitalize(state.snapshot.winner)} finished the game by checkmate.`;

    ui.resultOverlay.dataset.tone = youWon ? 'win' : youLost ? 'lose' : 'neutral';
    ui.resultOverlayKicker.textContent = kicker;
    ui.resultOverlayTitle.textContent = title;
    ui.resultOverlaySubtitle.textContent = subtitle;
    ui.resultOverlay.classList.remove('hidden');
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
    const timeControlLocked = (state.mode === 'online' && hasRoom)
      || (state.mode === 'solo' && Boolean(state.snapshot) && !state.snapshot.winner && !state.snapshot.drawReason);
    ui.hostBtn.disabled = pendingConnection;
    ui.joinBtn.disabled = pendingConnection || !sanitizeRoomCode(ui.roomInput.value);
    ui.retryEngineBtn.disabled = state.mode !== 'solo' || Boolean(state.engineInitPromise);
    ui.engineMoveBtn.disabled = state.mode !== 'solo' || !state.snapshot || Boolean(state.snapshot.winner || state.snapshot.drawReason);
    ui.restartBtn.disabled = !state.snapshot;
    ui.flipBtn.disabled = !state.snapshot;
    ui.copyBtn.disabled = !hasRoom;
    ui.copyCodeBtn.disabled = !hasRoom;
    ui.shareLoungeBtn.disabled = !hasRoom;
    ui.engineLevelSelect.disabled = state.mode === 'online';
    ui.timeControlSelect.disabled = timeControlLocked;
    ui.boardThemeSelect.disabled = false;
    ui.pieceStyleSelect.disabled = false;
    ui.soundProfileSelect.disabled = !audioSupported();
    ui.focusBtn.disabled = false;
    ui.retryEngineBtn.textContent = state.engineInitPromise
      ? 'Loading Stockfish 18...'
      : state.engineReady
        ? 'Reload Stockfish'
        : 'Retry Stockfish';

  }

  function render() {
    renderRailLayout();
    renderPills();
    renderStatus();
    renderTimeControlInfo();
    renderDifficultyInfo();
    renderBoardThemeInfo();
    renderPieceStyleInfo();
    renderSoundProfileInfo();
    renderSoundInfo();
    renderFocusModeInfo();
    updateInviteUi();
    renderSummary();
    renderClockStrip();
    renderPlayers();
    renderHistory();
    renderCaptured();
    renderBoard();
    renderResultOverlay();
    renderControls();
    setEngineStatus(state.engineStatus);
    queueResponsiveBoardSizeSync();
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
    soloState.clock = soloState.clock
      ? normalizeClockState(soloState.clock)
      : createLocalClockSnapshot(state.timeControlPreset);
    if (soloState.winner || soloState.drawReason || !soloState.clock.enabled) {
      soloState.clock.runningColor = null;
    }
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
      if (maybeHandleSoloTimeout()) {
        return;
      }
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
      if (
        !move ||
        state.mode !== 'solo' ||
        !state.snapshot ||
        state.snapshot.winner ||
        state.snapshot.drawReason ||
        snapshotToFen(state.snapshot) !== fenAtStart
      ) {
        return;
      }
      syncSnapshotClockToNow(state.snapshot);
      if (state.snapshot.clock && state.snapshot.clock.enabled && state.snapshot.clock.remainingMs.black <= 0) {
        finishSnapshotOnTimeout(state.snapshot, 'black');
        setStatusMessage(state.snapshot.status);
        render();
        return;
      }
      const sandbox = Core.cloneState(state.snapshot);
      const result = Core.applyMove(sandbox, move);
      if (!result.ok) {
        return;
      }
      setSnapshotClockRunning(sandbox, sandbox.turn);
      setSnapshot(decorateSoloSnapshot(sandbox));
      if (maybeExecuteQueuedMove()) {
        return;
      }
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
    if (maybeHandleSoloTimeout()) {
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

    if (
      !move ||
      !state.snapshot ||
      state.snapshot.winner ||
      state.snapshot.drawReason ||
      snapshotToFen(state.snapshot) !== fenAtStart
    ) {
      return;
    }
    syncSnapshotClockToNow(state.snapshot);
    if (state.snapshot.clock && state.snapshot.clock.enabled && state.snapshot.clock.remainingMs[sideToMove] <= 0) {
      finishSnapshotOnTimeout(state.snapshot, sideToMove);
      setStatusMessage(state.snapshot.status);
      render();
      return;
    }

    const sandbox = Core.cloneState(state.snapshot);
    const result = Core.applyMove(sandbox, move);
    if (!result.ok) {
      showToast(result.error || 'Engine move failed.');
      return;
    }

    setSnapshotClockRunning(sandbox, sandbox.turn);
    setSnapshot(decorateSoloSnapshot(sandbox));
    if (maybeExecuteQueuedMove()) {
      return;
    }
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
    clearPremove({ silent: true });

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
      syncSnapshotClockToNow(state.snapshot);
      if (state.snapshot.clock && state.snapshot.clock.enabled && state.snapshot.clock.remainingMs.white <= 0) {
        finishSnapshotOnTimeout(state.snapshot, 'white');
        setStatusMessage(state.snapshot.status);
        render();
        return;
      }
      const sandbox = Core.cloneState(state.snapshot);
      const result = Core.applyMove(sandbox, move);
      if (!result.ok) {
        showToast(result.error || 'That move is not legal.');
        return;
      }
      setSnapshotClockRunning(sandbox, sandbox.turn);
      setSnapshot(decorateSoloSnapshot(sandbox));
      setStatusMessage(state.snapshot.status);
      clearSelection();
      render();
      if (!maybeHandleSoloTimeout()) {
        queueEngineTurn();
      }
    }
  }

  function selectSquare(x, y) {
    const piece = boardPieceAt(x, y);
    const controlledColor = getControlledColor();
    if (!piece || piece.color !== controlledColor || (!canInteract() && !canQueuePremove())) {
      return false;
    }
    state.selected = { x, y };
    state.legalMoves = getLegalMovesForColor(state.snapshot, x, y, controlledColor);
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
    if (canQueuePremove()) {
      if (destination.promotionRequired) {
        move.promotion = 'queen';
      }
      queuePremove(move);
    } else if (destination.promotionRequired) {
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
    const canQueue = canQueuePremove();

    if (state.selected && attemptMoveTo(x, y)) {
      return;
    }

    if ((interactive || canQueue) && piece && piece.color === controlledColor) {
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
    if (!canInteract() && !canQueuePremove()) {
      return;
    }
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (piece.color !== getControlledColor()) {
      if (state.selected) {
        event.preventDefault();
        ui.boardGrid.focus();
        setKeyboardFocus(x, y);
        handleSquare(x, y);
      }
      return;
    }
    event.preventDefault();
    ui.boardGrid.focus();
    setKeyboardFocus(x, y);
    const wasSelected = Boolean(state.selected && state.selected.x === x && state.selected.y === y);
    selectSquare(x, y);
    createDragGhost(piece, event.clientX, event.clientY);
    state.drag = {
      pointerId: event.pointerId,
      pieceId: piece.id,
      from: { x, y },
      wasSelected,
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
    const droppedElsewhere = Boolean(
      dropSquare &&
      (dropSquare.x !== dragInfo.from.x || dropSquare.y !== dragInfo.from.y)
    );
    cleanupDrag();
    state.clickGuardUntil = dragInfo.moved || droppedElsewhere
      ? performance.now() + 180
      : 0;
    if (dropSquare && (dragInfo.moved || droppedElsewhere)) {
      setKeyboardFocus(dropSquare.x, dropSquare.y);
      if (attemptMoveTo(dropSquare.x, dropSquare.y)) {
        return;
      }
      setKeyboardFocus(dragInfo.from.x, dragInfo.from.y);
      selectSquare(dragInfo.from.x, dragInfo.from.y);
      return;
    }
    setKeyboardFocus(dragInfo.from.x, dragInfo.from.y);
    if (dragInfo.wasSelected) {
      clearSelection();
      return;
    }
    selectSquare(dragInfo.from.x, dragInfo.from.y);
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
        if (state.focusMode) {
          setFocusMode(false);
          return;
        }
        if (state.selected) {
          clearSelection();
          return;
        }
        if (state.premove) {
          clearPremove({ silent: true });
          render();
        }
        return;
      default:
        return;
    }
  }

  function updateSoloEngineLabel() {
    if (state.mode === 'solo' && state.snapshot) {
      syncSnapshotClockToNow(state.snapshot);
      setSnapshot(decorateSoloSnapshot(state.snapshot), { silent: true });
      render();
    }
  }

  function updateFromServerSnapshot(snapshot, message) {
    setSnapshot(snapshot);
    if (snapshot && snapshot.clock && snapshot.clock.presetId) {
      state.timeControlPreset = normalizeTimeControlPreset(snapshot.clock.presetId);
    }
    state.roomCode = snapshot.roomCode;
    ui.roomInput.value = snapshot.roomCode;
    if (snapshot && !snapshot.lastMove && Array.isArray(snapshot.history) && snapshot.history.length === 0) {
      clearPremove({ silent: true });
    }
    if (state.selected) {
      const selectedPiece = boardPieceAt(state.selected.x, state.selected.y);
      if (!selectedPiece || selectedPiece.color !== getControlledColor() || !canInteract()) {
        clearSelection();
      }
    }
    maybeExecuteQueuedMove();
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
    clearPremove({ silent: true });
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
        game: 'chess',
        mode,
        name,
        roomCode,
        timeControlPreset: state.timeControlPreset,
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
    const freshGame = Core.createGameState();
    freshGame.clock = createLocalClockSnapshot(state.timeControlPreset);
    setSnapshot(decorateSoloSnapshot(freshGame), { startCue: true });
    state.selected = null;
    state.legalMoves = [];
    clearPremove({ silent: true });
    setKeyboardFocus(defaultFocusForControlledSide().x, defaultFocusForControlledSide().y);
    const clockProfile = timeControlProfile(state.timeControlPreset);
    setStatusMessage(`Stockfish 18 ${engineLevelProfile().label} match started. You control White.${clockProfile.baseMs > 0 ? ` Clock: ${clockProfile.label}.` : ''} Mouse, touch, and keyboard controls are all enabled.`);
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
        syncSnapshotClockToNow(state.snapshot);
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

    ui.timeControlSelect.addEventListener('change', () => {
      state.timeControlPreset = normalizeTimeControlPreset(ui.timeControlSelect.value);
      persistSettings();
      renderTimeControlInfo();
      renderClockStrip();
      showToast(`${timeControlProfile().label} selected.`);
    });

    ui.boardThemeSelect.addEventListener('change', async () => {
      state.boardTheme = normalizeBoardTheme(ui.boardThemeSelect.value);
      persistSettings();
      render();
      if (state.soundEnabled && state.soundProfile === 'auto' && audioSupported()) {
        await primeAudio();
        playSoundCue('move');
      }
      showToast(`${boardThemeProfile().label} board selected.`);
    });

    ui.pieceStyleSelect.addEventListener('change', () => {
      state.pieceStyle = normalizePieceStyle(ui.pieceStyleSelect.value);
      persistSettings();
      render();
      showToast(`${pieceStyleProfile().label} pieces selected.`);
    });

    ui.soundProfileSelect.addEventListener('change', async () => {
      state.soundProfile = normalizeSoundProfile(ui.soundProfileSelect.value);
      persistSettings();
      render();
      if (state.soundEnabled && audioSupported()) {
        await primeAudio();
        playSoundCue('move');
      }
      showToast(`${soundProfileProfile().label} sound style selected.`);
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

    ui.toggleSetupBtn.addEventListener('click', () => {
      state.setupCollapsed = !state.setupCollapsed;
      persistSettings();
      render();
    });
    ui.toggleSidebarBtn.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persistSettings();
      render();
    });

    ui.focusBtn.addEventListener('click', () => {
      setFocusMode(!state.focusMode);
    });
    ui.focusExitBtn.addEventListener('click', () => {
      setFocusMode(false);
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
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.focusMode && event.target !== ui.boardGrid) {
        event.preventDefault();
        setFocusMode(false);
      }
    });
    window.addEventListener('resize', queueResponsiveBoardSizeSync, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', queueResponsiveBoardSizeSync, { passive: true });
    }

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
    ui.openLoungeBtn.addEventListener('click', () => openArcadeLounge(false));
    ui.shareLoungeBtn.addEventListener('click', () => openArcadeLounge(true));
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
    state.timeControlPreset = normalizeTimeControlPreset(localStorage.getItem(STORAGE_KEYS.timeControlPreset) || 'untimed');
    ui.timeControlSelect.value = state.timeControlPreset;
    const savedSetupCollapsed = localStorage.getItem(STORAGE_KEYS.setupCollapsed);
    const savedSidebarCollapsed = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed);
    state.setupCollapsed = savedSetupCollapsed === null ? true : savedSetupCollapsed === '1';
    state.sidebarCollapsed = savedSidebarCollapsed === null ? true : savedSidebarCollapsed === '1';
    state.boardTheme = normalizeBoardTheme(localStorage.getItem(STORAGE_KEYS.boardTheme) || 'walnut');
    ui.boardThemeSelect.value = state.boardTheme;
    state.pieceStyle = normalizePieceStyle(localStorage.getItem(STORAGE_KEYS.pieceStyle) || 'auto');
    ui.pieceStyleSelect.value = state.pieceStyle;
    state.soundEnabled = localStorage.getItem(STORAGE_KEYS.soundEnabled) !== '0';
    state.soundProfile = normalizeSoundProfile(localStorage.getItem(STORAGE_KEYS.soundProfile) || 'auto');
    ui.soundProfileSelect.value = state.soundProfile;
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
    installResponsiveBoardObserver();
    render();
    window.setInterval(() => {
      if (!state.snapshot) {
        return;
      }
      maybeHandleSoloTimeout();
      renderClockStrip();
    }, 100);
  }

  init();
})();
