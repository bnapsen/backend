'use strict';

const CANDIDATE_SOURCES = [
  'https://cdn.jsdelivr.net/npm/stockfish@11.0.0/src/stockfish.js',
];

let engine = null;
let ready = false;
let loadingError = null;
let activeRequestId = null;
let activeRequest = null;

function normalizeLine(raw) {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw.data === 'string') {
    return raw.data;
  }
  return '';
}

function attachEngine(instance) {
  engine = instance;
  engine.onmessage = (raw) => {
    const line = normalizeLine(raw);
    if (!line) {
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
      activeRequest = null;
      return;
    }

    if (line.startsWith('info ')) {
      if (activeRequestId !== null) {
        self.postMessage({
          type: 'info',
          requestId: activeRequestId,
          line,
        });
      }
    }
  };
}

function tryLoadEngine() {
  if (engine || loadingError) {
    return;
  }

  for (const source of CANDIDATE_SOURCES) {
    try {
      importScripts(source);
      if (typeof STOCKFISH === 'function') {
        attachEngine(STOCKFISH());
        return;
      }
    } catch (error) {
      loadingError = error;
    }
  }

  if (!engine) {
    loadingError = loadingError || new Error('Could not load a Stockfish worker script.');
    self.postMessage({
      type: 'error',
      message: loadingError.message || 'Unable to load the engine.',
    });
  }
}

function sendToEngine(command) {
  if (!engine) {
    return;
  }
  engine.postMessage(command);
}

self.onmessage = (event) => {
  const payload = event.data || {};

  if (payload.type === 'init') {
    tryLoadEngine();
    if (!engine) {
      return;
    }
    sendToEngine('uci');
    sendToEngine('isready');
    return;
  }

  if (!engine) {
    self.postMessage({
      type: 'error',
      message: 'Engine is not available.',
    });
    return;
  }

  if (payload.type === 'analyze') {
    activeRequestId = payload.requestId;
    activeRequest = payload;
    sendToEngine('stop');
    sendToEngine('ucinewgame');
    sendToEngine(`setoption name Skill Level value ${payload.skill || 10}`);
    sendToEngine(`position fen ${payload.fen}`);
    if (payload.depth) {
      sendToEngine(`go depth ${payload.depth}`);
    } else {
      sendToEngine(`go movetime ${payload.movetime || 500}`);
    }
    return;
  }

  if (payload.type === 'stop') {
    activeRequestId = null;
    activeRequest = null;
    sendToEngine('stop');
    return;
  }
};
