const BUILDINGS = {
  house: {
    label: 'House',
    cost: { wood: 10 },
    color: '#f2c078',
    production: { gold: 0.2 },
    population: 2,
    desc: 'Homes generate taxes and boost population when connected by roads.'
  },
  farm: {
    label: 'Farm',
    cost: { wood: 10 },
    color: '#80e36d',
    production: { food: 1 },
    population: 0,
    desc: 'Feeds your town. Adjacent farms make each other more efficient.'
  },
  sawmill: {
    label: 'Sawmill',
    cost: { wood: 20 },
    color: '#8a6f4d',
    production: { wood: 2 },
    population: 0,
    desc: 'Turns forests into timber and fuels expansion.'
  },
  road: {
    label: 'Road',
    cost: { wood: 1 },
    color: '#9da3b4',
    production: {},
    population: 0,
    desc: 'Increases city happiness by connecting neighborhoods.'
  }
};

const START_RESOURCES = { wood: 50, food: 20, gold: 10, population: 0, happiness: 55 };
const RESOURCE_TICK_MS = 1_000;

const QUESTS = [
  { id: 'starter-hamlet', label: 'Build your first 6 houses.', check: (s) => s.counts.house >= 6 },
  { id: 'agrarian-boom', label: 'Reach 8 farms.', check: (s) => s.counts.farm >= 8 },
  { id: 'street-grid', label: 'Lay down 24 roads.', check: (s) => s.counts.road >= 24 },
  { id: 'population-40', label: 'Grow to population 40.', check: (s) => (s.resources.population || 0) >= 40 }
];

const state = {
  ws: null,
  room: 'public',
  yourId: null,
  map: [],
  gridSize: 64,
  resources: { ...START_RESOURCES },
  players: [],
  selected: 'house',
  camX: 120,
  camY: 80,
  zoom: 1,
  tilePx: 24,
  hoverTile: null,
  isPanning: false,
  lastPointer: null,
  mode: 'multiplayer',
  soloTickTimer: null,
  completedQuests: new Set(),
  visualsTime: 0,
  tileStats: { counts: { house: 0, farm: 0, sawmill: 0, road: 0 }, roadsConnected: 0 }
};

const els = {
  overlay: document.getElementById('joinOverlay'),
  name: document.getElementById('nameInput'),
  room: document.getElementById('roomInput'),
  ws: document.getElementById('wsInput'),
  join: document.getElementById('joinBtn'),
  solo: document.getElementById('soloBtn'),
  roomLabel: document.getElementById('roomLabel'),
  selectedLabel: document.getElementById('selectedLabel'),
  selectionHint: document.getElementById('selectionHint'),
  buildButtons: document.getElementById('buildButtons'),
  wood: document.getElementById('woodVal'),
  food: document.getElementById('foodVal'),
  gold: document.getElementById('goldVal'),
  pop: document.getElementById('popVal'),
  happiness: document.getElementById('happinessVal'),
  questList: document.getElementById('questList'),
  playersList: document.getElementById('playersList'),
  tileInfo: document.getElementById('tileInfo'),
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
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return isLocal ? 'ws://localhost:3000' : 'wss://YOUR_SERVER_HOST';
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
  els.pop.textContent = Math.round(state.resources.population || 0);
  els.happiness.textContent = Math.round(state.resources.happiness || 0);
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

function getTile(x, y) {
  return state.map[y]?.[x] || null;
}

function isRoadAt(x, y) {
  return getTile(x, y)?.type === 'road';
}

function buildButtons() {
  Object.entries(BUILDINGS).forEach(([type, data]) => {
    const btn = document.createElement('button');
    btn.textContent = `${data.label} (${Object.entries(data.cost).map(([k, v]) => `${v} ${k}`).join(', ')})`;
    btn.dataset.type = type;
    btn.title = data.desc;
    btn.addEventListener('click', () => {
      state.selected = type;
      updateSelectionUi();
    });
    if (type === state.selected) btn.classList.add('active');
    els.buildButtons.appendChild(btn);
  });
  updateSelectionUi();
}

function updateSelectionUi() {
  els.selectedLabel.textContent = BUILDINGS[state.selected].label;
  els.selectionHint.textContent = BUILDINGS[state.selected].desc;
  [...els.buildButtons.children].forEach((b) => b.classList.toggle('active', b.dataset.type === state.selected));
}

function updateTileInfo() {
  if (!state.hoverTile) {
    els.tileInfo.textContent = 'Hover over a tile to inspect it.';
    return;
  }
  const { tx, ty } = state.hoverTile;
  if (tx < 0 || ty < 0 || tx >= state.gridSize || ty >= state.gridSize) {
    els.tileInfo.textContent = 'Out of bounds.';
    return;
  }

  const tile = getTile(tx, ty);
  if (!tile) {
    els.tileInfo.textContent = `(${tx}, ${ty}) • Empty grassland.`;
    return;
  }
  const b = BUILDINGS[tile.type];
  const owner = tile.ownerId === state.yourId ? 'You' : 'Another player';
  els.tileInfo.textContent = `(${tx}, ${ty}) • ${b?.label || tile.type} • Owner: ${owner}`;
}

function refreshTownStats() {
  const counts = { house: 0, farm: 0, sawmill: 0, road: 0 };
  let roadsConnected = 0;

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = getTile(x, y);
      if (!tile || tile.ownerId !== state.yourId) continue;
      counts[tile.type] = (counts[tile.type] || 0) + 1;
      if (tile.type !== 'road' && (isRoadAt(x + 1, y) || isRoadAt(x - 1, y) || isRoadAt(x, y + 1) || isRoadAt(x, y - 1))) {
        roadsConnected += 1;
      }
    }
  }

  const happiness = Math.max(0, Math.min(100,
    50 + counts.road * 0.7 + roadsConnected * 0.9 + counts.farm * 0.4 - counts.sawmill * 0.35
  ));

  state.tileStats = { counts, roadsConnected };
  state.resources.happiness = happiness;

  updateQuestUi();
  updateResourcesUi();
}

