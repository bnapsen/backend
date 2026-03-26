'use strict';

const STOCKFISH_WORKER_URL = new URL('vendor/stockfish/stockfish-18-lite-single.js?v=20260325e', self.location.href).toString();

let engine = null;
let ready = false;
let desiredSkill = 10;
let activeRequestId = null;
let needsNewGame = true;

function clampSkill(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 10;
  }
  return Math.max(0, Math.min(20, Math.round(numeric)));
}

function normalizeLine(raw) {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw.data === 'string') {
    return raw.data;
  }
  return '';
}

function postError(message) {
  self.postMessage({
    type: 'error',
    message: message || 'Unable to load Stockfish 18.',
  });
}

function sendToEngine(command) {
  if (!engine) {
    return;
  }
  engine.postMessage(command);
}

function applyOptions() {
  sendToEngine('setoption name UCI_Chess960 value false');
  sendToEngine('setoption name MultiPV value 1');
  sendToEngine('setoption name Ponder value false');
  sendToEngine(`setoption name Skill Level value ${clampSkill(desiredSkill)}`);
}

function teardownEngine() {
  if (!engine) {
    return;
  }
  try {
    engine.postMessage('stop');
    engine.terminate();
  } catch (error) {
    // Ignore engine shutdown issues inside the worker wrapper.
  }
  engine = null;
  ready = false;
  activeRequestId = null;
}

function handleLine(line) {
  if (!line) {
    return;
  }

  if (line === 'uciok') {
    applyOptions();
    sendToEngine('isready');
    return;
  }

  if (line === 'readyok') {
    ready = true;
    self.postMessage({ type: 'ready' });
    return;
  }

  if (line.startsWith('bestmove ')) {
    const parts = line.split(/\s+/);
    self.postMessage({
      type: 'bestmove',
      requestId: activeRequestId,
      move: parts[1] || '(none)',
      ponder: parts[3] || null,
    });
    activeRequestId = null;
    return;
  }

  if (line.startsWith('info ') && activeRequestId !== null) {
    self.postMessage({
      type: 'info',
      requestId: activeRequestId,
      line,
    });
  }
}

function attachEngine(instance) {
  engine = instance;
  ready = false;
  needsNewGame = true;
  engine.onmessage = (event) => {
    const text = normalizeLine(event.data);
    if (!text) {
      return;
    }
    text.split(/\r?\n/).forEach((line) => handleLine(line.trim()));
  };
  engine.onerror = () => {
    teardownEngine();
    postError('Stockfish 18 worker failed to load.');
  };
}

function ensureEngine() {
  if (engine) {
    return true;
  }

  try {
    attachEngine(new Worker(STOCKFISH_WORKER_URL));
    return true;
  } catch (error) {
    teardownEngine();
    postError(error && error.message ? error.message : 'Could not start Stockfish 18.');
    return false;
  }
}

function initializeEngine() {
  if (!ensureEngine()) {
    return;
  }
  if (ready) {
    applyOptions();
    self.postMessage({ type: 'ready' });
    return;
  }
  sendToEngine('uci');
}

self.onmessage = (event) => {
  const payload = event.data || {};

  if (payload.type === 'init') {
    desiredSkill = clampSkill(payload.skill || desiredSkill);
    initializeEngine();
    return;
  }

  if (payload.type === 'stop') {
    activeRequestId = null;
    sendToEngine('stop');
    return;
  }

  if (payload.type !== 'analyze') {
    return;
  }

  desiredSkill = clampSkill(payload.skill || desiredSkill);
  if (!ensureEngine() || !ready) {
    postError('Stockfish 18 is not ready yet.');
    return;
  }

  activeRequestId = payload.requestId;
  applyOptions();
  sendToEngine('stop');
  if (needsNewGame) {
    sendToEngine('ucinewgame');
    needsNewGame = false;
  }
  sendToEngine(`position fen ${payload.fen}`);
  if (payload.depth) {
    sendToEngine(`go depth ${payload.depth}`);
  } else {
    sendToEngine(`go movetime ${payload.movetime || 700}`);
  }
};
