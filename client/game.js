const BUILDINGS = {
  house: { cost: { wood: 10 }, color: '#f2c078' },
  farm: { cost: { wood: 10 }, color: '#7ed957' },
  sawmill: { cost: { wood: 20 }, color: '#8a6f4d' },
  road: { cost: { wood: 1 }, color: '#9da3b4' }
};

const state = {
  ws: null,
  room: 'public',
  yourId: null,
  map: [],
  gridSize: 64,
  resources: { wood: 0, food: 0, gold: 0, population: 0 },
  players: [],
  selected: 'house',
  camX: 0,
  camY: 0,
  zoom: 1,
  tilePx: 24,
  hoverTile: null,
  isPanning: false,
  lastPointer: null
};

const els = {
  overlay: document.getElementById('joinOverlay'),
  name: document.getElementById('nameInput'),
  room: document.getElementById('roomInput'),
  ws: document.getElementById('wsInput'),
  join: document.getElementById('joinBtn'),
  roomLabel: document.getElementById('roomLabel'),
  selectedLabel: document.getElementById('selectedLabel'),
  buildButtons: document.getElementById('buildButtons'),
  wood: document.getElementById('woodVal'),
  food: document.getElementById('foodVal'),
  gold: document.getElementById('goldVal'),
  pop: document.getElementById('popVal'),
  playersList: document.getElementById('playersList'),
  chatLog: document.getElementById('chatLog'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  toast: document.getElementById('toast'),
  canvas: document.getElementById('gameCanvas')
};

const ctx = els.canvas.getContext('2d');

function getDefaultWsUrl() {
  const fromStorage = localStorage.getItem('town_ws_url');
  if (fromStorage) return fromStorage;

  const qp = new URLSearchParams(location.search);
  const fromQuery = qp.get('ws') || qp.get('server');
  if (fromQuery) return normalizeWsUrl(fromQuery);

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) return 'ws://localhost:3000';

  // If client and backend are on the same host, this works out-of-the-box.
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}`;
}

function normalizeWsUrl(input) {
  const value = (input || '').trim();
  if (!value) return '';

  if (value.startsWith('ws://') || value.startsWith('wss://')) return value;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;

  // Allow bare hosts like "my-server.onrender.com".
  const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${protocol}${value}`;
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.style.display = 'none'), 1800);
}

function updateResourcesUi() {
  els.wood.textContent = state.resources.wood.toFixed(1);
  els.food.textContent = state.resources.food.toFixed(1);
  els.gold.textContent = state.resources.gold.toFixed(1);
  els.pop.textContent = state.resources.population || 0;
}

function updatePlayersUi() {
  els.playersList.innerHTML = '';
  state.players.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    els.playersList.appendChild(li);
  });
}

function addChatLine(text) {
  const p = document.createElement('p');
  p.textContent = text;
  els.chatLog.appendChild(p);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function buildButtons() {
  Object.entries(BUILDINGS).forEach(([type, data]) => {
    const btn = document.createElement('button');
    btn.textContent = `${type} (${Object.entries(data.cost).map(([k, v]) => `${v} ${k}`).join(', ')})`;
    btn.dataset.type = type;
    btn.addEventListener('click', () => {
      state.selected = type;
      els.selectedLabel.textContent = type;
      [...els.buildButtons.children].forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    });
    if (type === state.selected) btn.classList.add('active');
    els.buildButtons.appendChild(btn);
  });
}

function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(msg));
}