function updateQuestUi() {
  els.questList.innerHTML = '';
  const stats = { counts: state.tileStats.counts, resources: state.resources };
  QUESTS.forEach((quest) => {
    const done = quest.check(stats);
    if (done) state.completedQuests.add(quest.id);

    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    li.textContent = `${done ? '✅' : '⬜'} ${quest.label}`;
    els.questList.appendChild(li);
  });
}

function send(msg) {
  if (state.mode === 'solo') {
    handleSoloMessage(msg);
    return;
  }

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(msg));
}

function closeMultiplayerSocket() {
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
}

function startSoloMode() {
  closeMultiplayerSocket();
  state.mode = 'solo';
  state.room = 'solo';
  state.yourId = 'solo-player';
  state.gridSize = 64;
  state.map = makeEmptyMap(state.gridSize);
  state.resources = { ...START_RESOURCES };
  state.players = [els.name.value.trim() || 'Solo Player'];

  els.roomLabel.textContent = 'solo';
  els.overlay.style.display = 'none';
  updateResourcesUi();
  updatePlayersUi();
  refreshTownStats();
  addChatLine('[System] Solo sandbox enabled. Build, optimize, and chase mayor goals.');

  clearInterval(state.soloTickTimer);
  state.soloTickTimer = setInterval(applySoloResourceTick, RESOURCE_TICK_MS);
}

function makeEmptyMap(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function applySoloResourceTick() {
  const farmBonus = Math.min(1.6, 1 + state.tileStats.counts.farm * 0.02);
  const moodBoost = 1 + (state.resources.happiness - 50) / 200;

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = state.map[y][x];
      if (!tile) continue;
      const rules = BUILDINGS[tile.type];
      if (!rules) continue;
      for (const [res, amount] of Object.entries(rules.production)) {
        let adjusted = amount;
        if (tile.type === 'farm') adjusted *= farmBonus;
        if (res === 'gold') adjusted *= moodBoost;
        state.resources[res] = (state.resources[res] || 0) + adjusted;
      }
    }
  }

  updateResourcesUi();
}

function handleSoloMessage(msg) {
  if (msg.type === 'place_building') {
    const { x, y, buildingType } = msg;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) {
      return;
    }

    const rules = BUILDINGS[buildingType];
    if (!rules) return;

    const tile = state.map[y][x];
    if (tile && tile.type !== 'road') {
      toast('Tile is occupied.');
      return;
    }

    const canAfford = Object.entries(rules.cost).every(([res, amount]) => (state.resources[res] || 0) >= amount);
    if (!canAfford) {
      toast(`Not enough resources for ${buildingType}.`);
      return;
    }

    for (const [res, amount] of Object.entries(rules.cost)) {
      state.resources[res] -= amount;
    }

    state.map[y][x] = {
      type: buildingType,
      ownerId: state.yourId,
      ts: Date.now()
    };

    state.resources.population = calculatePopulationFor(state.yourId);
    refreshTownStats();
  }

  if (msg.type === 'chat_send') {
    addChatLine(`[${new Date().toLocaleTimeString()}] ${state.players[0]}: ${msg.text}`);
  }
}

function calculatePopulationFor(ownerId) {
  let total = 0;
  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = state.map[y][x];
      if (!tile || tile.ownerId !== ownerId) continue;
      const rules = BUILDINGS[tile.type];
      total += rules?.population || 0;
    }
  }
  return total;
}

function connect() {
  clearInterval(state.soloTickTimer);
  state.mode = 'multiplayer';

  const wsUrl = els.ws.value.trim();
  localStorage.setItem('town_ws_url', wsUrl);
  state.ws = new WebSocket(wsUrl);

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
      state.resources = { ...state.resources, ...(msg.resources || {}) };
      els.roomLabel.textContent = state.room;
      els.overlay.style.display = 'none';
      updateResourcesUi();
      updatePlayersUi();
      refreshTownStats();
    }

    if (msg.type === 'tile_update') {
      if (state.map[msg.y] && typeof state.map[msg.y][msg.x] !== 'undefined') {
        state.map[msg.y][msg.x] = msg.tile;
      }
      state.resources.population = calculatePopulationFor(state.yourId);
      refreshTownStats();
    }

    if (msg.type === 'resources_update') {
      state.resources = { ...state.resources, ...msg.resources };
      refreshTownStats();
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
  state.ws.onerror = () => toast('WebSocket error');
}

