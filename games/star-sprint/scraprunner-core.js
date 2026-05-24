(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.ScrapRunnerCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ARENA = { width: 1800, height: 1200 };
  const MAX_PLAYERS = 4;
  const MAX_EVENTS = 36;
  const PLAYER_COLORS = ['#6ee7f9', '#ffd166', '#f0abfc', '#86efac'];
  const RUN_SECONDS = 150;
  const SCRAP_PICKUP_RADIUS = 28;
  const BOOST_SECONDS = 0.58;
  const BOOST_RECHARGE_PER_SECOND = 0.38;

  const ZONES = Object.freeze([
    {
      id: 'rust-yard',
      name: 'Rust Yard',
      shortName: 'Rust',
      difficulty: 1,
      unlockCostCents: 0,
      scrapValueCents: 18,
      killValueCents: 35,
      extractBonusCents: 150,
      maxRewardCents: 3200,
      scrapSpawn: 45,
      enemyCap: 9,
      hazardCount: 5,
      enemySpeed: 92,
      enemyHp: 28,
      enemyDamage: 10,
      enemyReward: 6,
      bg: '#1c251f',
      accent: '#f59e0b',
    },
    {
      id: 'neon-wrecks',
      name: 'Neon Wrecks',
      shortName: 'Neon',
      difficulty: 2,
      unlockCostCents: 3500,
      scrapValueCents: 26,
      killValueCents: 48,
      extractBonusCents: 260,
      maxRewardCents: 6200,
      scrapSpawn: 54,
      enemyCap: 13,
      hazardCount: 7,
      enemySpeed: 118,
      enemyHp: 36,
      enemyDamage: 12,
      enemyReward: 8,
      bg: '#10223a',
      accent: '#22d3ee',
    },
    {
      id: 'drone-dump',
      name: 'Drone Dump',
      shortName: 'Drones',
      difficulty: 3,
      unlockCostCents: 8500,
      scrapValueCents: 35,
      killValueCents: 66,
      extractBonusCents: 420,
      maxRewardCents: 9800,
      scrapSpawn: 62,
      enemyCap: 17,
      hazardCount: 9,
      enemySpeed: 136,
      enemyHp: 48,
      enemyDamage: 15,
      enemyReward: 11,
      bg: '#25163a',
      accent: '#a78bfa',
    },
    {
      id: 'deep-salvage',
      name: 'Deep Salvage',
      shortName: 'Deep',
      difficulty: 4,
      unlockCostCents: 18000,
      scrapValueCents: 48,
      killValueCents: 92,
      extractBonusCents: 720,
      maxRewardCents: 15000,
      scrapSpawn: 72,
      enemyCap: 22,
      hazardCount: 12,
      enemySpeed: 154,
      enemyHp: 66,
      enemyDamage: 19,
      enemyReward: 15,
      bg: '#111827',
      accent: '#fb7185',
    },
  ]);

  const UPGRADE_DEFS = Object.freeze([
    { id: 'engine', name: 'Engine speed', maxLevel: 8, baseCostCents: 1200, costScale: 1.42, stat: 'speed' },
    { id: 'cargo', name: 'Cargo capacity', maxLevel: 8, baseCostCents: 1000, costScale: 1.38, stat: 'cargo' },
    { id: 'health', name: 'Max health', maxLevel: 8, baseCostCents: 1300, costScale: 1.42, stat: 'health' },
    { id: 'weapon', name: 'Weapon damage', maxLevel: 8, baseCostCents: 1500, costScale: 1.45, stat: 'damage' },
    { id: 'magnet', name: 'Magnet range', maxLevel: 8, baseCostCents: 900, costScale: 1.36, stat: 'magnet' },
    { id: 'boost', name: 'Boost cooldown', maxLevel: 8, baseCostCents: 1100, costScale: 1.4, stat: 'boost' },
    { id: 'coin', name: 'Coin multiplier', maxLevel: 8, baseCostCents: 1800, costScale: 1.5, stat: 'coins' },
    { id: 'scrap', name: 'Scrap value', maxLevel: 8, baseCostCents: 1600, costScale: 1.48, stat: 'scrapValue' },
  ]);

  const ACHIEVEMENTS = Object.freeze([
    { id: 'first-extract', name: 'First Haul', description: 'Extract from any zone.', stat: 'extractions', target: 1 },
    { id: 'hundred-scrap', name: 'Magnet Hands', description: 'Extract with 100 scrap in one run.', runStat: 'scrap', target: 100 },
    { id: 'drone-breaker', name: 'Drone Breaker', description: 'Destroy 25 drones total.', stat: 'kills', target: 25 },
    { id: 'deep-runner', name: 'Deep Runner', description: 'Extract from Deep Salvage.', runZone: 'deep-salvage' },
    { id: 'coin-hauler', name: 'SIM Hauler', description: 'Earn 250 SIM from ScrapRunner.', stat: 'earnedCents', target: 25000 },
  ]);

  const ZONE_BY_ID = Object.freeze(Object.fromEntries(ZONES.map((zone) => [zone.id, zone])));
  const UPGRADE_BY_ID = Object.freeze(Object.fromEntries(UPGRADE_DEFS.map((upgrade) => [upgrade.id, upgrade])));

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function distanceSquared(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function normalizeVector(x, y) {
    const length = Math.hypot(x, y);
    if (!length) {
      return { x: 0, y: 0 };
    }
    return { x: x / length, y: y / length };
  }

  function normalizeZoneId(raw) {
    const id = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
    return ZONE_BY_ID[id] ? id : 'rust-yard';
  }

  function defaultInput() {
    return {
      moveX: 0,
      moveY: 0,
      aimX: ARENA.width / 2,
      aimY: ARENA.height / 2,
      fire: false,
      boost: false,
    };
  }

  function cleanUpgradeLevels(source) {
    const levels = {};
    for (const upgrade of UPGRADE_DEFS) {
      levels[upgrade.id] = clamp(Math.floor(Number(source && source[upgrade.id]) || 0), 0, upgrade.maxLevel);
    }
    return levels;
  }

  function upgradeCostCents(upgradeId, currentLevel) {
    const def = UPGRADE_BY_ID[upgradeId];
    if (!def) {
      return 0;
    }
    const level = clamp(Math.floor(Number(currentLevel) || 0), 0, def.maxLevel);
    if (level >= def.maxLevel) {
      return 0;
    }
    return Math.round(def.baseCostCents * Math.pow(def.costScale, level) / 25) * 25;
  }

  function statsFromUpgrades(levels) {
    const u = cleanUpgradeLevels(levels);
    return {
      speed: 250 + u.engine * 18,
      cargo: 90 + u.cargo * 24,
      maxHealth: 100 + u.health * 16,
      damage: 18 + u.weapon * 4,
      magnetRange: 92 + u.magnet * 26,
      boostCooldownFactor: Math.max(0.48, 1 - u.boost * 0.055),
      coinMultiplier: 1 + u.coin * 0.07,
      scrapValueMultiplier: 1 + u.scrap * 0.08,
    };
  }

  function pushEvent(state, type, payload = {}) {
    state.events.push({
      id: ++state.lastEventId,
      type,
      at: Number(state.time.toFixed(2)),
      ...payload,
    });
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
  }

  function createGameState(options = {}) {
    const zoneId = normalizeZoneId(options.zoneId);
    const zone = ZONE_BY_ID[zoneId];
    const state = {
      title: 'ScrapRunner Online',
      arena: { ...ARENA },
      roomCode: '',
      runId: `scrap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      zone: { ...zone },
      status: `Drop into ${zone.name}, fill your cargo, and extract before the timer burns out.`,
      objective: 'Collect scrap, shoot drones, then dock inside the extraction ring.',
      phase: 'waiting',
      gameOver: false,
      time: 0,
      timeLeft: RUN_SECONDS,
      score: 0,
      extractedCount: 0,
      nextEntityId: 1,
      lastEventId: 0,
      events: [],
      players: [],
      scraps: [],
      enemies: [],
      hazards: [],
      bullets: [],
      extraction: {
        x: ARENA.width / 2,
        y: ARENA.height - 130,
        radius: 88,
        pulse: 0,
      },
      nextScrapAt: 0.2,
      nextEnemyAt: 1.4,
    };
    seedHazards(state);
    seedScrap(state, zone.scrapSpawn);
    return state;
  }

  function resetMatch(state) {
    const players = state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      profile: player.profile,
      input: { ...player.input },
    }));
    const fresh = createGameState({ zoneId: state.zone && state.zone.id });
    Object.assign(state, fresh);
    players.forEach((player, index) => {
      const next = createPlayer(index, player.id, player.name, player.color, player.profile);
      next.input = player.input;
      state.players.push(next);
    });
    if (state.players.length) {
      state.phase = 'running';
      state.status = `${state.zone.name} is live. Haul scrap and extract clean.`;
    }
    return state;
  }

  function publicZone(zone) {
    return {
      id: zone.id,
      name: zone.name,
      shortName: zone.shortName,
      difficulty: zone.difficulty,
      unlockCostCents: zone.unlockCostCents,
      scrapValueCents: zone.scrapValueCents,
      killValueCents: zone.killValueCents,
      maxRewardCents: zone.maxRewardCents,
      bg: zone.bg,
      accent: zone.accent,
    };
  }

  function cloneState(state) {
    return {
      title: state.title,
      arena: { ...state.arena },
      roomCode: state.roomCode || '',
      runId: state.runId,
      zone: publicZone(state.zone),
      status: state.status,
      objective: state.objective,
      phase: state.phase,
      gameOver: state.gameOver,
      time: state.time,
      timeLeft: state.timeLeft,
      score: state.score,
      extractedCount: state.extractedCount,
      events: state.events.map((event) => ({ ...event })),
      players: state.players.map(clonePlayer),
      scraps: state.scraps.map((scrap) => ({ ...scrap })),
      enemies: state.enemies.map((enemy) => ({ ...enemy })),
      hazards: state.hazards.map((hazard) => ({ ...hazard })),
      bullets: state.bullets.map((bullet) => ({ ...bullet })),
      extraction: { ...state.extraction },
    };
  }

  function createPlayer(index, id, name, color, profile = {}) {
    const upgrades = cleanUpgradeLevels(profile && profile.upgrades);
    const stats = statsFromUpgrades(upgrades);
    const startX = ARENA.width * (0.42 + index * 0.055);
    return {
      id,
      name,
      color: color || PLAYER_COLORS[index % PLAYER_COLORS.length],
      seat: index,
      x: startX,
      y: ARENA.height - 155,
      r: 22,
      angle: -Math.PI / 2,
      hp: stats.maxHealth,
      maxHp: stats.maxHealth,
      scrap: 0,
      cargo: stats.cargo,
      kills: 0,
      damageDealt: 0,
      score: 0,
      alive: true,
      extracted: false,
      extractedAt: 0,
      rewardCents: 0,
      fireCooldown: 0,
      boostCharge: 1,
      boostTimer: 0,
      invulnerable: 1.1,
      flash: 0,
      stats,
      profile: {
        uid: String(profile && profile.uid || ''),
        upgrades,
      },
      input: defaultInput(),
    };
  }

  function clonePlayer(player) {
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      seat: player.seat,
      x: player.x,
      y: player.y,
      r: player.r,
      angle: player.angle,
      hp: player.hp,
      maxHp: player.maxHp,
      scrap: player.scrap,
      cargo: player.cargo,
      kills: player.kills,
      score: player.score,
      alive: player.alive,
      extracted: player.extracted,
      extractedAt: player.extractedAt,
      rewardCents: player.rewardCents,
      boostCharge: player.boostCharge,
      boostTimer: player.boostTimer,
      invulnerable: player.invulnerable,
      flash: player.flash,
      stats: { ...player.stats },
      input: { ...player.input },
    };
  }

  function addPlayer(state, info) {
    const existing = state.players.find((player) => player.id === info.id);
    if (existing) {
      existing.name = info.name || existing.name;
      return existing;
    }
    if (state.players.length >= MAX_PLAYERS) {
      return null;
    }
    const player = createPlayer(
      state.players.length,
      info.id,
      info.name || 'Runner',
      info.color || PLAYER_COLORS[state.players.length % PLAYER_COLORS.length],
      info.profile || {}
    );
    state.players.push(player);
    state.phase = 'running';
    state.status = state.players.length === 1
      ? `${player.name} opened ${state.zone.name}. Share the room and start salvaging.`
      : `${player.name} joined the salvage crew.`;
    pushEvent(state, 'runner-joined', { playerId: player.id, name: player.name });
    return player;
  }

  function removePlayer(state, id) {
    const index = state.players.findIndex((player) => player.id === id);
    if (index < 0) {
      return;
    }
    const [removed] = state.players.splice(index, 1);
    state.bullets = state.bullets.filter((bullet) => bullet.ownerId !== id);
    state.players.forEach((player, seat) => {
      player.seat = seat;
    });
    pushEvent(state, 'runner-left', { playerId: id, name: removed.name });
    if (!state.players.length) {
      state.phase = 'waiting';
      state.status = 'The salvage room is empty.';
    }
  }

  function setPlayerInput(state, playerId, rawInput) {
    const player = state.players.find((item) => item.id === playerId);
    if (!player) {
      return false;
    }
    const input = rawInput || {};
    player.input.moveX = clamp(Number(input.moveX) || 0, -1, 1);
    player.input.moveY = clamp(Number(input.moveY) || 0, -1, 1);
    player.input.aimX = clamp(Number(input.aimX) || ARENA.width / 2, 0, ARENA.width);
    player.input.aimY = clamp(Number(input.aimY) || ARENA.height / 2, 0, ARENA.height);
    player.input.fire = Boolean(input.fire);
    player.input.boost = Boolean(input.boost);
    return true;
  }

  function randomArenaPoint(padding = 80) {
    return {
      x: rand(padding, ARENA.width - padding),
      y: rand(padding, ARENA.height - padding),
    };
  }

  function seedHazards(state) {
    state.hazards = [];
    for (let index = 0; index < state.zone.hazardCount; index += 1) {
      const point = randomArenaPoint(120);
      if (point.y > ARENA.height - 260 && Math.abs(point.x - ARENA.width / 2) < 240) {
        point.y = rand(120, ARENA.height - 340);
      }
      state.hazards.push({
        id: `haz-${++state.nextEntityId}`,
        x: point.x,
        y: point.y,
        radius: rand(32, 58),
        damagePerSecond: 10 + state.zone.difficulty * 3,
        phase: rand(0, Math.PI * 2),
      });
    }
  }

  function createScrap(state, x, y, value) {
    return {
      id: ++state.nextEntityId,
      x,
      y,
      r: 10 + Math.random() * 4,
      value: value || Math.ceil(rand(5, 13 + state.zone.difficulty * 3)),
      phase: rand(0, Math.PI * 2),
    };
  }

  function seedScrap(state, count) {
    for (let index = 0; index < count; index += 1) {
      const point = randomArenaPoint(70);
      state.scraps.push(createScrap(state, point.x, point.y));
    }
  }

  function spawnEnemy(state) {
    const edge = Math.floor(rand(0, 4));
    const point = edge === 0
      ? { x: rand(0, ARENA.width), y: -40 }
      : edge === 1
        ? { x: ARENA.width + 40, y: rand(0, ARENA.height) }
        : edge === 2
          ? { x: rand(0, ARENA.width), y: ARENA.height + 40 }
          : { x: -40, y: rand(0, ARENA.height) };
    const elite = Math.random() < 0.12 + state.zone.difficulty * 0.025;
    state.enemies.push({
      id: ++state.nextEntityId,
      type: elite ? 'hauler-drone' : 'scrap-drone',
      x: point.x,
      y: point.y,
      r: elite ? 25 : 18,
      hp: state.zone.enemyHp * (elite ? 1.65 : 1),
      maxHp: state.zone.enemyHp * (elite ? 1.65 : 1),
      speed: state.zone.enemySpeed * (elite ? 0.78 : 1),
      damage: state.zone.enemyDamage * (elite ? 1.4 : 1),
      reward: state.zone.enemyReward * (elite ? 2 : 1),
      flash: 0,
      attackCooldown: rand(0.2, 0.8),
    });
  }

  function nearestActivePlayer(state, entity) {
    let best = null;
    let bestDistance = Infinity;
    for (const player of state.players) {
      if (!player.alive || player.extracted) {
        continue;
      }
      const value = distanceSquared(entity.x, entity.y, player.x, player.y);
      if (value < bestDistance) {
        best = player;
        bestDistance = value;
      }
    }
    return best;
  }

  function collectScrap(state, player, scrap) {
    const room = Math.max(0, player.cargo - player.scrap);
    if (room <= 0) {
      return;
    }
    const amount = Math.min(room, scrap.value);
    player.scrap += amount;
    player.score += amount * 8;
    state.score += amount * 8;
    scrap.value -= amount;
    pushEvent(state, 'scrap', {
      playerId: player.id,
      name: player.name,
      amount,
    });
  }

  function damagePlayer(state, player, amount) {
    if (!player.alive || player.extracted || player.invulnerable > 0) {
      return;
    }
    player.hp = Math.max(0, player.hp - amount);
    player.flash = 0.18;
    if (player.hp <= 0) {
      player.alive = false;
      player.scrap = Math.floor(player.scrap * 0.45);
      state.status = `${player.name}'s rig went down and spilled cargo.`;
      pushEvent(state, 'runner-downed', { playerId: player.id, name: player.name });
    }
  }

  function updatePlayers(state, delta) {
    for (const player of state.players) {
      player.flash = Math.max(0, player.flash - delta);
      player.invulnerable = Math.max(0, player.invulnerable - delta);
      if (!player.alive || player.extracted) {
        continue;
      }

      const move = normalizeVector(player.input.moveX, player.input.moveY);
      const wantsBoost = player.input.boost && player.boostCharge >= 0.18;
      if (wantsBoost && player.boostTimer <= 0) {
        player.boostTimer = BOOST_SECONDS;
      }
      const boostActive = player.boostTimer > 0 && player.boostCharge > 0;
      const speed = player.stats.speed * (boostActive ? 1.72 : 1);
      player.x = clamp(player.x + move.x * speed * delta, player.r, ARENA.width - player.r);
      player.y = clamp(player.y + move.y * speed * delta, player.r, ARENA.height - player.r);
      if (move.x || move.y) {
        player.angle = Math.atan2(player.input.aimY - player.y, player.input.aimX - player.x);
      }
      if (boostActive) {
        player.boostTimer -= delta;
        player.boostCharge = Math.max(0, player.boostCharge - delta * 0.8 * player.stats.boostCooldownFactor);
      } else {
        player.boostTimer = Math.max(0, player.boostTimer - delta);
        player.boostCharge = Math.min(1, player.boostCharge + delta * BOOST_RECHARGE_PER_SECOND / player.stats.boostCooldownFactor);
      }

      for (const hazard of state.hazards) {
        if (distanceSquared(player.x, player.y, hazard.x, hazard.y) <= (player.r + hazard.radius) ** 2) {
          damagePlayer(state, player, hazard.damagePerSecond * delta);
        }
      }

      if (player.input.fire && player.fireCooldown <= 0) {
        const angle = Math.atan2(player.input.aimY - player.y, player.input.aimX - player.x);
        player.angle = angle;
        player.fireCooldown = Math.max(0.09, 0.22 - cleanUpgradeLevels(player.profile.upgrades).weapon * 0.01);
        state.bullets.push({
          id: ++state.nextEntityId,
          ownerId: player.id,
          x: player.x + Math.cos(angle) * (player.r + 6),
          y: player.y + Math.sin(angle) * (player.r + 6),
          vx: Math.cos(angle) * 720,
          vy: Math.sin(angle) * 720,
          r: 5,
          ttl: 0.9,
          damage: player.stats.damage,
          color: player.color,
        });
      }
      player.fireCooldown = Math.max(0, player.fireCooldown - delta);
    }
  }

  function updateScrap(state, delta) {
    for (const scrap of state.scraps) {
      scrap.phase += delta * 4;
      let magnetTarget = null;
      let bestDistance = Infinity;
      for (const player of state.players) {
        if (!player.alive || player.extracted || player.scrap >= player.cargo) {
          continue;
        }
        const value = distanceSquared(scrap.x, scrap.y, player.x, player.y);
        if (value < bestDistance && value <= player.stats.magnetRange ** 2) {
          magnetTarget = player;
          bestDistance = value;
        }
      }
      if (magnetTarget) {
        const direction = normalizeVector(magnetTarget.x - scrap.x, magnetTarget.y - scrap.y);
        scrap.x += direction.x * (210 + magnetTarget.stats.magnetRange * 1.6) * delta;
        scrap.y += direction.y * (210 + magnetTarget.stats.magnetRange * 1.6) * delta;
      }
      for (const player of state.players) {
        if (!player.alive || player.extracted) {
          continue;
        }
        if (distanceSquared(scrap.x, scrap.y, player.x, player.y) <= (player.r + SCRAP_PICKUP_RADIUS) ** 2) {
          collectScrap(state, player, scrap);
          break;
        }
      }
    }
    state.scraps = state.scraps.filter((scrap) => scrap.value > 0);
  }

  function updateBullets(state, delta) {
    for (const bullet of state.bullets) {
      bullet.x += bullet.vx * delta;
      bullet.y += bullet.vy * delta;
      bullet.ttl -= delta;
      if (bullet.x < -60 || bullet.x > ARENA.width + 60 || bullet.y < -60 || bullet.y > ARENA.height + 60) {
        bullet.ttl = 0;
        continue;
      }
      for (const enemy of state.enemies) {
        if (enemy.hp <= 0) {
          continue;
        }
        if (distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y) <= (bullet.r + enemy.r) ** 2) {
          const owner = state.players.find((player) => player.id === bullet.ownerId);
          enemy.hp -= bullet.damage;
          enemy.flash = 0.16;
          bullet.ttl = 0;
          if (owner) {
            owner.damageDealt += bullet.damage;
          }
          if (enemy.hp <= 0) {
            killEnemy(state, enemy, owner);
          }
          break;
        }
      }
    }
    state.bullets = state.bullets.filter((bullet) => bullet.ttl > 0);
    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  }

  function killEnemy(state, enemy, owner) {
    const chunks = Math.max(2, Math.min(8, Math.round(enemy.reward / 2)));
    for (let index = 0; index < chunks; index += 1) {
      state.scraps.push(createScrap(
        state,
        clamp(enemy.x + rand(-28, 28), 24, ARENA.width - 24),
        clamp(enemy.y + rand(-28, 28), 24, ARENA.height - 24),
        Math.ceil(enemy.reward / chunks)
      ));
    }
    if (owner) {
      owner.kills += 1;
      owner.score += enemy.type === 'hauler-drone' ? 320 : 160;
    }
    state.score += enemy.type === 'hauler-drone' ? 320 : 160;
    pushEvent(state, 'drone-down', {
      playerId: owner && owner.id || '',
      name: owner && owner.name || 'Crew',
      enemyType: enemy.type,
    });
  }

  function updateEnemies(state, delta) {
    for (const enemy of state.enemies) {
      enemy.flash = Math.max(0, enemy.flash - delta);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      const target = nearestActivePlayer(state, enemy);
      if (!target) {
        continue;
      }
      const direction = normalizeVector(target.x - enemy.x, target.y - enemy.y);
      enemy.x += direction.x * enemy.speed * delta;
      enemy.y += direction.y * enemy.speed * delta;
      if (distanceSquared(enemy.x, enemy.y, target.x, target.y) <= (enemy.r + target.r + 2) ** 2) {
        if (enemy.attackCooldown <= 0) {
          damagePlayer(state, target, enemy.damage);
          enemy.attackCooldown = 0.72;
        }
      }
    }
  }

  function updateSpawns(state, delta) {
    state.nextScrapAt -= delta;
    if (state.nextScrapAt <= 0 && state.scraps.length < state.zone.scrapSpawn + 25) {
      const point = randomArenaPoint(60);
      state.scraps.push(createScrap(state, point.x, point.y));
      state.nextScrapAt = Math.max(0.12, 0.72 - state.zone.difficulty * 0.08);
    }

    state.nextEnemyAt -= delta;
    if (state.nextEnemyAt <= 0 && state.enemies.length < state.zone.enemyCap) {
      spawnEnemy(state);
      const pressure = 1 + (RUN_SECONDS - state.timeLeft) / RUN_SECONDS;
      state.nextEnemyAt = Math.max(0.22, (1.4 - state.zone.difficulty * 0.16) / pressure);
    }
  }

  function activePlayers(state) {
    return state.players.filter((player) => !player.extracted && player.alive);
  }

  function finishIfDone(state) {
    if (!state.players.length || state.gameOver) {
      return;
    }
    const allResolved = state.players.every((player) => player.extracted || !player.alive);
    if (allResolved) {
      state.gameOver = true;
      state.phase = 'complete';
      state.status = state.players.some((player) => player.extracted)
        ? 'Run complete. Extracted cargo has been sent to the SIM wallet rail.'
        : 'Run failed. No rig made it to extraction.';
      pushEvent(state, 'run-complete', { extractedCount: state.extractedCount });
    }
  }

  function step(state, delta) {
    if (!state || state.phase !== 'running' || state.gameOver) {
      return false;
    }
    const dt = clamp(Number(delta) || 0, 0.001, 0.12);
    state.time += dt;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    state.extraction.pulse += dt * 4;

    updatePlayers(state, dt);
    updateScrap(state, dt);
    updateBullets(state, dt);
    updateEnemies(state, dt);
    updateSpawns(state, dt);

    if (state.timeLeft <= 0) {
      state.gameOver = true;
      state.phase = 'complete';
      state.status = 'Timer expired. Extract earlier next run to bank the haul.';
      pushEvent(state, 'timer-expired');
    }
    finishIfDone(state);
    return true;
  }

  function calculateRunRewardCents(state, player) {
    const zone = state.zone;
    const scrapValue = zone.scrapValueCents * player.stats.scrapValueMultiplier;
    const raw = (
      player.scrap * scrapValue
      + player.kills * zone.killValueCents
      + zone.extractBonusCents
      + Math.floor(state.timeLeft) * Math.max(2, zone.difficulty * 4)
    ) * player.stats.coinMultiplier;
    return Math.max(0, Math.min(zone.maxRewardCents, Math.round(raw)));
  }

  function tryExtract(state, playerId) {
    if (!state || state.gameOver) {
      return { ok: false, error: 'That run is already over.' };
    }
    const player = state.players.find((item) => item.id === playerId);
    if (!player) {
      return { ok: false, error: 'Runner not found.' };
    }
    if (!player.alive) {
      return { ok: false, error: 'Downed rigs cannot extract.' };
    }
    if (player.extracted) {
      return { ok: false, error: 'This runner already extracted.' };
    }
    const nearExtraction = distanceSquared(player.x, player.y, state.extraction.x, state.extraction.y)
      <= (state.extraction.radius + player.r) ** 2;
    if (!nearExtraction) {
      return { ok: false, error: 'Dock inside the extraction ring first.' };
    }

    const rewardCents = calculateRunRewardCents(state, player);
    player.extracted = true;
    player.alive = false;
    player.extractedAt = Number(state.time.toFixed(2));
    player.rewardCents = rewardCents;
    state.extractedCount += 1;
    state.status = `${player.name} extracted ${player.scrap} scrap for ${(rewardCents / 100).toFixed(2)} SIM.`;
    pushEvent(state, 'extract', {
      playerId: player.id,
      name: player.name,
      scrap: player.scrap,
      kills: player.kills,
      rewardCents,
    });
    finishIfDone(state);

    return {
      ok: true,
      run: {
        id: `${state.runId}-${player.id.slice(0, 8)}`,
        runId: state.runId,
        playerId: player.id,
        zoneId: state.zone.id,
        zoneName: state.zone.name,
        scrap: Math.round(player.scrap),
        kills: Math.round(player.kills),
        score: Math.round(player.score),
        durationSeconds: Number(player.extractedAt || state.time),
        timeLeftSeconds: Math.round(state.timeLeft),
        rewardCents,
        extracted: true,
        createdAt: new Date().toISOString(),
      },
    };
  }

  function dailyMissionTemplates(dayKey) {
    const seed = Array.from(String(dayKey || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const scrapTarget = 80 + (seed % 5) * 20;
    const killTarget = 8 + (seed % 4) * 3;
    return [
      {
        id: `${dayKey}:scrap`,
        kind: 'scrap',
        label: `Collect ${scrapTarget} scrap`,
        target: scrapTarget,
        rewardCents: 450 + (seed % 3) * 100,
      },
      {
        id: `${dayKey}:kills`,
        kind: 'kills',
        label: `Destroy ${killTarget} drones`,
        target: killTarget,
        rewardCents: 400 + (seed % 4) * 75,
      },
      {
        id: `${dayKey}:extract`,
        kind: 'extractions',
        label: 'Extract one live run',
        target: 1,
        rewardCents: 550,
      },
    ];
  }

  return {
    ARENA,
    MAX_PLAYERS,
    RUN_SECONDS,
    ZONES,
    ZONE_BY_ID,
    UPGRADE_DEFS,
    UPGRADE_BY_ID,
    ACHIEVEMENTS,
    normalizeZoneId,
    cleanUpgradeLevels,
    upgradeCostCents,
    statsFromUpgrades,
    dailyMissionTemplates,
    createGameState,
    cloneState,
    resetMatch,
    addPlayer,
    removePlayer,
    setPlayerInput,
    step,
    tryExtract,
    calculateRunRewardCents,
  };
});
