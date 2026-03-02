const fs = require('fs');
const path = require('path');

const GRID_SIZE = 64;
const START_RESOURCES = { wood: 50, food: 20, gold: 10, population: 0 };
const SAVE_INTERVAL_MS = 10_000;
const RESOURCE_TICK_MS = 1_000;

const BUILDINGS = {
  house: { cost: { wood: 10 }, production: { gold: 0.2 }, population: 2 },
  farm: { cost: { wood: 10 }, production: { food: 1 } },
  sawmill: { cost: { wood: 20 }, production: { wood: 2 } },
  road: { cost: { wood: 1 }, production: {} }
};

const DATA_DIR = path.join(__dirname, 'data');
const rooms = new Map();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function makeEmptyMap(size = GRID_SIZE) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function roomFile(roomCode) {
  const safe = roomCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

function loadRoomState(roomCode) {
  ensureDataDir();
  const file = roomFile(roomCode);

  if (!fs.existsSync(file)) {
    return { gridSize: GRID_SIZE, map: makeEmptyMap(GRID_SIZE), resources: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const gridSize = Number(parsed.gridSize) || GRID_SIZE;
    return {
      gridSize,
      map: Array.isArray(parsed.map) ? parsed.map : makeEmptyMap(gridSize),
      resources: parsed.resources && typeof parsed.resources === 'object' ? parsed.resources : {}
    };
  } catch (err) {
    console.error(`Failed to load room ${roomCode}, using in-memory fallback:`, err.message);
    return { gridSize: GRID_SIZE, map: makeEmptyMap(GRID_SIZE), resources: {} };
  }
}

function saveRoom(room) {
  ensureDataDir();
  const file = roomFile(room.code);
  const payload = {
    gridSize: room.gridSize,
    map: room.map,
    resources: room.resources
  };

  try {
    fs.writeFileSync(file, JSON.stringify(payload));
  } catch (err) {
    // Persistence failure should not crash the app.
    console.error(`Failed to save room ${room.code}:`, err.message);
  }
}

function getOrCreateRoom(roomCode) {
  const code = roomCode || 'public';
  if (rooms.has(code)) return rooms.get(code);

  const loaded = loadRoomState(code);
  const room = {
    code,
    gridSize: loaded.gridSize,
    map: loaded.map,
    resources: loaded.resources,
    players: new Map(),
    saveTimer: null,
    tickTimer: null
  };

  room.saveTimer = setInterval(() => saveRoom(room), SAVE_INTERVAL_MS);
  room.tickTimer = setInterval(() => applyResourceTick(room), RESOURCE_TICK_MS);
  rooms.set(code, room);
  return room;
}

function getPlayerResources(room, playerId) {
  if (!room.resources[playerId]) {
    room.resources[playerId] = { ...START_RESOURCES };
  }
  return room.resources[playerId];
}

function canAfford(resources, cost) {
  return Object.entries(cost).every(([key, value]) => (resources[key] || 0) >= value);
}

function spendCost(resources, cost) {
  for (const [key, value] of Object.entries(cost)) {
    resources[key] = (resources[key] || 0) - value;
  }
}

function computePopulation(room, playerId) {
  let total = 0;
  for (let y = 0; y < room.gridSize; y += 1) {
    for (let x = 0; x < room.gridSize; x += 1) {
      const tile = room.map[y][x];
      if (!tile || tile.ownerId !== playerId) continue;
      const b = BUILDINGS[tile.type];
      if (b && b.population) total += b.population;
    }
  }
  return total;
}

function applyResourceTick(room) {
  const increments = new Map();

  for (let y = 0; y < room.gridSize; y += 1) {
    for (let x = 0; x < room.gridSize; x += 1) {
      const tile = room.map[y][x];
      if (!tile) continue;
      const rules = BUILDINGS[tile.type];
      if (!rules || !rules.production) continue;
      if (!increments.has(tile.ownerId)) increments.set(tile.ownerId, { wood: 0, food: 0, gold: 0 });

      const playerInc = increments.get(tile.ownerId);
      for (const [res, amount] of Object.entries(rules.production)) {
        playerInc[res] = (playerInc[res] || 0) + amount;
      }
    }
  }

  for (const [playerId, player] of room.players.entries()) {
    const resources = getPlayerResources(room, playerId);
    const inc = increments.get(playerId) || { wood: 0, food: 0, gold: 0 };
    resources.wood += inc.wood;
    resources.food += inc.food;
    resources.gold += inc.gold;
    resources.population = computePopulation(room, playerId);

    player.send({ type: 'resources_update', resources });
  }
}

function listPlayers(room) {
  return Array.from(room.players.values()).map((p) => p.name);
}

function addPlayer(room, player) {
  room.players.set(player.id, player);
  getPlayerResources(room, player.id);
}

function removePlayer(room, playerId) {
  room.players.delete(playerId);
}

function validatePlacement(room, playerId, x, y, buildingType) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, error: 'Invalid coordinates.' };
  if (x < 0 || y < 0 || x >= room.gridSize || y >= room.gridSize) return { ok: false, error: 'Out of bounds.' };

  const rules = BUILDINGS[buildingType];
  if (!rules) return { ok: false, error: 'Unknown building type.' };

  const tile = room.map[y][x];
  if (tile && tile.type !== 'road') {
    return { ok: false, error: 'Tile is occupied.' };
  }

  const resources = getPlayerResources(room, playerId);
  if (!canAfford(resources, rules.cost)) {
    return { ok: false, error: `Not enough resources for ${buildingType}.` };
  }

  return { ok: true };
}

function placeBuilding(room, playerId, x, y, buildingType) {
  const validation = validatePlacement(room, playerId, x, y, buildingType);
  if (!validation.ok) return validation;

  const resources = getPlayerResources(room, playerId);
  const rules = BUILDINGS[buildingType];
  spendCost(resources, rules.cost);

  const tile = {
    type: buildingType,
    ownerId: playerId,
    ts: Date.now()
  };

  room.map[y][x] = tile;
  resources.population = computePopulation(room, playerId);
  return { ok: true, tile, resources };
}

function broadcast(room, message) {
  for (const player of room.players.values()) {
    player.send(message);
  }
}

function cleanupAllRooms() {
  for (const room of rooms.values()) {
    saveRoom(room);
    clearInterval(room.saveTimer);
    clearInterval(room.tickTimer);
  }
}

module.exports = {
  GRID_SIZE,
  BUILDINGS,
  START_RESOURCES,
  getOrCreateRoom,
  addPlayer,
  removePlayer,
  placeBuilding,
  getPlayerResources,
  listPlayers,
  broadcast,
  saveRoom,
  cleanupAllRooms
};
