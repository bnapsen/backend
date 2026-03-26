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
  const PLAYER_COLORS = ['#67e8f9', '#ffd166'];
  const ENEMY_COLORS = {
    drone: '#ff7a90',
    striker: '#ffad5c',
    turret: '#d7a2ff',
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

  function cloneProjectile(projectile) {
    return { ...projectile };
  }

  function clonePickup(pickup) {
    return { ...pickup };
  }

  function createGameState() {
    return {
      title: 'Starline Defense Co-Op',
      arena: { ...ARENA },
      roomCode: '',
      status: 'Host a squad room, invite a wingmate, or launch solo.',
      gameOver: false,
      time: 0,
      wave: 1,
      score: 0,
      nextEntityId: 1,
      nextSpawnAt: 1.1,
      nextWaveAt: 18,
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
      gameOver: state.gameOver,
      time: state.time,
      wave: state.wave,
      score: state.score,
      nextEntityId: state.nextEntityId,
      nextSpawnAt: state.nextSpawnAt,
      nextWaveAt: state.nextWaveAt,
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
      seat: player.seat,
      input: { ...player.input },
    }));
    const fresh = createGameState();
    Object.assign(state, fresh);
    players.forEach((player, index) => {
      state.players.push(createPlayer(index, player.id, player.name, player.color));
      state.players[state.players.length - 1].input = player.input;
    });
    state.status = state.players.length
      ? 'Wave one live. Move, aim, and hold fire to survive.'
      : fresh.status;
    return state;
  }

  function findPlayer(state, id) {
    return state.players.find((player) => player.id === id) || null;
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

    const player = createPlayer(state.players.length, info.id, info.name, info.color || PLAYER_COLORS[state.players.length % PLAYER_COLORS.length]);
    state.players.push(player);
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
      return;
    }
    state.players.forEach((player, seat) => {
      player.seat = seat;
      const reset = createPlayer(seat, player.id, player.name, player.color);
      player.x = reset.x;
      player.y = reset.y;
    });
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

  function livingPlayers(state) {
    return state.players.filter((player) => player.alive);
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

  function spawnEnemy(state) {
    const edge = Math.floor(rand(0, 4));
    let x = 0;
    let y = 0;
    if (edge === 0) {
      x = rand(60, ARENA.width - 60);
      y = -30;
    } else if (edge === 1) {
      x = ARENA.width + 30;
      y = rand(80, ARENA.height * 0.62);
    } else if (edge === 2) {
      x = rand(60, ARENA.width - 60);
      y = ARENA.height + 30;
    } else {
      x = -30;
      y = rand(80, ARENA.height * 0.62);
    }

    const roll = Math.random();
    let type = 'drone';
    if (state.wave >= 4 && roll > 0.72) {
      type = 'striker';
    }
    if (state.wave >= 7 && roll > 0.88) {
      type = 'turret';
    }

    const scale = 1 + state.wave * 0.085;
    const config = type === 'turret'
      ? { r: 26, speed: 84 * scale, hp: 6 + state.wave, damage: 2, shootRate: 1.7 }
      : type === 'striker'
        ? { r: 22, speed: 160 * scale, hp: 4 + Math.floor(state.wave * 0.7), damage: 2, shootRate: 0 }
        : { r: 18, speed: 118 * scale, hp: 2 + Math.floor(state.wave * 0.45), damage: 1, shootRate: 0 };

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
      shootCooldown: rand(0.3, 1.4),
      shootRate: config.shootRate,
      flash: 0,
      color: ENEMY_COLORS[type],
    });
  }

  function spawnPickup(state, x, y) {
    const roll = Math.random();
    if (roll > 0.24) {
      return;
    }
    const type = roll < 0.12 ? 'heal' : 'overdrive';
    state.pickups.push({
      id: state.nextEntityId++,
      type,
      x,
      y,
      r: 16,
      ttl: 10,
    });
  }

  function spawnPlayerBullet(state, player, offset) {
    const angle = player.angle + offset;
    const speed = player.overdriveTimer > 0 ? 820 : 720;
    state.playerBullets.push({
      id: state.nextEntityId++,
      ownerId: player.id,
      x: player.x + Math.cos(angle) * 26,
      y: player.y + Math.sin(angle) * 26,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: player.overdriveTimer > 0 ? 2 : 1,
      r: 6,
      ttl: 1.4,
      color: player.color,
    });
  }

  function spawnEnemyBullet(state, enemy, target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    const speed = 250 + state.wave * 12;
    state.enemyBullets.push({
      id: state.nextEntityId++,
      x: enemy.x,
      y: enemy.y,
      vx: (dx / distance) * speed,
      vy: (dy / distance) * speed,
      damage: enemy.damage,
      r: 6,
      ttl: 3,
      color: '#ffd3f3',
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

    const aliveOthers = livingPlayers(state);
    if (!aliveOthers.length) {
      state.gameOver = true;
      state.status = 'All pilots are down. Restart to launch another run.';
    } else {
      state.status = `${player.name} is down. Hold the line for the respawn window.`;
    }
  }

  function respawnPlayer(player) {
    const reset = createPlayer(player.seat, player.id, player.name, player.color);
    player.x = reset.x;
    player.y = reset.y;
    player.hp = Math.ceil(player.maxHp * 0.7);
    player.shield = 1;
    player.alive = true;
    player.respawnTimer = 0;
    player.invulnerable = 1.3;
    player.fireCooldown = 0.25;
    player.flash = 0;
  }

  function step(state, dt) {
    if (!state.players.length) {
      return;
    }

    if (!state.gameOver) {
      state.time += dt;
      if (state.time >= state.nextWaveAt) {
        state.wave += 1;
        state.nextWaveAt += 18;
        state.status = `Wave ${state.wave} incoming. Stay together and clear the flank.`;
      }

      state.nextSpawnAt -= dt;
      while (state.nextSpawnAt <= 0) {
        spawnEnemy(state);
        state.nextSpawnAt += clamp(1.15 - state.wave * 0.06, 0.35, 1.15);
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
            respawnPlayer(player);
            state.status = `${player.name} is back in the fight.`;
          }
        }
        continue;
      }

      const input = player.input;
      const magnitude = Math.hypot(input.moveX, input.moveY) || 1;
      const boostActive = input.boost && player.boostMeter > 0.1;
      const speed = boostActive ? PLAYER_BOOST_SPEED : PLAYER_SPEED;
      if (boostActive) {
        player.boostMeter = clamp(player.boostMeter - dt * 0.28, 0, 1);
      }

      const vx = (input.moveX / magnitude) * speed;
      const vy = (input.moveY / magnitude) * speed;
      if (Math.abs(input.moveX) > 0.02 || Math.abs(input.moveY) > 0.02) {
        player.x = clamp(player.x + vx * dt, 48, ARENA.width - 48);
        player.y = clamp(player.y + vy * dt, 70, ARENA.height - 54);
      }

      player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);

      if (!state.gameOver && input.fire && player.fireCooldown <= 0) {
        const spread = player.overdriveTimer > 0 ? 0.12 : 0.08;
        spawnPlayerBullet(state, player, -spread);
        spawnPlayerBullet(state, player, spread);
        player.fireCooldown = player.overdriveTimer > 0 ? 0.12 : 0.17;
      }
    }

    for (let index = state.playerBullets.length - 1; index >= 0; index -= 1) {
      const bullet = state.playerBullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= dt;
      if (bullet.ttl <= 0 || bullet.x < -40 || bullet.x > ARENA.width + 40 || bullet.y < -40 || bullet.y > ARENA.height + 40) {
        state.playerBullets.splice(index, 1);
      }
    }

    for (let index = state.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = state.enemyBullets[index];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= dt;
      if (bullet.ttl <= 0 || bullet.x < -40 || bullet.x > ARENA.width + 40 || bullet.y < -40 || bullet.y > ARENA.height + 40) {
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
      const target = nearestLivingPlayer(state, enemy);
      if (!target) {
        continue;
      }

      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      const drift = enemy.type === 'striker' ? Math.sin((state.time + enemy.id) * 3.4) * 90 : 0;
      const desiredX = dx / distance;
      const desiredY = dy / distance;
      enemy.vx = desiredX * enemy.speed - desiredY * drift * 0.18;
      enemy.vy = desiredY * enemy.speed + desiredX * drift * 0.18;
      enemy.x = clamp(enemy.x + enemy.vx * dt, -60, ARENA.width + 60);
      enemy.y = clamp(enemy.y + enemy.vy * dt, -60, ARENA.height + 60);

      if (enemy.type === 'turret') {
        enemy.shootCooldown -= dt;
        if (enemy.shootCooldown <= 0) {
          enemy.shootCooldown = clamp(enemy.shootRate - state.wave * 0.03, 0.7, enemy.shootRate);
          spawnEnemyBullet(state, enemy, target);
        }
      }
    }

    for (let b = state.playerBullets.length - 1; b >= 0; b -= 1) {
      const bullet = state.playerBullets[b];
      let hit = false;
      for (let e = state.enemies.length - 1; e >= 0; e -= 1) {
        const enemy = state.enemies[e];
        if (distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y) > (bullet.r + enemy.r) * (bullet.r + enemy.r)) {
          continue;
        }
        enemy.hp -= bullet.damage;
        enemy.flash = 0.12;
        hit = true;
        if (enemy.hp <= 0) {
          const owner = findPlayer(state, bullet.ownerId);
          if (owner) {
            owner.score += enemy.type === 'turret' ? 160 : enemy.type === 'striker' ? 110 : 80;
            owner.combo += 1;
          }
          state.score += enemy.type === 'turret' ? 160 : enemy.type === 'striker' ? 110 : 80;
          spawnPickup(state, enemy.x, enemy.y);
          state.enemies.splice(e, 1);
        }
        break;
      }
      if (hit) {
        state.playerBullets.splice(b, 1);
      }
    }

    for (let b = state.enemyBullets.length - 1; b >= 0; b -= 1) {
      const bullet = state.enemyBullets[b];
      let hit = false;
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        if (distanceSquared(bullet.x, bullet.y, player.x, player.y) <= (bullet.r + player.r) * (bullet.r + player.r)) {
          damagePlayer(state, player, bullet.damage);
          hit = true;
          break;
        }
      }
      if (hit) {
        state.enemyBullets.splice(b, 1);
      }
    }

    for (const enemy of state.enemies) {
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        if (distanceSquared(enemy.x, enemy.y, player.x, player.y) <= (enemy.r + player.r) * (enemy.r + player.r)) {
          damagePlayer(state, player, enemy.damage);
          enemy.hp = 0;
        }
      }
    }
    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);

    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = state.pickups[index];
      for (const player of state.players) {
        if (!player.alive) {
          continue;
        }
        if (distanceSquared(pickup.x, pickup.y, player.x, player.y) > (pickup.r + player.r) * (pickup.r + player.r)) {
          continue;
        }
        if (pickup.type === 'heal') {
          player.hp = clamp(player.hp + 4, 0, player.maxHp);
          player.shield = clamp(player.shield + 1, 0, 5);
          state.status = `${player.name} grabbed a repair cache.`;
        } else {
          player.overdriveTimer = 8;
          player.shield = clamp(player.shield + 2, 0, 6);
          state.status = `${player.name} activated overdrive.`;
        }
        state.pickups.splice(index, 1);
        break;
      }
    }
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
