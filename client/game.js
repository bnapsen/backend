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
  quarry: {
    label: 'Quarry',
    cost: { wood: 16, food: 6 },
    color: '#8f97a3',
    production: { stone: 1.6 },
    population: 0,
    desc: 'Extracts stone for heavier construction projects.'
  },
  mine: {
    label: 'Iron Mine',
    cost: { wood: 14, stone: 12 },
    color: '#56606f',
    production: { iron: 1.2 },
    population: 0,
    desc: 'Produces iron ore used by advanced structures.'
  },
  warehouse: {
    label: 'Warehouse',
    cost: { wood: 16, stone: 14 },
    color: '#9a865a',
    production: {},
    population: 0,
    desc: 'Improves logistics and boosts nearby industry output.'
  },
  market: {
    label: 'Market',
    cost: { wood: 12, stone: 8, food: 8 },
    color: '#f3bf68',
    production: { gold: 1.1 },
    population: 0,
    desc: 'Converts surplus food into gold and commerce.'
  },
  workshop: {
    label: 'Workshop',
    cost: { wood: 15, stone: 10, iron: 8 },
    color: '#9d73d7',
    production: { gold: 1.7 },
    population: 1,
    desc: 'Uses iron and logistics to create high-value goods.'
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

const START_RESOURCES = { wood: 50, stone: 8, iron: 0, food: 20, gold: 10, population: 0, happiness: 55 };
const RESOURCE_TICK_MS = 1_000;
const SEASON_LENGTH_MS = 45_000;
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

const QUESTS = [
  { id: 'starter-hamlet', label: 'Build your first 6 houses.', check: (s) => s.counts.house >= 6, progress: (s) => `${Math.min(6, s.counts.house || 0)}/6 houses` },
  { id: 'agrarian-boom', label: 'Reach 8 farms.', check: (s) => s.counts.farm >= 8, progress: (s) => `${Math.min(8, s.counts.farm || 0)}/8 farms` },
  { id: 'street-grid', label: 'Lay down 24 roads.', check: (s) => s.counts.road >= 24, progress: (s) => `${Math.min(24, s.counts.road || 0)}/24 roads` },
  { id: 'population-40', label: 'Grow to population 40.', check: (s) => (s.resources.population || 0) >= 40, progress: (s) => `${Math.min(40, Math.round(s.resources.population || 0))}/40 population` },
  { id: 'stone-age', label: 'Stockpile 120 stone for civic projects.', check: (s) => (s.resources.stone || 0) >= 120, progress: (s) => `${Math.min(120, Math.floor(s.resources.stone || 0))}/120 stone` },
  { id: 'iron-industry', label: 'Operate 5 iron mines.', check: (s) => s.counts.mine >= 5, progress: (s) => `${Math.min(5, s.counts.mine || 0)}/5 mines` },
  { id: 'trade-league', label: 'Build 4 markets and 3 warehouses.', check: (s) => s.counts.market >= 4 && s.counts.warehouse >= 3, progress: (s) => `${Math.min(4, s.counts.market || 0)}/4 markets • ${Math.min(3, s.counts.warehouse || 0)}/3 warehouses` },
  { id: 'artisan-district', label: 'Create an artisan district with 6 workshops.', check: (s) => s.counts.workshop >= 6, progress: (s) => `${Math.min(6, s.counts.workshop || 0)}/6 workshops` },
  { id: 'happy-metropolis', label: 'Reach population 90 while happiness is at least 72.', check: (s) => (s.resources.population || 0) >= 90 && (s.resources.happiness || 0) >= 72, progress: (s) => `${Math.min(90, Math.round(s.resources.population || 0))}/90 pop • ${Math.round(s.resources.happiness || 0)}/72 happiness` },
  { id: 'economic-powerhouse', label: 'Maintain 250 gold and 90 food reserves.', check: (s) => (s.resources.gold || 0) >= 250 && (s.resources.food || 0) >= 90, progress: (s) => `${Math.min(250, Math.floor(s.resources.gold || 0))}/250 gold • ${Math.min(90, Math.floor(s.resources.food || 0))}/90 food` }
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
  economyText: 'Stable',
  seasonIndex: 0,
  seasonStartedAt: Date.now(),
  clouds: [
    { x: 120, y: 90, speed: 0.1, size: 1.2 },
    { x: 500, y: 150, speed: 0.16, size: 1.55 },
    { x: 830, y: 70, speed: 0.12, size: 1.1 }
  ],
  tileStats: { counts: { house: 0, farm: 0, sawmill: 0, quarry: 0, mine: 0, warehouse: 0, market: 0, workshop: 0, road: 0 }, roadsConnected: 0, clusteredFarms: 0, industrialSynergy: 0 }
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
  stone: document.getElementById('stoneVal'),
  iron: document.getElementById('ironVal'),
  food: document.getElementById('foodVal'),
  gold: document.getElementById('goldVal'),
  pop: document.getElementById('popVal'),
  happiness: document.getElementById('happinessVal'),
  season: document.getElementById('seasonVal'),
  economy: document.getElementById('economyVal'),
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
  els.stone.textContent = (state.resources.stone || 0).toFixed(1);
  els.iron.textContent = (state.resources.iron || 0).toFixed(1);
  els.food.textContent = state.resources.food.toFixed(1);
  els.gold.textContent = state.resources.gold.toFixed(1);
  els.pop.textContent = Math.round(state.resources.population || 0);
  els.happiness.textContent = Math.round(state.resources.happiness || 0);
  if (els.season) els.season.textContent = SEASONS[state.seasonIndex];
  if (els.economy) els.economy.textContent = state.economyText;
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
  const counts = { house: 0, farm: 0, sawmill: 0, quarry: 0, mine: 0, warehouse: 0, market: 0, workshop: 0, road: 0 };
  let roadsConnected = 0;
  let clusteredFarms = 0;
  let industrialSynergy = 0;

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = getTile(x, y);
      if (!tile || tile.ownerId !== state.yourId) continue;
      counts[tile.type] = (counts[tile.type] || 0) + 1;
      if (tile.type !== 'road' && (isRoadAt(x + 1, y) || isRoadAt(x - 1, y) || isRoadAt(x, y + 1) || isRoadAt(x, y - 1))) {
        roadsConnected += 1;
      }
      if (tile.type === 'farm') {
        const n = [getTile(x + 1, y), getTile(x - 1, y), getTile(x, y + 1), getTile(x, y - 1)];
        clusteredFarms += n.filter((neighbor) => neighbor?.type === 'farm').length;
      }
      if (tile.type === 'market' || tile.type === 'warehouse' || tile.type === 'workshop') {
        const n = [getTile(x + 1, y), getTile(x - 1, y), getTile(x, y + 1), getTile(x, y - 1)];
        industrialSynergy += n.filter((neighbor) => neighbor && ['market', 'warehouse', 'workshop', 'mine', 'quarry'].includes(neighbor.type)).length;
      }
    }
  }

  const foodBuffer = state.resources.food - Math.max(0, state.resources.population * 0.5);
  const happiness = Math.max(0, Math.min(100,
    48
    + counts.road * 0.7
    + roadsConnected * 1.1
    + counts.farm * 0.5
    + clusteredFarms * 0.12
    + industrialSynergy * 0.16
    + counts.market * 0.55
    + Math.max(-12, Math.min(10, foodBuffer * 0.18))
    - counts.sawmill * 0.4
    - counts.mine * 0.35
  ));

  state.tileStats = { counts, roadsConnected, clusteredFarms, industrialSynergy };
  state.resources.happiness = happiness;
  if (happiness > 75) state.economyText = 'Prosperous';
  else if (happiness < 35 || foodBuffer < -10) state.economyText = 'Struggling';
  else state.economyText = 'Stable';

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
    const progressText = done ? 'Completed' : (quest.progress ? quest.progress(stats) : 'In progress');
    li.textContent = `${done ? '✅' : '⬜'} ${quest.label} (${progressText})`;
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
  state.seasonIndex = 0;
  state.seasonStartedAt = Date.now();
  state.economyText = 'Stable';
  state.players = [els.name.value.trim() || 'Solo Player'];

  els.roomLabel.textContent = 'solo';
  els.overlay.style.display = 'none';
  updateResourcesUi();
  updatePlayersUi();
  refreshTownStats();
  addChatLine('[System] Solo sandbox enabled. Build, optimize, and chase mayor goals. Right-click to demolish and reclaim wood.');

  clearInterval(state.soloTickTimer);
  state.soloTickTimer = setInterval(applySoloResourceTick, RESOURCE_TICK_MS);
}

