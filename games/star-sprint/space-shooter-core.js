(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.StarlineDefenseCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ARENA = { width: 1600, height: 900 };
  const PLAYER_SPEED = 360;
  const PLAYER_BOOST_SPEED = 520;
  const MAX_PLAYERS = 2;
  const BOSS_WAVE_INTERVAL = 4;
  const MAX_EVENTS = 24;
  const PLAYER_COLORS = ['#67e8f9', '#ffd166'];
  const ENEMY_COLORS = {
    drone: '#ff7a90',
    striker: '#ffad5c',
    turret: '#d7a2ff',
    juggernaut: '#91a6ff',
    boss: '#ff5cd2',
  };
  const SCORE_VALUES = {
    drone: 80,
    striker: 120,
    turret: 150,
    juggernaut: 240,
    boss: 1800,
  };
  const XP_VALUES = {
    drone: 10,
    striker: 14,
    turret: 16,
    juggernaut: 26,
    boss: 120,
  };

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

  function nextBossWaveNumber(wave) {
    return Math.ceil(wave / BOSS_WAVE_INTERVAL) * BOSS_WAVE_INTERVAL;
  }

  function cloneProjectile(projectile) {
    return { ...projectile };
  }

  function clonePickup(pickup) {
    return { ...pickup };
  }

  function cloneEvent(event) {
    return { ...event };
  }

  function pushEvent(state, type, payload) {
    state.events.push({
      id: ++state.lastEventId,
      type,
      time: Number(state.time.toFixed(3)),
      ...payload,
    });
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
  }

  function createPlayer(index, id, name, color) {
    const anchorX = index === 0 ? ARENA.width * 0.38 : ARENA.width * 0.62;
    return {
      id,
      name,
      color,
      seat: index,
      x: anchorX,
      y: ARENA.height - 120,
      r: 22,
      angle: -Math.PI / 2,
      hp: 10,
      maxHp: 10,
      shield: 3,
      score: 0,
      combo: 0,
      xp: 0,
      level: 1,
      nextLevelXp: 60,
      damageBonus: 0,
      fireRateBonus: 0,
      weaponTier: 1,
      alive: true,
      respawnTimer: 0,
      fireCooldown: 0,
      boostMeter: 1,
      overdriveTimer: 0,
      invulnerable: 1.2,
      input: defaultInput(),
      flash: 0,
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
      shield: player.shield,
      score: player.score,
      combo: player.combo,
      xp: player.xp,
      level: player.level,
      nextLevelXp: player.nextLevelXp,
      damageBonus: player.damageBonus,
      fireRateBonus: player.fireRateBonus,
      weaponTier: player.weaponTier,
      alive: player.alive,
      respawnTimer: player.respawnTimer,
      fireCooldown: player.fireCooldown,
      boostMeter: player.boostMeter,
      overdriveTimer: player.overdriveTimer,
      invulnerable: player.invulnerable,
      flash: player.flash,
      input: { ...player.input },
    };
  }

  function createGameState() {
    return {
      title: 'Starline Defense Co-Op',
      arena: { ...ARENA },
      roomCode: '',
      status: 'Host a squad room, invite a wingmate, or launch solo.',
      objective: `Build the squad and survive to wave ${BOSS_WAVE_INTERVAL}.`,
      gameOver: false,
      time: 0,
      wave: 1,
      score: 0,
      squadLevel: 1,
      nextEntityId: 1,
      lastEventId: 0,
      events: [],
      nextSpawnAt: 1.1,
      nextWaveAt: 18,
      nextBossWave: BOSS_WAVE_INTERVAL,
      bossWaveEvery: BOSS_WAVE_INTERVAL,
      bossActive: false,
      players: [],
      playerBullets: [],
      enemyBullets: [],
      enemies: [],
      pickups: [],
    };
  }

  function cloneState(state) {
    return {
      title: state.title,
      arena: { ...state.arena },
      roomCode: state.roomCode || '',
      status: state.status,
      objective: state.objective,
      gameOver: state.gameOver,
      time: state.time,
      wave: state.wave,
      score: state.score,
      squadLevel: state.squadLevel,
      nextEntityId: state.nextEntityId,
      lastEventId: state.lastEventId,
      events: state.events.map(cloneEvent),
      nextSpawnAt: state.nextSpawnAt,
      nextWaveAt: state.nextWaveAt,
      nextBossWave: state.nextBossWave,
      bossWaveEvery: state.bossWaveEvery,
      bossActive: state.bossActive,
      players: state.players.map(clonePlayer),
      playerBullets: state.playerBullets.map(cloneProjectile),
      enemyBullets: state.enemyBullets.map(cloneProjectile),
      enemies: state.enemies.map(cloneProjectile),
      pickups: state.pickups.map(clonePickup),
    };
  }

  function resetMatch(state) {
    const players = state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      input: { ...player.input },
    }));
    const fresh = createGameState();
    Object.assign(state, fresh);
    players.forEach((player, index) => {
      const next = createPlayer(index, player.id, player.name, player.color);
      next.input = player.input;
      state.players.push(next);
    });
    state.status = state.players.length
      ? 'Wave one live. Move, aim, and hold fire to survive.'
      : fresh.status;
    state.objective = `Build the squad and survive to wave ${state.nextBossWave}.`;
    return state;
  }

  function findPlayer(state, id) {
    return state.players.find((player) => player.id === id) || null;
  }

  function livingPlayers(state) {
    return state.players.filter((player) => player.alive);
  }

  function updateSquadLevel(state) {
    state.squadLevel = Math.max(1, ...state.players.map((player) => player.level || 1));
  }

  function addPlayer(state, info) {
    const existing = findPlayer(state, info.id);
    if (existing) {
      existing.name = info.name;
      return existing;
    }

    if (state.players.length >= MAX_PLAYERS) {
      return null;
    }

    const player = createPlayer(
      state.players.length,
      info.id,
      info.name,
      info.color || PLAYER_COLORS[state.players.length % PLAYER_COLORS.length]
    );
    state.players.push(player);
    updateSquadLevel(state);
    if (state.players.length === 1) {
      state.status = `${player.name} is piloting. Share the invite link to begin co-op.`;
    } else {
      state.status = `${player.name} joined the squad. Survive together.`;
    }
    return player;
  }

  function removePlayer(state, id) {
    const index = state.players.findIndex((player) => player.id === id);
    if (index < 0) {
      return;
    }
    state.players.splice(index, 1);
    state.playerBullets = state.playerBullets.filter((bullet) => bullet.ownerId !== id);
    if (!state.players.length) {
      state.status = 'The room is empty.';
      state.objective = `Build the squad and survive to wave ${state.nextBossWave}.`;
      return;
    }
    state.players.forEach((player, seat) => {
      player.seat = seat;
      const reset = createPlayer(seat, player.id, player.name, player.color);
      player.x = reset.x;
      player.y = reset.y;
    });
    updateSquadLevel(state);
    state.status = 'A pilot disconnected. The room stays open.';
  }

  function setPlayerInput(state, playerId, rawInput) {
    const player = findPlayer(state, playerId);
    if (!player) {
      return false;
    }

    const next = rawInput || {};
    player.input.moveX = clamp(Number(next.moveX) || 0, -1, 1);
    player.input.moveY = clamp(Number(next.moveY) || 0, -1, 1);
    player.input.aimX = clamp(Number(next.aimX) || ARENA.width / 2, 0, ARENA.width);
    player.input.aimY = clamp(Number(next.aimY) || ARENA.height / 2, 0, ARENA.height);
    player.input.fire = Boolean(next.fire);
    player.input.boost = Boolean(next.boost);
    return true;
  }

  function nearestLivingPlayer(state, enemy) {
    const alive = livingPlayers(state);
    if (!alive.length) {
      return null;
    }
    let best = alive[0];
    let bestDistance = distanceSquared(enemy.x, enemy.y, best.x, best.y);
    for (let index = 1; index < alive.length; index += 1) {
      const player = alive[index];
      const value = distanceSquared(enemy.x, enemy.y, player.x, player.y);
      if (value < bestDistance) {
        best = player;
        bestDistance = value;
      }
    }
    return best;
  }

  function applyLevelUps(state, player, gainedXp) {
    player.xp += gainedXp;
    let leveledUp = false;
    while (player.xp >= player.nextLevelXp) {
      player.xp -= player.nextLevelXp;
      player.level += 1;
      player.nextLevelXp = Math.floor(player.nextLevelXp * 1.38);
      player.maxHp += 1;
      player.hp = clamp(player.hp + 2, 0, player.maxHp);
      player.shield = clamp(player.shield + 1, 0, 7);
      player.damageBonus += 0.18;
      player.fireRateBonus += 0.012;
      player.weaponTier = Math.min(4, 1 + Math.floor((player.level - 1) / 2));
      leveledUp = true;
      pushEvent(state, 'level_up', {
        playerId: player.id,
        name: player.name,
        level: player.level,
      });
    }
    if (leveledUp) {
      updateSquadLevel(state);
      state.status = `${player.name} hit level ${player.level}. Weapons upgraded.`;
      state.objective = state.bossActive
        ? 'Boss wave live. Break the dreadnought and survive the escort swarm.'
        : `Squad stronger. Survive to wave ${state.nextBossWave}.`;
    }
  }

  function spawnEnemy(state, forcedType) {
    const edge = Math.floor(rand(0, 4));
    let x = 0;
    let y = 0;
    if (edge === 0) {
      x = rand(80, ARENA.width - 80);
      y = -50;
    } else if (edge === 1) {
      x = ARENA.width + 50;
      y = rand(100, ARENA.height * 0.62);
    } else if (edge === 2) {
      x = rand(80, ARENA.width - 80);
      y = ARENA.height + 50;
    } else {
      x = -50;
      y = rand(100, ARENA.height * 0.62);
    }

    let type = forcedType || 'drone';
    if (!forcedType) {
      const roll = Math.random();
      if (state.wave >= 6 && roll > 0.9) {
        type = 'juggernaut';
      } else if (state.wave >= 4 && roll > 0.77) {
        type = 'turret';
      } else if (state.wave >= 3 && roll > 0.56) {
        type = 'striker';
      }
    }

    const scale = 1 + state.wave * 0.085 + state.squadLevel * 0.03;
    const config = type === 'juggernaut'
      ? { r: 48, speed: 76 * scale, hp: 20 + state.wave * 2, damage: 3, shootRate: 1.55 }
      : type === 'turret'
        ? { r: 34, speed: 88 * scale, hp: 8 + state.wave, damage: 2, shootRate: 1.45 }
        : type === 'striker'
          ? { r: 28, speed: 170 * scale, hp: 5 + Math.floor(state.wave * 0.8), damage: 2, shootRate: 0 }
          : { r: 20, speed: 126 * scale, hp: 3 + Math.floor(state.wave * 0.55), damage: 1, shootRate: 0 };

    state.enemies.push({
      id: state.nextEntityId++,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: config.hp,
      maxHp: config.hp,
      r: config.r,
      speed: config.speed,
      damage: config.damage,
      shootCooldown: rand(0.35, 1.3),
      shootRate: config.shootRate,
      flash: 0,
      color: ENEMY_COLORS[type],
      phase: rand(0, Math.PI * 2),
      dir: Math.random() > 0.5 ? 1 : -1,
      summonCooldown: rand(3.2, 5.4),
    });
  }

  function spawnBoss(state) {
    if (state.enemies.some((enemy) => enemy.type === 'boss')) {
      return;
    }

    const hp = 160 + state.wave * 26 + state.squadLevel * 10;
    state.enemies.push({
      id: state.nextEntityId++,
      type: 'boss',
      x: ARENA.width / 2,
      y: 150,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      r: 96,
      speed: 84 + state.wave * 1.5,
      damage: 4,
      shootCooldown: 1.1,
      shootRate: 1.15,
      flash: 0,
      color: ENEMY_COLORS.boss,
      phase: rand(0, Math.PI * 2),
      dir: Math.random() > 0.5 ? 1 : -1,
      summonCooldown: 4.6,
      label: `Dreadnought ${state.wave}`,
    });
    state.bossActive = true;
    state.status = `Boss wave ${state.wave}. Dreadnought incoming.`;
    state.objective = 'Break the dreadnought and keep the squad alive.';
    pushEvent(state, 'boss_spawn', {
      wave: state.wave,
      label: `Dreadnought ${state.wave}`,
    });
  }

  function spawnPickup(state, x, y, forcedType) {
    const roll = Math.random();
    if (!forcedType && roll > 0.28) {
      return;
    }
    const type = forcedType || (roll < 0.11
      ? 'heal'
      : roll < 0.19
        ? 'shield'
        : 'overdrive');
    state.pickups.push({
      id: state.nextEntityId++,
      type,
      x,
      y,
      r: type === 'shield' ? 18 : 16,
      ttl: type === 'overdrive' ? 12 : 10,
    });
  }

  function spawnPlayerBullet(state, player, offset, damageScale) {
    const angle = player.angle + offset;
    const speed = 720 + player.level * 14 + (player.overdriveTimer > 0 ? 90 : 0);
    state.playerBullets.push({
      id: state.nextEntityId++,
      ownerId: player.id,
      x: player.x + Math.cos(angle) * 28,
      y: player.y + Math.sin(angle) * 28,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: (1 + player.damageBonus + (player.overdriveTimer > 0 ? 0.9 : 0)) * (damageScale || 1),
      r: 6 + Math.min(2, player.weaponTier * 0.35),
      ttl: 1.5,
      color: player.color,
    });
  }

  function firePlayerWeapon(state, player) {
    const offsets = player.weaponTier >= 4
      ? [-0.22, -0.09, 0, 0.09, 0.22]
      : player.weaponTier === 3
        ? [-0.16, 0, 0.16]
        : player.weaponTier === 2
          ? [-0.12, 0.12, 0]
          : [-0.08, 0.08];
    offsets.forEach((offset, index) => {
      const center = Math.abs(offset) < 0.001;
      const damageScale = center ? 1.12 : 1;
      spawnPlayerBullet(state, player, offset, damageScale);
      if (player.overdriveTimer > 0 && index === 0 && player.weaponTier >= 3) {
        spawnPlayerBullet(state, player, offset * 0.55, 0.9);
      }
    });
  }

  function spawnEnemyBullet(state, enemy, target, offset, speedScale, damageScale) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const baseAngle = Math.atan2(dy, dx);
    const angle = baseAngle + (offset || 0);
    const speed = (250 + state.wave * 12 + state.squadLevel * 4) * (speedScale || 1);
    const radius = enemy.type === 'boss' ? 11 : enemy.type === 'juggernaut' ? 9 : 6;
    state.enemyBullets.push({
      id: state.nextEntityId++,
      x: enemy.x + Math.cos(angle) * Math.max(8, enemy.r * 0.55),
      y: enemy.y + Math.sin(angle) * Math.max(8, enemy.r * 0.55),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: enemy.damage * (damageScale || 1),
      r: radius,
      ttl: enemy.type === 'boss' ? 3.8 : 3.2,
      color: enemy.type === 'boss' ? '#ffd0f2' : '#ffd3f3',
    });
  }

  function damagePlayer(state, player, amount) {
    if (!player.alive || player.invulnerable > 0) {
      return;
    }
    let damage = amount;
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, damage);
      player.shield -= absorbed;
      damage -= absorbed;
    }
    if (damage > 0) {
      player.hp = clamp(player.hp - damage, 0, player.maxHp);
    }
    player.flash = 0.12;
    player.invulnerable = 0.45;

    if (player.hp > 0) {
      return;
    }

    player.alive = false;
    player.respawnTimer = 4.2;
    player.input.fire = false;
    pushEvent(state, 'player_down', {
      playerId: player.id,
      name: player.name,
    });

    if (!livingPlayers(state).length) {
      state.gameOver = true;
      state.status = 'All pilots are down. Restart to launch another run.';
      state.objective = 'Regroup and restart the run.';
      pushEvent(state, 'game_over', {
        wave: state.wave,
        score: state.score,
      });
    } else {
      state.status = `${player.name} is down. Hold the line for the respawn window.`;
    }
  }

  function respawnPlayer(state, player) {
    const reset = createPlayer(player.seat, player.id, player.name, player.color);
    player.x = reset.x;
    player.y = reset.y;
    player.hp = Math.ceil(player.maxHp * 0.72);
    player.shield = 1;
    player.alive = true;
    player.respawnTimer = 0;
    player.invulnerable = 1.3;
    player.fireCooldown = 0.25;
    player.flash = 0;
    pushEvent(state, 'player_respawn', {
      playerId: player.id,
      name: player.name,
    });
  }

  function handleEnemyDestroyed(state, enemy, owner) {
    const scoreGain = SCORE_VALUES[enemy.type] || 80;
    const xpGain = XP_VALUES[enemy.type] || 10;
    if (owner) {
      owner.score += scoreGain;
      owner.combo += 1;
      applyLevelUps(state, owner, xpGain);
    }
    state.score += scoreGain;
    if (enemy.type === 'boss') {
      state.bossActive = false;
      state.nextBossWave = nextBossWaveNumber(state.wave + 1);
      state.status = `Boss destroyed. Re-arm for wave ${state.wave + 1}.`;
      state.objective = `Recovery window active. Next boss wave at ${state.nextBossWave}.`;
      state.nextWaveAt = state.time + 10;
      pushEvent(state, 'boss_down', {
        wave: state.wave,
        scoreGain,
      });
      spawnPickup(state, enemy.x - 40, enemy.y, 'heal');
      spawnPickup(state, enemy.x + 40, enemy.y, 'shield');
      spawnPickup(state, enemy.x, enemy.y + 20, 'overdrive');
      return;
    }
    spawnPickup(state, enemy.x, enemy.y);
  }

  function updateObjective(state) {
    if (state.gameOver) {
      state.objective = 'Restart the run and chase a deeper wave.';
      return;
    }
    if (state.bossActive) {
      state.objective = 'Boss wave live. Break the dreadnought and dodge the crossfire.';
      return;
    }
    state.objective = `Survive to wave ${state.nextBossWave}. Current wave ${state.wave}.`;
  }

  function step(state, dt) {
    if (!state.players.length) {
      return;
    }

    if (!state.gameOver) {
      state.time += dt;

      if (!state.bossActive && state.time >= state.nextWaveAt) {
        state.wave += 1;
        state.nextBossWave = nextBossWaveNumber(state.wave);
        if (state.wave % state.bossWaveEvery === 0) {
          spawnBoss(state);
          state.nextWaveAt = state.time + 26;
        } else {
          state.status = `Wave ${state.wave} incoming. Stay together and clear the flank.`;
          state.nextWaveAt = state.time + 18;
          updateObjective(state);
          pushEvent(state, 'wave_up', {
            wave: state.wave,
          });
        }
      }

      state.nextSpawnAt -= dt;
      while (state.nextSpawnAt <= 0) {
        if (state.bossActive) {
          const escorts = state.enemies.filter((enemy) => enemy.type !== 'boss').length;
          if (escorts < 4 + Math.floor(state.wave / 6)) {
            spawnEnemy(state, Math.random() > 0.6 ? 'striker' : 'drone');
          }
          state.nextSpawnAt += 3.2;
        } else {
          spawnEnemy(state);
          state.nextSpawnAt += clamp(1.08 - state.wave * 0.04, 0.32, 1.08);
        }
      }
    }

    for (const player of state.players) {
      player.flash = Math.max(0, player.flash - dt);
      player.invulnerable = Math.max(0, player.invulnerable - dt);
      player.fireCooldown = Math.max(0, player.fireCooldown - dt);
      player.overdriveTimer = Math.max(0, player.overdriveTimer - dt);
      player.boostMeter = clamp(player.boostMeter + dt * 0.18, 0, 1);

      if (!player.alive) {
        if (!state.gameOver) {
          player.respawnTimer = Math.max(0, player.respawnTimer - dt);
          if (player.respawnTimer === 0 && livingPlayers(state).length) {
            respawnPlayer(state, player);
            state.status = `${player.name} is back in the fight.`;
          }
        }
        continue;
      }

      const input = player.input;
      const magnitude = Math.hypot(input.moveX, input.moveY);
      const boostActive = input.boost && player.boostMeter > 0.1;
      const speed = boostActive ? PLAYER_BOOST_SPEED : PLAYER_SPEED;
      if (boostActive) {
        player.boostMeter = clamp(player.boostMeter - dt * 0.28, 0, 1);
      }

      if (magnitude > 0.02) {
        const vx = (input.moveX / magnitude) * speed;
        const vy = (input.moveY / magnitude) * speed;
        player.x = clamp(player.x + vx * dt, 48, ARENA.width - 48);
        player.y = clamp(player.y + vy * dt, 70, ARENA.height - 54);
      }

      player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);

      if (!state.gameOver && input.fire && player.fireCooldown <= 0) {
        firePlayerWeapon(state, player);
        player.fireCooldown = Math.max(
          0.08,
          (player.overdriveTimer > 0 ? 0.12 : 0.2) - player.fireRateBonus
        );
      }
    }

    for (let index = state.playerBullets.length - 1; index >= 0; index -= 1) {
      const bullet = state.playerBullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= dt;
      if (
        bullet.ttl <= 0 ||
        bullet.x < -40 ||
        bullet.x > ARENA.width + 40 ||
        bullet.y < -40 ||
        bullet.y > ARENA.height + 40
      ) {
        state.playerBullets.splice(index, 1);
      }
    }

    for (let index = state.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = state.enemyBullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= dt;
      if (
        bullet.ttl <= 0 ||
        bullet.x < -40 ||
        bullet.x > ARENA.width + 40 ||
        bullet.y < -40 ||
        bullet.y > ARENA.height + 40
      ) {
        state.enemyBullets.splice(index, 1);
      }
    }

    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = state.pickups[index];
      pickup.ttl -= dt;
      if (pickup.ttl <= 0) {
        state.pickups.splice(index, 1);
      }
    }

    for (let index = state.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = state.enemies[index];
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.phase += dt;
      const target = nearestLivingPlayer(state, enemy);
      if (!target) {
        continue;
      }

      if (enemy.type === 'boss') {
        enemy.x += enemy.dir * enemy.speed * dt;
        if (enemy.x <= 140 || enemy.x >= ARENA.width - 140) {
          enemy.dir *= -1;
        }
        enemy.y = 150 + Math.sin(enemy.phase * 0.9) * 34;
        enemy.shootCooldown -= dt;
        if (enemy.shootCooldown <= 0) {
          enemy.shootCooldown = Math.max(0.52, enemy.shootRate - state.squadLevel * 0.03);
          [-0.22, -0.08, 0.08, 0.22].forEach((offset) => {
            spawnEnemyBullet(state, enemy, target, offset, 1.08, 0.9);
          });
        }
        enemy.summonCooldown -= dt;
        if (enemy.summonCooldown <= 0) {
          enemy.summonCooldown = Math.max(2.8, 4.8 - state.wave * 0.06);
          spawnEnemy(state, Math.random() > 0.5 ? 'turret' : 'striker');
        }
        continue;
      }

      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      const desiredX = dx / distance;
      const desiredY = dy / distance;
      const drift = enemy.type === 'striker'
        ? Math.sin((state.time + enemy.id) * 3.4) * 90
        : enemy.type === 'juggernaut'
          ? Math.sin((state.time + enemy.id) * 1.8) * 46
          : 0;
      const minimumRange = enemy.type === 'turret' ? 230 : enemy.type === 'juggernaut' ? 180 : 0;
      const thrust = distance < minimumRange ? -0.55 : 1;
      enemy.vx = desiredX * enemy.speed * thrust - desiredY * drift * 0.18;
      enemy.vy = desiredY * enemy.speed * thrust + desiredX * drift * 0.18;
      enemy.x = clamp(enemy.x + enemy.vx * dt, -60, ARENA.width + 60);
      enemy.y = clamp(enemy.y + enemy.vy * dt, -60, ARENA.height + 60);

      if (enemy.type === 'turret' || enemy.type === 'juggernaut') {
        enemy.shootCooldown -= dt;
        if (enemy.shootCooldown <= 0) {
          enemy.shootCooldown = Math.max(0.68, enemy.shootRate - state.wave * 0.02);
          if (enemy.type === 'juggernaut') {
            [-0.12, 0.12].forEach((offset) => {
              spawnEnemyBullet(state, enemy, target, offset, 0.94, 1.1);
            });
          } else {
            spawnEnemyBullet(state, enemy, target, 0, 1, 1);
          }
        }
      }
    }

    for (let bulletIndex = state.playerBullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = state.playerBullets[bulletIndex];
      let hit = false;
      for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = state.enemies[enemyIndex];
        const hitRadius = bullet.r + enemy.r;
        if (distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y) > hitRadius * hitRadius) {
          continue;
        }
        enemy.hp -= bullet.damage;
        enemy.flash = 0.12;
        hit = true;
        if (enemy.hp <= 0) {
          const owner = findPlayer(state, bullet.ownerId);
          handleEnemyDestroyed(state, enemy, owner);
          state.enemies.splice(enemyIndex, 1);
        }
        break;
      }
      if (hit) {
        state.playerBullets.splice(bulletIndex, 1);
      }
    }

    for (let bulletIndex = state.enemyBullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = state.enemyBullets[bulletIndex];
      let hit = false;
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        const hitRadius = bullet.r + player.r;
        if (distanceSquared(bullet.x, bullet.y, player.x, player.y) <= hitRadius * hitRadius) {
          damagePlayer(state, player, bullet.damage);
          hit = true;
          break;
        }
      }
      if (hit) {
        state.enemyBullets.splice(bulletIndex, 1);
      }
    }

    for (const enemy of state.enemies) {
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        const hitRadius = enemy.r + player.r;
        if (distanceSquared(enemy.x, enemy.y, player.x, player.y) > hitRadius * hitRadius) {
          continue;
        }
        damagePlayer(state, player, enemy.damage);
        if (enemy.type !== 'boss' && enemy.type !== 'juggernaut') {
          enemy.hp = 0;
        } else {
          enemy.flash = 0.14;
        }
      }
    }

    for (let index = state.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = state.enemies[index];
      if (enemy.hp > 0) {
        continue;
      }
      handleEnemyDestroyed(state, enemy, null);
      state.enemies.splice(index, 1);
    }

    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = state.pickups[index];
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        const hitRadius = pickup.r + player.r;
        if (distanceSquared(pickup.x, pickup.y, player.x, player.y) > hitRadius * hitRadius) {
          continue;
        }
        if (pickup.type === 'heal') {
          player.hp = clamp(player.hp + 4, 0, player.maxHp);
          player.shield = clamp(player.shield + 1, 0, 6);
          state.status = `${player.name} grabbed a repair cache.`;
        } else if (pickup.type === 'shield') {
          player.shield = clamp(player.shield + 3, 0, 8);
          state.status = `${player.name} reinforced the shield lattice.`;
        } else {
          player.overdriveTimer = 8;
          player.shield = clamp(player.shield + 2, 0, 7);
          player.boostMeter = clamp(player.boostMeter + 0.35, 0, 1);
          state.status = `${player.name} activated overdrive.`;
        }
        pushEvent(state, 'pickup', {
          playerId: player.id,
          name: player.name,
          pickup: pickup.type,
        });
        state.pickups.splice(index, 1);
        break;
      }
    }

    updateObjective(state);
  }

  return {
    ARENA,
    PLAYER_COLORS,
    MAX_PLAYERS,
    createGameState,
    cloneState,
    resetMatch,
    addPlayer,
    removePlayer,
    setPlayerInput,
    step,
  };
});
