(() => {
  'use strict';

  const SETTINGS_KEY = 'carSoccerMini.settings.v1';
  const FIELD = { width: 1600, height: 900, goalWidth: 260, goalDepth: 95 };
  const MATCH_SECONDS = 180;
  const WIN_GOALS = 5;
  const FIXED_DT = 1 / 120;
  const CAR_TURN_POWER = 2.45;
  const CAR_MAX_ANGULAR_SPEED = 0.095;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    score: document.getElementById('score'),
    time: document.getElementById('time'),
    boost: document.getElementById('boost'),
    graphicsLabel: document.getElementById('graphicsLabel'),
    networkStatus: document.getElementById('networkStatus'),
    pauseMenu: document.getElementById('pauseMenu'),
    menuStatus: document.getElementById('menuStatus'),
    graphicsToggle: document.getElementById('graphicsToggle'),
    volumeSlider: document.getElementById('volumeSlider'),
    fullscreenToggle: document.getElementById('fullscreenToggle'),
    resumeBtn: document.getElementById('resumeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    leftTeamLabel: document.getElementById('leftTeamLabel'),
    rightTeamLabel: document.getElementById('rightTeamLabel'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    serverUrlInput: document.getElementById('serverUrlInput'),
    hostOnlineBtn: document.getElementById('hostOnlineBtn'),
    joinOnlineBtn: document.getElementById('joinOnlineBtn'),
    copyInviteBtn: document.getElementById('copyInviteBtn'),
    touchControls: document.getElementById('touchControls')
  };

  const state = {
    running: true,
    paused: false,
    gameOver: false,
    accumulator: 0,
    lastFrame: performance.now(),
    scoreA: 0,
    scoreB: 0,
    countdown: MATCH_SECONDS,
    message: 'Kickoff!',
    messageTime: 1.4,
    shake: 0,
    particles: [],
    highGraphics: true,
    volume: 0.3,
    fullscreenPreferred: false,
    multiplayer: {
      enabled: false,
      role: 'local',
      ws: null,
      roomCode: '',
      serverUrl: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:8080`,
      reconnectAttempt: 0,
      reconnectTimer: null,
      lastRemoteInput: null,
      localInputSeq: 0
    }
  };

  const keys = new Set();

  function v(x = 0, y = 0) { return { x, y }; }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function len(a) { return Math.hypot(a.x, a.y); }
  function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function angleToVec(a) { return { x: Math.cos(a), y: Math.sin(a) }; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function createCar(x, y, angle, color, controls) {
    return {
      pos: v(x, y),
      vel: v(),
      angle,
      angVel: 0,
      w: 84,
      h: 48,
      color,
      boost: 100,
      controls,
      isBot: controls === null
    };
  }

  const player = createCar(FIELD.width * 0.25, FIELD.height * 0.5, 0, '#4ec9ff', {
    up: 'w', down: 's', left: 'a', right: 'd', boost: 'shift', handbrake: ' ', reset: 'r'
  });
  const bot = createCar(FIELD.width * 0.75, FIELD.height * 0.5, Math.PI, '#ff6f61', null);

  const ball = {
    pos: v(FIELD.width * 0.5, FIELD.height * 0.5),
    vel: v(),
    radius: 25
  };

  const audio = {
    ctx: null,
    unlocked: false,
    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    ping(freq = 320, duration = 0.12, type = 'square', gain = 0.08) {
      if (!this.unlocked) return;
      this.init();
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(gain * state.volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + duration);
    }
  };

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (typeof parsed.highGraphics === 'boolean') state.highGraphics = parsed.highGraphics;
      if (typeof parsed.volume === 'number') state.volume = clamp(parsed.volume, 0, 1);
      if (typeof parsed.fullscreenPreferred === 'boolean') state.fullscreenPreferred = parsed.fullscreenPreferred;
    } catch (_) {}
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      highGraphics: state.highGraphics,
      volume: state.volume,
      fullscreenPreferred: state.fullscreenPreferred
    }));
  }

  function isTouchDevice() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  function resizeCanvas() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen() {
    const sx = window.innerWidth / FIELD.width;
    const sy = window.innerHeight / FIELD.height;
    const scale = Math.min(sx, sy);
    const offsetX = (window.innerWidth - FIELD.width * scale) * 0.5;
    const offsetY = (window.innerHeight - FIELD.height * scale) * 0.5;
    return { scale, offsetX, offsetY };
  }

  function createProjection(transform) {
    const { scale, offsetX, offsetY } = transform;
    const centerX = offsetX + FIELD.width * 0.5 * scale;
    const horizonY = offsetY - FIELD.height * scale * 0.04;
    const nearY = offsetY + FIELD.height * scale * 1.02;

    const project = (x, y) => {
      const depth = clamp(y / FIELD.height, 0, 1);
      const laneScale = 0.7 + depth * 0.3;
      return {
        x: centerX + (x - FIELD.width * 0.5) * scale * laneScale,
        y: horizonY + depth * (nearY - horizonY),
        depth,
        laneScale
      };
    };

    return { project, centerX, horizonY, nearY };
  }

  function spawnParticles(x, y, count, color, speed = 220) {
    if (!state.highGraphics) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random());
      state.particles.push({
        pos: v(x, y),
        vel: v(Math.cos(a) * s, Math.sin(a) * s),
        life: 0.3 + Math.random() * 0.5,
        maxLife: 0.3 + Math.random() * 0.5,
        color
      });
    }
  }


  function sanitizeRoomCode(raw) {
    return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) || 'PUBLIC';
  }

  function sanitizeServerUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return state.multiplayer.serverUrl;
    if (/^wss?:\/\//i.test(value)) return value;
    return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${value}`;
  }

  function disconnectMultiplayer(forceLocal = false) {
    const net = state.multiplayer;
    resetMultiplayerConnection();
    net.lastRemoteInput = null;
    net.reconnectAttempt = 0;
    if (forceLocal) {
      net.enabled = false;
      net.role = 'local';
    }
    bot.isBot = true;
  }


  function getMultiplayerStatusLabel() {
    const net = state.multiplayer;
    if (!net.enabled) return 'Local vs Bot';
    if (net.ws && net.ws.readyState === WebSocket.OPEN) {
      const room = net.roomCode ? ` room ${net.roomCode}` : '';
      return `Online ${net.role}${room}`;
    }
    if (net.ws && net.ws.readyState === WebSocket.CONNECTING) return 'Connecting...';
    return 'Offline (local fallback)';
  }

  function buildInputSnapshot() {
    return {
      up: keys.has('w'),
      down: keys.has('s'),
      left: keys.has('a'),
      right: keys.has('d'),
      boost: keys.has('shift'),
      handbrake: keys.has(' ')
    };
  }

  function consumeRemoteInput() {
    const net = state.multiplayer;
    if (!net.enabled || net.role !== 'host') return null;
    const remote = net.lastRemoteInput;
    if (!remote) return null;
    return {
      throttle: (remote.up ? 1 : 0) - (remote.down ? 1 : 0),
      steer: (remote.right ? 1 : 0) - (remote.left ? 1 : 0),
      boost: Boolean(remote.boost),
      handbrake: Boolean(remote.handbrake)
    };
  }

  function shouldSendInputFrame() {
    const net = state.multiplayer;
    return Boolean(net.enabled && net.role === 'guest' && net.ws && net.ws.readyState === WebSocket.OPEN);
  }

  function sendNetworkMessage(type, payload = {}) {
    const ws = state.multiplayer.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function resetMultiplayerConnection() {
    const net = state.multiplayer;
    if (net.reconnectTimer) {
      clearTimeout(net.reconnectTimer);
      net.reconnectTimer = null;
    }
    if (net.ws) {
      net.ws.onopen = null;
      net.ws.onmessage = null;
      net.ws.onerror = null;
      net.ws.onclose = null;
      try { net.ws.close(); } catch (_) {}
      net.ws = null;
    }
  }

  function scheduleReconnect() {
    const net = state.multiplayer;
    if (!net.enabled || net.reconnectTimer) return;
    const delay = Math.min(8000, 1000 * (2 ** net.reconnectAttempt));
    net.reconnectAttempt += 1;
    net.reconnectTimer = setTimeout(() => {
      net.reconnectTimer = null;
      connectToMultiplayer();
    }, delay);
  }

  function handleServerMessage(msg) {
    const net = state.multiplayer;
    if (msg.type === 'welcome') {
      net.roomCode = msg.room || net.roomCode;
      net.role = msg.role || net.role;
      if (net.role === 'host') {
        bot.isBot = false;
      }
      state.message = msg.message || 'Connected!';
      state.messageTime = 1.2;
      return;
    }

    if (msg.type === 'peerJoined') {
      state.message = 'Opponent connected';
      state.messageTime = 1.2;
      bot.isBot = false;
      return;
    }

    if (msg.type === 'peerLeft') {
      state.message = 'Opponent disconnected';
      state.messageTime = 1.2;
      net.lastRemoteInput = null;
      bot.isBot = true;
      return;
    }

    if (msg.type === 'input' && net.role === 'host') {
      net.lastRemoteInput = msg.input || null;
      return;
    }

    if (msg.type === 'state' && net.role === 'guest' && msg.snapshot) {
      const snap = msg.snapshot;
      state.scoreA = snap.scoreA ?? state.scoreA;
      state.scoreB = snap.scoreB ?? state.scoreB;
      state.countdown = snap.countdown ?? state.countdown;
      if (snap.player) {
        player.pos = v(snap.player.pos.x, snap.player.pos.y);
        player.vel = v(snap.player.vel.x, snap.player.vel.y);
        player.angle = snap.player.angle;
        player.boost = snap.player.boost;
      }
      if (snap.bot) {
        bot.pos = v(snap.bot.pos.x, snap.bot.pos.y);
        bot.vel = v(snap.bot.vel.x, snap.bot.vel.y);
        bot.angle = snap.bot.angle;
        bot.boost = snap.bot.boost;
      }
      if (snap.ball) {
        ball.pos = v(snap.ball.pos.x, snap.ball.pos.y);
        ball.vel = v(snap.ball.vel.x, snap.ball.vel.y);
      }
    }
  }

  function connectToMultiplayer() {
    const net = state.multiplayer;
    if (!net.enabled || net.ws) return;

    let ws;
    try {
      ws = new WebSocket(net.serverUrl);
    } catch (_) {
      scheduleReconnect();
      return;
    }

    net.ws = ws;

    ws.onopen = () => {
      net.reconnectAttempt = 0;
      bot.isBot = net.role !== 'guest';
      sendNetworkMessage('join', { room: net.roomCode || 'public' });
      state.message = 'Connected to server';
      state.messageTime = 1;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (_) {}
    };

    ws.onerror = () => {
      state.message = 'Network error';
      state.messageTime = 1;
    };

    ws.onclose = () => {
      net.ws = null;
      net.lastRemoteInput = null;
      bot.isBot = true;
      if (net.enabled) scheduleReconnect();
    };
  }

  function publishHostSnapshot() {
    if (!state.multiplayer.enabled || state.multiplayer.role !== 'host') return;
    sendNetworkMessage('state', {
      snapshot: {
        scoreA: state.scoreA,
        scoreB: state.scoreB,
        countdown: state.countdown,
        player: {
          pos: player.pos,
          vel: player.vel,
          angle: player.angle,
          boost: player.boost
        },
        bot: {
          pos: bot.pos,
          vel: bot.vel,
          angle: bot.angle,
          boost: bot.boost
        },
        ball: {
          pos: ball.pos,
          vel: ball.vel
        }
      }
    });
  }

  function handleInput() {
    if (keys.has('p')) {
      keys.delete('p');
      togglePause();
    }
    if (keys.has('r')) {
      resetPositions();
      keys.delete('r');
    }
  }

  function getControlsForCar(car) {
    if (state.multiplayer.enabled && car === bot) {
      const remote = consumeRemoteInput();
      if (remote) return remote;
    }
    if (car.isBot) return computeBotControls();
    const c = car.controls;
    return {
      throttle: (keys.has(c.up) ? 1 : 0) - (keys.has(c.down) ? 1 : 0),
      steer: (keys.has(c.right) ? 1 : 0) - (keys.has(c.left) ? 1 : 0),
      boost: keys.has(c.boost),
      handbrake: keys.has(c.handbrake)
    };
  }

  function computeBotControls() {
    const target = v(ball.pos.x, ball.pos.y);
    if (ball.pos.x > FIELD.width * 0.62) {
      target.x = Math.min(target.x, FIELD.width * 0.58);
      target.y = FIELD.height * 0.5 + Math.sin(performance.now() / 500) * 120;
    }
    const toTarget = { x: target.x - bot.pos.x, y: target.y - bot.pos.y };
    const desiredAngle = Math.atan2(toTarget.y, toTarget.x);
    const angleDiff = wrapAngle(desiredAngle - bot.angle);

    let steer = clamp(angleDiff * 2.6, -1, 1);
    steer += (Math.random() - 0.5) * 0.08;

    const dist = len(toTarget);
    const towardGoal = ball.pos.x < bot.pos.x;

    return {
      throttle: dist > 90 ? 1 : 0.35,
      steer,
      boost: dist > 280 && Math.abs(angleDiff) < 0.35,
      handbrake: Math.abs(angleDiff) > 1.0 && towardGoal
    };
  }

  function updateCar(car, dt) {
    const input = getControlsForCar(car);
    const forward = angleToVec(car.angle);
    const right = { x: -forward.y, y: forward.x };

    const accel = 720;
    const turnPower = CAR_TURN_POWER;
    const maxSpeed = 560;

    car.vel.x += forward.x * input.throttle * accel * dt;
    car.vel.y += forward.y * input.throttle * accel * dt;

    const speed = len(car.vel);
    const grip = input.handbrake ? 0.6 : 1.15;
    const lateral = dot(car.vel, right);
    car.vel.x -= right.x * lateral * grip * dt;
    car.vel.y -= right.y * lateral * grip * dt;

    car.angVel += input.steer * turnPower * (0.7 + Math.min(speed / maxSpeed, 1)) * dt;
    car.angVel *= input.handbrake ? 0.90 : 0.82;
    car.angVel = clamp(car.angVel, -CAR_MAX_ANGULAR_SPEED, CAR_MAX_ANGULAR_SPEED);
    car.angle += car.angVel;

    if (input.boost && car.boost > 0) {
      const boostForce = 1200;
      car.vel.x += forward.x * boostForce * dt;
      car.vel.y += forward.y * boostForce * dt;
      car.boost = Math.max(0, car.boost - 33 * dt);
      if (Math.random() < 0.7) spawnParticles(car.pos.x - forward.x * 34, car.pos.y - forward.y * 34, 1, '#87c6ff', 80);
    } else {
      car.boost = Math.min(100, car.boost + 12 * dt);
    }

    const drag = input.handbrake ? 0.991 : 0.996;
    car.vel.x *= drag;
    car.vel.y *= drag;

    const s2 = len(car.vel);
    if (s2 > maxSpeed) {
      const r = maxSpeed / s2;
      car.vel.x *= r;
      car.vel.y *= r;
    }

    car.pos.x += car.vel.x * dt;
    car.pos.y += car.vel.y * dt;

    confineCar(car);
  }

  function confineCar(car) {
    const halfW = car.w * 0.45;
    const halfH = car.h * 0.45;
    const minX = halfW;
    const maxX = FIELD.width - halfW;
    const minY = halfH;
    const maxY = FIELD.height - halfH;

    if (car.pos.x < minX) { car.pos.x = minX; car.vel.x *= -0.35; }
    if (car.pos.x > maxX) { car.pos.x = maxX; car.vel.x *= -0.35; }
    if (car.pos.y < minY) { car.pos.y = minY; car.vel.y *= -0.35; }
    if (car.pos.y > maxY) { car.pos.y = maxY; car.vel.y *= -0.35; }
  }

  function updateBall(dt) {
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;

    const topGoalY = FIELD.height * 0.5 - FIELD.goalWidth * 0.5;
    const bottomGoalY = FIELD.height * 0.5 + FIELD.goalWidth * 0.5;
    const inGoalMouthY = ball.pos.y > topGoalY && ball.pos.y < bottomGoalY;

    if (ball.pos.y - ball.radius < 0) {
      ball.pos.y = ball.radius;
      ball.vel.y *= -0.88;
    }
    if (ball.pos.y + ball.radius > FIELD.height) {
      ball.pos.y = FIELD.height - ball.radius;
      ball.vel.y *= -0.88;
    }

    if (!inGoalMouthY && ball.pos.x - ball.radius < 0) {
      ball.pos.x = ball.radius;
      ball.vel.x *= -0.9;
    }
    if (!inGoalMouthY && ball.pos.x + ball.radius > FIELD.width) {
      ball.pos.x = FIELD.width - ball.radius;
      ball.vel.x *= -0.9;
    }

    // Full-crossing goal detection.
    if (inGoalMouthY && ball.pos.x + ball.radius < 0) {
      scoreGoal('bot');
    } else if (inGoalMouthY && ball.pos.x - ball.radius > FIELD.width) {
      scoreGoal('player');
    }

    ball.vel.x *= 0.9975;
    ball.vel.y *= 0.9975;
    const maxBallSpeed = 860;
    const sp = len(ball.vel);
    if (sp > maxBallSpeed) {
      const m = maxBallSpeed / sp;
      ball.vel.x *= m;
      ball.vel.y *= m;
    }
  }

  function collideBallCar(car) {
    const dx = ball.pos.x - car.pos.x;
    const dy = ball.pos.y - car.pos.y;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const hx = car.w * 0.5;
    const hy = car.h * 0.5;

    const closestX = clamp(localX, -hx, hx);
    const closestY = clamp(localY, -hy, hy);

    let diffX = localX - closestX;
    let diffY = localY - closestY;
    const distSq = diffX * diffX + diffY * diffY;

    if (distSq > ball.radius * ball.radius) return;

    const dist = Math.sqrt(distSq) || 0.0001;
    diffX /= dist;
    diffY /= dist;

    const nx = diffX * Math.cos(car.angle) - diffY * Math.sin(car.angle);
    const ny = diffX * Math.sin(car.angle) + diffY * Math.cos(car.angle);

    const penetration = ball.radius - dist + 0.5;
    ball.pos.x += nx * penetration;
    ball.pos.y += ny * penetration;

    const relVel = { x: ball.vel.x - car.vel.x, y: ball.vel.y - car.vel.y };
    const sepVel = dot(relVel, { x: nx, y: ny });

    if (sepVel < 0) {
      const restitution = 0.88;
      const impulse = -(1 + restitution) * sepVel;
      ball.vel.x += nx * impulse + car.vel.x * 0.035;
      ball.vel.y += ny * impulse + car.vel.y * 0.035;
      state.shake = Math.min(0.25, state.shake + 0.05);
      spawnParticles(ball.pos.x, ball.pos.y, 2, '#dff7ff', 120);
      audio.ping(240 + Math.random() * 60, 0.04, 'square', 0.05);
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.x *= 0.95;
      p.vel.y *= 0.95;
    }
  }

  function scoreGoal(side) {
    if (state.gameOver) return;
    if (side === 'player') state.scoreA += 1;
    else state.scoreB += 1;

    const opponentName = bot.isBot ? 'Bot' : 'Opponent';
    state.message = side === 'player' ? 'GOAL! You scored!' : `${opponentName} scores!`;
    state.messageTime = 1.6;
    state.shake = 0.35;
    spawnParticles(ball.pos.x, ball.pos.y, 45, side === 'player' ? '#4ec9ff' : '#ff8d87', 400);
    audio.ping(side === 'player' ? 520 : 190, 0.25, 'sawtooth', 0.12);

    if (state.scoreA >= WIN_GOALS || state.scoreB >= WIN_GOALS) {
      endMatch();
    } else {
      resetPositions();
    }
  }

  function resetPositions() {
    player.pos = v(FIELD.width * 0.25, FIELD.height * 0.5);
    player.vel = v();
    player.angle = 0;
    player.angVel = 0;
    player.boost = 100;

    bot.pos = v(FIELD.width * 0.75, FIELD.height * 0.5);
    bot.vel = v();
    bot.angle = Math.PI;
    bot.angVel = 0;
    bot.boost = 100;

    ball.pos = v(FIELD.width * 0.5, FIELD.height * 0.5);
    ball.vel = v((Math.random() - 0.5) * 130, (Math.random() - 0.5) * 100);
  }

  function endMatch() {
    state.gameOver = true;
    state.paused = true;
    const opponentName = bot.isBot ? 'Bot' : 'Opponent';
    const label = state.scoreA === state.scoreB ? 'Draw Game!' : state.scoreA > state.scoreB ? 'You Win!' : `${opponentName} Wins!`;
    ui.menuStatus.textContent = `${label} (${state.scoreA}-${state.scoreB})`;
    ui.pauseMenu.classList.remove('hidden');
  }

  function togglePause(forceValue) {
    if (typeof forceValue === 'boolean') state.paused = forceValue;
    else state.paused = !state.paused;

    if (state.paused) {
      ui.menuStatus.textContent = state.gameOver ? ui.menuStatus.textContent : 'Paused';
      ui.pauseMenu.classList.remove('hidden');
    } else {
      ui.pauseMenu.classList.add('hidden');
      if (state.fullscreenPreferred && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  }

  function restartMatch() {
    state.scoreA = 0;
    state.scoreB = 0;
    state.countdown = MATCH_SECONDS;
    state.message = 'Kickoff!';
    state.messageTime = 1.2;
    state.gameOver = false;
    state.paused = false;
    resetPositions();
    ui.pauseMenu.classList.add('hidden');
  }

  function updateUI() {
    ui.networkStatus.textContent = getMultiplayerStatusLabel();
    ui.leftTeamLabel.textContent = state.multiplayer.role === 'guest' ? 'Host' : 'You';
    ui.rightTeamLabel.textContent = bot.isBot ? 'Bot' : (state.multiplayer.role === 'guest' ? 'You' : 'Opponent');
    ui.score.textContent = `${state.scoreA} - ${state.scoreB}`;
    const mins = Math.floor(state.countdown / 60).toString().padStart(2, '0');
    const secs = Math.floor(state.countdown % 60).toString().padStart(2, '0');
    ui.time.textContent = `${mins}:${secs}`;
    ui.boost.textContent = `${Math.round(player.boost)}`;
    ui.graphicsLabel.textContent = state.highGraphics ? 'High' : 'Low';
    ui.graphicsToggle.textContent = state.highGraphics ? 'High' : 'Low';
    ui.fullscreenToggle.textContent = state.fullscreenPreferred ? 'On' : 'Off';
    ui.volumeSlider.value = state.volume.toFixed(2);
  }

  function update(dt) {
    handleInput();

    if (state.paused || state.gameOver) return;

    updateCar(player, dt);
    updateCar(bot, dt);
    updateBall(dt);
    collideBallCar(player);
    collideBallCar(bot);

    updateParticles(dt);

    if (shouldSendInputFrame()) {
      state.multiplayer.localInputSeq += 1;
      sendNetworkMessage('input', {
        seq: state.multiplayer.localInputSeq,
        input: buildInputSnapshot()
      });
    }

    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      endMatch();
    }

    if (state.messageTime > 0) state.messageTime -= dt;
    state.shake = Math.max(0, state.shake - dt * 0.8);
  }

  function drawField(transform, projection) {
    const { scale } = transform;
    const { project, centerX, horizonY, nearY } = projection;

    ctx.save();
    ctx.fillStyle = '#081222';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    if (state.shake > 0 && state.highGraphics) {
      const shakeAmount = state.shake * 8;
      ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    }

    const corners = [
      project(0, 0),
      project(FIELD.width, 0),
      project(FIELD.width, FIELD.height),
      project(0, FIELD.height)
    ];

    const skyGrad = ctx.createLinearGradient(0, 0, 0, nearY);
    skyGrad.addColorStop(0, '#071018');
    skyGrad.addColorStop(1, '#081a2b');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, window.innerWidth, nearY + 200);

    if (state.highGraphics) {
      for (let i = 0; i < 12; i++) {
        const y = horizonY + (i / 11) * (nearY - horizonY);
        const alpha = 0.08 - i * 0.005;
        ctx.strokeStyle = `rgba(135,180,255,${Math.max(0, alpha)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(window.innerWidth, y);
        ctx.stroke();
      }
    }

    const turfGrad = ctx.createLinearGradient(0, horizonY, 0, nearY);
    turfGrad.addColorStop(0, '#0f3222');
    turfGrad.addColorStop(0.55, '#175536');
    turfGrad.addColorStop(1, '#1e7248');
    ctx.fillStyle = turfGrad;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 9; i++) {
      const y0 = (i / 9) * FIELD.height;
      const y1 = ((i + 1) / 9) * FIELD.height;
      const a = project(0, y0);
      const b = project(FIELD.width, y0);
      const c = project(FIELD.width, y1);
      const d = project(0, y1);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }

    const drawLine = (x1, y1, x2, y2, w = 5) => {
      const p1 = project(x1, y1);
      const p2 = project(x2, y2);
      ctx.strokeStyle = 'rgba(236, 247, 255, 0.82)';
      ctx.lineWidth = w * (0.72 + (p1.depth + p2.depth) * 0.35) * scale;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    };

    drawLine(0, 0, FIELD.width, 0, 6);
    drawLine(FIELD.width, 0, FIELD.width, FIELD.height, 6);
    drawLine(FIELD.width, FIELD.height, 0, FIELD.height, 6);
    drawLine(0, FIELD.height, 0, 0, 6);
    drawLine(FIELD.width * 0.5, 0, FIELD.width * 0.5, FIELD.height, 5);

    ctx.strokeStyle = 'rgba(236, 247, 255, 0.74)';
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const px = FIELD.width * 0.5 + Math.cos(a) * 110;
      const py = FIELD.height * 0.5 + Math.sin(a) * 110;
      const p = project(px, py);
      if (i === 0) ctx.beginPath(), ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.lineWidth = 4.5 * scale;
    ctx.stroke();

    const gy = FIELD.height * 0.5 - FIELD.goalWidth * 0.5;
    const drawGoal = (left = true, color = 'rgba(78, 201, 255, 0.26)') => {
      const x0 = left ? -FIELD.goalDepth : FIELD.width;
      const x1 = left ? 0 : FIELD.width + FIELD.goalDepth;
      const a = project(x0, gy);
      const b = project(x1, gy);
      const c = project(x1, gy + FIELD.goalWidth);
      const d = project(x0, gy + FIELD.goalWidth);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
    };
    drawGoal(true);
    drawGoal(false, 'rgba(255, 111, 97, 0.26)');

    if (state.highGraphics) {
      const crowdGrad = ctx.createLinearGradient(0, 0, 0, horizonY + 80);
      crowdGrad.addColorStop(0, 'rgba(26,50,74,0)');
      crowdGrad.addColorStop(1, 'rgba(26,50,74,0.55)');
      ctx.fillStyle = crowdGrad;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(centerX + FIELD.width * scale * 0.55, horizonY - 55);
      ctx.lineTo(centerX - FIELD.width * scale * 0.55, horizonY - 55);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawCar(car, transform, projection) {
    const { scale } = transform;
    const p = projection.project(car.pos.x, car.pos.y);
    const carScale = scale * (0.76 + p.depth * 0.5);
    const bodyW = car.w * carScale;
    const bodyH = car.h * carScale;
    const noseX = bodyW * 0.5;
    const tailX = -bodyW * 0.5;

    const roundedRectPath = (x, y, w, h, r) => {
      const radius = Math.min(r, w * 0.5, h * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    };

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(car.angle);

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundedRectPath(tailX + 5, -bodyH * 0.5 + 6, bodyW, bodyH, bodyH * 0.24);
    ctx.fill();

    ctx.fillStyle = '#15181f';
    const wheelW = bodyW * 0.14;
    const wheelH = bodyH * 0.28;
    const wheelX = bodyW * 0.2;
    const wheelY = bodyH * 0.38;
    roundedRectPath(-wheelX - wheelW, -wheelY - wheelH, wheelW, wheelH, wheelW * 0.35);
    ctx.fill();
    roundedRectPath(wheelX, -wheelY - wheelH, wheelW, wheelH, wheelW * 0.35);
    ctx.fill();
    roundedRectPath(-wheelX - wheelW, wheelY, wheelW, wheelH, wheelW * 0.35);
    ctx.fill();
    roundedRectPath(wheelX, wheelY, wheelW, wheelH, wheelW * 0.35);
    ctx.fill();

    const paint = ctx.createLinearGradient(tailX, -bodyH * 0.5, noseX, bodyH * 0.5);
    if (car.color === '#4ec9ff') {
      paint.addColorStop(0, '#0f2c72');
      paint.addColorStop(0.35, '#136fd4');
      paint.addColorStop(0.7, '#1b6af9');
      paint.addColorStop(1, '#4db8ff');
    } else {
      paint.addColorStop(0, '#5f1620');
      paint.addColorStop(0.35, '#a22d38');
      paint.addColorStop(0.7, '#df5763');
      paint.addColorStop(1, '#ff8c77');
    }
    ctx.fillStyle = paint;
    roundedRectPath(tailX, -bodyH * 0.5, bodyW, bodyH, bodyH * 0.26);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(1.5, 2 * carScale);
    roundedRectPath(tailX + bodyW * 0.06, -bodyH * 0.5 + bodyH * 0.07, bodyW * 0.88, bodyH * 0.86, bodyH * 0.22);
    ctx.stroke();

    ctx.fillStyle = '#0f131a';
    roundedRectPath(-bodyW * 0.08, -bodyH * 0.27, bodyW * 0.33, bodyH * 0.54, bodyH * 0.16);
    ctx.fill();

    const windshield = ctx.createLinearGradient(-bodyW * 0.02, -bodyH * 0.26, bodyW * 0.2, bodyH * 0.26);
    windshield.addColorStop(0, 'rgba(120,170,220,0.72)');
    windshield.addColorStop(1, 'rgba(20,40,65,0.86)');
    ctx.fillStyle = windshield;
    roundedRectPath(-bodyW * 0.03, -bodyH * 0.21, bodyW * 0.24, bodyH * 0.42, bodyH * 0.12);
    ctx.fill();

    ctx.fillStyle = 'rgba(18,22,30,0.92)';
    roundedRectPath(noseX - bodyW * 0.2, -bodyH * 0.44, bodyW * 0.25, bodyH * 0.09, bodyH * 0.04);
    ctx.fill();

    ctx.fillStyle = '#d7ecff';
    roundedRectPath(noseX - bodyW * 0.03, -bodyH * 0.35, bodyW * 0.05, bodyH * 0.14, bodyH * 0.03);
    ctx.fill();
    roundedRectPath(noseX - bodyW * 0.03, bodyH * 0.21, bodyW * 0.05, bodyH * 0.14, bodyH * 0.03);
    ctx.fill();

    ctx.fillStyle = '#11151c';
    roundedRectPath(tailX - bodyW * 0.03, -bodyH * 0.27, bodyW * 0.08, bodyH * 0.54, bodyH * 0.06);
    ctx.fill();

    ctx.restore();
  }

  function drawBall(transform, projection) {
    const { scale } = transform;
    const p = projection.project(ball.pos.x, ball.pos.y);
    const ballScale = scale * (0.78 + p.depth * 0.42);
    ctx.save();
    ctx.translate(p.x, p.y);
    const r = ball.radius * ballScale;
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, 2, 0, 0, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d0deea');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(transform, projection) {
    const { scale } = transform;
    for (const p of state.particles) {
      const alpha = p.life / p.maxLife;
      const pp = projection.project(p.pos.x, p.pos.y);
      ctx.fillStyle = p.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      if (!ctx.fillStyle.includes('rgba')) ctx.fillStyle = `rgba(180,220,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, Math.max(1.2, 3 * scale * alpha * (0.7 + pp.depth * 0.6)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMessage() {
    if (state.messageTime <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 38px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.message, window.innerWidth / 2, window.innerHeight * 0.16);
    ctx.restore();
  }

  function render() {
    const transform = worldToScreen();
    const projection = createProjection(transform);
    drawField(transform, projection);
    if (state.highGraphics) drawParticles(transform, projection);
    drawBall(transform, projection);
    drawCar(player, transform, projection);
    drawCar(bot, transform, projection);
    drawMessage();
  }

  function frame(now) {
    const dtSec = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    state.accumulator += dtSec;

    while (state.accumulator >= FIXED_DT) {
      update(FIXED_DT);
      state.accumulator -= FIXED_DT;
    }

    render();
    updateUI();
    publishHostSnapshot();

    if (state.running) requestAnimationFrame(frame);
  }

  function setupEvents() {
    const toKey = (key) => {
      if (key === ' ') return ' ';
      if (key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight') return 'shift';
      return key.toLowerCase();
    };

    window.addEventListener('keydown', (e) => {
      const k = toKey(e.key);
      keys.add(k);
      if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      audio.unlocked = true;
      audio.init();
    });
    window.addEventListener('keyup', (e) => keys.delete(toKey(e.key)));

    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !state.paused) togglePause(true);
    });

    ui.resumeBtn.addEventListener('click', () => togglePause(false));
    ui.restartBtn.addEventListener('click', restartMatch);

    ui.graphicsToggle.addEventListener('click', () => {
      state.highGraphics = !state.highGraphics;
      saveSettings();
    });

    ui.volumeSlider.addEventListener('input', () => {
      state.volume = clamp(parseFloat(ui.volumeSlider.value), 0, 1);
      saveSettings();
    });

    ui.fullscreenToggle.addEventListener('click', () => {
      state.fullscreenPreferred = !state.fullscreenPreferred;
      saveSettings();
      if (!state.fullscreenPreferred && document.fullscreenElement) {
        document.exitFullscreen?.();
      }
    });

    ui.hostOnlineBtn.addEventListener('click', () => {
      const net = state.multiplayer;
      net.roomCode = sanitizeRoomCode(ui.roomCodeInput.value || net.roomCode);
      net.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value || net.serverUrl);
      net.role = 'host';
      net.enabled = true;
      disconnectMultiplayer(false);
      connectToMultiplayer();
      state.message = `Hosting room ${net.roomCode}`;
      state.messageTime = 1.2;
    });

    ui.joinOnlineBtn.addEventListener('click', () => {
      const net = state.multiplayer;
      net.roomCode = sanitizeRoomCode(ui.roomCodeInput.value || net.roomCode);
      net.serverUrl = sanitizeServerUrl(ui.serverUrlInput.value || net.serverUrl);
      net.role = 'guest';
      net.enabled = true;
      disconnectMultiplayer(false);
      connectToMultiplayer();
      state.message = `Joining room ${net.roomCode}`;
      state.messageTime = 1.2;
    });

    ui.copyInviteBtn.addEventListener('click', async () => {
      const net = state.multiplayer;
      const room = sanitizeRoomCode(ui.roomCodeInput.value || net.roomCode);
      const server = sanitizeServerUrl(ui.serverUrlInput.value || net.serverUrl);
      const invite = `${window.location.origin}${window.location.pathname}?mp=1&role=guest&room=${encodeURIComponent(room)}&server=${encodeURIComponent(server)}`;
      try {
        await navigator.clipboard.writeText(invite);
        state.message = 'Invite copied';
      } catch (_) {
        state.message = 'Copy failed';
      }
      state.messageTime = 1.2;
    });

    const params = new URLSearchParams(window.location.search);
    const net = state.multiplayer;
    if (params.get('mp') === '1') {
      net.enabled = true;
      net.roomCode = sanitizeRoomCode(params.get('room') || net.roomCode);
      net.serverUrl = sanitizeServerUrl(params.get('server') || net.serverUrl);
      const role = params.get('role');
      if (role === 'host' || role === 'guest') net.role = role;
      connectToMultiplayer();
    }

    ui.roomCodeInput.value = net.roomCode || 'PUBLIC';
    ui.serverUrlInput.value = net.serverUrl;

    if (isTouchDevice()) {
      ui.touchControls.classList.remove('hidden');
      const map = { shift: 'shift', space: ' ' };
      ui.touchControls.querySelectorAll('button').forEach((btn) => {
        const key = map[btn.dataset.key] || btn.dataset.key;
        const press = (down) => {
          if (down) keys.add(key);
          else keys.delete(key);
        };
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); press(true); }, { passive: false });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); press(false); }, { passive: false });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); press(false); }, { passive: false });
      });
    }
  }

  loadSettings();
  resizeCanvas();
  setupEvents();
  resetPositions();
  updateUI();
  requestAnimationFrame(frame);
})();