function makeEmptyMap(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function applySoloResourceTick() {
  const elapsed = Date.now() - state.seasonStartedAt;
  if (elapsed >= SEASON_LENGTH_MS) {
    state.seasonIndex = (state.seasonIndex + 1) % SEASONS.length;
    state.seasonStartedAt = Date.now();
    addChatLine(`[System] ${SEASONS[state.seasonIndex]} has arrived. Production modifiers changed.`);
  }

  const season = SEASONS[state.seasonIndex];
  const seasonFarmBoost = season === 'Summer' ? 1.3 : season === 'Winter' ? 0.65 : 1;
  const seasonWoodBoost = season === 'Autumn' ? 1.25 : season === 'Winter' ? 0.9 : 1;
  const seasonStoneBoost = season === 'Winter' ? 1.15 : season === 'Spring' ? 0.9 : 1;
  const seasonIronBoost = season === 'Winter' ? 0.82 : season === 'Autumn' ? 1.12 : 1;
  const moodBoost = Math.max(0.6, 1 + (state.resources.happiness - 50) / 180);
  const farmBonus = Math.min(1.8, 1 + state.tileStats.counts.farm * 0.02 + state.tileStats.clusteredFarms * 0.006);
  const logisticsBoost = Math.min(1.6, 1 + state.tileStats.counts.warehouse * 0.04 + state.tileStats.industrialSynergy * 0.01);

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const tile = state.map[y][x];
      if (!tile) continue;
      const rules = BUILDINGS[tile.type];
      if (!rules) continue;
      for (const [res, amount] of Object.entries(rules.production)) {
        let adjusted = amount;
        if (tile.type === 'farm') adjusted *= farmBonus;
        if (tile.type === 'farm') adjusted *= seasonFarmBoost;
        if (tile.type === 'sawmill') adjusted *= seasonWoodBoost;
        if (tile.type === 'quarry') adjusted *= seasonStoneBoost;
        if (tile.type === 'mine') adjusted *= seasonIronBoost;
        if (tile.type === 'mine' || tile.type === 'quarry' || tile.type === 'workshop') adjusted *= logisticsBoost;
        if (res === 'gold') adjusted *= moodBoost;
        if (res === 'gold' && tile.type === 'house' && (isRoadAt(x + 1, y) || isRoadAt(x - 1, y) || isRoadAt(x, y + 1) || isRoadAt(x, y - 1))) {
          adjusted *= 1.15;
        }
        if (tile.type === 'market') {
          const marketFoodUse = Math.min(state.resources.food, 0.45);
          state.resources.food -= marketFoodUse;
          adjusted += marketFoodUse * 0.55;
        }
        if (tile.type === 'workshop') {
          const ironUse = Math.min(state.resources.iron || 0, 0.3);
          state.resources.iron = (state.resources.iron || 0) - ironUse;
          adjusted += ironUse * 1.4;
        }
        state.resources[res] = (state.resources[res] || 0) + adjusted;
      }
    }
  }

  const foodConsumption = state.resources.population * 0.28;
  state.resources.food -= foodConsumption;
  if (state.resources.food < 0) {
    const hungerPenalty = Math.min(8, Math.abs(state.resources.food) * 0.22);
    state.resources.happiness = Math.max(0, state.resources.happiness - hungerPenalty);
    state.resources.food = 0;
  }

  refreshTownStats();
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
    ctx.fillStyle = '#7d8ea0';
    ctx.fillRect(sx + tileSize * 0.26, sy + pad, tileSize * 0.48, inner);
    ctx.fillRect(sx + pad, sy + tileSize * 0.26, inner, tileSize * 0.48);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(sx + tileSize * 0.28, sy + pad, tileSize * 0.44, inner);
    ctx.fillRect(sx + pad, sy + tileSize * 0.28, inner, tileSize * 0.08);
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
    ctx.fillStyle = '#f9f3dc';
    ctx.fillRect(sx + tileSize * 0.22, sy + tileSize * 0.52, tileSize * 0.14, tileSize * 0.12);
    ctx.fillRect(sx + tileSize * 0.62, sy + tileSize * 0.52, tileSize * 0.14, tileSize * 0.12);
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
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(sx + tileSize * 0.64, sy + tileSize * 0.2);
    ctx.lineTo(sx + tileSize * 0.71, sy + tileSize * 0.11);
    ctx.lineTo(sx + tileSize * 0.78, sy + tileSize * 0.2);
    ctx.stroke();
    return;
  }

  if (tile.type === 'quarry') {
    ctx.fillStyle = '#8791a0';
    ctx.fillRect(sx + pad, sy + tileSize * 0.32, inner, tileSize * 0.56);
    ctx.fillStyle = '#aeb7c3';
    ctx.beginPath();
    ctx.moveTo(sx + tileSize * 0.22, sy + tileSize * 0.42);
    ctx.lineTo(sx + tileSize * 0.45, sy + tileSize * 0.18);
    ctx.lineTo(sx + tileSize * 0.62, sy + tileSize * 0.4);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (tile.type === 'mine') {
    ctx.fillStyle = '#5f6a7a';
    ctx.fillRect(sx + pad, sy + tileSize * 0.36, inner, tileSize * 0.5);
    ctx.fillStyle = '#3a4351';
    ctx.beginPath();
    ctx.moveTo(sx + tileSize * 0.2, sy + tileSize * 0.86);
    ctx.lineTo(sx + tileSize * 0.5, sy + tileSize * 0.45);
    ctx.lineTo(sx + tileSize * 0.8, sy + tileSize * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d59d50';
    ctx.fillRect(sx + tileSize * 0.46, sy + tileSize * 0.54, tileSize * 0.08, tileSize * 0.18);
    return;
  }

  if (tile.type === 'warehouse') {
    ctx.fillStyle = '#8f7b55';
    ctx.fillRect(sx + pad, sy + tileSize * 0.3, inner, tileSize * 0.58);
    ctx.fillStyle = '#6d5c3d';
    ctx.fillRect(sx + tileSize * 0.24, sy + tileSize * 0.52, tileSize * 0.52, tileSize * 0.24);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(sx + tileSize * 0.24, sy + tileSize * 0.52, tileSize * 0.52, tileSize * 0.24);
    return;
  }

  if (tile.type === 'market') {
    ctx.fillStyle = '#f0ba63';
    ctx.fillRect(sx + pad, sy + tileSize * 0.4, inner, tileSize * 0.46);
    ctx.fillStyle = '#d05b65';
    ctx.beginPath();
    ctx.moveTo(sx + tileSize * 0.2, sy + tileSize * 0.4);
    ctx.lineTo(sx + tileSize * 0.5, sy + tileSize * 0.16);
    ctx.lineTo(sx + tileSize * 0.8, sy + tileSize * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff2d8';
    ctx.fillRect(sx + tileSize * 0.38, sy + tileSize * 0.56, tileSize * 0.24, tileSize * 0.14);
    return;
  }

  if (tile.type === 'workshop') {
    ctx.fillStyle = '#8866be';
    ctx.fillRect(sx + pad, sy + tileSize * 0.34, inner, tileSize * 0.52);
    ctx.fillStyle = '#cfbfec';
    ctx.fillRect(sx + tileSize * 0.25, sy + tileSize * 0.52, tileSize * 0.5, tileSize * 0.2);
    ctx.strokeStyle = '#f6f0ff';
    ctx.beginPath();
    ctx.arc(sx + tileSize * 0.5, sy + tileSize * 0.44, tileSize * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCloud(x, y, size) {
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(x, y, 18 * size, 0, Math.PI * 2);
  ctx.arc(x + 20 * size, y - 8 * size, 15 * size, 0, Math.PI * 2);
  ctx.arc(x + 38 * size, y, 18 * size, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  state.visualsTime += 0.005;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  const dayNight = (Math.sin(state.visualsTime * 0.2) + 1) / 2;
  sky.addColorStop(0, `rgb(${40 + dayNight * 50}, ${80 + dayNight * 90}, ${120 + dayNight * 105})`);
  sky.addColorStop(1, `rgb(${70 + dayNight * 90}, ${130 + dayNight * 100}, ${160 + dayNight * 85})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  state.clouds.forEach((cloud) => {
    drawCloud(cloud.x, cloud.y, cloud.size);
    cloud.x += cloud.speed;
    if (cloud.x > w + 60) cloud.x = -80;
  });

  const tileSize = state.tilePx * state.zoom;
  const mapSizePx = state.gridSize * tileSize;

  const grass = ctx.createLinearGradient(0, state.camY, 0, state.camY + mapSizePx);
  grass.addColorStop(0, '#6ab86a');
  grass.addColorStop(1, '#3d7b41');
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
      const sx = state.camX + x * tileSize;
      const sy = state.camY + y * tileSize;
      if (!tile) {
        if ((x * 13 + y * 7) % 19 === 0 && tileSize > 10) {
          ctx.fillStyle = 'rgba(33,95,37,0.48)';
          ctx.beginPath();
          ctx.arc(sx + tileSize * 0.52, sy + tileSize * 0.53, tileSize * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      drawTileVisual(tile, sx, sy, tileSize);
    }
  }

  if (state.hoverTile) {
    const { tx, ty } = state.hoverTile;
    if (tx >= 0 && ty >= 0 && tx < state.gridSize && ty < state.gridSize) {
      const targetTile = getTile(tx, ty);
      const canBuild = !targetTile || targetTile.type === 'road';
      ctx.fillStyle = canBuild ? 'rgba(105,216,255,0.32)' : 'rgba(255,98,98,0.34)';
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
    if (e.button === 2 && state.mode === 'solo') {
      const { tx, ty } = screenToTile(e.clientX, e.clientY);
      const tile = getTile(tx, ty);
      if (tile && tile.ownerId === state.yourId) {
        state.map[ty][tx] = null;
        state.resources.wood += Math.max(0.5, (BUILDINGS[tile.type]?.cost.wood || 0) * 0.4);
        state.resources.population = calculatePopulationFor(state.yourId);
        refreshTownStats();
      }
      state.isPanning = false;
      state.lastPointer = null;
      return;
    }
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

  els.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