function connect() {
  const wsUrl = normalizeWsUrl(els.ws.value);
  if (!wsUrl) return toast('Enter your backend URL first.');
  if (wsUrl.includes('YOUR_SERVER_HOST')) return toast('Replace YOUR_SERVER_HOST with your real backend domain.');

  els.ws.value = wsUrl;
  localStorage.setItem('town_ws_url', wsUrl);

  try {
    state.ws = new WebSocket(wsUrl);
  } catch {
    return toast('Invalid server URL. Try https://your-server.com or wss://your-server.com');
  }

  state.ws.onopen = () => {
    send({ type: 'join_room', name: els.name.value.trim(), room: els.room.value.trim() || 'public' });
  };

  state.ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'welcome') {
      state.yourId = msg.yourId;
      state.room = msg.room;
      state.map = msg.map;
      state.gridSize = msg.gridSize || 64;
      state.players = msg.players || [];
      state.resources = msg.resources || state.resources;
      els.roomLabel.textContent = state.room;
      els.overlay.style.display = 'none';
      updateResourcesUi();
      updatePlayersUi();
    }

    if (msg.type === 'tile_update') {
      if (state.map[msg.y] && typeof state.map[msg.y][msg.x] !== 'undefined') {
        state.map[msg.y][msg.x] = msg.tile;
      }
    }

    if (msg.type === 'resources_update') {
      state.resources = msg.resources;
      updateResourcesUi();
    }

    if (msg.type === 'player_list') {
      state.players = msg.players;
      updatePlayersUi();
    }

    if (msg.type === 'chat_broadcast') {
      addChatLine(`[${new Date(msg.ts).toLocaleTimeString()}] ${msg.name}: ${msg.text}`);
    }

    if (msg.type === 'error') {
      toast(msg.message || 'Server error');
    }
  };

  state.ws.onclose = () => toast('Disconnected from server');
  state.ws.onerror = () => toast('WebSocket connection failed. Check backend URL + HTTPS/WSS.');
}

function screenToTile(screenX, screenY) {
  const rect = els.canvas.getBoundingClientRect();
  const x = (screenX - rect.left - state.camX) / (state.tilePx * state.zoom);
  const y = (screenY - rect.top - state.camY) / (state.tilePx * state.zoom);
  return { tx: Math.floor(x), ty: Math.floor(y) };
}

function draw() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#3f8f5f';
  ctx.fillRect(0, 0, w, h);

  const tileSize = state.tilePx * state.zoom;

  // Grid.
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  for (let x = 0; x <= state.gridSize; x += 1) {
    const sx = state.camX + x * tileSize;
    ctx.beginPath(); ctx.moveTo(sx, state.camY); ctx.lineTo(sx, state.camY + state.gridSize * tileSize); ctx.stroke();
  }
  for (let y = 0; y <= state.gridSize; y += 1) {
    const sy = state.camY + y * tileSize;
    ctx.beginPath(); ctx.moveTo(state.camX, sy); ctx.lineTo(state.camX + state.gridSize * tileSize, sy); ctx.stroke();
  }

  // Buildings.
  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = state.map[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = BUILDINGS[tile.type]?.color || '#fff';
      ctx.fillRect(state.camX + x * tileSize + 2, state.camY + y * tileSize + 2, tileSize - 4, tileSize - 4);
    }
  }

  // Hover preview.
  if (state.hoverTile) {
    const { tx, ty } = state.hoverTile;
    if (tx >= 0 && ty >= 0 && tx < state.gridSize && ty < state.gridSize) {
      ctx.fillStyle = 'rgba(101,209,255,0.35)';
      ctx.fillRect(state.camX + tx * tileSize, state.camY + ty * tileSize, tileSize, tileSize);
    }
  }

  requestAnimationFrame(draw);
}

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  els.canvas.width = Math.floor(rect.width * devicePixelRatio);
  els.canvas.height = Math.floor(rect.height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function setupCanvasInput() {
  els.canvas.addEventListener('pointerdown', (e) => {
    state.lastPointer = { x: e.clientX, y: e.clientY };
    state.isPanning = e.button === 1 || e.shiftKey;
  });

  els.canvas.addEventListener('pointermove', (e) => {
    const tile = screenToTile(e.clientX, e.clientY);
    state.hoverTile = tile;

    if (state.isPanning && state.lastPointer) {
      const dx = e.clientX - state.lastPointer.x;
      const dy = e.clientY - state.lastPointer.y;
      state.camX += dx;
      state.camY += dy;
      state.lastPointer = { x: e.clientX, y: e.clientY };
    }
  });

  els.canvas.addEventListener('pointerup', (e) => {
    if (!state.isPanning) {
      const { tx, ty } = screenToTile(e.clientX, e.clientY);
      send({ type: 'place_building', x: tx, y: ty, buildingType: state.selected });
    }
    state.isPanning = false;
    state.lastPointer = null;
  });

  els.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    state.zoom = Math.max(0.4, Math.min(3, state.zoom + (dir > 0 ? -0.1 : 0.1)));
  }, { passive: false });
}

els.ws.value = getDefaultWsUrl();
els.join.addEventListener('click', () => {
  if (!els.name.value.trim()) return toast('Please enter a name.');
  connect();
});
els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  send({ type: 'chat_send', text });
  els.chatInput.value = '';
});

buildButtons();
setupCanvasInput();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(draw);
