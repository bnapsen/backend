(function (globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.ZombieSiegeCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ARENA = { width: 232, depth: 232 };
  const MAX_PLAYERS = 4;
  const MAX_EVENTS = 28;
  const PLAYER_COLORS = ['#73d9ff', '#ffd57a', '#ff9fc5', '#91f5a8'];
  const PLAYER_SPEED = 7.35;
  const PLAYER_SPRINT_SPEED = 10.8;
  const PLAYER_TURN_SPEED = 15.2;
  const PLAYER_ACCEL = 16.8;
  const PLAYER_AIR_ACCEL = 8.4;
  const PLAYER_DRAG = 8.8;
  const PLAYER_AIR_DRAG = 2.8;
  const PLAYER_RADIUS = 0.72;
  const PLAYER_MAX_HEALTH = 100;
  const PLAYER_JUMP_VELOCITY = 9.4;
  const PLAYER_GRAVITY = 28;
  const GRENADE_COOLDOWN = 3.9;
  const GRENADE_SPEED = 20.5;
  const GRENADE_UPWARD = 8.4;
  const GRENADE_GRAVITY = 24;
  const GRENADE_RADIUS = 8.8;
  const GRENADE_DAMAGE = 88;
  const GRENADE_KNOCKBACK = 4.4;
  const GRENADE_FUSE = 1.18;
  const SPITTER_PROJECTILE_SPEED = 16.5;
  const SPITTER_SPLASH_RADIUS = 2.8;
  const SPITTER_SPLASH_DAMAGE = 13;
  const RESPAWN_TIME = 5.5;
  const WAVE_START_DELAY = 2.3;
  const BOSS_WAVE_INTERVAL = 4;
  const RELAY_CAPTURE_SECONDS = 5.5;
  const EXTRACTION_HOLD_SECONDS = 11;
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
    crawler: {
      key: 'crawler',
      label: 'Crawler',
      hp: 22,
      speed: 4.85,
      radius: 0.54,
      damage: 7,
      attackCooldown: 0.64,
      score: 130,
      tint: '#bfc89a',
    },
    spitter: {
      key: 'spitter',
      label: 'Spitter',
      hp: 48,
      speed: 2.3,
      radius: 0.78,
      damage: 10,
      attackCooldown: 1.95,
      score: 210,
      tint: '#7ca870',
      preferredDistance: 16,
      ranged: true,
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
  const RELAY_POINTS = Object.freeze([
    { x: -78, z: 18, radius: 7.4 },
    { x: 0, z: -42, radius: 7.6 },
    { x: 74, z: 26, radius: 7.4 },
  ]);
  const NEST_POINTS = Object.freeze([
    { x: -82, z: -18, radius: 2.8 },
    { x: 86, z: -26, radius: 2.8 },
    { x: 0, z: 78, radius: 2.9 },
  ]);
  const EXTRACTION_POINT = Object.freeze({
    x: 0,
    z: 78,
    radius: 9.8,
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

  function rectContains(x, z, rect) {
    return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
  }

  function rampHeight(value, start, end, from, to) {
    if (start === end) {
      return to;
    }
    const t = clamp((value - start) / (end - start), 0, 1);
    return from + (to - from) * t;
  }

  function groundHeightAt(x, z) {
    let height = 0;

    if (rectContains(x, z, {
      minX: -42,
      maxX: 42,
      minZ: -62,
      maxZ: -24,
    })) {
      height = Math.max(height, 4.4);
    }
    if (rectContains(x, z, {
      minX: -56,
      maxX: -42,
      minZ: -44,
      maxZ: -24,
    })) {
      height = Math.max(height, rampHeight(x, -56, -42, 0, 4.4));
    }
    if (rectContains(x, z, {
      minX: 42,
      maxX: 56,
      minZ: -44,
      maxZ: -24,
    })) {
      height = Math.max(height, rampHeight(x, 56, 42, 0, 4.4));
    }
    if (rectContains(x, z, {
      minX: -18,
      maxX: 18,
      minZ: -52,
      maxZ: -32,
    })) {
      height = Math.max(height, 8.2);
    }
    if (rectContains(x, z, {
      minX: -30,
      maxX: -18,
      minZ: -48,
      maxZ: -32,
    })) {
      height = Math.max(height, rampHeight(x, -30, -18, 4.4, 8.2));
    }
    if (rectContains(x, z, {
      minX: 18,
      maxX: 30,
      minZ: -48,
      maxZ: -32,
    })) {
      height = Math.max(height, rampHeight(x, 30, 18, 4.4, 8.2));
    }

    if (rectContains(x, z, {
      minX: 54,
      maxX: 94,
      minZ: 4,
      maxZ: 50,
    })) {
      height = Math.max(height, 5.2);
    }
    if (rectContains(x, z, {
      minX: 42,
      maxX: 54,
      minZ: 16,
      maxZ: 34,
    })) {
      height = Math.max(height, rampHeight(x, 42, 54, 0, 5.2));
    }
    if (rectContains(x, z, {
      minX: 66,
      maxX: 82,
      minZ: 18,
      maxZ: 34,
    })) {
      height = Math.max(height, 9.6);
    }
    if (rectContains(x, z, {
      minX: 54,
      maxX: 66,
      minZ: 18,
      maxZ: 34,
    })) {
      height = Math.max(height, rampHeight(x, 54, 66, 5.2, 9.6));
    }

    if (rectContains(x, z, {
      minX: -28,
      maxX: 28,
      minZ: 56,
      maxZ: 92,
    })) {
      height = Math.max(height, 3.8);
    }
    if (rectContains(x, z, {
      minX: -42,
      maxX: -28,
      minZ: 68,
      maxZ: 84,
    })) {
      height = Math.max(height, rampHeight(x, -42, -28, 0, 3.8));
    }
    if (rectContains(x, z, {
      minX: -10,
      maxX: 10,
      minZ: 68,
      maxZ: 84,
    })) {
      height = Math.max(height, 7.4);
    }
    if (rectContains(x, z, {
      minX: -22,
      maxX: -10,
      minZ: 68,
      maxZ: 84,
    })) {
      height = Math.max(height, rampHeight(x, -22, -10, 3.8, 7.4));
    }

    return Number(height.toFixed(3));
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
      grenade: false,
      jump: false,
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
      y: 0,
      vy: 0,
      vx: 0,
      vz: 0,
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
      grenadeCooldown: 0,
      grounded: true,
      grenadeLatch: false,
      jumpLatch: false,
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
      y: player.y,
      vy: player.vy,
      vx: player.vx,
      vz: player.vz,
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
      grenadeCooldown: player.grenadeCooldown,
      grounded: player.grounded,
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
      y: zombie.y,
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
      preferredDistance: zombie.preferredDistance,
      ranged: zombie.ranged,
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
      fromY: shot.fromY,
      toX: shot.toX,
      toZ: shot.toZ,
      toY: shot.toY,
      width: shot.width,
      hit: shot.hit,
      ttl: shot.ttl,
    };
  }

  function cloneGrenade(grenade) {
    return { ...grenade };
  }

  function cloneExplosion(explosion) {
    return { ...explosion };
  }

  function cloneEnemyProjectile(projectile) {
    return { ...projectile };
  }

  function clonePickup(pickup) {
    return { ...pickup };
  }

  function cloneRelay(relay) {
    return { ...relay };
  }

  function cloneNest(nest) {
    return { ...nest };
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
      victory: false,
      missionStage: 'breach',
      intermission: 0.2,
      spawnBudget: 0,
      spawnTimer: 0,
      nextEntityId: 1,
      lastEventId: 0,
      players: [],
      zombies: [],
      shots: [],
      grenades: [],
      explosions: [],
      enemyProjectiles: [],
      pickups: [],
      relays: [],
      nests: [],
      extraction: {
        active: false,
        x: EXTRACTION_POINT.x,
        z: EXTRACTION_POINT.z,
        y: groundHeightAt(EXTRACTION_POINT.x, EXTRACTION_POINT.z),
        radius: EXTRACTION_POINT.radius,
        progress: 0,
        goal: EXTRACTION_HOLD_SECONDS,
      },
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
      victory: state.victory,
      missionStage: state.missionStage,
      intermission: state.intermission,
      spawnBudget: state.spawnBudget,
      spawnTimer: state.spawnTimer,
      remaining: state.zombies.length + state.spawnBudget + state.nests.filter((nest) => !nest.destroyed).length,
      nextEntityId: state.nextEntityId,
      lastEventId: state.lastEventId,
      players: state.players.map(clonePlayer),
      zombies: state.zombies.map(cloneZombie),
      shots: state.shots.map(cloneShot),
      grenades: state.grenades.map(cloneGrenade),
      explosions: state.explosions.map(cloneExplosion),
      enemyProjectiles: state.enemyProjectiles.map(cloneEnemyProjectile),
      pickups: state.pickups.map(clonePickup),
      relays: state.relays.map(cloneRelay),
      nests: state.nests.map(cloneNest),
      extraction: state.extraction ? { ...state.extraction } : null,
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

  function activeRelayCount(state) {
    return state.relays.filter((relay) => relay.complete).length;
  }

  function destroyedNestCount(state) {
    return state.nests.filter((nest) => nest.destroyed).length;
  }

  function updateMissionObjective(state) {
    if (state.victory) {
      setObjective(state, 'Extraction successful. Restart the run or host another squad drop.');
      return;
    }
    if (state.missionStage === 'relays') {
      if (activeRelayCount(state) >= RELAY_POINTS.length) {
        setObjective(state, `Relay grid online. Hold the yard until plague nests reveal themselves on later waves.`);
        return;
      }
      setObjective(state, `Bring the relay grid online (${activeRelayCount(state)}/${RELAY_POINTS.length}). Stand in each uplink ring to charge it.`);
      return;
    }
    if (state.missionStage === 'nests') {
      if (destroyedNestCount(state) >= NEST_POINTS.length) {
        setObjective(state, 'All nests destroyed. Survive until extraction is available.');
        return;
      }
      setObjective(state, `Destroy the plague nests (${destroyedNestCount(state)}/${NEST_POINTS.length}). They keep seeding new infected into the yard.`);
      return;
    }
    if (state.missionStage === 'evac' && state.extraction?.active) {
      const hold = Math.max(0, (state.extraction.goal || EXTRACTION_HOLD_SECONDS) - (state.extraction.progress || 0));
      setObjective(state, `Reach the evac pad and hold it for ${hold.toFixed(1)}s while the last horde crashes in.`);
      return;
    }
    if (state.wave <= 1) {
      setObjective(state, 'Clear the first breach and stabilize the perimeter.');
      return;
    }
    if (state.wave < 3) {
      setObjective(state, `Survive the breach. Objective systems unlock after wave 2. Wave ${state.wave} is live.`);
      return;
    }
    setObjective(state, `Stay alive and keep the yard clean while the mission escalates. Wave ${state.wave} is live.`);
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
      updateMissionObjective(state);
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
      updateMissionObjective(state);
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
    updateMissionObjective(state);
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
    player.input.grenade = Boolean(next.grenade);
    player.input.jump = Boolean(next.jump);
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

  function ensureRelayPhase(state) {
    if (state.relays.length) {
      return;
    }
    state.missionStage = 'relays';
    state.relays = RELAY_POINTS.map((point) => ({
      id: nextEntityId(state),
      x: point.x,
      z: point.z,
      y: groundHeightAt(point.x, point.z),
      radius: point.radius,
      progress: 0,
      goal: RELAY_CAPTURE_SECONDS,
      complete: false,
      pulse: rand(0, Math.PI * 2),
    }));
    setStatus(state, 'Mission update: the relay grid is exposed. Bring all three uplinks online.');
    updateMissionObjective(state);
    pushEvent(state, 'mission-stage', {
      stage: 'relays',
      wave: state.wave,
    });
  }

  function ensureNestPhase(state) {
    if (state.nests.length) {
      return;
    }
    state.missionStage = 'nests';
    state.nests = NEST_POINTS.map((point) => ({
      id: nextEntityId(state),
      x: point.x,
      z: point.z,
      y: groundHeightAt(point.x, point.z),
      radius: point.radius,
      hp: 220,
      maxHp: 220,
      destroyed: false,
      pulse: rand(0, Math.PI * 2),
      spawnTimer: 1.4 + Math.random() * 1.1,
    }));
    setStatus(state, 'Mission update: plague nests are pulsing across the yard. Burn them down.');
    updateMissionObjective(state);
    pushEvent(state, 'mission-stage', {
      stage: 'nests',
      wave: state.wave,
    });
  }

  function ensureEvacPhase(state) {
    if (state.extraction?.active) {
      return;
    }
    state.missionStage = 'evac';
    state.extraction = {
      active: true,
      x: EXTRACTION_POINT.x,
      z: EXTRACTION_POINT.z,
      y: groundHeightAt(EXTRACTION_POINT.x, EXTRACTION_POINT.z),
      radius: EXTRACTION_POINT.radius,
      progress: 0,
      goal: EXTRACTION_HOLD_SECONDS,
    };
    state.spawnBudget += 8 + state.players.length * 2;
    spawnZombie(state, 'boss');
    spawnZombie(state, 'spitter');
    setStatus(state, 'Mission update: evac shuttle inbound. Reach the rooftop pad and hold it.');
    updateMissionObjective(state);
    pushEvent(state, 'mission-stage', {
      stage: 'evac',
      wave: state.wave,
    });
  }

  function completeMission(state) {
    state.gameOver = true;
    state.victory = true;
    state.spawnBudget = 0;
    state.enemyProjectiles = [];
    setStatus(state, 'Extraction secured. The squad made it out alive.');
    updateMissionObjective(state);
    pushEvent(state, 'mission-clear', {
      wave: state.wave,
      score: state.score,
    });
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
      y: groundHeightAt(x, z),
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
      preferredDistance: template.preferredDistance || 0,
      ranged: Boolean(template.ranged),
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
    } else {
      setStatus(state, `Wave ${state.wave} incoming. Hold the perimeter.`);
    }
    updateMissionObjective(state);
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
      y: groundHeightAt(zombie.x, zombie.z),
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

  function zombieAimHeight(zombie) {
    if (zombie.type === 'boss') {
      return (zombie.y || 0) + 2.9;
    }
    if (zombie.type === 'brute') {
      return (zombie.y || 0) + 2.2;
    }
    if (zombie.type === 'spitter') {
      return (zombie.y || 0) + 1.72;
    }
    if (zombie.type === 'runner') {
      return (zombie.y || 0) + 1.18;
    }
    if (zombie.type === 'crawler') {
      return (zombie.y || 0) + 0.8;
    }
    return (zombie.y || 0) + 1.45;
  }

  function nestAimHeight(nest) {
    return (nest.y || 0) + 1.9;
  }

  function damageNest(state, nest, amount, owner) {
    if (!nest || nest.destroyed) {
      return false;
    }
    nest.hp -= amount;
    nest.pulse += 0.4;
    if (nest.hp > 0) {
      return false;
    }
    nest.hp = 0;
    nest.destroyed = true;
    const player = owner || state.players[0];
    if (player) {
      player.score += 420;
      state.score += 420;
    }
    pushEvent(state, 'nest-destroyed', {
      playerId: player?.id || '',
      playerName: player?.name || 'Survivor',
      destroyed: destroyedNestCount(state),
      total: NEST_POINTS.length,
      wave: state.wave,
    });
    setStatus(state, `${player?.name || 'The squad'} destroyed a plague nest.`);
    updateMissionObjective(state);
    return true;
  }

  function recordShot(state, player, weapon, toX, toZ, toY, hit) {
    state.shots.push({
      id: nextEntityId(state),
      ownerId: player.id,
      weaponKey: weapon.key,
      color: weapon.color,
      fromX: player.x,
      fromZ: player.z,
      fromY: (player.y || 0) + 1.46,
      toX,
      toZ,
      toY,
      width: weapon.key === 'shotgun' ? 0.12 : weapon.key === 'smg' ? 0.06 : 0.08,
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
      let bestNest = null;
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
        if (ahead <= bestAhead) {
          bestAhead = ahead;
          bestZombie = zombie;
          bestNest = null;
        }
      }

      for (const nest of state.nests) {
        if (nest.destroyed) {
          continue;
        }
        const dx = nest.x - player.x;
        const dz = nest.z - player.z;
        const ahead = dx * dirX + dz * dirZ;
        if (ahead < 0.3 || ahead > aimData.targetDistance) {
          continue;
        }
        const lateral = Math.abs(dx * dirZ - dz * dirX);
        if (lateral > nest.radius + weapon.width) {
          continue;
        }
        if (ahead <= bestAhead) {
          bestAhead = ahead;
          bestZombie = null;
          bestNest = nest;
        }
      }

      if (bestZombie) {
        const hitX = player.x + dirX * bestAhead;
        const hitZ = player.z + dirZ * bestAhead;
        const hitY = zombieAimHeight(bestZombie);
        const damageFalloff = 1 - clamp(bestAhead / weapon.range, 0, 1) * 0.16;
        bestZombie.hp -= weapon.damage * player.damageScale * damageFalloff;
        bestZombie.hitFlash = 0.1;
        bestZombie.x += dirX * weapon.knockback;
        bestZombie.z += dirZ * weapon.knockback;
        recordShot(state, player, weapon, hitX, hitZ, hitY, true);
      } else if (bestNest) {
        const hitX = player.x + dirX * bestAhead;
        const hitZ = player.z + dirZ * bestAhead;
        const hitY = nestAimHeight(bestNest);
        const damageFalloff = 1 - clamp(bestAhead / weapon.range, 0, 1) * 0.1;
        damageNest(state, bestNest, weapon.damage * player.damageScale * damageFalloff * 1.05, player);
        recordShot(state, player, weapon, hitX, hitZ, hitY, true);
      } else {
        recordShot(
          state,
          player,
          weapon,
          player.x + dirX * aimData.targetDistance,
          player.z + dirZ * aimData.targetDistance,
          (player.y || 0) + 1.42,
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

  function recordExplosion(state, x, y, z, radius, kind, color) {
    state.explosions.push({
      id: nextEntityId(state),
      x,
      y,
      z,
      radius,
      kind: kind || 'frag',
      color: color || (kind === 'acid' ? '#7dff72' : '#ffb26a'),
      ttl: 0.56,
      maxTtl: 0.56,
    });
  }

  function applyDamageToPlayer(state, player, amount, sourceX, sourceZ, statusText) {
    if (!player || !player.alive) {
      return false;
    }
    player.health -= amount;
    player.hurtTimer = 0.2;
    const angle = Math.atan2(player.x - sourceX, player.z - sourceZ);
    player.vx += Math.sin(angle) * 2.2;
    player.vz += Math.cos(angle) * 2.2;
    player.x += Math.sin(angle) * 0.4;
    player.z += Math.cos(angle) * 0.4;
    player.x = clamp(player.x, -ARENA.width * 0.47, ARENA.width * 0.47);
    player.z = clamp(player.z, -ARENA.depth * 0.47, ARENA.depth * 0.47);
    player.y = groundHeightAt(player.x, player.z);
    player.vy = 0;
    player.grounded = true;
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      player.respawnTimer = RESPAWN_TIME;
      pushEvent(state, 'player-down', {
        playerId: player.id,
        playerName: player.name,
      });
      setStatus(state, statusText || `${player.name} went down. Keep someone alive for the respawn.`);
      return true;
    }
    return false;
  }

  function recordEnemyProjectile(state, projectile) {
    state.enemyProjectiles.push({
      id: nextEntityId(state),
      ...projectile,
    });
  }

  function recordAcidSplash(state, x, y, z) {
    recordExplosion(state, x, y, z, SPITTER_SPLASH_RADIUS, 'acid', '#8dff7a');
  }

  function explodeGrenade(state, grenade, owner) {
    const originX = grenade.x;
    const originZ = grenade.z;
    const originY = grenade.y;
    recordExplosion(state, originX, originY, originZ, GRENADE_RADIUS, 'frag', '#ffb26a');
    let kills = 0;

    for (let index = state.zombies.length - 1; index >= 0; index -= 1) {
      const zombie = state.zombies[index];
      const dx = zombie.x - originX;
      const dz = zombie.z - originZ;
      const distance = Math.hypot(dx, dz);
      if (distance > GRENADE_RADIUS + zombie.radius) {
        continue;
      }
      const falloff = 1 - clamp(distance / GRENADE_RADIUS, 0, 1);
      const damage = GRENADE_DAMAGE * (0.32 + falloff * 0.68);
      zombie.hp -= damage * (owner?.damageScale || 1);
      zombie.hitFlash = 0.18;
      const knock = GRENADE_KNOCKBACK * (0.35 + falloff * 0.65);
      const norm = distance > 0.001 ? 1 / distance : 1;
      zombie.x += dx * norm * knock;
      zombie.z += dz * norm * knock;
      zombie.y = groundHeightAt(zombie.x, zombie.z);
      if (zombie.hp <= 0) {
        awardKill(state, owner || state.players[0], zombie);
        state.zombies.splice(index, 1);
        kills += 1;
      }
    }

    for (const nest of state.nests) {
      if (nest.destroyed) {
        continue;
      }
      const distance = Math.hypot(nest.x - originX, nest.z - originZ);
      if (distance > GRENADE_RADIUS + nest.radius) {
        continue;
      }
      const falloff = 1 - clamp(distance / GRENADE_RADIUS, 0, 1);
      damageNest(state, nest, GRENADE_DAMAGE * (0.48 + falloff * 0.72), owner);
    }

    if (owner) {
      owner.grenadeCooldown = GRENADE_COOLDOWN;
    }
    if (kills > 0) {
      setStatus(state, `${owner?.name || 'A survivor'} blew apart ${kills} infected with a frag.`);
    } else {
      setStatus(state, `${owner?.name || 'A survivor'} flushed the horde with a frag grenade.`);
    }
  }

  function throwGrenade(state, player) {
    const aimData = aimDataForPlayer(player, { range: 28 });
    const dirX = Math.sin(aimData.baseAngle);
    const dirZ = -Math.cos(aimData.baseAngle);
    state.grenades.push({
      id: nextEntityId(state),
      ownerId: player.id,
      x: player.x + dirX * 0.95,
      y: (player.y || 0) + 1.5,
      z: player.z + dirZ * 0.95,
      vx: dirX * GRENADE_SPEED + (player.vx || 0) * 0.18,
      vy: GRENADE_UPWARD,
      vz: dirZ * GRENADE_SPEED + (player.vz || 0) * 0.18,
      ttl: GRENADE_FUSE,
      radius: 0.28,
      spin: rand(-8.4, 8.4),
      bounce: 0.34,
    });
  }

  function stepPlayer(state, player, dt) {
    player.flash = Math.max(0, player.flash - dt * 3.4);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.grenadeCooldown = Math.max(0, player.grenadeCooldown - dt);
    player.yaw = normalizeAngle(player.yaw);
    const moveBasisYaw = normalizeAngle(player.input.yaw);
    player.yaw = rotateToward(player.yaw, moveBasisYaw, PLAYER_TURN_SPEED * dt);
    player.weaponKey = WEAPONS[player.input.weaponKey] ? player.input.weaponKey : player.weaponKey;

    if (!player.alive) {
      const groundY = groundHeightAt(player.x, player.z);
      player.y = groundY;
      player.vy = 0;
      player.vx = 0;
      player.vz = 0;
      player.grounded = true;
      player.grenadeLatch = false;
      player.jumpLatch = false;
      if (livingPlayers(state).length > 0) {
        player.respawnTimer = Math.max(0, player.respawnTimer - dt);
        if (player.respawnTimer <= 0) {
          const point = respawnPoint(state);
          player.alive = true;
          player.health = Math.max(42, Math.round(player.maxHealth * 0.55));
          player.x = point.x;
          player.z = point.z;
          player.y = groundHeightAt(point.x, point.z);
          player.vy = 0;
          player.vx = 0;
          player.vz = 0;
          player.grounded = true;
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

    if (player.input.jump && !player.jumpLatch && player.grounded) {
      player.vy = PLAYER_JUMP_VELOCITY;
      player.grounded = false;
      player.jumpLatch = true;
    } else if (!player.input.jump) {
      player.jumpLatch = false;
    }

    let desiredVX = 0;
    let desiredVZ = 0;
    let hasMoveInput = false;
    let moveDirX = player.input.moveDirX;
    let moveDirZ = player.input.moveDirZ;
    if (Math.abs(moveDirX) > 0.001 || Math.abs(moveDirZ) > 0.001) {
      const magnitude = Math.hypot(moveDirX, moveDirZ) || 1;
      moveDirX /= magnitude;
      moveDirZ /= magnitude;
      const airControl = player.grounded ? 1 : 0.88;
      const speed = (player.input.sprint ? player.sprintSpeed : player.moveSpeed) * airControl;
      desiredVX = moveDirX * speed;
      desiredVZ = moveDirZ * speed;
      hasMoveInput = true;
    } else {
      let moveX = player.input.moveX;
      let moveY = player.input.moveY;
      if (Math.abs(moveX) > 0.001 || Math.abs(moveY) > 0.001) {
        const magnitude = Math.hypot(moveX, moveY) || 1;
        moveX /= magnitude;
        moveY /= magnitude;
        const airControl = player.grounded ? 1 : 0.88;
        const speed = (player.input.sprint ? player.sprintSpeed : player.moveSpeed) * airControl;
        const forwardX = Math.sin(moveBasisYaw);
        const forwardZ = -Math.cos(moveBasisYaw);
        const rightX = -forwardZ;
        const rightZ = forwardX;
        desiredVX = (forwardX * moveY + rightX * moveX) * speed;
        desiredVZ = (forwardZ * moveY + rightZ * moveX) * speed;
        hasMoveInput = true;
      }
    }

    const response = player.grounded ? PLAYER_ACCEL : PLAYER_AIR_ACCEL;
    const blend = Math.min(1, response * dt);
    player.vx += (desiredVX - player.vx) * blend;
    player.vz += (desiredVZ - player.vz) * blend;
    if (!hasMoveInput) {
      const drag = Math.max(0, 1 - (player.grounded ? PLAYER_DRAG : PLAYER_AIR_DRAG) * dt);
      player.vx *= drag;
      player.vz *= drag;
      if (Math.abs(player.vx) < 0.02) {
        player.vx = 0;
      }
      if (Math.abs(player.vz) < 0.02) {
        player.vz = 0;
      }
    }

    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.x = clamp(player.x, -ARENA.width * 0.47, ARENA.width * 0.47);
    player.z = clamp(player.z, -ARENA.depth * 0.47, ARENA.depth * 0.47);
    const groundY = groundHeightAt(player.x, player.z);
    player.vy -= PLAYER_GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y <= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    if (player.input.grenade && !player.grenadeLatch && player.grenadeCooldown <= 0) {
      throwGrenade(state, player);
      player.grenadeLatch = true;
    } else if (!player.input.grenade) {
      player.grenadeLatch = false;
    }

    if (player.input.fire && player.fireCooldown <= 0) {
      fireWeapon(state, player);
      player.fireCooldown = currentWeapon(player).cooldown;
      player.flash = 1;
    }
  }

  function applyZombieAttacks(state, zombie, player) {
    if (!player || !player.alive) {
      return;
    }
    if (Math.abs((player.y || 0) - (zombie.y || 0)) > 1.9) {
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
    applyDamageToPlayer(state, player, zombie.damage, zombie.x, zombie.z);
  }

  function launchAcid(state, zombie, target) {
    const dx = target.x - zombie.x;
    const dz = target.z - zombie.z;
    const distance = Math.hypot(dx, dz) || 1;
    const dirX = dx / distance;
    const dirZ = dz / distance;
    const fromY = zombieAimHeight(zombie);
    const targetY = (target.y || 0) + 1.05;
    recordEnemyProjectile(state, {
      ownerId: zombie.id,
      x: zombie.x + dirX * (zombie.radius + 0.5),
      y: fromY,
      z: zombie.z + dirZ * (zombie.radius + 0.5),
      vx: dirX * SPITTER_PROJECTILE_SPEED,
      vy: clamp((targetY - fromY) / Math.max(0.8, distance / SPITTER_PROJECTILE_SPEED), -1.6, 1.8),
      vz: dirZ * SPITTER_PROJECTILE_SPEED,
      radius: 0.32,
      ttl: 1.9,
      splashRadius: SPITTER_SPLASH_RADIUS,
      damage: SPITTER_SPLASH_DAMAGE + Math.floor(state.wave / 3),
      color: '#9bff71',
    });
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
      if (zombie.ranged) {
        const desired = zombie.preferredDistance || 15;
        let moveX = 0;
        let moveZ = 0;
        if (distance > desired + 2.4) {
          moveX = dx / distance;
          moveZ = dz / distance;
        } else if (distance < desired - 3.2) {
          moveX = -dx / distance;
          moveZ = -dz / distance;
        } else {
          const strafe = Math.sin(state.time * 0.8 + zombie.id) >= 0 ? 1 : -1;
          moveX = (dz / distance) * strafe * 0.75;
          moveZ = (-dx / distance) * strafe * 0.75;
        }
        zombie.x += moveX * zombie.speed * dt;
        zombie.z += moveZ * zombie.speed * dt;
        if (distance <= 28 && Math.abs((target.y || 0) - (zombie.y || 0)) <= 3 && zombie.attackTimer <= 0) {
          zombie.attackTimer = zombie.attackCooldown;
          launchAcid(state, zombie, target);
        }
      } else if (distance > zombie.radius + target.radius + 0.18) {
        zombie.x += (dx / distance) * zombie.speed * dt;
        zombie.z += (dz / distance) * zombie.speed * dt;
      }
      zombie.x = clamp(zombie.x, -ARENA.width * 0.49, ARENA.width * 0.49);
      zombie.z = clamp(zombie.z, -ARENA.depth * 0.49, ARENA.depth * 0.49);
      zombie.y = groundHeightAt(zombie.x, zombie.z);
      applyZombieAttacks(state, zombie, target);
    }
  }

  function stepEnemyProjectiles(state, dt) {
    for (let index = state.enemyProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = state.enemyProjectiles[index];
      projectile.ttl -= dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.z += projectile.vz * dt;
      projectile.vy -= 5.6 * dt;
      projectile.x = clamp(projectile.x, -ARENA.width * 0.52, ARENA.width * 0.52);
      projectile.z = clamp(projectile.z, -ARENA.depth * 0.52, ARENA.depth * 0.52);

      let removed = false;
      for (const player of livingPlayers(state)) {
        const dy = ((player.y || 0) + 1.05) - projectile.y;
        const horizontal = Math.sqrt(distanceSquared(player.x, player.z, projectile.x, projectile.z));
        if (horizontal > player.radius + projectile.radius || Math.abs(dy) > 1.2) {
          continue;
        }
        recordAcidSplash(state, projectile.x, Math.max(projectile.y, player.y || 0), projectile.z);
        applyDamageToPlayer(state, player, projectile.damage, projectile.x, projectile.z);
        state.enemyProjectiles.splice(index, 1);
        removed = true;
        break;
      }
      if (removed) {
        continue;
      }

      const groundY = groundHeightAt(projectile.x, projectile.z) + projectile.radius * 0.5;
      if (projectile.y <= groundY || projectile.ttl <= 0) {
        recordAcidSplash(state, projectile.x, groundY, projectile.z);
        for (const player of livingPlayers(state)) {
          const distance = Math.sqrt(distanceSquared(player.x, player.z, projectile.x, projectile.z));
          if (distance > (projectile.splashRadius || SPITTER_SPLASH_RADIUS) + player.radius) {
            continue;
          }
          const falloff = 1 - clamp(distance / (projectile.splashRadius || SPITTER_SPLASH_RADIUS), 0, 1);
          applyDamageToPlayer(state, player, projectile.damage * (0.45 + falloff * 0.55), projectile.x, projectile.z);
        }
        state.enemyProjectiles.splice(index, 1);
      }
    }
  }

  function stepRelays(state, dt) {
    if (!state.relays.length || activeRelayCount(state) >= RELAY_POINTS.length) {
      return;
    }
    let activatedThisFrame = false;
    for (const relay of state.relays) {
      relay.pulse += dt * 1.8;
      if (relay.complete) {
        continue;
      }
      let charging = false;
      for (const player of livingPlayers(state)) {
        const sameLevel = Math.abs((player.y || 0) - relay.y) <= 2.5;
        const distance = Math.sqrt(distanceSquared(player.x, player.z, relay.x, relay.z));
        if (!sameLevel || distance > relay.radius) {
          continue;
        }
        charging = true;
        relay.progress = Math.min(relay.goal, relay.progress + dt);
      }
      if (!charging) {
        relay.progress = Math.max(0, relay.progress - dt * 0.35);
      }
      if (!relay.complete && relay.progress >= relay.goal) {
        relay.complete = true;
        activatedThisFrame = true;
        pushEvent(state, 'relay-online', {
          relayId: relay.id,
          active: activeRelayCount(state),
          total: RELAY_POINTS.length,
          wave: state.wave,
        });
        setStatus(state, `Relay ${activeRelayCount(state)} of ${RELAY_POINTS.length} is online.`);
      }
    }
    if (activatedThisFrame) {
      updateMissionObjective(state);
    }
  }

  function stepNests(state, dt) {
    if (!state.nests.length || destroyedNestCount(state) >= NEST_POINTS.length) {
      return;
    }
    for (const nest of state.nests) {
      nest.pulse += dt * 2.6;
      if (nest.destroyed) {
        continue;
      }
      nest.spawnTimer -= dt;
      if (nest.spawnTimer <= 0) {
        const type = Math.random() > 0.5 ? 'crawler' : 'runner';
        spawnZombie(state, type);
        const zombie = state.zombies[state.zombies.length - 1];
        if (zombie) {
          zombie.x = clamp(nest.x + rand(-4.2, 4.2), -ARENA.width * 0.48, ARENA.width * 0.48);
          zombie.z = clamp(nest.z + rand(-4.2, 4.2), -ARENA.depth * 0.48, ARENA.depth * 0.48);
          zombie.y = groundHeightAt(zombie.x, zombie.z);
        }
        nest.spawnTimer = 3.4 + Math.random() * 1.8;
      }
    }
  }

  function stepExtraction(state, dt) {
    if (!state.extraction?.active || state.victory) {
      return;
    }
    let occupied = false;
    for (const player of livingPlayers(state)) {
      const sameLevel = Math.abs((player.y || 0) - state.extraction.y) <= 2.6;
      const distance = Math.sqrt(distanceSquared(player.x, player.z, state.extraction.x, state.extraction.z));
      if (!sameLevel || distance > state.extraction.radius) {
        continue;
      }
      occupied = true;
      break;
    }
    if (occupied) {
      state.extraction.progress = Math.min(state.extraction.goal, state.extraction.progress + dt);
    } else {
      state.extraction.progress = Math.max(0, state.extraction.progress - dt * 0.35);
    }
    if (state.extraction.progress >= state.extraction.goal) {
      completeMission(state);
    } else {
      updateMissionObjective(state);
    }
  }

  function advanceMission(state) {
    if (state.victory || state.gameOver) {
      return;
    }
    if (state.wave >= 3 && !state.relays.length) {
      ensureRelayPhase(state);
      return;
    }
    if (state.relays.length && activeRelayCount(state) >= RELAY_POINTS.length && state.wave >= 5 && !state.nests.length) {
      ensureNestPhase(state);
      return;
    }
    if (state.nests.length && destroyedNestCount(state) >= NEST_POINTS.length && state.wave >= 7 && !state.extraction?.active) {
      ensureEvacPhase(state);
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
    for (let index = state.explosions.length - 1; index >= 0; index -= 1) {
      state.explosions[index].ttl -= dt;
      if (state.explosions[index].ttl <= 0) {
        state.explosions.splice(index, 1);
      }
    }
  }

  function stepGrenades(state, dt) {
    for (let index = state.grenades.length - 1; index >= 0; index -= 1) {
      const grenade = state.grenades[index];
      grenade.ttl -= dt;
      grenade.vy -= GRENADE_GRAVITY * dt;
      grenade.x += grenade.vx * dt;
      grenade.y += grenade.vy * dt;
      grenade.z += grenade.vz * dt;
      grenade.x = clamp(grenade.x, -ARENA.width * 0.49, ARENA.width * 0.49);
      grenade.z = clamp(grenade.z, -ARENA.depth * 0.49, ARENA.depth * 0.49);
      const floorY = groundHeightAt(grenade.x, grenade.z) + grenade.radius;
      if (grenade.y <= floorY) {
        grenade.y = floorY;
        if (Math.abs(grenade.vy) > 1.1) {
          grenade.vy = Math.abs(grenade.vy) * grenade.bounce;
        } else {
          grenade.vy = 0;
        }
        grenade.vx *= 0.8;
        grenade.vz *= 0.8;
      }
      if (grenade.ttl <= 0) {
        const owner = findPlayer(state, grenade.ownerId);
        explodeGrenade(state, grenade, owner);
        state.grenades.splice(index, 1);
      }
    }
  }

  function maybeAdvanceWave(state, dt) {
    if (!state.players.length || state.gameOver || state.victory) {
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
        const pool = state.wave >= 8
          ? ['walker', 'runner', 'runner', 'crawler', 'crawler', 'spitter', 'brute', 'brute']
          : state.wave >= 5
            ? ['walker', 'walker', 'runner', 'runner', 'crawler', 'spitter', 'brute', 'brute']
          : state.wave >= 3
            ? ['walker', 'walker', 'runner', 'runner', 'crawler', 'spitter', 'brute']
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
        updateMissionObjective(state);
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
        updateMissionObjective(state);
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
    state.victory = false;
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
    stepGrenades(state, delta);
    stepZombies(state, delta);
    stepEnemyProjectiles(state, delta);
    advanceMission(state);
    stepRelays(state, delta);
    stepNests(state, delta);
    stepExtraction(state, delta);
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
    groundHeightAt,
    setPlayerInput,
    step,
  };
});
