(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.ZombieSiegeCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ARENA = { width: 108, depth: 108 };
  const MAX_PLAYERS = 4;
  const MAX_EVENTS = 28;
  const PLAYER_COLORS = ['#73d9ff', '#ffd57a', '#ff9fc5', '#91f5a8'];
  const PLAYER_SPEED = 6.9;
  const PLAYER_SPRINT_SPEED = 9.8;
  const PLAYER_TURN_SPEED = 11.6;
  const PLAYER_RADIUS = 0.72;
  const PLAYER_MAX_HEALTH = 100;
  const RESPAWN_TIME = 5.5;
  const WAVE_START_DELAY = 2.3;
  const BOSS_WAVE_INTERVAL = 4;
  const WEAPONS = Object.freeze({
    rifle: {
      key: 'rifle',
      label: 'Rifle',
      damage: 24,
      range: 46,
      cooldown: 0.17,
      spread: 0,
      pellets: 1,
      width: 0.68,
      knockback: 0.8,
      color: '#8be7ff',
    },
    smg: {
      key: 'smg',
      label: 'SMG',
      damage: 13,
      range: 34,
      cooldown: 0.078,
      spread: 0,
      pellets: 1,
      width: 0.58,
      knockback: 0.45,
      color: '#ffd676',
    },
    shotgun: {
      key: 'shotgun',
      label: 'Shotgun',
      damage: 10,
      range: 22,
      cooldown: 0.58,
      spread: 0.14,
      pellets: 7,
      width: 0.92,
      knockback: 1.3,
      color: '#ff9eb9',
    },
  });
  const ZOMBIE_TYPES = Object.freeze({
    walker: {
      key: 'walker',
      label: 'Walker',
      hp: 42,
      speed: 2.45,
      radius: 0.84,
      damage: 10,
      attackCooldown: 0.9,
      score: 100,
      tint: '#9ec593',
    },
    runner: {
      key: 'runner',
      label: 'Runner',
      hp: 26,
      speed: 4.15,
      radius: 0.62,
      damage: 8,
      attackCooldown: 0.72,
      score: 120,
      tint: '#d2e3b2',
    },
    brute: {
      key: 'brute',
      label: 'Brute',
      hp: 124,
      speed: 1.82,
      radius: 1.08,
      damage: 18,
      attackCooldown: 1.15,
      score: 280,
      tint: '#8f8b7a',
    },
    boss: {
      key: 'boss',
      label: 'Abomination',
      hp: 520,
      speed: 1.44,
      radius: 1.7,
      damage: 24,
      attackCooldown: 1.25,
      score: 1800,
      tint: '#774748',
    },
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function distanceSquared(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
  }

  function normalizeAngle(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) {
      angle -= Math.PI * 2;
    }
    while (angle < -Math.PI) {
      angle += Math.PI * 2;
    }
    return angle;
  }

  function rotateToward(current, target, maxStep) {
    const delta = normalizeAngle(target - current);
    if (Math.abs(delta) <= maxStep) {
      return normalizeAngle(target);
    }
    return normalizeAngle(current + Math.sign(delta) * maxStep);
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

  function defaultInput() {
    return {
      moveX: 0,
      moveY: 0,
      moveDirX: 0,
      moveDirZ: 0,
      yaw: 0,
      aimX: null,
      aimZ: null,
      fire: false,
      sprint: false,
      weaponKey: 'rifle',
    };
  }

  function createPlayer(seat, id, name, color) {
    return {
      id,
      name,
      color,
      seat,
      x: seat < 2 ? -7 + seat * 6 : -7 + (seat - 2) * 6,
      z: seat < 2 ? 14 : 19,
      yaw: -Math.PI / 2,
      radius: PLAYER_RADIUS,
      health: PLAYER_MAX_HEALTH,
      maxHealth: PLAYER_MAX_HEALTH,
      kills: 0,
      score: 0,
      alive: true,
      respawnTimer: 0,
      fireCooldown: 0,
      damageScale: 1,
      moveSpeed: PLAYER_SPEED,
      sprintSpeed: PLAYER_SPRINT_SPEED,
      weaponKey: 'rifle',
      flash: 0,
      hurtTimer: 0,
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
      z: player.z,
      yaw: player.yaw,
      radius: player.radius,
      health: player.health,
      maxHealth: player.maxHealth,
      kills: player.kills,
      score: player.score,
      alive: player.alive,
      respawnTimer: player.respawnTimer,
      fireCooldown: player.fireCooldown,
      damageScale: player.damageScale,
      moveSpeed: player.moveSpeed,
      sprintSpeed: player.sprintSpeed,
      weaponKey: player.weaponKey,
      flash: player.flash,
      hurtTimer: player.hurtTimer,
      input: { ...player.input },
    };
  }

  function cloneZombie(zombie) {
    return {
      id: zombie.id,
      type: zombie.type,
      label: zombie.label,
      x: zombie.x,
      z: zombie.z,
      yaw: zombie.yaw,
      hp: zombie.hp,
      maxHp: zombie.maxHp,
      radius: zombie.radius,
      speed: zombie.speed,
      damage: zombie.damage,
      attackCooldown: zombie.attackCooldown,
      attackTimer: zombie.attackTimer,
      tint: zombie.tint,
      hitFlash: zombie.hitFlash,
      stride: zombie.stride,
      score: zombie.score,
    };
  }

  function cloneShot(shot) {
    return {
      id: shot.id,
      ownerId: shot.ownerId,
      weaponKey: shot.weaponKey,
      color: shot.color,
      fromX: shot.fromX,
      fromZ: shot.fromZ,
      toX: shot.toX,
      toZ: shot.toZ,
      hit: shot.hit,
      ttl: shot.ttl,
    };
  }

  function clonePickup(pickup) {
    return { ...pickup };
  }

  function cloneEvent(event) {
    return { ...event };
  }

  function createGameState() {
    return {
      title: 'Zombie Siege 3D Live',
      roomCode: '',
      arena: { ...ARENA },
      status: 'Host a room, share the invite, and hold the line together.',
      objective: 'Wave one is ready. Clear the yard before the next breach.',
      time: 0,
      wave: 0,
      bossWaveEvery: BOSS_WAVE_INTERVAL,
      score: 0,
      kills: 0,
      gameOver: false,
      intermission: 0.2,
      spawnBudget: 0,
      spawnTimer: 0,
      nextEntityId: 1,
      lastEventId: 0,
      players: [],
      zombies: [],
      shots: [],
      pickups: [],
      events: [],
    };
  }

  function cloneState(state) {
    return {
      title: state.title,
      roomCode: state.roomCode || '',
      arena: { ...state.arena },
      status: state.status,
      objective: state.objective,
      time: state.time,
      wave: state.wave,
      bossWaveEvery: state.bossWaveEvery,
      score: state.score,
      kills: state.kills,
      gameOver: state.gameOver,
      intermission: state.intermission,
      spawnBudget: state.spawnBudget,
      spawnTimer: state.spawnTimer,
      remaining: state.zombies.length + state.spawnBudget,
      nextEntityId: state.nextEntityId,
      lastEventId: state.lastEventId,
      players: state.players.map(clonePlayer),
      zombies: state.zombies.map(cloneZombie),
      shots: state.shots.map(cloneShot),
      pickups: state.pickups.map(clonePickup),
      events: state.events.map(cloneEvent),
    };
  }

  function currentWeapon(player) {
    return WEAPONS[player.weaponKey] || WEAPONS.rifle;
  }

  function livingPlayers(state) {
    return state.players.filter((player) => player.alive);
  }

  function findPlayer(state, id) {
    return state.players.find((player) => player.id === id) || null;
  }

  function setStatus(state, text) {
    state.status = text;
  }

  function setObjective(state, text) {
    state.objective = text;
  }

  function resetMatch(state) {
    const players = state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      input: { ...player.input },
      seat: player.seat,
    }));
    const fresh = createGameState();
    Object.assign(state, fresh);
    players.forEach((info, index) => {
      const player = createPlayer(index, info.id, info.name, info.color);
      player.input = info.input;
      state.players.push(player);
    });
    if (state.players.length) {
      state.intermission = 1.4;
      setStatus(state, 'Wave one is almost here. Secure the lot.');
      setObjective(state, 'Clear the first breach and keep everyone alive.');
    }
    return state;
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
    if (state.wave === 0) {
      state.intermission = 1.4;
      setStatus(state, `${player.name} is gearing up. Wave one is about to start.`);
      setObjective(state, 'Move the mouse over the arena, line up your shots, and clear the breach.');
    } else {
      setStatus(state, `${player.name} joined the fight. Cover the new teammate.`);
    }
    pushEvent(state, 'player-join', {
      playerId: player.id,
      playerName: player.name,
    });
    return player;
  }

  function removePlayer(state, playerId) {
    const index = state.players.findIndex((player) => player.id === playerId);
    if (index < 0) {
      return;
    }
    const player = state.players[index];
    state.players.splice(index, 1);
    state.players.forEach((entry, seat) => {
      entry.seat = seat;
    });
    if (!state.players.length) {
      setStatus(state, 'The yard is quiet. The room is empty.');
      setObjective(state, 'Host a room or launch solo to start a new siege.');
      return;
    }
    pushEvent(state, 'player-leave', {
      playerId: player.id,
      playerName: player.name,
    });
    setStatus(state, `${player.name} dropped out. The fight stays open for another survivor.`);
  }

  function setPlayerInput(state, playerId, rawInput) {
    const player = findPlayer(state, playerId);
    if (!player) {
      return false;
    }
    const next = rawInput || {};
    player.input.moveX = clamp(Number(next.moveX) || 0, -1, 1);
    player.input.moveY = clamp(Number(next.moveY) || 0, -1, 1);
    player.input.moveDirX = clamp(Number(next.moveDirX) || 0, -1, 1);
    player.input.moveDirZ = clamp(Number(next.moveDirZ) || 0, -1, 1);
    player.input.yaw = normalizeAngle(Number(next.yaw) || 0);
    player.input.aimX = Number.isFinite(Number(next.aimX))
      ? clamp(Number(next.aimX), -ARENA.width * 0.65, ARENA.width * 0.65)
      : null;
    player.input.aimZ = Number.isFinite(Number(next.aimZ))
      ? clamp(Number(next.aimZ), -ARENA.depth * 0.65, ARENA.depth * 0.65)
      : null;
    player.input.fire = Boolean(next.fire);
    player.input.sprint = Boolean(next.sprint);
    if (WEAPONS[next.weaponKey]) {
      player.input.weaponKey = next.weaponKey;
      player.weaponKey = next.weaponKey;
    }
    return true;
  }

  function nextEntityId(state) {
    const id = state.nextEntityId;
    state.nextEntityId += 1;
    return id;
  }

  function spawnZombie(state, typeKey) {
    const template = ZOMBIE_TYPES[typeKey] || ZOMBIE_TYPES.walker;
    const edge = Math.floor(Math.random() * 4);
    let x = 0;
    let z = 0;
    const margin = 10;
    if (edge === 0) {
      x = rand(-ARENA.width * 0.5 + margin, ARENA.width * 0.5 - margin);
      z = -ARENA.depth * 0.5 - 4.5;
    } else if (edge === 1) {
      x = ARENA.width * 0.5 + 4.5;
      z = rand(-ARENA.depth * 0.5 + margin, ARENA.depth * 0.5 - margin);
    } else if (edge === 2) {
      x = rand(-ARENA.width * 0.5 + margin, ARENA.width * 0.5 - margin);
      z = ARENA.depth * 0.5 + 4.5;
    } else {
      x = -ARENA.width * 0.5 - 4.5;
      z = rand(-ARENA.depth * 0.5 + margin, ARENA.depth * 0.5 - margin);
    }
    state.zombies.push({
      id: nextEntityId(state),
      type: template.key,
      label: template.label,
      x,
      z,
      yaw: 0,
      hp: template.hp + Math.max(0, state.wave - 1) * (template.key === 'boss' ? 24 : template.key === 'brute' ? 7 : 4),
      maxHp: template.hp + Math.max(0, state.wave - 1) * (template.key === 'boss' ? 24 : template.key === 'brute' ? 7 : 4),
      radius: template.radius,
      speed: template.speed + Math.min(1.6, state.wave * 0.08),
      damage: template.damage + Math.floor((state.wave - 1) / 3),
      attackCooldown: template.attackCooldown,
      attackTimer: rand(0.1, template.attackCooldown),
      tint: template.tint,
      hitFlash: 0,
      stride: rand(0, Math.PI * 2),
      score: template.score,
    });
  }

  function beginWave(state) {
    state.wave += 1;
    state.intermission = 0;
    const playerCount = Math.max(1, state.players.length);
    const bossWave = state.wave % BOSS_WAVE_INTERVAL === 0;
    state.spawnBudget = 8 + state.wave * 3 + playerCount * 3;
    if (bossWave) {
      state.spawnBudget += 3;
      spawnZombie(state, 'boss');
      pushEvent(state, 'boss-wave', {
        wave: state.wave,
      });
      setStatus(state, `Boss wave ${state.wave} is live. The abomination is in the yard.`);
      setObjective(state, 'Focus the boss, kite the brute pack, and keep someone alive.');
    } else {
      setStatus(state, `Wave ${state.wave} incoming. Hold the perimeter.`);
      setObjective(state, `Clear wave ${state.wave} and get ready for wave ${state.wave + 1}.`);
    }
    state.spawnTimer = 0.15;
    pushEvent(state, 'wave-start', { wave: state.wave });
  }

  function nearestLivingPlayer(state, zombie) {
    const players = livingPlayers(state);
    if (!players.length) {
      return null;
    }
    let best = players[0];
    let bestDistance = distanceSquared(zombie.x, zombie.z, best.x, best.z);
    for (let index = 1; index < players.length; index += 1) {
      const player = players[index];
      const value = distanceSquared(zombie.x, zombie.z, player.x, player.z);
      if (value < bestDistance) {
        best = player;
        bestDistance = value;
      }
    }
    return best;
  }

  function maybeSpawnPickup(state, zombie) {
    const chance = zombie.type === 'boss'
      ? 1
      : zombie.type === 'brute'
        ? 0.34
        : 0.12;
    if (Math.random() > chance) {
      return;
    }
    state.pickups.push({
      id: nextEntityId(state),
      type: 'medkit',
      x: zombie.x,
      z: zombie.z,
      radius: 0.85,
      heal: zombie.type === 'boss' ? 50 : zombie.type === 'brute' ? 34 : 22,
      ttl: zombie.type === 'boss' ? 16 : 12,
      rotation: rand(0, Math.PI * 2),
    });
  }

  function awardKill(state, player, zombie) {
    player.kills += 1;
    player.score += zombie.score;
    state.kills += 1;
    state.score += zombie.score;
    if (player.kills % 8 === 0) {
      player.damageScale = Math.min(1.75, player.damageScale + 0.08);
      player.maxHealth = Math.min(150, player.maxHealth + 6);
      player.health = Math.min(player.maxHealth, player.health + 16);
    }
    maybeSpawnPickup(state, zombie);
    pushEvent(state, 'enemy-down', {
      playerId: player.id,
      playerName: player.name,
      enemyType: zombie.type,
      wave: state.wave,
    });
  }

  function recordShot(state, player, weapon, toX, toZ, hit) {
    state.shots.push({
      id: nextEntityId(state),
      ownerId: player.id,
      weaponKey: weapon.key,
      color: weapon.color,
      fromX: player.x,
      fromZ: player.z,
      toX,
      toZ,
      hit: Boolean(hit),
      ttl: weapon.key === 'shotgun' ? 0.07 : 0.09,
    });
  }

  function aimDataForPlayer(player, weapon) {
    const aimX = Number(player.input.aimX);
    const aimZ = Number(player.input.aimZ);
    if (Number.isFinite(aimX) && Number.isFinite(aimZ)) {
      const dx = aimX - player.x;
      const dz = aimZ - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.05) {
        return {
          baseAngle: Math.atan2(dx, -dz),
          targetDistance: Math.min(weapon.range, distance),
        };
      }
    }
    return {
      baseAngle: player.yaw,
      targetDistance: weapon.range,
    };
  }

  function fireWeapon(state, player) {
    const weapon = currentWeapon(player);
    const aimData = aimDataForPlayer(player, weapon);
    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      const angle = aimData.baseAngle + rand(-weapon.spread, weapon.spread);
      const dirX = Math.sin(angle);
      const dirZ = -Math.cos(angle);
      let bestZombie = null;
      let bestAhead = aimData.targetDistance;

      for (const zombie of state.zombies) {
        const dx = zombie.x - player.x;
        const dz = zombie.z - player.z;
        const ahead = dx * dirX + dz * dirZ;
        if (ahead < 0.3 || ahead > aimData.targetDistance) {
          continue;
        }
        const lateral = Math.abs(dx * dirZ - dz * dirX);
        if (lateral > zombie.radius + weapon.width) {
          continue;
        }
        if (ahead < bestAhead) {
          bestAhead = ahead;
          bestZombie = zombie;
        }
      }

      if (bestZombie) {
        const hitX = player.x + dirX * bestAhead;
        const hitZ = player.z + dirZ * bestAhead;
        const damageFalloff = 1 - clamp(bestAhead / weapon.range, 0, 1) * 0.16;
        bestZombie.hp -= weapon.damage * player.damageScale * damageFalloff;
        bestZombie.hitFlash = 0.1;
        bestZombie.x += dirX * weapon.knockback;
        bestZombie.z += dirZ * weapon.knockback;
        recordShot(state, player, weapon, hitX, hitZ, true);
      } else {
        recordShot(
          state,
          player,
          weapon,
          player.x + dirX * aimData.targetDistance,
          player.z + dirZ * aimData.targetDistance,
          false
        );
      }
    }

    for (let index = state.zombies.length - 1; index >= 0; index -= 1) {
      const zombie = state.zombies[index];
      if (zombie.hp > 0) {
        continue;
      }
      awardKill(state, player, zombie);
      state.zombies.splice(index, 1);
    }
  }

  function respawnPoint(state) {
    const alive = livingPlayers(state);
    if (!alive.length) {
      return { x: 0, z: 12 };
    }
    const anchor = alive[Math.floor(Math.random() * alive.length)];
    return {
      x: clamp(anchor.x + rand(-2, 2), -ARENA.width * 0.46, ARENA.width * 0.46),
      z: clamp(anchor.z + rand(2.6, 4.8), -ARENA.depth * 0.46, ARENA.depth * 0.46),
    };
  }

  function stepPlayer(state, player, dt) {
    player.flash = Math.max(0, player.flash - dt * 3.4);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.yaw = normalizeAngle(player.yaw);
    let moveBasisYaw = normalizeAngle(player.input.yaw);
    if (Number.isFinite(player.input.aimX) && Number.isFinite(player.input.aimZ)) {
      const dx = player.input.aimX - player.x;
      const dz = player.input.aimZ - player.z;
      if (Math.hypot(dx, dz) > 0.05) {
        moveBasisYaw = Math.atan2(dx, -dz);
        player.yaw = rotateToward(player.yaw, moveBasisYaw, PLAYER_TURN_SPEED * dt);
      }
    } else {
      player.yaw = rotateToward(player.yaw, moveBasisYaw, PLAYER_TURN_SPEED * dt);
    }
    player.weaponKey = WEAPONS[player.input.weaponKey] ? player.input.weaponKey : player.weaponKey;

    if (!player.alive) {
      if (livingPlayers(state).length > 0) {
        player.respawnTimer = Math.max(0, player.respawnTimer - dt);
        if (player.respawnTimer <= 0) {
          const point = respawnPoint(state);
          player.alive = true;
          player.health = Math.max(42, Math.round(player.maxHealth * 0.55));
          player.x = point.x;
          player.z = point.z;
          player.hurtTimer = 0;
          setStatus(state, `${player.name} fought their way back into the yard.`);
          pushEvent(state, 'player-respawn', {
            playerId: player.id,
            playerName: player.name,
          });
        }
      }
      return;
    }

    let moveDirX = player.input.moveDirX;
    let moveDirZ = player.input.moveDirZ;
    if (Math.abs(moveDirX) > 0.001 || Math.abs(moveDirZ) > 0.001) {
      const magnitude = Math.hypot(moveDirX, moveDirZ) || 1;
      moveDirX /= magnitude;
      moveDirZ /= magnitude;
      const speed = player.input.sprint ? player.sprintSpeed : player.moveSpeed;
      player.x += moveDirX * speed * dt;
      player.z += moveDirZ * speed * dt;
    } else {
      let moveX = player.input.moveX;
      let moveY = player.input.moveY;
      if (Math.abs(moveX) > 0.001 || Math.abs(moveY) > 0.001) {
        const magnitude = Math.hypot(moveX, moveY) || 1;
        moveX /= magnitude;
        moveY /= magnitude;
        const speed = player.input.sprint ? player.sprintSpeed : player.moveSpeed;
        const forwardX = Math.sin(moveBasisYaw);
        const forwardZ = -Math.cos(moveBasisYaw);
        const rightX = -forwardZ;
        const rightZ = forwardX;
        player.x += (forwardX * moveY + rightX * moveX) * speed * dt;
        player.z += (forwardZ * moveY + rightZ * moveX) * speed * dt;
      }
    }
    player.x = clamp(player.x, -ARENA.width * 0.47, ARENA.width * 0.47);
    player.z = clamp(player.z, -ARENA.depth * 0.47, ARENA.depth * 0.47);

    if (player.input.fire && player.fireCooldown <= 0) {
      fireWeapon(state, player);
      player.fireCooldown = currentWeapon(player).cooldown;
      player.flash = 1;
    }
  }

  function applyZombieAttacks(state, zombie, player) {
    zombie.attackTimer = Math.max(0, zombie.attackTimer - state.lastStep);
    if (!player || !player.alive) {
      return;
    }
    const range = zombie.radius + player.radius + 0.3;
    const distance = Math.sqrt(distanceSquared(zombie.x, zombie.z, player.x, player.z));
    if (distance > range) {
      return;
    }
    if (zombie.attackTimer > 0) {
      return;
    }
    zombie.attackTimer = zombie.attackCooldown;
    player.health -= zombie.damage;
    player.hurtTimer = 0.2;
    const angle = Math.atan2(player.x - zombie.x, player.z - zombie.z);
    player.x += Math.sin(angle) * 0.6;
    player.z += Math.cos(angle) * 0.6;
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      player.respawnTimer = RESPAWN_TIME;
      pushEvent(state, 'player-down', {
        playerId: player.id,
        playerName: player.name,
      });
      setStatus(state, `${player.name} went down. Keep someone alive for the respawn.`);
    }
  }

  function stepZombies(state, dt) {
    for (const zombie of state.zombies) {
      zombie.hitFlash = Math.max(0, zombie.hitFlash - dt * 4);
      zombie.attackTimer = Math.max(0, zombie.attackTimer - dt);
      const target = nearestLivingPlayer(state, zombie);
      if (!target) {
        continue;
      }
      const dx = target.x - zombie.x;
      const dz = target.z - zombie.z;
      const distance = Math.sqrt(dx * dx + dz * dz) || 1;
      zombie.yaw = Math.atan2(dx, -dz);
      if (distance > zombie.radius + target.radius + 0.18) {
        zombie.x += (dx / distance) * zombie.speed * dt;
        zombie.z += (dz / distance) * zombie.speed * dt;
      }
      applyZombieAttacks(state, zombie, target);
    }
  }

  function stepPickups(state, dt) {
    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = state.pickups[index];
      pickup.ttl -= dt;
      pickup.rotation += dt * 1.2;
      if (pickup.ttl <= 0) {
        state.pickups.splice(index, 1);
        continue;
      }
      for (const player of livingPlayers(state)) {
        if (distanceSquared(player.x, player.z, pickup.x, pickup.z) > Math.pow(player.radius + pickup.radius, 2)) {
          continue;
        }
        player.health = Math.min(player.maxHealth, player.health + pickup.heal);
        state.pickups.splice(index, 1);
        pushEvent(state, 'pickup', {
          playerId: player.id,
          playerName: player.name,
          pickupType: pickup.type,
        });
        setStatus(state, `${player.name} grabbed a med kit.`);
        break;
      }
    }
  }

  function cleanupEffects(state, dt) {
    for (let index = state.shots.length - 1; index >= 0; index -= 1) {
      state.shots[index].ttl -= dt;
      if (state.shots[index].ttl <= 0) {
        state.shots.splice(index, 1);
      }
    }
  }

  function maybeAdvanceWave(state, dt) {
    if (!state.players.length || state.gameOver) {
      return;
    }

    if (state.wave === 0) {
      state.intermission = Math.max(0, state.intermission - dt);
      if (state.intermission <= 0) {
        beginWave(state);
      }
      return;
    }

    if (state.spawnBudget > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const pool = state.wave >= 5
          ? ['walker', 'walker', 'runner', 'runner', 'runner', 'brute', 'brute']
          : state.wave >= 3
            ? ['walker', 'walker', 'runner', 'runner', 'brute']
            : ['walker', 'walker', 'walker', 'runner'];
        spawnZombie(state, pool[Math.floor(Math.random() * pool.length)]);
        state.spawnBudget -= 1;
        state.spawnTimer = Math.max(0.24, 0.88 - state.wave * 0.05 - state.players.length * 0.05);
      }
      return;
    }

    if (!state.zombies.length) {
      if (state.intermission <= 0) {
        state.intermission = WAVE_START_DELAY;
        setStatus(state, `Wave ${state.wave} cleared. Catch your breath and reload.`);
        setObjective(state, `Next breach in ${WAVE_START_DELAY.toFixed(1)} seconds.`);
        pushEvent(state, 'wave-clear', {
          wave: state.wave,
        });
        return;
      }
      state.intermission = Math.max(0, state.intermission - dt);
      if (state.intermission <= 0) {
        beginWave(state);
      } else {
        setStatus(state, `Wave ${state.wave} cleared. Next breach in ${state.intermission.toFixed(1)}s.`);
        setObjective(state, `Fortify for wave ${state.wave + 1}.`);
      }
    }
  }

  function updateGameOver(state) {
    if (!state.players.length || state.gameOver) {
      return;
    }
    if (livingPlayers(state).length > 0) {
      return;
    }
    state.gameOver = true;
    setStatus(state, `The yard fell on wave ${state.wave}. Restart to run it back.`);
    setObjective(state, 'Everybody is down. Reset the run or host a fresh room.');
    pushEvent(state, 'game-over', {
      wave: state.wave,
      score: state.score,
    });
  }

  function step(state, dt) {
    const delta = clamp(Number(dt) || 0, 0, 0.05);
    state.lastStep = delta;
    state.time = Number((state.time + delta).toFixed(3));

    cleanupEffects(state, delta);
    for (const player of state.players) {
      stepPlayer(state, player, delta);
    }
    stepZombies(state, delta);
    stepPickups(state, delta);
    maybeAdvanceWave(state, delta);
    updateGameOver(state);
    return state;
  }

  return {
    ARENA,
    MAX_PLAYERS,
    WEAPONS,
    ZOMBIE_TYPES,
    createGameState,
    cloneState,
    resetMatch,
    addPlayer,
    removePlayer,
    setPlayerInput,
    step,
  };
});