function screenToTile(screenX, screenY) {
  const rect = els.canvas.getBoundingClientRect();
  const x = (screenX - rect.left - state.camX) / (state.tilePx * state.zoom);
  const y = (screenY - rect.top - state.camY) / (state.tilePx * state.zoom);
  return { tx: Math.floor(x), ty: Math.floor(y) };
}

function drawTileVisual(tile, sx, sy, tileSize) {
  const pad = Math.max(2, tileSize * 0.08);
  const inner = tileSize - pad * 2;
  const wobble = Math.sin((Date.now() * 0.003) + (sx + sy) * 0.03) * 0.6;

  if (tile.type === 'road') {
    ctx.fillStyle = '#a7b4c5';
    ctx.fillRect(sx + tileSize * 0.28, sy + pad, tileSize * 0.44, inner);
    ctx.fillRect(sx + pad, sy + tileSize * 0.28, inner, tileSize * 0.44);
    return;
  }

  if (tile.type === 'house') {
    ctx.fillStyle = '#f4d09a';
    ctx.fillRect(sx + pad, sy + tileSize * 0.38, inner, tileSize * 0.5);
    ctx.fillStyle = '#b4575f';
    ctx.beginPath();
    ctx.moveTo(sx + pad - 1, sy + tileSize * 0.43);
    ctx.lineTo(sx + tileSize / 2, sy + pad + wobble);
    ctx.lineTo(sx + tileSize - pad + 1, sy + tileSize * 0.43);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#335d88';
    ctx.fillRect(sx + tileSize * 0.43, sy + tileSize * 0.62, tileSize * 0.16, tileSize * 0.26);
    return;
  }

  if (tile.type === 'farm') {
    ctx.fillStyle = '#6eb54f';
    ctx.fillRect(sx + pad, sy + pad, inner, inner);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 4; i += 1) {
      const rowY = sy + pad + (inner / 4) * i + wobble * 0.2;
      ctx.beginPath();
      ctx.moveTo(sx + pad, rowY);
      ctx.lineTo(sx + tileSize - pad, rowY);
      ctx.stroke();
    }
    return;
  }

  if (tile.type === 'sawmill') {
    ctx.fillStyle = '#7d6343';
    ctx.fillRect(sx + pad, sy + tileSize * 0.35, inner, tileSize * 0.55);
    ctx.fillStyle = '#594630';
    ctx.fillRect(sx + tileSize * 0.64, sy + tileSize * 0.2, tileSize * 0.17, tileSize * 0.28);
    ctx.fillStyle = '#c8a27c';
    ctx.fillRect(sx + tileSize * 0.2, sy + tileSize * 0.56, tileSize * 0.44, tileSize * 0.14);
  }
}

function draw() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  state.visualsTime += 0.005;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#4da6d8');
  sky.addColorStop(1, '#8fd3ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const tileSize = state.tilePx * state.zoom;
  const mapSizePx = state.gridSize * tileSize;

  const grass = ctx.createLinearGradient(0, state.camY, 0, state.camY + mapSizePx);
  grass.addColorStop(0, '#5faa60');
  grass.addColorStop(1, '#417d43');
  ctx.fillStyle = grass;
  ctx.fillRect(state.camX, state.camY, mapSizePx, mapSizePx);

  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  for (let x = 0; x <= state.gridSize; x += 1) {
    const sx = state.camX + x * tileSize;
    ctx.beginPath();
    ctx.moveTo(sx, state.camY);
    ctx.lineTo(sx, state.camY + mapSizePx);
    ctx.stroke();
  }
  for (let y = 0; y <= state.gridSize; y += 1) {
    const sy = state.camY + y * tileSize;
    ctx.beginPath();
    ctx.moveTo(state.camX, sy);
    ctx.lineTo(state.camX + mapSizePx, sy);
    ctx.stroke();
  }

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = state.map[y]?.[x];
      if (!tile) continue;
      const sx = state.camX + x * tileSize;
      const sy = state.camY + y * tileSize;
      drawTileVisual(tile, sx, sy, tileSize);
    }
  }

  if (state.hoverTile) {
    const { tx, ty } = state.hoverTile;
    if (tx >= 0 && ty >= 0 && tx < state.gridSize && ty < state.gridSize) {
      ctx.fillStyle = 'rgba(105,216,255,0.3)';
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
    updateTileInfo();

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
els.solo.addEventListener('click', () => startSoloMode());
els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  send({ type: 'chat_send', text });
  els.chatInput.value = '';
});

buildButtons();
updateQuestUi();
setupCanvasInput();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(draw);
